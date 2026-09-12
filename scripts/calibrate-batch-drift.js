#!/usr/bin/env node
/*
 * Batch-drift calibration: a per-ID-decile additive offset that recenters each cohort's mean to
 * the corpus-wide grand mean, for fields whose cohort separation (corpus-metrics.js) is strong in
 * every measured cohort -- meaning the in-cohort ORDERING is real judgement and only the absolute
 * scale drifted across scoring batches. This is a mechanical statistical transform, not a rubric
 * re-judgment, so it is scoped ONLY to fields where that distinction is measured to be safe:
 *   movies.atmosphericDreadIndex    min separation 36.1 across 10/10 cohorts
 *   books.atmosphericDreadIndex     min separation 32.5 across 7/7 measured cohorts
 * Deliberately excluded, with reasons measured rather than assumed:
 *   - tvShows.atmosphericDreadIndex / videoGames.immersionTensionIndex: weak-to-negative
 *     separation in at least one cohort -- calibrating would launder a real scoring-quality
 *     problem as a scale problem, exactly what this script exists to avoid doing.
 *   - movies.ontologicalComplexity: separation itself was fine (min 27.4), but its cohort offsets
 *     are large enough (-15 to -18.9) that a flat additive shift clamped 55 movies to the 0/100
 *     floor or ceiling -- collapsing real distinctions between them at the boundary. A field with
 *     offsets this large needs a boundary-aware (e.g. rank/quantile-preserving) recalibration,
 *     not this script's flat shift; left for that follow-up rather than rushed here.
 *   - books.craft.ideaDensity: no measured separation evidence at all (not one of
 *     corpus-metrics.js's SEPARATION_PROBES, and two of ten cohorts have zero genre-probe
 *     coverage), so "the ordering is real" cannot be verified either way.
 * A run reports how many values landed exactly on 0 or 100 for each field calibrated -- a
 * boundary clamp destroys resolution the same way, and should be reviewed even for a field that
 * otherwise looked safe, rather than assumed away because separation was measured elsewhere.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

const TARGETS = [
  { file: 'data/movies.js', varName: 'movies', field: 'atmosphericDreadIndex' },
  { file: 'data/books.js', varName: 'books', field: 'atmosphericDreadIndex' },
];

function load(file, varName) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return new Function(src + '\nreturn ' + varName + ';')();
}
function cohortsOf(records) {
  const sorted = records.slice().sort((a, b) => parseInt(a.id.slice(1)) - parseInt(b.id.slice(1)));
  const size = Math.ceil(sorted.length / 10);
  const out = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

const byFile = {};
for (const t of TARGETS) {
  (byFile[t.file] = byFile[t.file] || []).push(t);
}

let totalChanged = 0;
for (const [file, targets] of Object.entries(byFile)) {
  const records = load(file, targets[0].varName);
  const cohorts = cohortsOf(records);
  let src = fs.readFileSync(path.join(ROOT, file), 'utf8');

  for (const t of targets) {
    const allVals = records.map(r => r[t.field]).filter(v => typeof v === 'number');
    const grandMean = mean(allVals);
    const cohortOffsets = cohorts.map(c => {
      const vals = c.map(r => r[t.field]).filter(v => typeof v === 'number');
      return vals.length ? grandMean - mean(vals) : 0;
    });

    let changed = 0, clamped = 0;
    cohorts.forEach((cohort, ci) => {
      const offset = cohortOffsets[ci];
      cohort.forEach(rec => {
        const old = rec[t.field];
        if (typeof old !== 'number') return;
        const next = Math.max(0, Math.min(100, Math.round(old + offset)));
        if (next === old) return;
        if (next === 0 || next === 100) clamped++;
        const needle = '"id":"' + rec.id + '"';
        const recStart = src.indexOf(needle);
        if (recStart < 0) { console.error('cannot find ' + rec.id); process.exit(1); }
        const recEnd = src.indexOf('\n', recStart);
        const fieldNeedle = '"' + t.field + '":' + old;
        const slice = src.slice(recStart, recEnd);
        const hits = slice.split(fieldNeedle).length - 1;
        if (hits !== 1) { console.error('refusing ' + rec.id + '/' + t.field + ': matched ' + hits + ' times'); process.exit(1); }
        const newSlice = slice.replace(fieldNeedle, '"' + t.field + '":' + next);
        src = src.slice(0, recStart) + newSlice + src.slice(recEnd);
        changed++;
      });
    });
    console.log(file + ' ' + t.field + ': grand mean ' + grandMean.toFixed(1) +
      ', cohort offsets [' + cohortOffsets.map(o => o.toFixed(1)).join(', ') + '], ' + changed +
      ' record(s) changed, ' + clamped + ' landed on the 0/100 boundary');
    totalChanged += changed;
  }

  if (!DRY) fs.writeFileSync(path.join(ROOT, file), src);
}
console.log((DRY ? '[dry run] ' : '') + totalChanged + ' total value(s) ' + (DRY ? 'would change' : 'changed'));
