#!/usr/bin/env node
/*
 * Fact-gathering harness for Phase 5.
 *
 * This script NEVER writes to data/. It reads the corpus, asks external catalogues what they hold
 * for each work, reconciles the answers against each other, and emits two artifacts:
 *
 *   evidence/<medium>-<date>.json   machine-readable proposals, each with its grade and sources
 *   evidence/<medium>-<date>.md     the human review queue: everything the machine will not decide
 *
 * scripts/apply-facts.js is the only thing that edits the corpus, and it only applies grade A.
 * The split is the whole point: gathering is allowed to be wrong, applying is not.
 *
 * EVIDENCE GRADES
 *   A  two independent sources agree, and they disagree with the corpus  -> applyable
 *   B  one source, or two that agree on a field only one of them carries -> review queue
 *   C  model recall, or a value with no source at all                    -> NEVER produced here,
 *                                                                          and never written to
 *                                                                          the corpus by anything
 *
 * A field where the corpus already agrees with the sources is recorded as `confirmed` and produces
 * no edit -- but it is exactly what earns the record its prov stamp, so it is kept in the output.
 *
 * KEYS
 * Read from the environment, never from the repo, never logged:
 *   OMDB_API_KEY          omdbapi.com
 *   TMDB_API_KEY          themoviedb.org (v3 key)
 *   IGDB_CLIENT_ID        + IGDB_CLIENT_SECRET (Twitch app credentials)
 * openlibrary.org and googleapis.com/books need no key.
 * Missing a key is not an error: that source is skipped and every field it would have carried
 * drops a grade, which the output says out loud.
 *
 * OFFLINE
 * The entire pipeline downstream of the network runs without it:
 *   --offline <file>   replay recorded observations instead of calling anything
 *   --record  <file>   write every raw API response of a live run to <file>, so that run can be
 *                      replayed, diffed, and argued with later
 * A recorded observation carries the untouched API response (`raw`, and `rawDetail` for TMDB's
 * second call), not just the fields parsed out of it -- so replaying re-runs the SAME adapter
 * parse() a live call would, against TODAY's code. That matters: a parse()-level fix (a title-match
 * guard, say) can only be verified against an old run if replay re-parses, rather than trusting
 * fields decided back when the bug was still live. A recording made before this existed has no
 * `raw` and falls back to trusting its stored fields, which is all it has.
 * This is how the harness was built and tested before any key existed, and it is why a live run
 * is reproducible rather than a one-off.
 *
 * USAGE
 *   node scripts/fetch-facts.js --medium movie --limit 25
 *   node scripts/fetch-facts.js --medium book --ids b01,b02,b03
 *   node scripts/fetch-facts.js --medium movie --owned-first --limit 50 --record raw.json
 *   node scripts/fetch-facts.js --medium movie --offline raw.json
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ===================== the corpus ===================== */

const SECTIONS = {
  movie: { file: 'data/movies.js', varName: 'movies' },
  tv:    { file: 'data/tv.js',     varName: 'tvShows' },
  game:  { file: 'data/games.js',  varName: 'videoGames' },
  book:  { file: 'data/books.js',  varName: 'books' },
};

function loadSection(medium) {
  const sec = SECTIONS[medium];
  const src = fs.readFileSync(path.join(ROOT, sec.file), 'utf8');
  return new Function(src + '\nreturn ' + sec.varName + ';')();
}

/* ===================== what each medium's facts are, and where they live ===================== */

/* `corpusPath` is where the value sits on a record; `label` is what a human calls it. Only fields
   an external catalogue can actually settle are listed. Indices, vibes and justifications are
   judgement and are scored against RUBRIC.md, not looked up -- putting them here would be the
   quietest possible way to launder a guess into the corpus. */
