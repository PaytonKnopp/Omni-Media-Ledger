#!/usr/bin/env node
// Splits a raw scoring-agent output file ([{id,field,value,note}, ...], value possibly null) into
// a decisions file score-batch.js --apply can consume (numeric values only) and a flagged file
// listing everything the agent refused to guess at (value: null) with its reason, so nothing
// thin-evidence gets silently dropped instead of reported.
//
//   node scripts/split-batch-results.js <raw.json> <decisions-out.json> <flagged-out.json>
const fs = require('fs');
const [rawFile, decisionsOut, flaggedOut] = process.argv.slice(2);
if (!rawFile || !decisionsOut || !flaggedOut) {
  console.error('usage: split-batch-results.js <raw.json> <decisions-out.json> <flagged-out.json>');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
const decisions = [];
const flagged = [];
for (const r of raw) {
  if (typeof r.value === 'number' && isFinite(r.value) && r.value >= 0 && r.value <= 100) {
    decisions.push({ id: r.id, field: r.field, value: r.value, note: r.note });
  } else {
    flagged.push({ id: r.id, field: r.field, note: r.note || '(no reason given)' });
  }
}
fs.writeFileSync(decisionsOut, JSON.stringify(decisions));
fs.writeFileSync(flaggedOut, JSON.stringify(flagged, null, 1));
console.log(rawFile + ': ' + decisions.length + ' scorable, ' + flagged.length + ' flagged (thin/no evidence)');
