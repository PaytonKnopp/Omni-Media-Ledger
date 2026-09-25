#!/usr/bin/env node
/*
 * How far is the corpus's audienceScore from IMDb's user rating? Movies and TV only.
 *
 * NOTES.md "Ideas / next steps" #6 names reception scores as the only part of data provenance with
 * real score leverage, and DATA_RUNBOOK.md names IMDb's bulk `title.ratings.tsv.gz` (personal,
 * non-commercial use; bulk download, no API, no scraping) as the one source for film/TV audience.
 * Before anything is recalibrated -- and recalibration is all-or-nothing per field -- this measures
 * the size and shape of the gap. It is a MEASUREMENT: it reads data/ and never writes to it.
 *
 * Pipeline, per work:
 *   1. TMDB search (title + year) -> the TMDB id, accepted only on an exact normalised title match
 *      (title or original title) within +/-1 year of the corpus year (see pickCandidate).
 *   2. TMDB /external_ids -> the IMDb tconst.
 *   3. IMDb's title.ratings.tsv.gz -> averageRating, numVotes.
 *   gap = audienceScore - round(averageRating * 10, 1). Positive means the corpus rates it higher.
 *
 * Writes evidence/imdb-audience-gap-<date>.json (the per-work match table: ids, ratings, gaps, no
 * third-party prose) and evidence/imdb-audience-gap-<date>.md (the report).
 *
 * Usage:
 *   node scripts/measure-imdb-gap.js                      # full run (~5,000 TMDB calls)
 *   node scripts/measure-imdb-gap.js --limit 20           # smoke test
 *   node scripts/measure-imdb-gap.js --reuse evidence/imdb-audience-gap-2026-09-25.json
 *        # skip TMDB for works already matched in that table; re-score against a fresh ratings file
 *   node scripts/measure-imdb-gap.js --ratings path/to/title.ratings.tsv.gz   # use a local copy
 *
 * TMDB auth: if TMDB_API_KEY (v3) is set it is sent as `api_key`. Otherwise requests go out
 * keyless, for environments whose egress proxy injects an `Authorization: Bearer` read-access
 * token. Keys never reach the output files: only TMDB/IMDb ids are recorded, never URLs.
 *
 * "This product uses the TMDB API but is not endorsed or certified by TMDB."
 * IMDb data courtesy of IMDb (https://www.imdb.com), used under its non-commercial dataset terms.
 */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { getJSON, stripYearSuffix } = require('./fetch-facts.js');

// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node >= 22.21). Behind a
// proxy without it, every request fails with a bare connection error that looks like "TMDB is
// down". Re-exec once with it set rather than make every caller remember.
if (process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1' && require.main === module) {
  const r = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)],
    { stdio: 'inherit', env: Object.assign({}, process.env, { NODE_USE_ENV_PROXY: '1' }) });
  process.exit(r.status == null ? 1 : r.status);
}

const ROOT = path.resolve(__dirname, '..');
const SECTIONS = {
  movie: { file: 'data/movies.js', varName: 'movies', label: 'Movies' },
  tv:    { file: 'data/tv.js',     varName: 'tvShows', label: 'TV' },
};
const RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const TMDB = 'https://api.themoviedb.org/3';
const CONCURRENCY = 8;

function loadSection(medium) {
  const sec = SECTIONS[medium];
  const src = fs.readFileSync(path.join(ROOT, sec.file), 'utf8');
  return new Function(src + '\nreturn ' + sec.varName + ';')();
}

// Same normalisation as fetch-facts.js (diacritics stripped before the alphanumeric filter, so
// "WALL-E" and "WALL·E" both become "wall e"). Kept local because fetch-facts doesn't export it.
const normText = v => String(v == null ? '' : v)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const yearOf = d => { const m = String(d || '').match(/^\d{4}/); return m ? +m[0] : undefined; };

function tmdbUrl(p, params) {
  const q = new URLSearchParams(params || {});
  if (process.env.TMDB_API_KEY) q.set('api_key', process.env.TMDB_API_KEY);
  const s = q.toString();
  return TMDB + p + (s ? '?' + s : '');
}