const FACT_FIELDS = {
  movie: [
    { key: 'year',    corpusPath: 'year',    label: 'release year' },
    { key: 'runtime', corpusPath: 'runtime', label: 'runtime (min)' },
    { key: 'creator', corpusPath: 'creator', label: 'director', text: true, people: true },
    { key: 'studio',  corpusPath: 'studio',  label: 'studio', text: true, soft: true },
  ],
  tv: [
    { key: 'year',    corpusPath: 'year',            label: 'first air year' },
    { key: 'seasons', corpusPath: 'totalSeasons',    label: 'seasons' },
    { key: 'creator', corpusPath: 'creator',         label: 'creator', text: true, people: true },
    { key: 'network', corpusPath: 'networkStreamer', label: 'network / streamer', text: true, soft: true },
  ],
  game: [
    { key: 'year',      corpusPath: 'year',                 label: 'release year' },
    { key: 'creator',   corpusPath: 'creator',              label: 'developer', text: true, people: true },
    { key: 'platforms', corpusPath: 'platformAvailability', label: 'platforms', list: true, soft: true },
  ],
  book: [
    { key: 'year',      corpusPath: 'year',      label: 'first publication year' },
    { key: 'pages',     corpusPath: 'pages',     label: 'page count', editionDependent: true },
    { key: 'creator',   corpusPath: 'creator',   label: 'author', text: true, people: true },
    { key: 'publisher', corpusPath: 'publisher', label: 'publisher', text: true, soft: true, editionDependent: true },
  ],
};

/* ===================== source adapters ===================== */

/* Each adapter returns {src, url, fields:{...}} or null. `fields` uses the medium's own field keys
   above, so reconciliation never has to know which catalogue an answer came from. Shapes follow
   each API's documented response; every access is defensive, because a catalogue that changes a
   field name should degrade to "this source had nothing" rather than crash a 500-work run. */

const num = v => { const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : undefined; };
// OMDb spells "we have nothing for this field" as the literal string "N/A" (its Production field
// in particular has been a dead field returning only this for years). Treating it as a real value
// makes every movie's studio look like a disagreement against the corpus -- noise, not a fact.
const str = v => { if (typeof v !== 'string') return undefined; const t = v.trim(); return (t && !/^n\/a$/i.test(t)) ? t : undefined; };
const firstYear = v => { const m = String(v || '').match(/\d{4}/); return m ? parseInt(m[0], 10) : undefined; };

// Shared with reconcile() below. Declared here (rather than left where reconciliation uses it)
// because the source adapters need it too, to verify a catalogue actually answered about the work
// that was asked for -- see pickTmdbHit and the OMDb title guard.
const normText = v => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// OMDb disambiguates two entries that share a title by appending " (YYYY)" to the Title field of
// its answer -- found live querying "1917": it answers "1917 (2019)" for the real film, not "1917".
// That is OMDb's own formatting convention, not a different work, so it is stripped before the
// title-match guard runs. Left in place, the guard would reject a correct match on every title OMDb
// happens to disambiguate this way -- a real cost (lost corroboration) but not the WALL-E danger
// (a genuinely different title slipping through), since this only strips a trailing year in parens.
const stripOmdbYearSuffix = v => String(v == null ? '' : v).replace(/\s*\(\d{4}\)\s*$/, '');

// TMDB's /search endpoint ranks by its own relevance score, not by exact title, so `results[0]` is
// not "the movie we searched for" -- it is "TMDB's best guess". Found live: searching "WALL-E"
// (the corpus's ASCII-hyphen spelling) ranks the same-year Pixar short "WALL·E's Treasures &
// Trinkets" ABOVE the real film (titled with a middle dot, not a hyphen) in TMDB's own results, and
// OMDb's "exact title" endpoint made the identical wrong call for the identical reason. Both
// catalogues corroborating each other looked like grade-A evidence and would have overwritten a
// correct 98-minute runtime with the short's 5 minutes. A search hit only counts as the work if its
// title actually matches once punctuation/case are normalised; otherwise it is not evidence at all.
function pickTmdbHit(results, medium, work) {
  if (!Array.isArray(results) || !results.length || !work) return null;
  const want = normText(work.title);
  const titleOf = r => (medium === 'tv' ? r.name : r.title);
  return results.find(r => normText(titleOf(r)) === want) || null;
}

