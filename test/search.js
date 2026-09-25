#!/usr/bin/env node
/*
 * Search harness: app/search.js against the real corpus, no browser needed (part of test-fast).
 *
 * Every query below is one the old search -- a lowercase substring test against every field glued
 * together -- answered with nothing, or answered in an order that buried the obvious hit. The
 * browser suite checks the Global Controller wiring; this checks the matching itself, fast enough
 * to run on every commit.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); failures++; }
}

// The corpus and the module load exactly as the page loads them: classic scripts in one scope.
const ctx = { console };
vm.createContext(ctx);
for (const f of ['data/movies.js', 'data/tv.js', 'data/games.js', 'data/books.js', 'app/search.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^const /gm, 'var '), ctx, { filename: f });
}
const ALL = [].concat(ctx.movies, ctx.tvShows, ctx.videoGames, ctx.books);
// The same fields the app hands in (searchFieldsOf in ledger-app.js), from the raw records.
const fieldsOf = x => ({
  title: x.title,
  creator: x.creator,
  other: [x.studio, x.networkStreamer, x.publisher, (x.platformAvailability || []).join(' '),
    (x.genres || []).join(' '), (x.contextTags || {}).vibeTime, String(x.year)],
});

const t0 = Date.now();
const ix = vm.runInContext('buildSearchIndex', ctx)(ALL, fieldsOf);
const buildMs = Date.now() - t0;
const searchQuery = vm.runInContext('searchQuery', ctx);
const fold = vm.runInContext('foldSearchText', ctx);
const textMatchesQuery = vm.runInContext('textMatchesQuery', ctx);

// Results the way the Global Controller shows them: best bucket first (the app then applies the
// person's own sort inside a bucket; corpus order stands in for it here).
function run(q) {
  const m = searchQuery(ix, q);
  if (!m) return null;
  return Array.from(m.entries()).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([d, b]) => ({ x: ALL[d], b }));
}
const titles = r => (r || []).map(h => h.x.title);
const has = (q, title) => titles(run(q)).includes(title);

console.log('\n=== search: accents, case and punctuation fold away ===');
check('"amelie" finds Amélie, as an exact title', (run('amelie') || [])[0] && run('amelie')[0].x.title === 'Amélie' && run('amelie')[0].b === 0);
check('"Amélie" and "AMELIE" give the same answer as "amelie"',
  JSON.stringify(titles(run('Amélie'))) === JSON.stringify(titles(run('amelie'))) && JSON.stringify(titles(run('AMELIE'))) === JSON.stringify(titles(run('amelie'))));
check('"cuaron" finds Alfonso Cuarón\'s films (Gravity, Children of Men)', has('cuaron', 'Gravity') && has('cuaron', 'Children of Men'));
check('"inarritu" finds The Revenant (Alejandro G. Iñárritu)', has('inarritu', 'The Revenant'));
check('"zulawski" finds Possession (Andrzej Żuławski -- ł is not a combining mark)', has('zulawski', 'Possession'));
check('"tar" finds Tár', has('tar', 'Tár'));
check('"francois truffaut" finds The 400 Blows', has('francois truffaut', 'The 400 Blows'));
check('"cuckoos nest" and "cuckoo\'s nest" both find One Flew Over the Cuckoo\'s Nest',
  has('cuckoos nest', "One Flew Over the Cuckoo's Nest") && has("cuckoo's nest", "One Flew Over the Cuckoo's Nest"));
check('"8 1/2" finds 8½', has('8 1/2', '8½'));
check('"spiderman" finds Spider-Man (hyphenated titles are also indexed joined)', has('spiderman', 'Spider-Man'));
check('letters of other scripts survive folding', fold('東京物語') === '東京物語' && fold('Ōkami') === 'okami');

console.log('\n=== search: every word matches, in any order and any field ===');
check('"zelda breath" finds The Legend of Zelda: Breath of the Wild', has('zelda breath', 'The Legend of Zelda: Breath of the Wild'));
check('"breath zelda" (words swapped) finds it too', has('breath zelda', 'The Legend of Zelda: Breath of the Wild'));
check('"kubrick 1968" finds 2001: A Space Odyssey (director and year are different fields)', has('kubrick 1968', '2001: A Space Odyssey'));
check('"kubrick 1968" finds nothing else Kubrick made', titles(run('kubrick 1968')).length === 1);
check('"lord of the rings return of the king" finds the film, though the colon broke the old match',
  has('lord of the rings return of the king', 'The Lord of the Rings: The Return of the King'));
check('"godf" (typing, not finished) already finds The Godfather', has('godf', 'The Godfather'));

console.log('\n=== search: typos ===');
check('"godfater" finds The Godfather', has('godfater', 'The Godfather'));
check('"kubrik" finds Kubrick\'s films', has('kubrik', '2001: A Space Odyssey'));
check('"villanueve" (two edits) finds Denis Villeneuve\'s films', has('villanueve', 'Arrival'));
// Every searchable field of a raw record, folded, for asserting what a hit actually contains.
const hay = x => fold([x.title, x.creator, x.studio, x.networkStreamer, x.publisher, (x.platformAvailability || []).join(' '),
  (x.genres || []).join(' '), (x.contextTags || {}).vibeTime, String(x.year)].join(' '));
check('a word that matches exactly is never widened by typo matching (every "dune" hit really contains "dune")',
  run('dune').every(h => hay(h.x).indexOf('dune') >= 0));
check('a short word gets no typo budget (every "tar" hit has a word starting with "tar", none is "war"/"car")',
  run('tar').every(h => hay(h.x).split(' ').some(w => w.startsWith('tar'))));
check('nonsense matches nothing', titles(run('zzqqxxv')).length === 0);

console.log('\n=== search: relevance -- the obvious hit comes first ===');
const dune = run('dune');
check('"dune": an exact title "Dune" is the first result', dune[0].x.title === 'Dune' && dune[0].b === 0);
check('"dune": Dune: Part Two and Dune Messiah come next, as titles starting with the query',
  dune.slice(0, 4).map(h => h.x.title).filter(t => t === 'Dune: Part Two' || t === 'Dune Messiah').length === 2);
const scifi = run('sci-fi');
check('"sci-fi" is the genre: every hit carries the phrase "sci fi" (no Céline Sciamma film with "Fire" in the title)',
  scifi.length > 100 && scifi.every(h => (' ' + hay(h.x)).indexOf(' sci fi') >= 0) && !titles(scifi).includes('Portrait of a Lady on Fire'));
check('"sci-fi": works matched by the genre phrase outrank scattered word matches',
  scifi.every((h, i) => i === 0 || scifi[i - 1].b <= h.b) && scifi.filter(h => h.b === 5).length > 100);
check('"spidr-man" (a typo inside a hyphenated word) still finds Spider-Man, rather than nothing',
  has('spidr-man', 'Spider-Man'));
const godfather = run('the godfather');
check('"the godfather": exact titles lead, and The Godfather Part II follows as a title-prefix match',
  godfather[0].b === 0 && godfather.some(h => h.x.title === 'The Godfather Part II' && h.b === 1));
const kubrick = run('kubrick');
check('"kubrick": a creator-only query lands every hit in one bucket, so the person\'s own sort decides',
  kubrick.length > 5 && kubrick.every(h => h.b === kubrick[0].b));
check('an empty or all-punctuation query is "no search", not "nothing matches"', run('') === null && run('  --  ') === null);

console.log('\n=== search: small-list helper ===');
check('textMatchesQuery folds and matches word starts', textMatchesQuery('Middle-earth (Tolkien books)', 'tolk middle'));
check('textMatchesQuery needs every word', !textMatchesQuery('Middle-earth (Tolkien books)', 'tolkien narnia'));

console.log('\n=== search: cost ===');
const q0 = Date.now();
['amelie', 'godfater', 'zelda breath', 'kubrick 1968', 'lord of the rings return of the king', 'sci-fi', 'a'].forEach(q => { ix.cache.clear(); searchQuery(ix, q); });
const perQuery = (Date.now() - q0) / 7;
check('the index builds in under a second for the whole corpus (' + buildMs + 'ms, ' + ALL.length + ' works)', buildMs < 1000);
check('a query, uncached, runs in well under 100ms (' + perQuery.toFixed(1) + 'ms average)', perQuery < 100);

console.log(failures ? '\n' + failures + ' of ' + checks + ' search check(s) failed.' : '\nSearch harness passed all ' + checks + ' checks.');
process.exit(failures ? 1 : 0);
