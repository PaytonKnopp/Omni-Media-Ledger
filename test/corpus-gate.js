#!/usr/bin/env node
/*
 * The corpus consistency gate, full form: snapshot the real app's scores on a blank profile and on
 * the PK Sample (scripts/score-snapshot.js, real Chromium), then run scripts/corpus-metrics.js
 * --assert against each. `npm run test-fast` runs the data-only half without a browser; this adds
 * the rows that need gm (recency guard, concentration, resolution). CI runs it as part of npm test.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-gate-'));
let failed = false;
try {
  for (const profile of ['blank', 'pk']) {
    const out = path.join(dir, profile + '.json');
    execFileSync('node', [path.join(ROOT, 'scripts/score-snapshot.js'), '--profile', profile, out], { stdio: ['ignore', 'ignore', 'inherit'] });
    try {
      execFileSync('node', [path.join(ROOT, 'scripts/corpus-metrics.js'), '--assert', '--snapshot', out], { stdio: 'inherit' });
    } catch (e) { failed = true; }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