const ADAPTERS = {
  omdb: {
    label: 'OMDb',
    media: ['movie', 'tv'],
    key: () => process.env.OMDB_API_KEY,
    request(work, medium, key) {
      const q = new URLSearchParams({ apikey: key, t: work.title, type: medium === 'tv' ? 'series' : 'movie' });
      if (work.year) q.set('y', String(work.year));
      return 'https://www.omdbapi.com/?' + q;
    },
    // Used ONLY as a fallback when the year-constrained request above finds nothing. OMDb's `y=` is
    // an exact filter, not a tolerance, and its registered year for a title is not always the
    // corpus's -- found live re-verifying the owned batches: The Good, the Bad and the Ugly is 1966
    // in the corpus, 1967 on OMDb; A Beautiful Mind 2001 vs 2002; Schindler's List 1993 vs 1994. One
    // year off returns "Movie not found!" even though the title is right there, which permanently
    // caps that field at single-source grade B for no real reason. Dropping the year constraint on
    // retry is safe because the title-match guard in parse() below is the actual safety net, not
    // this parameter -- proven live: an unconstrained search for "Star Wars: A New Hope" returns a
    // 2025 stage-reading production first, and the guard rejects it on title exactly as it would a
    // year-constrained wrong match.
    retryRequest(work, medium, key) {
      return 'https://www.omdbapi.com/?' + new URLSearchParams({ apikey: key, t: work.title, type: medium === 'tv' ? 'series' : 'movie' });
    },
    parse(json, medium, work) {
      if (!json || json.Response === 'False') return null;
      // OMDb's "exact title" endpoint can still answer with a different work of the same name and
      // year (see pickTmdbHit's comment for the live WALL-E case, where OMDb made this exact
      // mistake). If what came back isn't actually the title asked for, it is not evidence.
      if (work && normText(stripOmdbYearSuffix(json.Title)) !== normText(work.title)) return null;
      const f = { year: firstYear(json.Year) };
      if (medium === 'movie') {
        f.runtime = num(json.Runtime);
        f.creator = str(json.Director);
        f.studio = str(json.Production);
      } else {
        f.seasons = num(json.totalSeasons);
        f.creator = str(json.Writer);   // OMDb has no creator field for series; Writer is the
                                        // closest it offers and is often a list, so tv creators
                                        // from OMDb are treated as weak (see reconcile()).
      }
      return f;
    },
  },

  tmdb: {
    label: 'TMDB',
    media: ['movie', 'tv'],
    key: () => process.env.TMDB_API_KEY,
    request(work, medium, key) {
      const q = new URLSearchParams({ api_key: key, query: work.title });
      if (medium === 'movie' && work.year) q.set('year', String(work.year));
      return 'https://api.themoviedb.org/3/search/' + (medium === 'tv' ? 'tv' : 'movie') + '?' + q;
    },
    parse(json, medium, work) {
      const hit = pickTmdbHit(json && json.results, medium, work);
      if (!hit) return null;
      return medium === 'movie'
        ? { year: firstYear(hit.release_date) }
        : { year: firstYear(hit.first_air_date) };
      // Runtime, seasons, director and network need a second /movie/{id} or /tv/{id} call. The
      // detail fetch is a documented follow-up, not a guess, so it lives in detailRequest below.
    },
    detailRequest(hit, medium, key) {
      if (!hit || !hit.id) return null;
      return 'https://api.themoviedb.org/3/' + (medium === 'tv' ? 'tv' : 'movie') + '/' + hit.id +
        '?' + new URLSearchParams({ api_key: key, append_to_response: 'credits' });
    },
    parseDetail(json, medium) {
      if (!json) return null;
      if (medium === 'movie') {
        const crew = (json.credits && json.credits.crew) || [];
        const dir = crew.filter(c => c.job === 'Director').map(c => c.name).join(', ');
        return {
          year: firstYear(json.release_date),
          runtime: num(json.runtime),
          creator: str(dir),
          studio: str(((json.production_companies || [])[0] || {}).name),
        };
      }
      return {
        year: firstYear(json.first_air_date),
        seasons: num(json.number_of_seasons),
        creator: str((json.created_by || []).map(c => c.name).join(', ')),
        network: str(((json.networks || [])[0] || {}).name),
      };
    },
  },

  openlibrary: {
    label: 'OpenLibrary',
    media: ['book'],
    key: () => 'keyless',
    request(work) {
      return 'https://openlibrary.org/search.json?' + new URLSearchParams({ title: work.title, limit: '1' });
    },
    parse(json) {
      const hit = json && Array.isArray(json.docs) && json.docs[0];
      if (!hit) return null;
      return {
        year: num(hit.first_publish_year),
        pages: num(hit.number_of_pages_median),
        creator: str((hit.author_name || [])[0]),
        publisher: str((hit.publisher || [])[0]),
      };
    },
  },

  googlebooks: {
    label: 'Google Books',
    media: ['book'],
    key: () => 'keyless',
    request(work) {
      return 'https://www.googleapis.com/books/v1/volumes?' +
        new URLSearchParams({ q: 'intitle:' + work.title, maxResults: '1' });
    },
    parse(json) {
      const v = json && Array.isArray(json.items) && json.items[0] && json.items[0].volumeInfo;
      if (!v) return null;
      return {
        year: firstYear(v.publishedDate),
        pages: num(v.pageCount),
        creator: str((v.authors || [])[0]),
        publisher: str(v.publisher),
      };
    },
  },

  igdb: {
    label: 'IGDB',
    media: ['game'],
    key: () => (process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET) ? 'oauth' : undefined,
    // IGDB is POST-with-a-query-body and needs an OAuth token exchange first, so it does not fit
    // the GET shape above. That is handled in callSource(); the parse stays here with the rest.
    parse(json) {
      const hit = Array.isArray(json) && json[0];
      if (!hit) return null;
      return {
        year: hit.first_release_date ? new Date(hit.first_release_date * 1000).getUTCFullYear() : undefined,
        creator: str(((hit.involved_companies || []).find(c => c.developer) || {}).name),
        platforms: (hit.platforms || []).map(p => p && p.name).filter(Boolean),
      };
    },
  },
};

