#!/usr/bin/env node
/*
 * Regression test for scripts/score-batch.js's --apply, focused on the prov.indices:"rubric-v1"
 * stamping this session added (score-batch.js previously never touched prov at all). Runs the
 * real script against a backed-up-and-restored copy of the real data files, since apply's data
 * path isn't parameterizable -- same pattern test/fetch-facts.js uses for apply-facts.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); if (detail) console.log('     ' + detail); failures++; }
}

const moviesPath = path.join(ROOT, 'data/movies.js');
const backup = fs.readFileSync(moviesPath, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-score-'));

function loadMovies() {
  return new Function(fs.readFileSync(moviesPath, 'utf8') + '\nreturn movies;')();
}

try {
  console.log('\n=== score-batch harness: rubric-v1 stamping ===');
  const before = loadMovies();
  // Pick a real movie with NO prov stamp at all yet and no existing index values, so this
  // exercises both the insert-new-field path (contextTags anchor) and the "no prior facts stamp"
  // default in one record. Found dynamically rather than hardcoded to one ID (originally m11):
  // Phase C consumes the corpus in ID order as it runs, so a fixed ID eventually stops being an
  // unscored work and the whole test starts failing for a reason that has nothing to do with the
  // script under test. This is exactly the drifting-fixture failure mode -- caught when Phase C's
  // first real batch landed on m11 and broke this test for a reason unrelated to score-batch.js.
  const target = before.find(m => !m.prov && m.emotionalWarmth === undefined);
  check('setup: found a movie with no prov and no emotionalWarmth to start (test is meaningless otherwise)',
    !!target, 'no unscored fixture movie left in the corpus -- Phase C has consumed all of them');
  const fixtureId = target && target.id;

  const decisions = fixtureId ? [
    { id: fixtureId, field: 'ontologicalComplexity', value: 80, note: 'test: reverse-chronology memory structure' },
    { id: fixtureId, field: 'emotionalWarmth', value: 30, note: 'test: cold, manipulation-driven' },
    { id: fixtureId, field: 'comicIntent', value: 10, note: 'test: minimal comic construction' },
    { id: fixtureId, field: 'aestheticBeauty', value: 45, note: 'test: competent, not beauty-focused' },
  ] : [];
  fs.writeFileSync(path.join(tmp, 'decisions.json'), JSON.stringify(decisions));

  if (fixtureId) {
    const dry = execFileSync(process.execPath, [path.join(ROOT, 'scripts/score-batch.js'),
      '--apply', path.join(tmp, 'decisions.json'), '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
    check('a dry run reports the record would be stamped, without writing',
      /1 record\(s\) would be stamped rubric-v1/.test(dry) &&
      fs.readFileSync(moviesPath, 'utf8') === backup, dry);

    execFileSync(process.execPath, [path.join(ROOT, 'scripts/score-batch.js'),
      '--apply', path.join(tmp, 'decisions.json')], { cwd: ROOT, encoding: 'utf8' });
    const after = loadMovies();
    const m11 = after.find(m => m.id === fixtureId);
    check('all four decided fields were written',
      m11.ontologicalComplexity === 80 && m11.emotionalWarmth === 30 &&
      m11.comicIntent === 10 && m11.aestheticBeauty === 45, JSON.stringify(m11));
    check('a record with every applicable (non-dread) field now scored gets stamped indices:"rubric-v1"',
      m11.prov && m11.prov.indices === 'rubric-v1', JSON.stringify(m11.prov));
    check('a record with no prior prov stamp defaults facts to "estimated", not fabricated as sourced',
      m11.prov && m11.prov.facts === 'estimated', JSON.stringify(m11.prov));
  } else {
    ['a dry run reports the record would be stamped, without writing',
     'all four decided fields were written',
     'a record with every applicable (non-dread) field now scored gets stamped indices:"rubric-v1"',
     'a record with no prior prov stamp defaults facts to "estimated", not fabricated as sourced']
      .forEach(label => check(label, false, 'skipped: no unscored fixture movie available'));
  }

  // Restore, then verify a record that ALREADY has a real facts stamp keeps it -- indices scoring
  // must never clobber Phase A/B's hard-won provenance.
  fs.writeFileSync(moviesPath, backup);
  const sourcedId = before.find(m => m.prov && m.prov.facts === 'sourced' &&
    m.ontologicalComplexity !== undefined && m.emotionalWarmth === undefined)?.id
    || before.find(m => m.prov && m.prov.facts === 'sourced')?.id;
  if (sourcedId) {
    const rec = before.find(m => m.id === sourcedId);
    const originalFacts = rec.prov.facts;
    const originalChecked = rec.prov.checked;
    const originalSrc = rec.prov.src;
    const needed = ['ontologicalComplexity', 'emotionalWarmth', 'comicIntent', 'aestheticBeauty']
      .filter(f => rec[f] === undefined)
      .map(f => ({ id: sourcedId, field: f, value: 50, note: 'test: placeholder mid-band value' }));
    fs.writeFileSync(path.join(tmp, 'decisions2.json'), JSON.stringify(needed));
    if (needed.length) {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/score-batch.js'),
        '--apply', path.join(tmp, 'decisions2.json')], { cwd: ROOT, encoding: 'utf8' });
      const after2 = loadMovies().find(m => m.id === sourcedId);
      check('a record that already had a real facts stamp (' + originalFacts + ') keeps it, only indices changes',
        after2.prov.facts === originalFacts &&
        after2.prov.checked === originalChecked && after2.prov.src === originalSrc &&
        after2.prov.indices === 'rubric-v1',
        JSON.stringify({ before: rec.prov, after: after2.prov }));
    } else {
      check('a record that already had a real facts stamp keeps it, only indices changes', false,
        'no fixture record found with a sourced stamp and a genuine field gap to fill -- test setup needs revisiting');
    }
  } else {
    check('a record that already had a real facts stamp keeps it, only indices changes', false,
      'no sourced-stamped record found in the corpus to test against');
  }

  // A record missing even ONE applicable field must not be stamped -- partial is not "scored".
  fs.writeFileSync(moviesPath, backup);
  if (fixtureId) {
    const partial = [{ id: fixtureId, field: 'ontologicalComplexity', value: 80, note: 'test: only one of four fields' }];
    fs.writeFileSync(path.join(tmp, 'decisions3.json'), JSON.stringify(partial));
    const partialOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts/score-batch.js'),
      '--apply', path.join(tmp, 'decisions3.json')], { cwd: ROOT, encoding: 'utf8' });
    const afterPartial = loadMovies().find(m => m.id === fixtureId);
    check('a record missing even one applicable field is NOT stamped -- partial scoring is not "scored"',
      /0 record\(s\) stamped rubric-v1/.test(partialOut) &&
      (!afterPartial.prov || afterPartial.prov.indices !== 'rubric-v1'),
      partialOut + ' | prov=' + JSON.stringify(afterPartial.prov));
  } else {
    check('a record missing even one applicable field is NOT stamped -- partial scoring is not "scored"',
      false, 'skipped: no unscored fixture movie available');
  }
} finally {
  fs.writeFileSync(moviesPath, backup);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? '\n' + failures + ' score-batch check(s) failed.' : '\nScore-batch harness passed all checks.');
process.exit(failures ? 1 : 0);
