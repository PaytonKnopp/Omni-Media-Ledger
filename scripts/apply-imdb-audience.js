#!/usr/bin/env node
/*
 * Applies IMDb's user rating (x10) as metrics.audienceScore for every movie and TV work.
 *
 * DATA_RUNBOOK.md names IMDb's bulk title.ratings.tsv.gz as the one audience source for film and
 * TV, and its rules are the ones this obeys:
 *
 *   - one source, applied uniformly, the value REPLACED outright -- never averaged with the old
 *     estimate (averaging two scales is the batch drift this whole pass exists to remove);
 *   - the field switches entirely: every movie and TV record ends up with an IMDb-sourced value,
 *     except a work IMDb genuinely has no title for, which keeps its estimate and is stamped as one;
 *   - every value carries its source and retrieval date:
 *       "metrics":{..., "audienceScore":83, "audienceSrc":{"src":"IMDb","id":"tt0062622","checked":"2026-09-25"}}
 *       "metrics":{..., "audienceScore":88, "audienceSrc":{"src":"estimated","why":"..."}}
 *     scripts/validate-corpus.js enforces both shapes.
 *
 * Like apply-facts.js it edits by exact-match replacement scoped to the record's OWN line, refuses
 * a line where the metrics block cannot be found exactly once, and is a dry run unless --write.
 * Re-running it with a newer ratings file refreshes the value and date in place.
 *
 * Which IMDb title a work is: the TMDB-derived match table from scripts/measure-imdb-gap.js, with
 * evidence/imdb-id-overrides.json taking precedence (the reviewable list for works TMDB could not
 * match, including the ones IMDb has no title for).
 *
 * USAGE
 *   node scripts/apply-imdb-audience.js --matches evidence/imdb-audience-gap-2026-09-25.json \
 *        --ratings title.ratings.tsv.gz [--basics title.basics.tsv.gz] [--write]
 *
 *   --ratings   IMDb's title.ratings.tsv.gz (https://datasets.imdbws.com/). Its download date is
 *               the retrieval date stamped on every value (--checked YYYY-MM-DD overrides).
 *   --basics    optional title.basics.tsv.gz: re-verifies every id's type, title and year against
 *               IMDb's own record and lists anything that doesn't line up, for review.
 *
 * Writes evidence/imdb-audience-applied-<checked>.json: every work's old and new value, IMDb id,
 * rating and vote count, and which route (tmdb / override / absent) the id came from.
 *
 * Information courtesy of IMDb (https://www.imdb.com). Used with permission, for personal and
 * non-commercial use.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const ROOT = path.resolve(__dirname, '..');

const FILES = { movie: { file: 'data/movies.js', varName: 'movies' }, tv: { file: 'data/tv.js', varName: 'tvShows' } };
const OVERRIDES = path.join(ROOT, 'evidence', 'imdb-id-overrides.json');

function parseArgs(argv) {
  const a = { write: argv.includes('--write') };
  for (let k = 0; k < argv.length; k++) {
    if (['--matches', '--ratings', '--basics', '--checked'].includes(argv[k])) a[argv[k].slice(2)] = argv[++k];
  }
  if (!a.matches || !a.ratings) {
    console.error('usage: apply-imdb-audience.js --matches <gap.json> --ratings <title.ratings.tsv.gz> [--basics <title.basics.tsv.gz>] [--checked YYYY-MM-DD] [--write]');
    process.exit(2);
  }
  return a;
}

function loadSection(medium) {
  const src = fs.readFileSync(path.join(ROOT, FILES[medium].file), 'utf8');
  return new Function(src + '\nreturn ' + FILES[medium].varName + ';')();
}

async function eachTsvRow(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) { if (header) { header = false; continue; } fn(line.split('\t')); }
}

/* The metrics block on a record's line, with or without a previous audienceSrc stamp. Anchored on
   the closing brace of `metrics`, so it cannot catch an audienceScore anywhere else on the line. */
const METRICS_RE = /"audienceScore":(\d+)(,"audienceSrc":\{[^{}]*\})?\}/g;

