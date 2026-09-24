#!/usr/bin/env node
/*
 * No third-party prose in committed evidence.
 *
 * This repository is public. Facts (a runtime, a year, a director, a keyword) can be committed
 * freely; a synopsis, a plot summary, a publisher's blurb or a quoted excerpt is expressive text,
 * and committing thousands of them is redistribution (DATA_RUNBOOK.md -> "Licensing"). The
 * harnesses already keep prose out of the packs they write, and .gitignore keeps the raw
 * `--record` files out by default -- but `git add -f` walks straight past .gitignore, and a file
 * named `*-raw.json` instead of `raw-*.json` never met it at all. That is how 126 recordings
 * (212MB) carrying ~9,000 TMDB overviews, ~1,800 OMDb plots and thousands of Google Books
 * descriptions and excerpts ended up committed.
 *
 * So this reads what git actually tracks under evidence/ and fails on any of those fields. A raw
 * recording with the prose stripped is still fine to commit for replay; one with prose is not.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

// The fields the sources this repo fetches from put prose in: TMDB overview/tagline, OMDb Plot,
// Google Books volumeInfo.description / searchInfo.textSnippet, OpenLibrary description /
// first_sentence / excerpts[].excerpt, fetch-substance's own --include-prose synopsis, and
// Wikidata's P7150 (epigraph), whose values are quotations from the book itself.
const PROSE_KEYS = new Set(['overview', 'Plot', 'tagline', 'synopsis', 'description', 'textSnippet',
  'first_sentence', 'excerpt', 'P7150']);

function isProse(key, v) {
  if (!PROSE_KEYS.has(key)) return false;
  if (key === 'P7150') return Array.isArray(v) ? v.length > 0 : v != null;
  if (typeof v === 'string') return v.trim().length > 0;
  // OpenLibrary writes text fields as {type:"/type/text", value:"..."}.
  return !!(v && typeof v === 'object' && v.type === '/type/text' && typeof v.value === 'string' && v.value.trim());
}

function proseFields(node, acc) {
  if (Array.isArray(node)) { for (const v of node) proseFields(v, acc); }
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (isProse(k, v)) acc[k] = (acc[k] || 0) + 1;
      else proseFields(v, acc);
    }
  }
  return acc;
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); if (detail) console.log('     ' + detail); failures++; }
}

console.log('\n=== evidence: the prose detector itself ===');
check('a TMDB overview and an OMDb Plot are caught',
  JSON.stringify(proseFields({ m01: [{ overview: 'Humanity finds…', Plot: 'An ape…' }] }, {})) === '{"overview":1,"Plot":1}');
check('OpenLibrary\'s {type:"/type/text"} form is caught',
  proseFields({ description: { type: '/type/text', value: 'A novel about…' } }, {}).description === 1);
check('empty prose fields are not flagged',
  Object.keys(proseFields({ overview: '', Plot: '  ', synopsis: null }, {})).length === 0);
check('the harnesses\' own notes and tags are not flagged',
  Object.keys(proseFields({ note: 'matches Wikidata; disagrees with OpenLibrary', tags: ['space travel'] }, {})).length === 0);

let tracked = null;
try {
  tracked = execFileSync('git', ['ls-files', '-z', '--', 'evidence'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(f => f.endsWith('.json'));
} catch (e) { /* not a git checkout (a downloaded zip, say): nothing is committed from here */ }

if (!tracked) {
  console.log('\n=== evidence: committed files - SKIPPED (not a git checkout) ===');
} else {
  console.log('\n=== evidence: committed files (' + tracked.length + ' JSON) ===');
  const offenders = [];
  for (const f of tracked) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
    catch (e) { check(f + ' parses as JSON', false, e.message); continue; }
    const hits = proseFields(doc, {});
    if (Object.keys(hits).length) offenders.push(f + '  ' + JSON.stringify(hits));
  }
  check('no committed evidence file carries synopsis, plot, blurb or excerpt prose', !offenders.length,
    offenders.length + ' file(s) do. Strip those fields, or untrack the file with `git rm --cached`:\n     '
      + offenders.slice(0, 20).join('\n     ') + (offenders.length > 20 ? '\n     … and ' + (offenders.length - 20) + ' more' : ''));
}

console.log(failures ? '\n' + failures + ' evidence check(s) failed.\n' : '\nEvidence check passed.\n');
process.exit(failures ? 1 : 0);