/* TMDB's search ranks by its own relevance, so results[0] is a guess (see pickTmdbHit in
   fetch-facts.js for the WALL-E case). A candidate counts only if its title or original title
   matches exactly once normalised, and its year is within one of the corpus's -- release-year
   registrations differ by a year across catalogues often enough (festival vs. wide release) that
   exact-year would drop real matches.
   Among survivors the most-voted on TMDB wins, NOT the closest year or TMDB's own order -- found on
   the first full run: "Split", "Enemy", "Birdman" and "A Silent Voice" each have an obscure
   same-title, same-year namesake (22 to 553 IMDb votes) that TMDB ranked first, which produced the
   run's four "worst gaps" (up to 46 points) out of pure mismatches. The corpus holds notable works,
   so the heavily-voted candidate is the one it means. `rivals` counts the others that passed.
   A TMDB title that is the corpus title plus a SUBTITLE also qualifies -- found on the second run:
   TMDB titles Birdman "Birdman or (The Unexpected Virtue of Ignorance)" and A Silent Voice "A
   Silent Voice: The Movie", so an exact-only rule left just the obscure exact-title namesakes (49
   and 199 IMDb votes). Only a real separator (":", " - ", " or ") counts, never a bare
   continuation, so "Scream" does not reach "Scream VI" a year later; and an exact title still wins
   unless the subtitled candidate has over 10x its TMDB votes. */
const SUBTITLE_SEP = /^(?:\s*[:\u2013\u2014-]\s+|\s*:\s*|,?\s+or\s*[,(:]?\s*)\S/i;
function titleQualifies(raw, want) {
  const t = stripYearSuffix(raw || '');
  if (normText(t) === want) return 'exact';
  // Compare on the raw title so the separator survives, but match the prefix case/accent-blind.
  const plain = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (let cut = 1; cut < plain.length; cut++) {
    if (normText(plain.slice(0, cut)) === want) return SUBTITLE_SEP.test(plain.slice(cut)) ? 'subtitle' : null;
  }
  return null;
}
function pickCandidate(results, medium, work) {
  if (!Array.isArray(results)) return null;
  const want = normText(stripYearSuffix(work.title));
  const titles = r => medium === 'tv' ? [r.name, r.original_name] : [r.title, r.original_title];
  const dateOf = r => medium === 'tv' ? r.first_air_date : r.release_date;
  const pass = [];
  for (const r of results) {
    const kinds = titles(r).map(t => titleQualifies(t, want));
    const kind = kinds.includes('exact') ? 'exact' : kinds.includes('subtitle') ? 'subtitle' : null;
    if (!kind) continue;
    const y = yearOf(dateOf(r));
    if (y === undefined || Math.abs(y - work.year) > 1) continue;
    pass.push({ id: r.id, year: y, title: titles(r)[0], votes: r.vote_count || 0, kind });
  }
  if (!pass.length) return null;
  // An exact title beats a subtitled one unless the subtitled one is an order of magnitude better
  // known -- the Birdman case, where the exact-title candidate is a 5-vote namesake.
  const top = list => list.length ? list.reduce((a, b) => (b.votes > a.votes ? b : a)) : null;
  const ex = top(pass.filter(p => p.kind === 'exact')), sub = top(pass.filter(p => p.kind === 'subtitle'));
  const best = !ex ? sub : !sub ? ex : (sub.votes > 10 * ex.votes ? sub : ex);
  return Object.assign(best, { rivals: pass.length - 1 });
}

async function matchWork(work, medium) {
  const kind = medium === 'tv' ? 'tv' : 'movie';
  const title = stripYearSuffix(work.title);
  const yearParam = medium === 'tv' ? 'first_air_date_year' : 'year';
  // Both searches, pooled: the year-filtered one reaches an obscure title buried past page 1 of an
  // unfiltered search, and the unfiltered one reaches a famous film TMDB dates a year off the
  // corpus -- which, searched only with the corpus year, would lose to a same-year namesake. The
  // +/-1-year guard in pickCandidate applies to both.
  const [byYear, open] = await Promise.all([
    getJSON(tmdbUrl('/search/' + kind, { query: title, [yearParam]: String(work.year) })),
    getJSON(tmdbUrl('/search/' + kind, { query: title })),
  ]);
  const seen = new Set();
  const results = [...(byYear.results || []), ...(open.results || [])].filter(r => !seen.has(r.id) && seen.add(r.id));
  const hit = pickCandidate(results, medium, work);
  if (!hit) return { status: 'no-tmdb-match' };
  const how = (hit.kind === 'subtitle' ? 'title+subtitle' : 'title') + (hit.year === work.year ? ', same year' : ', year +/-1');
  const ext = await getJSON(tmdbUrl('/' + kind + '/' + hit.id + '/external_ids'));
  const imdbId = ext && typeof ext.imdb_id === 'string' && /^tt\d+$/.test(ext.imdb_id) ? ext.imdb_id : null;
  return {
    status: imdbId ? 'matched' : 'no-imdb-id',
    tmdbId: hit.id, tmdbTitle: hit.title, tmdbYear: hit.year, rivals: hit.rivals, how, imdbId,
  };
}

async function pool(items, n, fn) {
  let i = 0, done = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k], k);
      if (++done % 100 === 0) process.stderr.write('  ' + done + '/' + items.length + '\n');
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
}

