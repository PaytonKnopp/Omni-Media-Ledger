#!/usr/bin/env node
/*
 * Substance gathering for Phase 5 -- the evidence the RUBRIC is scored FROM.
 *
 * WHY THIS IS A SEPARATE SCRIPT FROM fetch-facts.js
 * Facts and substance are different kinds of thing and must not share a pipeline.
 *   - A fact (runtime, year, page count) has one right answer. Two sources agreeing settles it,
 *     and scripts/apply-facts.js writes it into the corpus.
 *   - Substance (what a work is ABOUT) has no right answer to reconcile. It is raw material for a
 *     judgement, and nothing here is ever written into data/ automatically.
 * Keeping them apart preserves the invariant the whole quality pass rests on: apply-facts.js is the
 * only script that edits the corpus, and it applies only corroborated facts. If substance flowed
 * through the same grader, a keyword list would eventually be "applied" as though it were a fact.
 *
 * WHY SUBSTANCE IS THE HIGH-LEVERAGE FETCH
 * Measured on this corpus: gmBase has sd 2.82 against the boost stack's 6.52, so ~84% of
 * pre-override score variance is the boost stack -- and the boost stack keys on genres, vibes,
 * creators and the rubric indices, NOT on critic scores. A 12-point critic-score correction moves
 * the match score by about 3. So the catalogues' aggregate scores are the least leveraged thing
 * this project could fetch, and what a work is about is the most.
 *
 * LICENSING -- WHY TAGS ARE THE DEFAULT AND PROSE IS OPT-IN
 * This repository is public. Facts are not copyrightable (Feist v. Rural Telephone): a runtime, a
 * year, a director's name can be committed freely. A plot synopsis is expressive text and is
 * protected, so committing 2,500 verbatim synopses to a public repo is redistribution, not
 * personal use.
 * So by default this script keeps only SHORT FACTUAL TAGS -- TMDB keywords, IGDB themes,
 * OpenLibrary subjects, Google Books categories. Those are the better scoring input anyway
 * ("time loop", "small town", "obsession" is more useful to a rubric than a paragraph of plot),
 * and they carry none of the redistribution question.
 * `--include-prose` additionally keeps synopses. It writes them to a file that .gitignore already
 * excludes, prints a warning, and is meant for a local-only scoring session.
 *
 * ATTRIBUTION
 * TMDB's terms require this line wherever its data is used:
 *   "This product uses the TMDB API but is not endorsed or certified by TMDB."
 * The emitted pack carries it in its header so it travels with the data.
 *
 * KEYS
 *   TMDB_API_KEY                              movies, TV
 *   IGDB_CLIENT_ID + IGDB_CLIENT_SECRET       games
 *   (openlibrary.org and googleapis.com/books need none)
 * Missing a key skips that source and the pack says so, per work.
 *
 * USAGE
 *   node scripts/fetch-substance.js --medium movie --limit 25
 *   node scripts/fetch-substance.js --medium book --owned-first --limit 50 --record raw.json
 *   node scripts/fetch-substance.js --medium movie --offline raw.json
 *   node scripts/fetch-substance.js --medium movie --plan-only        # count calls, fetch nothing
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { redactKeys, pickTmdbHit } = require('./fetch-facts.js');

const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

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

/* ===================== normalising tags ===================== */

/* Tags arrive spelled a dozen ways across four catalogues. They are lowercased and trimmed, and
   compared EXACTLY after that -- never by substring. Substring matching on tags is how "war" finds
   "warmth" and "art" finds "heart", and it has already gone wrong twice in this repo's history. */
const normTag = v => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();