// Maps a recorded observation's human label ("TMDB") back to its ADAPTERS key ("tmdb"), so a
// replayed run can find the adapter that produced it.
const LABEL_TO_KEY = Object.fromEntries(Object.entries(ADAPTERS).map(([k, a]) => [a.label, k]));

/* --offline replay's whole point is letting an old run be re-argued against today's code. That only
   works for reconcile()-level changes unless the recorded observation is re-parsed, too -- a
   parse()-level fix (the title-collision guard is exactly this) can never be exercised by replaying
   pre-computed `fields`, because those fields were already decided at record time. If the
   observation carries `raw` (recorded after this was added), re-derive `fields` from it through
   today's adapter; a legacy recording with no `raw` falls back to trusting its stored `fields`, the
   only thing it has. */
function reparseObservation(obs, medium, work) {
  if (!obs || obs.error || obs.skipped || obs.raw === undefined) return obs;
  const adKey = LABEL_TO_KEY[obs.src];
  const ad = adKey && ADAPTERS[adKey];
  if (!ad) return obs;
  let fields = adKey === 'igdb' ? ad.parse(obs.raw) : ad.parse(obs.raw, medium, work);
  if (adKey === 'tmdb' && obs.rawDetail !== undefined) {
    fields = Object.assign({}, fields, ad.parseDetail(obs.rawDetail, medium));
  }
  return Object.assign({}, obs, { fields });
}

/* ===================== reconciliation ===================== */

/* Text comparison is deliberately loose on punctuation and case and strict on everything else:
   "Stanley Kubrick" and "stanley kubrick" are the same director, "Kubrick" and "Christopher Nolan"
   are not, and no amount of substring cleverness should be allowed to decide otherwise. Substring
   matching is what put a genre boost on the wrong works twice in this repo's history.
   (normText itself is declared up with the source adapters -- they need it too.) */