async function loadRatings(file) {
  if (!file) {
    file = path.join(os.tmpdir(), 'imdb-title.ratings.tsv.gz');
    const fresh = fs.existsSync(file) && (Date.now() - fs.statSync(file).mtimeMs) < 24 * 3600e3;
    if (!fresh) {
      process.stderr.write('Downloading ' + RATINGS_URL + '\n');
      const res = await fetch(RATINGS_URL);
      if (!res.ok) throw new Error('IMDb ratings download: HTTP ' + res.status);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
  }
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const map = new Map();
  const lines = text.split('\n');
  for (let k = 1; k < lines.length; k++) {  // line 0 is the header: tconst averageRating numVotes
    const [id, r, v] = lines[k].split('\t');
    if (id) map.set(id, { rating: +r, votes: +v });
  }
  return { map, file, mtime: fs.statSync(file).mtime.toISOString().slice(0, 10) };
}

/* ===================== statistics ===================== */

const round1 = x => Math.round(x * 10) / 10;
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function pearson(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { const dx = xs[k] - mx, dy = ys[k] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
// Average ranks (ties share the mean of the positions they span), 1-based.
function ranks(xs) {
  const idx = xs.map((v, k) => k).sort((a, b) => xs[a] - xs[b]);
  const out = new Array(xs.length);
  for (let k = 0; k < idx.length;) {
    let j = k;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[k]]) j++;
    for (let t = k; t <= j; t++) out[idx[t]] = (k + j) / 2 + 1;
    k = j + 1;
  }
  return out;
}
const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));
const sd = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, v) => a + (v - m) * (v - m), 0) / xs.length); };

/* The app never uses audienceScore raw: normalizeReceptionByKind (app/scoring.js) z-scores it
   within each medium, so a constant offset from IMDb, and a difference in spread, both vanish
   before scoring. What survives is ORDER. So alongside the raw gap this reports the offset, the
   gap left once that offset is removed, the two spreads, and Spearman's rank correlation. */
function absStats(vals) {
  const abs = vals.map(Math.abs).sort((a, b) => a - b), n = abs.length;
  return {
    median: quantile(abs, 0.5), mean: abs.reduce((a, b) => a + b, 0) / n,
    rms: Math.sqrt(abs.reduce((a, v) => a + v * v, 0) / n),
    p90: quantile(abs, 0.9), p95: quantile(abs, 0.95), max: abs[n - 1],
    within5: abs.filter(a => a <= 5).length / n, within10: abs.filter(a => a <= 10).length / n,
    over15: abs.filter(a => a > 15).length, over20: abs.filter(a => a > 20).length,
  };
}
function summarize(rows) {
  const n = rows.length;
  if (!n) return null;
  const gaps = rows.map(r => r.gap);
  const ours = rows.map(r => r.audienceScore), theirs = rows.map(r => r.imdb10);
  const offset = gaps.reduce((a, b) => a + b, 0) / n;
  return {
    n, offset,
    medianSigned: quantile(gaps.slice().sort((a, b) => a - b), 0.5),
    higher: gaps.filter(g => g > 0).length, lower: gaps.filter(g => g < 0).length,
    raw: absStats(gaps),
    adj: absStats(gaps.map(g => g - offset)),
    sdOurs: sd(ours), sdImdb: sd(theirs),
    r: pearson(ours, theirs),
    rho: spearman(ours, theirs),
  };
}

