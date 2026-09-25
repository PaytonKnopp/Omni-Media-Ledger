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
   exact-year would drop real matches, while two same-titled works a year apart are rare. Among
   survivors the closest year wins; ties keep TMDB's own order. */
function pickCandidate(results, medium, work) {
  if (!Array.isArray(results)) return null;
  const want = normText(stripYearSuffix(work.title));
  const titles = r => medium === 'tv' ? [r.name, r.original_name] : [r.title, r.original_title];
  const dateOf = r => medium === 'tv' ? r.first_air_date : r.release_date;
  let best = null;
  for (const r of results) {
    if (!titles(r).some(t => normText(t) === want)) continue;
    const y = yearOf(dateOf(r));
    if (y === undefined) continue;
    const dy = Math.abs(y - work.year);
    if (dy > 1) continue;
    if (!best || dy < best.dy) best = { id: r.id, year: y, dy, title: titles(r)[0] };
  }
  return best;
}

async function matchWork(work, medium) {
  const kind = medium === 'tv' ? 'tv' : 'movie';
  const title = stripYearSuffix(work.title);
  const yearParam = medium === 'tv' ? 'first_air_date_year' : 'year';
  // Year-filtered first; if nothing survives the guard, retry unfiltered (the guard still requires
  // +/-1 year, so dropping the filter only recovers catalogue year disagreements).
  let hit = pickCandidate((await getJSON(tmdbUrl('/search/' + kind, { query: title, [yearParam]: String(work.year) }))).results, medium, work);
  let how = 'title+year';
  if (!hit) {
    hit = pickCandidate((await getJSON(tmdbUrl('/search/' + kind, { query: title }))).results, medium, work);
    how = 'title, year +/-1';
  }
  if (!hit) return { status: 'no-tmdb-match' };
  const ext = await getJSON(tmdbUrl('/' + kind + '/' + hit.id + '/external_ids'));
  const imdbId = ext && typeof ext.imdb_id === 'string' && /^tt\d+$/.test(ext.imdb_id) ? ext.imdb_id : null;
  return {
    status: imdbId ? 'matched' : 'no-imdb-id',
    tmdbId: hit.id, tmdbTitle: hit.title, tmdbYear: hit.year, how, imdbId,
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
function summarize(rows) {
  const gaps = rows.map(r => r.gap);
  const abs = gaps.map(Math.abs).sort((a, b) => a - b);
  const n = gaps.length;
  if (!n) return null;
  const within = t => abs.filter(a => a <= t).length / n;
  return {
    n,
    meanSigned: gaps.reduce((a, b) => a + b, 0) / n,
    medianSigned: quantile(gaps.slice().sort((a, b) => a - b), 0.5),
    mae: abs.reduce((a, b) => a + b, 0) / n,
    medianAbs: quantile(abs, 0.5),
    rmse: Math.sqrt(gaps.reduce((a, g) => a + g * g, 0) / n),
    p90Abs: quantile(abs, 0.9),
    p95Abs: quantile(abs, 0.95),
    maxAbs: abs[n - 1],
    within5: within(5), within10: within(10), over15: abs.filter(a => a > 15).length,
    over20: abs.filter(a => a > 20).length,
    higher: gaps.filter(g => g > 0).length, lower: gaps.filter(g => g < 0).length,
    r: pearson(rows.map(r => r.audienceScore), rows.map(r => r.imdb10)),
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
  if (counts['no-tmdb-match']) out.push('| No TMDB result with the exact title within ±1 year | ' + counts['no-tmdb-match'] + ' |');
  if (counts.error) out.push('| Request error | ' + counts.error + ' |');
  out.push('');
  if (!s) return out;
  const col = (name, fn) => '| ' + name + ' | ' + fn(s) + ' | ' + (ss ? fn(ss) : '—') + ' |';
  out.push('Gap = our `audienceScore` − IMDb rating × 10. Positive = the corpus rates it higher than IMDb users do.', '');
  out.push('| | All matched | ≥ ' + lowVoteFloor.toLocaleString('en-US') + ' IMDb votes |', '|---|---:|---:|');
  out.push(col('Works', x => x.n));
  out.push(col('**Median absolute gap** (typical)', x => '**' + f1(x.medianAbs) + '**'));
  out.push(col('Mean absolute gap', x => f1(x.mae)));
  out.push(col('RMS gap', x => f1(x.rmse)));
  out.push(col('Mean signed gap (bias)', x => sgn(x.meanSigned)));
  out.push(col('Median signed gap', x => sgn(x.medianSigned)));
  out.push(col('Corpus higher / lower than IMDb', x => x.higher + ' / ' + x.lower));
  out.push(col('Within ±5 points', x => pct(x.within5)));
  out.push(col('Within ±10 points', x => pct(x.within10)));
  out.push(col('90th percentile absolute gap', x => f1(x.p90Abs)));
  out.push(col('95th percentile absolute gap', x => f1(x.p95Abs)));
  out.push(col('Gaps over 15 / over 20 points', x => x.over15 + ' / ' + x.over20));
  out.push(col('**Worst absolute gap**', x => '**' + f1(x.maxAbs) + '**'));
  out.push(col('Pearson r (audienceScore vs IMDb×10)', x => x.r.toFixed(2)));
  out.push('');
  out.push('### 20 biggest outliers', '');
  out.push('| # | id | Title | Year | Ours | IMDb ×10 | Gap | IMDb votes | IMDb id |', '|---:|---|---|---:|---:|---:|---:|---:|---|');
  rows.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.id.localeCompare(b.id)).slice(0, 20).forEach((r, k) => {
    out.push('| ' + (k + 1) + ' | ' + r.id + ' | ' + esc(r.title) + ' | ' + r.year + ' | ' + r.audienceScore + ' | ' + f1(r.imdb10) +
      ' | ' + sgn(r.gap) + ' | ' + r.votes.toLocaleString('en-US') + (r.votes < lowVoteFloor ? ' ⚠' : '') + ' | ' + r.imdbId + ' |');
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
      Object.assign(w, { status: 'matched', tmdbId: p.tmdbId, tmdbTitle: p.tmdbTitle, tmdbYear: p.tmdbYear, how: p.how, imdbId: p.imdbId });
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
    'Each movie and TV work was matched to TMDB by exact normalised title (or original title) within ±1 year of the corpus year, ' +
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
      tmdbId: w.tmdbId, tmdbTitle: w.tmdbTitle, tmdbYear: w.tmdbYear, how: w.how, imdbId: w.imdbId,
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
      (s ? '; median |gap| ' + f1(s.medianAbs) + ', mean |gap| ' + f1(s.mae) + ', bias ' + sgn(s.meanSigned) + ', worst ' + f1(s.maxAbs) : ''));
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { pickCandidate, summarize };
