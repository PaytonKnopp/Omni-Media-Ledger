#!/usr/bin/env node
/*
 * Structural integrity check for the corpus data files in data/.
 * No duplicate IDs, no duplicate titles (case-insensitive) within any of the
 * four media types, and every record has the fields its kind requires.
 * Run with: node scripts/validate-corpus.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SECTIONS = [
  { key: 'movies', file: 'data/movies.js', varName: 'movies', idPrefix: 'm',
    required: ['id', 'title', 'year', 'creator', 'studio', 'runtime', 'genres', 'metrics',
      'physicalMediaFidelity', 'atmosphericDreadIndex', 'ontologicalComplexity', 'contextTags'] },
  { key: 'tvShows', file: 'data/tv.js', varName: 'tvShows', idPrefix: 't',
    required: ['id', 'title', 'year', 'creator', 'networkStreamer', 'totalSeasons', 'genres', 'metrics',
      'physicalMediaFidelity', 'atmosphericDreadIndex', 'ontologicalComplexity', 'formats', 'contextTags'] },
  { key: 'videoGames', file: 'data/games.js', varName: 'videoGames', idPrefix: 'g',
    required: ['id', 'title', 'year', 'creator', 'platformAvailability', 'averagePlaytime', 'genres',
      'metrics', 'engineeringFidelity', 'immersionTensionIndex', 'systemsComplexity', 'contextTags'] },
  { key: 'books', file: 'data/books.js', varName: 'books', idPrefix: 'b',
    required: ['id', 'title', 'year', 'creator', 'publisher', 'pages', 'genres', 'metrics', 'craft',
      'atmosphericDreadIndex', 'ontologicalComplexity', 'format', 'contextTags'] },
];

let failures = 0;
function check(label, cond) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); failures++; }
}

console.log('\n=== data/ corpus files ===');
let total = 0;
for (const sec of SECTIONS) {
  const filePath = path.join(ROOT, sec.file);
  let records;
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    // Each data file is a classic script declaring `const <varName>=[...]` in global
    // scope (loaded via <script src> so it works under file:// -- see NOTES.md). Running
    // it in a fresh Function scope and returning the variable is the simplest way to
    // parse it without adding a JSON-with-comments dependency.
    records = new Function(src + '\nreturn ' + sec.varName + ';')();
  } catch (e) {
    check(sec.key + ' (' + sec.file + ') parses as valid JS', false);
    console.log('     ' + e.message);
    continue;
  }
  check(sec.key + ' (' + sec.file + ') parses as valid JS (' + records.length + ' records)', true);

  const ids = new Set();
  const dupIds = [];
  const titles = new Set();
  const dupTitles = [];
  const missingFields = [];
  for (const r of records) {
    if (ids.has(r.id)) dupIds.push(r.id); else ids.add(r.id);
    const t = (r.title || '').toLowerCase();
    if (titles.has(t)) dupTitles.push(r.title); else titles.add(t);
    const missing = sec.required.filter(f => !(f in r));
    if (missing.length) missingFields.push(r.id + ': ' + missing.join(','));
    if (r.id && !new RegExp('^' + sec.idPrefix + '\\d+$').test(r.id)) {
      missingFields.push(r.id + ': id does not match expected prefix "' + sec.idPrefix + '"');
    }
  }
  check(sec.key + ' has no duplicate IDs', dupIds.length === 0);
  if (dupIds.length) console.log('     duplicates: ' + dupIds.join(', '));
  check(sec.key + ' has no duplicate titles (case-insensitive)', dupTitles.length === 0);
  if (dupTitles.length) console.log('     duplicates: ' + dupTitles.join(', '));
  check(sec.key + ' records all have required fields', missingFields.length === 0);
  if (missingFields.length) missingFields.slice(0, 10).forEach(m => console.log('     ' + m));
  total += records.length;
}
console.log('  total records: ' + total);

// Both HTML files must reference the same shared data files, and neither should carry
// its own inline copy of the corpus arrays anymore (that duplication is the whole point
// of the split -- see NOTES.md "Split the dataset out of index.html").
for (const htmlFile of ['index.html', 'share.html']) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const hasScriptTags = SECTIONS.every(s => html.includes('<script src="' + s.file + '">'));
  check(htmlFile + ' references all 4 data/*.js files via <script src>', hasScriptTags);
  const hasInlineData = SECTIONS.some(s => new RegExp('\\bconst ' + s.varName + '=\\[').test(html));
  check(htmlFile + ' has no leftover inline copy of the corpus arrays', !hasInlineData);
}

console.log('\n' + (failures === 0 ? 'Corpus is structurally clean.' : failures + ' check(s) failed.'));
process.exit(failures === 0 ? 0 : 1);