/* ===================== report ===================== */

const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const pct = x => Math.round(x * 100) + '%';
const sgn = x => (x > 0 ? '+' : '') + f1(x);
const esc = s => String(s).replace(/\|/g, '\\|');

function mediumSection(label, all, rows, lowVoteFloor) {
  const out = [];
  const counts = {};
  for (const w of all) counts[w.status] = (counts[w.status] || 0) + 1;
  const s = summarize(rows);
  const solid = rows.filter(r => r.votes >= lowVoteFloor);
  const ss = summarize(solid);
  out.push('## ' + label, '');
  out.push('**Matched: ' + rows.length + ' of ' + all.length + '** (' + pct(rows.length / all.length) + ') have an IMDb rating to compare against.', '');
  out.push('| Outcome | Works |', '|---|---:|');
  out.push('| TMDB match, IMDb id, IMDb rating | ' + rows.length + ' |');
  if (counts['no-rating']) out.push('| IMDb id but no row in title.ratings | ' + counts['no-rating'] + ' |');
  if (counts['no-imdb-id']) out.push('| TMDB match but TMDB lists no IMDb id | ' + counts['no-imdb-id'] + ' |');
  if (counts['no-tmdb-match']) out.push('| No TMDB result with the title within ±1 year | ' + counts['no-tmdb-match'] + ' |');
  if (counts.error) out.push('| Request error | ' + counts.error + ' |');
  out.push('');
  if (!s) return out;
  const col = (name, fn) => '| ' + name + ' | ' + fn(s) + ' | ' + (ss ? fn(ss) : '—') + ' |';
  out.push('Gap = our `audienceScore` − IMDb rating × 10. Positive = the corpus rates it higher than IMDb users do.', '');
  out.push('| | All matched | ≥ ' + lowVoteFloor.toLocaleString('en-US') + ' IMDb votes |', '|---|---:|---:|');
  out.push(col('Works', x => x.n));
  out.push('| ***Offset*** | | |');
  out.push(col('**Average offset** (mean gap)', x => '**' + sgn(x.offset) + '**'));
  out.push(col('Median gap', x => sgn(x.medianSigned)));
  out.push(col('Corpus higher / lower than IMDb', x => x.higher + ' / ' + x.lower));
  out.push('| ***Raw gap*** | | |');
  out.push(col('**Median absolute gap** (typical)', x => '**' + f1(x.raw.median) + '**'));
  out.push(col('Mean / RMS absolute gap', x => f1(x.raw.mean) + ' / ' + f1(x.raw.rms)));
  out.push(col('Within ±5 / ±10 points', x => pct(x.raw.within5) + ' / ' + pct(x.raw.within10)));
  out.push(col('90th / 95th percentile absolute gap', x => f1(x.raw.p90) + ' / ' + f1(x.raw.p95)));
  out.push(col('Gaps over 15 / over 20 points', x => x.raw.over15 + ' / ' + x.raw.over20));
  out.push(col('**Worst absolute gap**', x => '**' + f1(x.raw.max) + '**'));
  out.push('| ***Gap after removing the offset*** | | |');
  out.push(col('**Median absolute gap** (typical)', x => '**' + f1(x.adj.median) + '**'));
  out.push(col('Mean / RMS absolute gap', x => f1(x.adj.mean) + ' / ' + f1(x.adj.rms)));
  out.push(col('Within ±5 / ±10 points', x => pct(x.adj.within5) + ' / ' + pct(x.adj.within10)));
  out.push(col('90th / 95th percentile absolute gap', x => f1(x.adj.p90) + ' / ' + f1(x.adj.p95)));
  out.push(col('Gaps over 15 / over 20 points', x => x.adj.over15 + ' / ' + x.adj.over20));
  out.push(col('Worst absolute gap', x => f1(x.adj.max)));
  out.push('| ***Order and spread*** | | |');
  out.push(col('**Spearman rank correlation**', x => '**' + x.rho.toFixed(2) + '**'));
  out.push(col('Pearson correlation', x => x.r.toFixed(2)));
  out.push(col('Spread (SD): ours / IMDb×10', x => f1(x.sdOurs) + ' / ' + f1(x.sdImdb)));
  out.push('');
  // Percentile of each work within this medium's matched set, on each side, so the table shows
  // rank disagreement (what survives the app's per-medium normalisation), not just the raw gap.
  const pOurs = ranks(rows.map(r => r.audienceScore)), pImdb = ranks(rows.map(r => r.imdb10));
  const toPct = rk => rows.length > 1 ? Math.round((rk - 1) / (rows.length - 1) * 100) : 50;
  rows.forEach((r, k) => { r._pOurs = toPct(pOurs[k]); r._pImdb = toPct(pImdb[k]); });
  out.push('### 20 biggest outliers', '');
  out.push('Ranked by raw gap. "Gap − offset" subtracts this medium\'s average offset (' + sgn(s.offset) + '); ' +
    '"Percentile" is the work\'s standing among the ' + rows.length + ' matched ' + label.toLowerCase() + ' on each side (ours → IMDb).', '');
  out.push('| # | id | Title | Year | Ours | IMDb ×10 | Gap | Gap − offset | Percentile | IMDb votes | IMDb id |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|');
  rows.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.id.localeCompare(b.id)).slice(0, 20).forEach((r, k) => {
    out.push('| ' + (k + 1) + ' | ' + r.id + ' | ' + esc(r.title) + ' | ' + r.year + ' | ' + r.audienceScore + ' | ' + f1(r.imdb10) +
      ' | ' + sgn(r.gap) + ' | ' + sgn(r.gap - s.offset) + ' | ' + r._pOurs + ' → ' + r._pImdb +
      ' | ' + r.votes.toLocaleString('en-US') + (r.votes < lowVoteFloor ? ' ⚠' : '') + ' | ' + r.imdbId + ' |');
  });
  out.push('');
  const unmatched = all.filter(w => w.status !== 'matched');
  if (unmatched.length) {
    out.push('<details><summary>Unmatched works (' + unmatched.length + ')</summary>', '');
    out.push('| id | Title | Year | Why |', '|---|---|---:|---|');
    for (const w of unmatched) out.push('| ' + w.id + ' | ' + esc(w.title) + ' | ' + w.year + ' | ' + w.status + (w.error ? ': ' + esc(w.error) : '') + ' |');
    out.push('', '</details>', '');
  }
  return out;
}