/* A multi-person credit has no stable word order -- found live re-verifying this session: OMDb and
   TMDB corroborate the SAME two Coen brothers on the SAME film in opposite orders, and the same
   duo's own two films disagree with EACH OTHER on order too (Avengers: Infinity War and Captain
   America: The Winter Soldier, both "Anthony & Joe Russo", each source picks a different order on
   each film). Comparing the raw joined string treats that as a factual disagreement it is not.
   Mirrors validate-corpus.js's `people()` key: split on separators, expand a bare first name that
   shares the group's surname ("Josh & Benny Safdie" -> "Josh Safdie" + "Benny Safdie"), then compare
   as a set. That check is the reason this matters at all -- the corpus's own creator-identity
   invariant requires every record for one person or duo to use the IDENTICAL string, because the
   app's creator boost matches by literal substring, so an order difference silently splits one
   person's filmography into two unconnected credits. */
const splitNames = v => String(v == null ? '' : v)
  .split(/\s*(?:&|,|\band\b)\s*/i).map(s => s.trim()).filter(Boolean);
// Expands a bare first name that shares the group's surname ("Josh & Benny Safdie" -> "Josh Safdie",
// "Benny Safdie"), keeping original casing -- shared by peopleKey (comparison) and
// canonicalizePeople (the written form) so they can never disagree about who "Josh" is.
function expandNames(v) {
  const raw = splitNames(v);
  const surname = (raw[raw.length - 1] || '').trim().split(/\s+/).pop();
  return raw.map(p => {
    const t = p.trim();
    return (t.split(/\s+/).length === 1 && surname && normText(t) !== normText(surname)) ? t + ' ' + surname : t;
  });
}
const peopleKey = v => expandNames(v).map(normText).sort().join('|');
// The value actually WRITTEN when sources agree as a set but not on order: a single deterministic
// (alphabetical) join, so the same duo converges on one string no matter which source or which of
// their films supplied it, rather than each record freezing in whatever order its own source used.
const canonicalizePeople = v => {
  const names = expandNames(v);
  if (names.length < 2) return v;
  return names.slice().sort((a, b) => normText(a).localeCompare(normText(b))).join(', ');
};

function valuesAgree(field, a, b) {
  if (a == null || b == null) return false;
  if (field.list) {
    const A = new Set((a || []).map(normText)), B = new Set((b || []).map(normText));
    if (!A.size || !B.size) return false;
    let shared = 0; A.forEach(v => { if (B.has(v)) shared++; });
    return shared / Math.max(A.size, B.size) >= 0.5;   // catalogues disagree on port lists forever
  }
  if (field.people) {
    const A = peopleKey(a), B = peopleKey(b);
    return A !== '' && A === B;
  }
  if (field.text) {
    const A = normText(a), B = normText(b);
    return A !== '' && A === B;
  }
  /* Numbers are compared exactly, with no tolerance band. A tolerance sounds reasonable -- two
     catalogues a minute apart on a runtime, a page count off by the front matter -- but it makes
     the harness quietly decide which small differences do not matter, and that is precisely the
     judgement this script is not allowed to make. A one-minute disagreement goes to the review
     queue, where a person can say "that is the PAL transfer" in two seconds. */
  return Number(a) === Number(b);
}

const dig = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

