#!/usr/bin/env node
/*
 * Builds data/true-stories.js: which works tell a true story, and the evidence that says so.
 *
 * "True story" is not a genre family. A true story can be a war film, a sports drama, a comedy or
 * a memoir, so folding it into GENRE_FAMILY_OF would either pull every biopic out of its real
 * family or give the family lens, the pairings and the rabbit hole a "shares the True Story thread"
 * reason that says nothing about taste. It is kept as its own flag, read by the genre filter's
 * True Story chip and shown on the card, and nothing in scoring reads it.
 *
 * WHAT COUNTS, AND FROM WHERE -- nothing here is recalled from memory (DATA_RUNBOOK rule 1):
 *   Film and TV  a TMDB keyword in evidence/true-story-film-tv-<date>.json (scripts/fetch-true-
 *                story.js, resolved by IMDb id), or the corpus's own Biopic / Biography genre tag.
 *   Books        formatType Memoir; or the corpus genre Biography, Memoir or True Crime; or, for
 *                a Non-Fiction or Graphic Novel record, a biography / memoir / autobiography /
 *                true crime subject in the book substance evidence already committed under
 *                evidence/. Subjects are not trusted on novels: catalogues file Ulysses and Little
 *                Women under "autobiography".
 *   Games        none. Nothing in the evidence marks a game as a true story.
 *
 * DISPUTED below lists the source tags that are plainly wrong about a work. TMDB keywords are
 * crowd-edited; each entry names what the source said and why it is overruled.
 *
 * USAGE
 *   node scripts/build-true-stories.js            # rewrite data/true-stories.js
 *   node scripts/build-true-stories.js --check    # fail if it is not what the sources produce
 */

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/true-stories.js');

const FILM_GENRES = ['Biopic', 'Biography'];
const BOOK_GENRES = ['Biography', 'Memoir', 'True Crime'];
const BOOK_SUBJECTS = ['biography', 'memoir', 'memoirs', 'autobiography', 'true crime'];
const BOOK_SUBJECT_FORMATS = ['Non-Fiction', 'Graphic Novel'];

const DISPUTED = {
  m547: 'TMDB tags Manhattan (1979) "based on true story" and "true crime"; it is an original screenplay with no crime in it',
  m179: 'TMDB tags Once Upon a Time in Hollywood "based on true story"; it rewrites the real events into a counterfactual ending',
  m630: 'TMDB tags Lagaan "based on true story"; its cricket match and village are invented',
};

function load(file, varName) {
  return new Function(fs.readFileSync(path.join(ROOT, file), 'utf8') + '\nreturn ' + varName + ';')();
}

function latestFilmTvEvidence() {
  const files = fs.readdirSync(path.join(ROOT, 'evidence')).filter(f => /^true-story-film-tv-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('no evidence/true-story-film-tv-<date>.json -- run scripts/fetch-true-story.js');
  const file = files[files.length - 1];
  return { file, pack: JSON.parse(fs.readFileSync(path.join(ROOT, 'evidence', file), 'utf8')) };
}

// Every subject tag any committed book substance pack recorded for each book id.
function bookSubjects() {
  const tags = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'evidence')).sort()) {
    if (!f.endsWith('.json')) continue;
    let pack;
    try { pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'evidence', f), 'utf8')); } catch (e) { continue; }
    if (!pack || !Array.isArray(pack.works)) continue;
    for (const w of pack.works) {
      if (!w || typeof w.id !== 'string' || !/^b\d+$/.test(w.id) || !Array.isArray(w.tags)) continue;
      if (!tags.has(w.id)) tags.set(w.id, new Set());
      w.tags.forEach(t => tags.get(w.id).add(String(t).toLowerCase().replace(/\s+/g, ' ').trim()));
    }
  }
  return tags;
}

function build() {
  const out = {};
  const { file, pack } = latestFilmTvEvidence();
  const tmdb = new Map(pack.works.map(w => [w.id, w.signals || []]));

  for (const [dataFile, varName] of [['data/movies.js', 'movies'], ['data/tv.js', 'tvShows']]) {
    for (const r of load(dataFile, varName)) {
      if (DISPUTED[r.id]) continue;
      const why = [];
      const kw = tmdb.get(r.id) || [];
      if (kw.length) why.push('TMDB: ' + kw.join(', '));
      const g = r.genres.filter(x => FILM_GENRES.includes(x));
      if (g.length) why.push('genre: ' + g.join(', '));
      if (why.length) out[r.id] = why.join('; ');
    }
  }

  const subjects = bookSubjects();
  for (const r of load('data/books.js', 'books')) {
    if (DISPUTED[r.id]) continue;
    const why = [];
    if (r.contextTags.formatType === 'Memoir') why.push('form: Memoir');
    const g = r.genres.filter(x => BOOK_GENRES.includes(x));
    if (g.length) why.push('genre: ' + g.join(', '));
    if (BOOK_SUBJECT_FORMATS.includes(r.contextTags.formatType)) {
      const s = BOOK_SUBJECTS.filter(x => (subjects.get(r.id) || new Set()).has(x));
      if (s.length) why.push('subject: ' + s.join(', '));
    }
    if (why.length) out[r.id] = why.join('; ');
  }

  const lines = Object.keys(out).map(id => ' ' + JSON.stringify(id) + ':' + JSON.stringify(out[id]));
  return '// GENERATED by scripts/build-true-stories.js from the corpus and ' + file + '. Do not edit by\n' +
    '// hand: change the rule or DISPUTED there and re-run it. `npm run test-fast` fails if this is stale.\n' +
    '//\n' +
    '// TRUE_STORY: work id -> why it counts as a true story (shown on the card). Read by the genre\n' +
    '// filter\'s True Story chip; nothing in scoring reads it.\n' +
    "'use strict';\n" +
    'const TRUE_STORY={\n' + lines.join(',\n') + '\n};\n';
}

const text = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) {
    console.error('data/true-stories.js is stale: run `node scripts/build-true-stories.js` and commit the result.');
    process.exit(1);
  }
  console.log('data/true-stories.js is current (' + (text.match(/^ "/gm) || []).length + ' works)');
} else {
  fs.writeFileSync(OUT, text);
  const n = { m: 0, t: 0, b: 0 };
  (text.match(/^ "([a-z])/gm) || []).forEach(s => { n[s[2]]++; });
  console.log('wrote data/true-stories.js: ' + n.m + ' films, ' + n.t + ' series, ' + n.b + ' books');
}
