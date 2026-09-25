#!/usr/bin/env node
/*
 * The batch-offset detector (scripts/composition.js) behind the corpus consistency gate. The gate
 * is only as good as two properties, so both are checked here against data whose answer is known:
 *
 *   - it does not flag sourced numbers: IMDb's ratings changed with the canon-first selection like
 *     everything else, but nobody scored them in batches, so any run found there is a false alarm;
 *   - it does find a batch scored on its own scale: a known offset planted in real data comes back
 *     with the right edges and the right size, and the calibrator's shift removes it.
 */
'use strict';
const C = require('../scripts/composition.js');

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); if (detail !== undefined) console.log('     ' + JSON.stringify(detail)); failures++; }
}

const loaded = C.loadSections();

console.log('\n=== composition: no false alarms on sourced data ===');
for (const key of ['movies', 'tvShows']) {
  const { runs } = C.findBatchOffsets(key, loaded[key], 'metrics.audienceScore');
  check(key + ': IMDb\'s ratings contain no batch run at all', runs.length === 1, runs.map(r => r.from + '-' + r.to + ' ' + r.offset));
}

console.log('\n=== composition: a planted batch offset is found and removed ===');
// Plant -10 on 120 consecutive books' ideaDensity, well inside the file and away from any run
// REVIEWED_RUNS lists, then ask the detector where it is.
const books = JSON.parse(JSON.stringify(loaded.books));
const sorted = books.slice().sort((a, b) => C.idNum(a) - C.idNum(b));
const lo = 1300, hi = 1420;
for (let i = lo; i < hi; i++) sorted[i].craft.ideaDensity = Math.max(0, sorted[i].craft.ideaDensity - 10);
const planted = C.flaggedRuns('books', books, 'craft.ideaDensity');
const hit = planted.find(r => r.to === sorted[hi - 1].id || r.from === sorted[lo].id ||
  (C.idNum({ id: r.from }) <= C.idNum(sorted[lo + 60]) && C.idNum({ id: r.to }) >= C.idNum(sorted[lo + 60])));
check('the planted run is flagged', !!hit, planted.map(r => r.from + '-' + r.to + ' ' + r.offset));
if (hit) {
  check('its edges land within 10 ids of the planted ones', Math.abs(hit.lo - lo) <= 10 && Math.abs(hit.hi - hi) <= 10,
    { found: [hit.from, hit.to], planted: [sorted[lo].id, sorted[hi - 1].id] });
  check('its size is measured within 2.5 points of the planted -10', Math.abs(hit.offset + 10) <= 2.5, hit.offset);
  check('it is not mistaken for a reviewed run', C.reviewFor(hit) === null, C.reviewFor(hit));
  for (let i = hit.lo; i < hit.hi; i++) sorted[i].craft.ideaDensity = Math.max(0, Math.min(100, Math.round(sorted[i].craft.ideaDensity - hit.offset)));
  const after = C.flaggedRuns('books', books, 'craft.ideaDensity').filter(r => !C.reviewFor(r));
  check('shifting it by its measured offset leaves nothing unreviewed flagged', after.length === 0, after.map(r => r.from + '-' + r.to + ' ' + r.offset));
}

console.log('\n=== composition: the review list ===');
check('every reviewed run says why', C.REVIEWED_RUNS.every(v => typeof v.why === 'string' && v.why.length > 20));
check('every verdict is corrected or real', C.REVIEWED_RUNS.every(v => v.verdict === 'corrected' || v.verdict === 'real'));
check('no reception field is ever corrected (RUBRIC.md: sourced, never judged)',
  C.REVIEWED_RUNS.every(v => v.verdict !== 'corrected' || C.JUDGED_FIELDS[v.section].includes(v.field)));

console.log(failures ? '\n' + failures + ' composition check(s) failed.\n' : '\nComposition checks passed.\n');
process.exit(failures ? 1 : 0);
