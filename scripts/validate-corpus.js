#!/usr/bin/env node
/*
 * Structural integrity check for the corpus arrays in index.html / share.html.
 * No duplicate IDs, no duplicate titles (case-insensitive) within any of the
 * four media types, and every record has the fields its kind requires.
 * Run with: node scripts/validate-corpus.js [file...]  (defaults to both).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ['index.html', 'share.html'];

const SECTIONS = [
  { key: 'movies', start: 'const movies=[', end: 'const tvShows=[', idPrefix: 'm',
    required: ['id', 'title', 'year', 'creator', 'studio', 'runtime', 'genres', 'metrics',
      'physicalMediaFidelity', 'atmosphericDreadIndex', 'ontologicalComplexity', 'contextTags'] },
  { key: 'tvShows', start: 'const tvShows=[', end: 'const videoGames=[', idPrefix: 't',
    required: ['id', 'title', 'year', 'creator', 'networkStreamer', 'totalSeasons', 'genres', 'metrics',
      'physicalMediaFidelity', 'atmosphericDreadIndex', 'ontologicalComplexity', 'formats', 'contextTags'] },
  { key: 'videoGames', start: 'const videoGames=[', end: 'const books=[', idPrefix: 'g',
    required: ['id', 'title', 'year', 'creator', 'platformAvailability', 'averagePlaytime', 'genres',
      'metrics', 'engineeringFidelity', 'immersionTensionIndex', 'systemsComplexity', 'contextTags'] },
  { key: 'books', start: 'const books=[', end: 'const directorsPantheon=[', idPrefix: 'b',
    required: ['id', 'title', 'year', 'creator', 'publisher', 'pages', 'genres', 'metrics', 'craft',
      'atmosphericDreadIndex', 'ontologicalComplexity', 'format', 'contextTags'] },
];

function extractSection(html, start, end) {
  const s = html.indexOf(start);
  if (s < 0) throw new Error('section start not found: ' + start);
  const e = html.indexOf(end, s);
  if (e < 0) throw new Error('section end not found: ' + end);
  return html.slice(s + start.length, e);
}

// The corpus arrays are single-line-per-record JSON objects joined by ",\n" (or "],\n" for the
// array boundary). Extracting them via a JS-in-a-string eval is the most robust way to parse
// this without a real JS parser dependency, since the section text is already `{...},{...}];`.
function parseRecords(sectionBody) {
  const trimmed = sectionBody.trim().replace(/,\s*$/, '').replace(/\];?\s*$/, '');
  return new Function('return [' + trimmed + ']')();
}

let failures = 0;
function check(label, cond) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); failures++; }
}

for (const target of TARGETS) {
  console.log('\n=== ' + target + ' ===');
  const html = fs.readFileSync(path.join(ROOT, target), 'utf8');
  let total = 0;
  for (const sec of SECTIONS) {
    const body = extractSection(html, sec.start, sec.end);
    let records;
    try {
      records = parseRecords(body);
    } catch (e) {
      check(sec.key + ' parses as valid JS array', false);
      console.log('     ' + e.message);
      continue;
    }
    check(sec.key + ' parses as valid JS array (' + records.length + ' records)', true);

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
}

console.log('\n' + (failures === 0 ? 'Corpus is structurally clean.' : failures + ' check(s) failed.'));
process.exit(failures === 0 ? 0 : 1);
