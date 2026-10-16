#!/usr/bin/env node
/*
 * True-story evidence for film and TV: which works TMDB says are based on real events or people.
 *
 * WHY THIS IS KEYED TO THE IMDb ID AND NOT THE TITLE
 * Every movie and TV record already carries its IMDb id (metrics.audienceSrc.id, Phase R). TMDB's
 * /find endpoint resolves that id to exactly one TMDB title, so there is no title search and no
 * chance of reading the keywords of a same-named remake. A work without an IMDb id is reported,
 * never guessed at.
 *
 * WHAT IS KEPT
 * Only the TMDB keywords in SIGNAL_KEYWORDS below -- short factual tags, no overview text -- plus
 * the TMDB id they were read from, so the evidence file is the receipt for every flag in
 * data/true-stories.js. Keywords are compared exactly after lowercasing, never by substring
 * ("biography" must not be found inside "fictional biography").
 *
 * This product uses the TMDB API but is not endorsed or certified by TMDB.
 *
 * KEYS
 *   TMDB_API_KEY in the environment, or a proxy that authenticates api.themoviedb.org itself.
 *
 * USAGE
 *   node scripts/fetch-true-story.js --out evidence/true-story-film-tv-<date>.json
 *   (Node reads HTTPS_PROXY only with NODE_USE_ENV_PROXY=1 -- set it when a proxy carries the key.)
 *   node scripts/fetch-true-story.js --out <file> --limit 20        # first 20 of each medium
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

// TMDB keywords that mean "this happened, to real people". Deliberately narrow: "historical
// figure" and "historical fiction" are left out, because TMDB applies them to invented stories
// that merely feature a real person (a vampire-hunting Lincoln) or a real period.
// "based on real person" is left out for the same reason: on its own it marks a character
// modelled on someone (Citizen Kane), not a story that happened.
const SIGNAL_KEYWORDS = [
  'based on true story',
  'biography',
  'based on memoir or autobiography',
  'true crime',
];

function loadSection(file, varName) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return new Function(src + '\nreturn ' + varName + ';')();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, attempt) {
  attempt = attempt || 0;
  const key = process.env.TMDB_API_KEY;
  const u = key ? url + (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(key) : url;
  const res = await fetch(u);
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(Math.min(30000, 1000 * 2 ** attempt));
    return getJSON(url, attempt + 1);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  return res.json();
}

async function lookup(work, medium) {
  const imdb = work.metrics && work.metrics.audienceSrc && work.metrics.audienceSrc.id;
  const out = { id: work.id, title: work.title, year: work.year, imdb: imdb || null };
  if (!imdb || !/^tt\d+$/.test(imdb)) { out.missed = 'no IMDb id on the record'; return out; }
  const found = await getJSON('https://api.themoviedb.org/3/find/' + imdb + '?external_source=imdb_id');
  // A TV record's IMDb id can resolve to the series or, for a few, a film entry; take what matches
  // the medium first and fall back to the other rather than reporting a miss.
  const order = medium === 'tv' ? ['tv_results', 'movie_results'] : ['movie_results', 'tv_results'];
  let kind = null, hit = null;
  for (const k of order) {
    if (found[k] && found[k].length) { hit = found[k][0]; kind = k === 'tv_results' ? 'tv' : 'movie'; break; }
  }
  if (!hit) { out.missed = 'TMDB has no title for this IMDb id'; return out; }
  const kw = await getJSON('https://api.themoviedb.org/3/' + kind + '/' + hit.id + '/keywords');
  const names = (kw.keywords || kw.results || []).map(k => String(k.name).toLowerCase().trim());
  out.tmdb = kind + '/' + hit.id;
  out.signals = SIGNAL_KEYWORDS.filter(s => names.includes(s));
  return out;
}

async function runPool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i]); } catch (e) {
        results[i] = { id: items[i].work.id, title: items[i].work.title, missed: 'error: ' + e.message };
      }
    }
  }
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const outFile = arg('--out');
  const limit = Number(arg('--limit')) || Infinity;
  if (!outFile) { console.error('usage: node scripts/fetch-true-story.js --out <file> [--limit N]'); process.exit(2); }

  const items = [
    ...loadSection('data/movies.js', 'movies').slice(0, limit).map(work => ({ work, medium: 'movie' })),
    ...loadSection('data/tv.js', 'tvShows').slice(0, limit).map(work => ({ work, medium: 'tv' })),
  ];
  const works = await runPool(items, 8, it => lookup(it.work, it.medium));
  const pack = {
    generated: new Date().toISOString().slice(0, 10),
    attribution: TMDB_ATTRIBUTION,
    source: 'TMDB keywords, resolved from each record\'s IMDb id',
    signalKeywords: SIGNAL_KEYWORDS,
    works,
  };
  // One work per line: a re-run diffs as the handful of works whose keywords changed.
  const head = JSON.stringify(Object.assign({}, pack, { works: [] }), null, 1).replace(/\[\]\n\}$/, '');
  fs.writeFileSync(path.resolve(outFile), head + '[\n' + works.map(w => JSON.stringify(w)).join(',\n') + '\n]\n}\n');
  const flagged = works.filter(w => w.signals && w.signals.length).length;
  const missed = works.filter(w => w.missed);
  console.log(works.length + ' works looked up, ' + flagged + ' with a true-story keyword, ' + missed.length + ' missed');
  missed.forEach(w => console.log('  missed ' + w.id + ' ' + w.title + ': ' + w.missed));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