function stampFor(route, imdbId, checked, why) {
  return route === 'absent'
    ? { src: 'estimated', why }
    : { src: 'IMDb', id: imdbId, checked };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checked = args.checked || fs.statSync(args.ratings).mtime.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) { console.error('--checked must be YYYY-MM-DD'); process.exit(2); }

  // 1. Which IMDb title each work is.
  const route = new Map();
  for (const w of JSON.parse(fs.readFileSync(args.matches, 'utf8')).works) {
    if (w.status === 'matched' && w.imdbId) route.set(w.medium + ':' + w.id, { via: 'tmdb', imdbId: w.imdbId, title: w.title, year: w.year });
  }
  for (const o of JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')).works) {
    route.set(o.medium + ':' + o.id, o.imdbId
      ? { via: 'override', imdbId: o.imdbId, title: o.title, year: o.year }
      : { via: 'absent', why: o.why, title: o.title, year: o.year });
  }

  // 2. Every movie and TV record must be routed -- the field switches entirely or not at all.
  const works = [];
  const unrouted = [];
  for (const medium of Object.keys(FILES)) {
    for (const r of loadSection(medium)) {
      const rt = route.get(medium + ':' + r.id);
      if (!rt) { unrouted.push(medium + ':' + r.id + ' "' + r.title + '"'); continue; }
      if (rt.title !== r.title || rt.year !== r.year) {
        unrouted.push(medium + ':' + r.id + ' is "' + r.title + '" (' + r.year + ') in the corpus but "' + rt.title + '" (' + rt.year + ') in the match table -- stale match, re-run measure-imdb-gap.js');
        continue;
      }
      works.push(Object.assign({ medium, id: r.id, title: r.title, year: r.year, old: r.metrics.audienceScore }, rt));
    }
  }
  if (unrouted.length) {
    console.error('Refusing: ' + unrouted.length + ' movie/TV work(s) have no IMDb route. Match them or add them to evidence/imdb-id-overrides.json:');
    unrouted.forEach(u => console.error('  ' + u));
    process.exit(1);
  }

  // 3. IMDb ratings (and, optionally, IMDb's own record of each title, for review).
  const want = new Set(works.filter(w => w.imdbId).map(w => w.imdbId));
  const ratings = new Map();
  await eachTsvRow(args.ratings, p => { if (want.has(p[0])) ratings.set(p[0], { rating: +p[1], votes: +p[2] }); });
  const unrated = works.filter(w => w.imdbId && !ratings.has(w.imdbId));
  if (unrated.length) {
    console.error('Refusing: ' + unrated.length + ' IMDb id(s) have no row in the ratings file:');
    unrated.forEach(w => console.error('  ' + w.id + ' "' + w.title + '" ' + w.imdbId));
    process.exit(1);
  }
  if (args.basics) {
    const basics = new Map();
    await eachTsvRow(args.basics, p => { if (want.has(p[0])) basics.set(p[0], p); });
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const review = [];
    for (const w of works.filter(x => x.imdbId)) {
      const b = basics.get(w.imdbId);
      if (!b) { review.push(w.id + ' ' + w.imdbId + ': not in title.basics'); continue; }
      const t = norm(w.title.replace(/\s*\(\d{4}\)\s*$/, ''));
      const titleOk = [b[2], b[3]].some(x => norm(x) === t || norm(x).startsWith(t + ' '));
      const typeOk = w.medium === 'tv' ? /^tv(Series|MiniSeries)$/.test(b[1]) : /^(movie|tvMovie|video|tvSpecial)$/.test(b[1]);
      const yearOk = /^\d{4}$/.test(b[5]) && Math.abs(+b[5] - w.year) <= 1;
      if (!(titleOk && typeOk && yearOk)) review.push(w.id + ' "' + w.title + '" (' + w.year + ', via ' + w.via + ') -> ' + w.imdbId + ' ' + b[1] + ' "' + b[2] + '" / "' + b[3] + '" ' + b[5]);
    }
    console.log('\nIMDb title.basics cross-check: ' + (works.length - review.length) + ' line up on title, type and year; ' + review.length + ' to eyeball:');
    review.forEach(r => console.log('  ' + r));
  }

  // 4. Rewrite each record's own line.
  const refused = [];
  const receipt = [];
  for (const medium of Object.keys(FILES)) {
    const dataPath = path.join(ROOT, FILES[medium].file);
    let text = fs.readFileSync(dataPath, 'utf8');
    for (const w of works.filter(x => x.medium === medium)) {
      const lineRe = new RegExp('^.*"id"\\s*:\\s*"' + w.id + '".*$', 'm');
      const m = text.match(lineRe);
      if (!m) { refused.push(w.id + ': no record line found'); continue; }
      const line = m[0];
      const hits = line.match(METRICS_RE) || [];
      if (hits.length !== 1) { refused.push(w.id + ': metrics block found ' + hits.length + ' times on its line'); continue; }
      const r = w.imdbId ? ratings.get(w.imdbId) : null;
      const value = r ? Math.round(r.rating * 10) : w.old;
      const stamp = stampFor(w.via, w.imdbId, checked, w.why);
      const next = line.replace(METRICS_RE, '"audienceScore":' + value + ',"audienceSrc":' + JSON.stringify(stamp) + '}');
      text = text.replace(line, () => next);
      receipt.push({ medium, id: w.id, title: w.title, via: w.via, imdbId: w.imdbId || null,
        imdbRating: r ? r.rating : null, votes: r ? r.votes : null, old: w.old, new: value });
    }
    if (args.write) fs.writeFileSync(dataPath, text);
  }

  // 5. Report.
  const changed = receipt.filter(x => x.new !== x.old);
  const deltas = changed.map(x => x.new - x.old);
  console.log('\n' + (args.write ? 'Applied' : 'Dry run (pass --write to apply)') + ' -- IMDb ratings retrieved ' + checked);
  for (const medium of Object.keys(FILES)) {
    const rs = receipt.filter(x => x.medium === medium);
    const by = v => rs.filter(x => x.via === v).length;
    console.log('  ' + medium + ': ' + rs.length + ' works -- ' + by('tmdb') + ' via TMDB match, ' + by('override') + ' via override, ' + by('absent') +
      ' absent from IMDb (estimate kept); ' + rs.filter(x => x.new !== x.old).length + ' values changed');
  }
  if (deltas.length) console.log('  mean change ' + (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1) + ' across ' + deltas.length + ' changed values');
  if (refused.length) {
    console.log('\nRefused ' + refused.length + ':');
    refused.forEach(r => console.log('  ' + r));
    process.exitCode = 1;
  }
  if (args.write) {
    const out = path.join(ROOT, 'evidence', 'imdb-audience-applied-' + checked + '.json');
    fs.writeFileSync(out, JSON.stringify({
      applied: checked, source: 'IMDb title.ratings.tsv.gz (datasets.imdbws.com), averageRating x 10',
      matches: path.relative(ROOT, path.resolve(args.matches)), overrides: path.relative(ROOT, OVERRIDES), works: receipt,
    }, null, 1) + '\n');
    console.log('\nWrote ' + path.relative(ROOT, out));
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { METRICS_RE, stampFor };