/* One work's observations -> one proposal per field. This is the only place a grade is decided. */
function reconcile(medium, work, observations) {
  const out = [];
  for (const field of FACT_FIELDS[medium]) {
    const current = dig(work, field.corpusPath);
    const seen = observations
      .map(o => ({ src: o.src, url: o.url, value: o.fields ? o.fields[field.key] : undefined }))
      .filter(o => o.value !== undefined && o.value !== null && o.value !== '');

    if (!seen.length) {
      out.push({ field: field.key, label: field.label, soft: !!field.soft, current, status: 'no-source', grade: null, sources: [] });
      continue;
    }

    // Group observations that agree with each other.
    const groups = [];
    for (const o of seen) {
      const g = groups.find(g => valuesAgree(field, g.value, o.value));
      if (g) g.sources.push(o); else groups.push({ value: o.value, sources: [o] });
    }
    groups.sort((a, b) => b.sources.length - a.sources.length);
    const best = groups[0];
    const contested = groups.length > 1;

    // For a people field, "matches the corpus" means matches EXACTLY, not just the same set of
    // names -- otherwise a record already correct in substance but formatted "Joel & Ethan Coen"
    // would be marked merely `confirmed` and never rewritten to the one literal string the corpus's
    // own creator-identity check (validate-corpus.js) requires every record for that duo to share.
    // Convergence has to be an active rewrite, not something that only happens to records that
    // already happened to be typed in the canonical order.
    const proposed = field.people ? canonicalizePeople(best.value) : best.value;
    const matchesCorpus = field.people
      ? normText(current) === normText(proposed)
      : valuesAgree(field, current, best.value);
    const corroborated = best.sources.length >= 2 && !contested;

    let status, grade;
    if (matchesCorpus && !contested) {
      status = 'confirmed';
      grade = corroborated ? 'A' : 'B';
    } else if (contested) {
      // Sources disagree with each other. Never applyable, whatever the corpus says -- the review
      // queue is exactly for the cases where the world does not have one answer.
      status = field.editionDependent ? 'edition-dependent' : 'sources-disagree';
      grade = 'B';
    } else {
      status = 'proposed-change';
      grade = corroborated ? 'A' : 'B';
      if (field.soft) grade = 'B';   // studio/publisher/network/platforms are naming conventions as
                                     // much as facts; two catalogues agreeing on "Warner Bros." vs
                                     // "Warner Bros. Pictures" is not licence to rewrite the field.
    }

    out.push({
      field: field.key, label: field.label, soft: !!field.soft, current,
      proposed, status, grade,
      sources: seen.map(o => ({ src: o.src, value: o.value, url: o.url })),
      alternatives: contested ? groups.slice(1).map(g => g.value) : undefined,
    });
  }
  return out;
}

/* ===================== the network half ===================== */

/* Every recorded URL passes through here before it can reach a file or the console. OMDb spells
   it `apikey`, TMDB `api_key`, and a recorded run is meant to be committed -- so this is the one
   place a key could leak, and it is deliberately a single chokepoint rather than a careful habit. */
const redactKeys = u => String(u).replace(/(api_?key|client_secret|access_token)=[^&]*/gi, '$1=REDACTED');

async function getJSON(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  return res.json();
}

