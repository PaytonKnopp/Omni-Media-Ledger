#!/usr/bin/env node
/*
 * Removes the batch offsets that scripts/composition.js REVIEWED_RUNS marks 'corrected'.
 *
 * Each such run is a stretch of consecutive ids that was scored on its own scale: once genre, era
 * and a reception reference are held fixed, and the smooth canon-first slope is allowed for, the
 * whole stretch still sits several points off the rest of its medium. The fix is one additive shift
 * per run, by the offset the detector measured:
 *
 *   - Nothing inside the run changes relative to anything else inside it (order, gaps, genre
 *     differences all survive), so the judgement that went into each value is kept.
 *   - Nothing outside the run moves.
 *   - The offset is measured, never chosen; the run's edges are the detector's, never drawn by eye.
 *
 * This replaces scripts/calibrate-batch-drift.js's per-decile recentring for new work. That tool
 * moved each decile to the grand mean, which also erased the real differences in what each decile
 * CONTAINS (a decile of horror should have more dread than a decile of musicals); this one only
 * removes what the composition model cannot explain.
 *
 *   node scripts/calibrate-batch-offsets.js --dry-run   report what would change
 *   node scripts/calibrate-batch-offsets.js             apply it
 *
 * Idempotent: a run that is no longer detected (because it was already corrected) is reported and
 * skipped. A 'corrected' run the detector finds at different edges is refused rather than guessed
 * at -- review it again and update REVIEWED_RUNS.
 */
const fs = require('fs');
const path = require('path');
const C = require('./composition.js');

const DRY = process.argv.includes('--dry-run');
const loaded = C.loadSections();
const sources = {};
let total = 0, clamped = 0, skipped = 0;

for (const target of C.REVIEWED_RUNS.filter(v => v.verdict === 'corrected')) {
  const sec = C.SECTIONS.find(s => s.key === target.section);
  const { sorted, runs } = C.findBatchOffsets(target.section, loaded[target.section], target.field);
  const run = runs.find(r => Math.abs(r.offset) >= C.FLAG_MIN_OFFSET &&
    C.reviewFor(Object.assign({ section: target.section, field: target.field }, r)) === target);
  const label = target.section + '.' + target.field + ' ' + target.from + '-' + target.to;
  if (!run) { console.log('  ' + label + ': not detected (already corrected), skipped'); skipped++; continue; }
  if (run.from !== target.from || run.to !== target.to) {
    console.error('refusing ' + label + ': now detected as ' + run.from + '-' + run.to + '; review it again');
    process.exit(1);
  }

  const leaf = target.field.split('.').pop();
  let src = sources[sec.file] || (sources[sec.file] = fs.readFileSync(path.join(C.ROOT, sec.file), 'utf8'));
  let changed = 0, atEdge = 0;
  for (let i = run.lo; i < run.hi; i++) {
    const rec = sorted[i], old = C.dig(rec, target.field);
    const next = Math.max(0, Math.min(100, Math.round(old - run.offset)));
    if (next === old) continue;
    if (next === 0 || next === 100) atEdge++;
    // Records are one per line; the leaf key is unique within a record line in every data file.
    const start = src.indexOf('{"id":"' + rec.id + '"');
    const end = src.indexOf('\n', start);
    if (start < 0) { console.error('cannot find ' + rec.id); process.exit(1); }
    const line = src.slice(start, end), needle = '"' + leaf + '":' + old;
    if (line.split(needle).length !== 2 || line.includes(needle + '.') || /\d/.test(line[line.indexOf(needle) + needle.length])) {
      console.error('refusing ' + rec.id + '/' + target.field + ': "' + needle + '" is not unique in its record');
      process.exit(1);
    }
    src = src.slice(0, start) + line.replace(needle, '"' + leaf + '":' + next) + src.slice(end);
    changed++;
  }
  sources[sec.file] = src;
  console.log('  ' + label + ': offset ' + run.offset + ', ' + changed + ' of ' + run.n + ' values shifted by ' +
    (-run.offset > 0 ? '+' : '') + Math.round(-run.offset) + (atEdge ? ', ' + atEdge + ' landed on 0/100' : ''));
  total += changed; clamped += atEdge;
}

if (!DRY) for (const [file, src] of Object.entries(sources)) fs.writeFileSync(path.join(C.ROOT, file), src);
console.log((DRY ? '[dry run] ' : '') + total + ' value(s) ' + (DRY ? 'would change' : 'changed') +
  (clamped ? ', ' + clamped + ' at the 0/100 boundary' : '') + (skipped ? ', ' + skipped + ' run(s) already corrected' : ''));