function mergeTags() {
  const out = [];
  const seen = new Set();
  for (const list of arguments) {
    for (const raw of (list || [])) {
      const t = normTag(raw);
      if (!t || t.length > 60 || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/* ===================== sources ===================== */

async function getJSON(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  return res.json();
}

/* TMDB: search for the title, then pull keywords off the matched id. The keyword list is the point
   -- TMDB's `keywords` are curated short tags and they are far closer to what RUBRIC.md reasons
   about than either the genre list or the overview. */
async function tmdbSubstance(work, medium) {
  const key = process.env.TMDB_API_KEY;
  if (!key) return { src: 'TMDB', skipped: 'no TMDB_API_KEY in environment' };
  const kind = medium === 'tv' ? 'tv' : 'movie';
  try {
    const q = new URLSearchParams({ api_key: key, query: work.title });
    if (medium === 'movie' && work.year) q.set('year', String(work.year));
    const search = await getJSON('https://api.themoviedb.org/3/search/' + kind + '?' + q);
    // Same guard as fetch-facts.js's pickTmdbHit, and for the same live-discovered reason: TMDB's
    // search ranking is not "the work asked for", it's TMDB's relevance score, and it has been
    // caught ranking a same-year same-prefix doppelganger above the real film (WALL-E). Wrong tags
    // are worse than missing ones here -- they'd silently misinform a rubric score later instead of
    // showing up as "NO tags at all", which is the one signal this script gives a human to check.
    const hit = pickTmdbHit(search && search.results, medium, work);
    if (!hit) return { src: 'TMDB', miss: 'no match for "' + work.title + '"' };

    const detail = await getJSON('https://api.themoviedb.org/3/' + kind + '/' + hit.id + '?' +
      new URLSearchParams({ api_key: key, append_to_response: 'keywords' }));
    const kw = (detail.keywords && (detail.keywords.keywords || detail.keywords.results)) || [];
    return {
      src: 'TMDB',
      url: redactKeys('https://api.themoviedb.org/3/' + kind + '/' + hit.id),
      matchedTitle: hit.title || hit.name,
      tags: mergeTags(kw.map(k => k && k.name)),
      sourceGenres: mergeTags((detail.genres || []).map(g => g && g.name)),
      synopsis: (hit.overview || detail.overview || '').trim() || undefined,
    };
  } catch (e) { return { src: 'TMDB', error: e.message }; }
}

/* IGDB: themes and genres are separate vocabularies there, and themes ("Horror", "Mystery",
   "Survival") are much closer to the rubric's constructs than genres ("Shooter") are. */
let igdbToken = null;
async function igdbSubstance(work) {
  if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
    return { src: 'IGDB', skipped: 'no IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in environment' };
  }
  try {
    if (!igdbToken) {
      const t = await getJSON('https://id.twitch.tv/oauth2/token?' + new URLSearchParams({
        client_id: process.env.IGDB_CLIENT_ID,
        client_secret: process.env.IGDB_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }), { method: 'POST' });
      igdbToken = t.access_token;
    }
    const res = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': process.env.IGDB_CLIENT_ID, Authorization: 'Bearer ' + igdbToken },
      body: 'search "' + String(work.title).replace(/"/g, '') + '"; ' +
            'fields name,summary,themes.name,genres.name,keywords.name; limit 1;',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const hit = (await res.json())[0];
    if (!hit) return { src: 'IGDB', miss: 'no match for "' + work.title + '"' };
    return {
      src: 'IGDB', url: 'igdb:games', matchedTitle: hit.name,
      tags: mergeTags((hit.themes || []).map(t => t && t.name), (hit.keywords || []).map(k => k && k.name)),
      sourceGenres: mergeTags((hit.genres || []).map(g => g && g.name)),
      synopsis: (hit.summary || '').trim() || undefined,
    };
  } catch (e) { return { src: 'IGDB', error: e.message }; }
}

/* OpenLibrary subjects are the richest free tag vocabulary for books, and the data is open. */
async function openLibrarySubstance(work) {
  try {
    const j = await getJSON('https://openlibrary.org/search.json?' +
      new URLSearchParams({ title: work.title, limit: '1' }));
    const hit = j && Array.isArray(j.docs) && j.docs[0];
    if (!hit) return { src: 'OpenLibrary', miss: 'no match for "' + work.title + '"' };
    return {
      src: 'OpenLibrary', url: 'https://openlibrary.org/search.json?title=' + encodeURIComponent(work.title),
      matchedTitle: hit.title,
      // `subject` runs to hundreds of entries on a well-catalogued book, most of them shelving
      // minutiae. The first 40 are the ones actually about the work.
      tags: mergeTags((hit.subject || []).slice(0, 40)),
      sourceGenres: [],
    };
  } catch (e) { return { src: 'OpenLibrary', error: e.message }; }
}

async function googleBooksSubstance(work) {
  try {
    const j = await getJSON('https://www.googleapis.com/books/v1/volumes?' +
      new URLSearchParams({ q: 'intitle:' + work.title, maxResults: '1' }));
    const v = j && Array.isArray(j.items) && j.items[0] && j.items[0].volumeInfo;
    if (!v) return { src: 'Google Books', miss: 'no match for "' + work.title + '"' };
    return {
      src: 'Google Books', url: 'https://www.googleapis.com/books/v1/volumes?q=intitle:' + encodeURIComponent(work.title),
      matchedTitle: v.title,
      tags: mergeTags(v.categories),
      sourceGenres: [],
      synopsis: (v.description || '').trim() || undefined,
    };
  } catch (e) { return { src: 'Google Books', error: e.message }; }
}

const SOURCES_FOR = {
  movie: [w => tmdbSubstance(w, 'movie')],
  tv:    [w => tmdbSubstance(w, 'tv')],
  game:  [igdbSubstance],
  book:  [openLibrarySubstance, googleBooksSubstance],
};

// How many HTTP calls one work costs, for --plan-only. TMDB is two (search, then detail).
const CALLS_PER_WORK = { movie: 2, tv: 2, game: 1, book: 2 };

/* ===================== the pack ===================== */

/* One entry per work: the merged tag vocabulary, who said what, and what was missed. `coverage`
   is the number that matters when deciding whether a scoring pass can proceed -- a work with no
   tags at all cannot be rubric-scored from evidence, and must be flagged rather than guessed. */
function packEntry(work, observations, includeProse) {
  const usable = observations.filter(o => o && (o.tags || o.sourceGenres));
  const entry = {
    id: work.id,
    title: work.title,
    year: work.year,
    corpusGenres: (work.genres || []).slice(),
    tags: mergeTags.apply(null, usable.map(o => o.tags)),
    sourceGenres: mergeTags.apply(null, usable.map(o => o.sourceGenres)),
    sources: usable.map(o => ({ src: o.src, matchedTitle: o.matchedTitle, url: o.url })),
    missed: observations.filter(o => o && !o.tags && !o.sourceGenres)
      .map(o => o.src + ' (' + (o.error || o.miss || o.skipped || 'nothing returned') + ')'),
  };
  if (includeProse) {
    entry.synopsis = usable.map(o => o.synopsis).filter(Boolean)[0];
  }
  entry.coverage = entry.tags.length;
  return entry;
}

/* ===================== main ===================== */

function parseArgs(argv) {
  const a = { medium: null, ids: null, limit: null, ownedFirst: false, offline: null,
              record: null, outDir: 'evidence', includeProse: false, planOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--medium') a.medium = argv[++i];
    else if (v === '--ids') a.ids = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (v === '--limit') a.limit = parseInt(argv[++i], 10);
    else if (v === '--owned-first') a.ownedFirst = true;
    else if (v === '--offline') a.offline = argv[++i];
    else if (v === '--record') a.record = argv[++i];
    else if (v === '--out-dir') a.outDir = argv[++i];
    else if (v === '--include-prose') a.includeProse = true;
    else if (v === '--plan-only') a.planOnly = true;
    else { console.error('unknown argument: ' + v); process.exit(2); }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.medium || !SECTIONS[args.medium]) {
    console.error('usage: fetch-substance.js --medium movie|tv|game|book [--ids a,b] [--limit N]\n' +
      '                          [--owned-first] [--offline raw.json] [--record raw.json]\n' +
      '                          [--include-prose] [--plan-only]');
    process.exit(2);
  }

  let works = loadSection(args.medium);
  if (args.ids) { const want = new Set(args.ids); works = works.filter(w => want.has(w.id)); }
  if (args.ownedFirst) works = works.slice().sort((a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0));
  if (args.limit) works = works.slice(0, args.limit);

  if (args.planOnly) {
    const calls = works.length * (CALLS_PER_WORK[args.medium] || 1);
    console.log('\n' + works.length + ' ' + args.medium + ' works x ' +
      (CALLS_PER_WORK[args.medium] || 1) + ' calls each = ' + calls + ' HTTP requests');
    console.log('  TMDB has no published daily cap but asks for ~50 req/s or less;');
    console.log('  OMDb free tier is 1,000/day; OpenLibrary and Google Books are courtesy-limited.');
    console.log('  Nothing was fetched.\n');
    return;
  }

  if (args.includeProse) {
    console.error('  NOTE: --include-prose keeps synopsis text. Synopses are expressive works, not');
    console.error('  facts, and this repository is public -- the prose pack is gitignored. Keep it local.');
  }

  const replay = args.offline ? JSON.parse(fs.readFileSync(args.offline, 'utf8')) : null;
  const recorded = {};
  const entries = [];
  for (const work of works) {
    const observations = replay
      ? (replay[work.id] || [])
      : await Promise.all(SOURCES_FOR[args.medium].map(fn => fn(work)));
    if (args.record) recorded[work.id] = observations;
    entries.push(packEntry(work, observations, args.includeProse));
  }

  const outDir = path.resolve(ROOT, args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = path.join(outDir, 'substance-' + args.medium + '-' + stamp +
    (args.includeProse ? '.prose' : '') + '.json');
  fs.writeFileSync(base, JSON.stringify({
    medium: args.medium,
    generated: new Date().toISOString(),
    offline: !!args.offline,
    includesProse: args.includeProse,
    attribution: (args.medium === 'movie' || args.medium === 'tv') ? TMDB_ATTRIBUTION : undefined,
    works: entries,
  }, null, 1));
  if (args.record) fs.writeFileSync(args.record, JSON.stringify(recorded, null, 1));

  const withTags = entries.filter(e => e.coverage > 0);
  const bare = entries.filter(e => e.coverage === 0);
  console.log('\n' + entries.length + ' ' + args.medium + ' works');
  console.log('  with tags        ' + withTags.length +
    '  (median ' + median(withTags.map(e => e.coverage)) + ' tags each)');
  console.log('  NO tags at all   ' + bare.length + (bare.length ? '  <- cannot be rubric-scored from evidence' : ''));
  bare.slice(0, 10).forEach(e => console.log('     ' + e.id + '  ' + e.title));
  if (bare.length > 10) console.log('     ...and ' + (bare.length - 10) + ' more');
  console.log('  -> ' + base + '\n');
}

function median(ns) {
  if (!ns.length) return 0;
  const s = ns.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { mergeTags, normTag, packEntry, TMDB_ATTRIBUTION, tmdbSubstance };