let igdbToken = null;
async function igdbAuth() {
  if (igdbToken) return igdbToken;
  const body = new URLSearchParams({
    client_id: process.env.IGDB_CLIENT_ID,
    client_secret: process.env.IGDB_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const j = await getJSON('https://id.twitch.tv/oauth2/token?' + body, { method: 'POST' });
  igdbToken = j.access_token;
  return igdbToken;
}

async function callSource(name, work, medium) {
  const ad = ADAPTERS[name];
  const key = ad.key();
  if (!key) return { src: ad.label, skipped: 'no key in environment' };
  try {
    if (name === 'igdb') {
      const token = await igdbAuth();
      const res = await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: 'Bearer ' + token },
        body: 'search "' + String(work.title).replace(/"/g, '') + '"; fields name,first_release_date,' +
              'platforms.name,involved_companies.company.name,involved_companies.developer; limit 1;',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      return { src: ad.label, url: 'igdb:games', raw, fields: ad.parse(raw) };
    }
    let url = ad.request(work, medium, key);
    let json = await getJSON(url);
    let fields = ad.parse(json, medium, work);
    if (fields === null && ad.retryRequest && work.year) {
      // The primary request found nothing usable -- retry without the year constraint (OMDb only;
      // see retryRequest's comment for why this is safe). Keep the primary response as the record
      // of what happened if the retry ALSO finds nothing, rather than overwriting it with a second
      // failure that explains less.
      const rurl = ad.retryRequest(work, medium, key);
      const rjson = await getJSON(rurl);
      const rfields = ad.parse(rjson, medium, work);
      if (rfields !== null) { url = rurl; json = rjson; fields = rfields; }
    }
    let rawDetail;
    if (name === 'tmdb' && ad.detailRequest) {
      // Same hit pickTmdbHit chose for parse() above -- re-deriving it independently here (as this
      // used to do with a bare `results[0]`) is exactly how a search-ranking mismatch could pick two
      // different "hits" for the summary and the detail fetch without anything noticing.
      const hit = pickTmdbHit(json && json.results, medium, work);
      const durl = ad.detailRequest(hit, medium, key);
      if (durl) { rawDetail = await getJSON(durl); fields = Object.assign({}, fields, ad.parseDetail(rawDetail, medium)); }
    }
    // The key is in the URL for OMDb and TMDB. It must never reach a file or the console.
    // `raw`/`rawDetail` are the untouched API responses -- kept alongside `fields` so a recorded run
    // can be replayed through WHATEVER parse() looks like when it is replayed, not just whatever it
    // looked like when it was recorded. Without this, a parse-level fix (like the title-collision
    // guard above) could never be verified offline against an old recording -- only reconcile()-level
    // fixes could, because reconcile is the only thing --offline used to re-run.
    return { src: ad.label, url: redactKeys(String(url)), raw: json, rawDetail, fields };
  } catch (e) {
    return { src: ad.label, error: e.message };
  }
}

/* ===================== output ===================== */

// A soft field (studio/publisher/network/platform list) whose OWN sources agree with each other is
// a naming-convention question, not a fact in dispute -- "Warner Bros." vs "Warner Bros. Pictures"
// is not the kind of thing a human needs to read one line at a time. At 93 works this was already
// most of the queue (studio naming variance was the single largest category in every batch); at
// 2,508 it would bury the genuine disagreements under thousands of lines nobody will ever read.
// Genuine conflicts -- sources disagreeing WITH EACH OTHER (sources-disagree, edition-dependent),
// and any HARD-field question, however it arose -- stay listed individually. Nothing is dropped:
// a naming-only field is still in the evidence JSON, just not spelled out in the human queue.
const isNamingOnly = p => !!p.soft && p.status === 'proposed-change';

function writeReviewQueue(file, medium, results) {
  const lines = ['# Review queue -- ' + medium + ' -- ' + new Date().toISOString().slice(0, 10), '',
    'Everything here needs a human. Grade A proposals are not listed: `scripts/apply-facts.js`',
    'applies those and records them in the JSON beside this file.', ''];
  let n = 0;          // genuine questions -- what actually needs a decision
  let nameOnly = 0;   // soft-field naming variance, counted but not spelled out per field
  for (const r of results) {
    const needs = r.proposals.filter(p => p.grade === 'B' && p.status !== 'confirmed');
    const named = needs.filter(isNamingOnly);
    const keep = needs.filter(p => !isNamingOnly(p));
    nameOnly += named.length;
    if (!keep.length) continue;   // nothing genuine for this work -- rolled into the tally above
    n += keep.length;
    lines.push('## ' + r.title + ' (' + r.id + ')');
    for (const p of keep) {
      lines.push('- **' + p.label + '** -- corpus has `' + JSON.stringify(p.current) + '`, ' +
        (p.status === 'sources-disagree' || p.status === 'edition-dependent'
          ? 'sources disagree (' + p.status + '): '
          : 'one source says ') +
        p.sources.map(s => s.src + ' `' + JSON.stringify(s.value) + '`').join(', '));
    }
    if (named.length) {
      lines.push('- _(+' + named.length + ' naming-only field' + (named.length === 1 ? '' : 's') +
        ' not shown -- sources agree with each other, differ from the corpus only in naming; see the evidence JSON.)_');
    }
    lines.push('');
  }
  const summary = [n === 0 ? '_Nothing genuinely in question._' : '**' + n + ' fields awaiting a decision.**'];
  if (nameOnly) {
    summary.push('**' + nameOnly + ' additional naming-only field' + (nameOnly === 1 ? '' : 's') +
      ' omitted** -- soft field, sources agree with each other, differ from the corpus only in ' +
      'naming (e.g. "Warner Bros." vs "Warner Bros. Pictures"). Full detail is in the evidence JSON.');
  }
  lines.splice(4, 0, ...summary, '');
  fs.writeFileSync(file, lines.join('\n'));
  return n;
}

/* ===================== main ===================== */

function parseArgs(argv) {
  const a = { medium: null, ids: null, limit: null, ownedFirst: false, offline: null, record: null, outDir: 'evidence' };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--medium') a.medium = argv[++i];
    else if (v === '--ids') a.ids = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (v === '--limit') a.limit = parseInt(argv[++i], 10);
    else if (v === '--owned-first') a.ownedFirst = true;
    else if (v === '--offline') a.offline = argv[++i];
    else if (v === '--record') a.record = argv[++i];
    else if (v === '--out-dir') a.outDir = argv[++i];
    else { console.error('unknown argument: ' + v); process.exit(2); }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.medium || !SECTIONS[args.medium]) {
    console.error('usage: fetch-facts.js --medium movie|tv|game|book [--ids a,b] [--limit N]\n' +
      '                      [--owned-first] [--offline raw.json] [--record raw.json]');
    process.exit(2);
  }

  let works = loadSection(args.medium);
  if (args.ids) { const want = new Set(args.ids); works = works.filter(w => want.has(w.id)); }
  if (args.ownedFirst) works = works.slice().sort((a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0));
  if (args.limit) works = works.slice(0, args.limit);

  const replay = args.offline ? JSON.parse(fs.readFileSync(args.offline, 'utf8')) : null;
  const recorded = {};
  const sources = Object.keys(ADAPTERS).filter(n => ADAPTERS[n].media.includes(args.medium));

  if (!replay) {
    const missing = sources.filter(n => !ADAPTERS[n].key());
    if (missing.length === sources.length) {
      console.error('No API keys in the environment for ' + args.medium + ' (' +
        sources.map(n => ADAPTERS[n].label).join(', ') + ').');
      console.error('Set them as environment variables -- never in the repo -- or run with --offline.');
      process.exit(3);
    }
    if (missing.length) console.error('  note: skipping ' + missing.map(n => ADAPTERS[n].label).join(', ') + ' (no key)');
  }

  const results = [];
  for (const work of works) {
    const observations = replay
      ? (replay[work.id] || []).map(o => reparseObservation(o, args.medium, work))
      : await Promise.all(sources.map(n => callSource(n, work, args.medium)));
    if (args.record) recorded[work.id] = observations;
    const usable = observations.filter(o => o && o.fields);
    results.push({
      id: work.id, title: work.title,
      sourcesReached: usable.map(o => o.src),
      sourcesMissed: observations.filter(o => o && !o.fields).map(o => o.src + (o.error ? ' (' + o.error + ')' : ' (' + (o.skipped || 'no match') + ')')),
      proposals: reconcile(args.medium, work, usable),
    });
  }

  const outDir = path.resolve(ROOT, args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = path.join(outDir, args.medium + '-' + stamp);
  fs.writeFileSync(base + '.json', JSON.stringify({
    medium: args.medium, generated: new Date().toISOString(), offline: !!args.offline,
    sources: sources.map(n => ADAPTERS[n].label), works: results,
  }, null, 1));
  const queued = writeReviewQueue(base + '.md', args.medium, results);
  if (args.record) fs.writeFileSync(args.record, JSON.stringify(recorded, null, 1));

  const flat = results.flatMap(r => r.proposals);
  const count = s => flat.filter(p => p.status === s).length;
  console.log('\n' + works.length + ' ' + args.medium + ' works, ' + flat.length + ' fields');
  console.log('  confirmed        ' + count('confirmed') +
    '  (grade A: ' + flat.filter(p => p.status === 'confirmed' && p.grade === 'A').length + ')');
  console.log('  proposed change  ' + count('proposed-change') +
    '  (grade A, applyable: ' + flat.filter(p => p.status === 'proposed-change' && p.grade === 'A').length + ')');
  console.log('  sources disagree ' + (count('sources-disagree') + count('edition-dependent')));
  console.log('  no source        ' + count('no-source'));
  console.log('  -> ' + base + '.json');
  console.log('  -> ' + base + '.md   (' + queued + ' fields for review)\n');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { reconcile, valuesAgree, redactKeys, FACT_FIELDS, ADAPTERS, writeReviewQueue, pickTmdbHit, reparseObservation, callSource, canonicalizePeople, peopleKey };