function parseArgs(argv) {
  const a = { limit: Infinity, reuse: null, ratings: null, out: null, minVotes: 1000 };
  for (let k = 0; k < argv.length; k++) {
    if (argv[k] === '--limit') a.limit = +argv[++k];
    else if (argv[k] === '--reuse') a.reuse = argv[++k];
    else if (argv[k] === '--ratings') a.ratings = argv[++k];
    else if (argv[k] === '--out') a.out = argv[++k];
    else if (argv[k] === '--min-votes') a.minVotes = +argv[++k];
    else { console.error('unknown argument: ' + argv[k]); process.exit(2); }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const base = args.out || path.join(ROOT, 'evidence', 'imdb-audience-gap-' + date);

  const prior = new Map();
  if (args.reuse) {
    for (const w of JSON.parse(fs.readFileSync(args.reuse, 'utf8')).works) {
      if (w.imdbId) prior.set(w.medium + ':' + w.id, w);
    }
  }

  // Fail fast on auth before queueing thousands of requests that would all 401.
  if (prior.size === 0 || args.limit !== Infinity) await getJSON(tmdbUrl('/configuration'));

  const ratings = await loadRatings(args.ratings);
  process.stderr.write('IMDb ratings: ' + ratings.map.size.toLocaleString('en-US') + ' titles (file date ' + ratings.mtime + ')\n');

  const works = [];
  for (const medium of Object.keys(SECTIONS)) {
    for (const w of loadSection(medium).slice(0, args.limit)) {
      works.push({ medium, id: w.id, title: w.title, year: w.year, audienceScore: w.metrics && w.metrics.audienceScore });
    }
  }

  await pool(works, CONCURRENCY, async w => {
    const p = prior.get(w.medium + ':' + w.id);
    if (p && p.title === w.title && p.year === w.year) {
      Object.assign(w, { status: 'matched', tmdbId: p.tmdbId, tmdbTitle: p.tmdbTitle, tmdbYear: p.tmdbYear, rivals: p.rivals, how: p.how, imdbId: p.imdbId });
    } else {
      try { Object.assign(w, await matchWork(w, w.medium)); }
      catch (e) { w.status = 'error'; w.error = e.message; }
    }
    if (w.status === 'matched') {
      const r = ratings.map.get(w.imdbId);
      if (!r) { w.status = 'no-rating'; return; }
      w.imdbRating = r.rating; w.votes = r.votes;
      w.imdb10 = round1(r.rating * 10);
      w.gap = round1(w.audienceScore - w.imdb10);
    }
  });

  const md = [
    '# Corpus audienceScore vs IMDb user rating',
    '',
    'Generated ' + date + ' by `scripts/measure-imdb-gap.js`. A measurement only: nothing in `data/` was changed.',
    '',
    'Each movie and TV work was matched to TMDB by normalised title or original title (exact, or exact plus a `:`/`or` subtitle) within ±1 year of the corpus year, taking the most-voted TMDB candidate when several qualify, ' +
    'then to its IMDb id through TMDB\'s external ids, then looked up in IMDb\'s `title.ratings.tsv.gz` (downloaded ' + ratings.mtime +
    ', ' + ratings.map.size.toLocaleString('en-US') + ' rated titles). Games and books are out of scope. The per-work table is in the `.json` beside this file.',
    '',
    'Rows marked ⚠ have fewer than ' + args.minVotes.toLocaleString('en-US') + ' IMDb votes: their IMDb mean is noisy, and a big gap there may be IMDb\'s noise as much as ours. ' +
    'A big gap can also mean the match itself is wrong (a same-titled work within a year), so check the IMDb id before acting on any single row.',
    '',
  ];
  for (const medium of Object.keys(SECTIONS)) {
    const all = works.filter(w => w.medium === medium);
    md.push(...mediumSection(SECTIONS[medium].label, all, all.filter(w => w.status === 'matched'), args.minVotes));
  }
  md.push('---', '', '_This product uses the TMDB API but is not endorsed or certified by TMDB. ' +
    'Information courtesy of IMDb (https://www.imdb.com). Used with permission, for personal and non-commercial use._', '');

  const json = {
    generated: date,
    imdbRatingsFileDate: ratings.mtime,
    note: 'gap = audienceScore - imdbRating*10. Only ids and ratings are recorded; no third-party prose.',
    works: works.map(w => ({
      medium: w.medium, id: w.id, title: w.title, year: w.year, status: w.status,
      tmdbId: w.tmdbId, tmdbTitle: w.tmdbTitle, tmdbYear: w.tmdbYear, rivals: w.rivals, how: w.how, imdbId: w.imdbId,
      audienceScore: w.audienceScore, imdbRating: w.imdbRating, votes: w.votes, gap: w.gap, error: w.error,
    })),
  };
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.writeFileSync(base + '.json', JSON.stringify(json, null, 1) + '\n');
  fs.writeFileSync(base + '.md', md.join('\n'));
  console.log('Wrote ' + path.relative(ROOT, base) + '.json and .md');
  for (const medium of Object.keys(SECTIONS)) {
    const all = works.filter(w => w.medium === medium), rows = all.filter(w => w.status === 'matched');
    const s = summarize(rows);
    console.log(SECTIONS[medium].label + ': matched ' + rows.length + '/' + all.length +
      (s ? '; offset ' + sgn(s.offset) + ', median |gap| ' + f1(s.raw.median) + ' raw / ' + f1(s.adj.median) + ' after offset' +
        ', worst ' + f1(s.raw.max) + ', Spearman ' + s.rho.toFixed(2) : ''));
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { pickCandidate, summarize, ranks, spearman };
