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

// Strips a record's prov stamp and four rubric fields out of the raw FILE TEXT (not just the
// parsed object), scoped to that record's own line the same way applyDecisions() itself scopes
// its replacements, so score-batch.js sees a genuinely fresh, unscored record to apply to. This
// replaces depending on a real gap existing somewhere in the live corpus: Phase C consumed the
// corpus in ID order as it ran, so a fixed fixture ID eventually stopped being an unscored work
// (caught once already, when the first real batch landed on m11) -- and now that scoring has
// reached 100% coverage, there is no real gap left anywhere for a dynamic search to find either.
// Synthesizing the gap on a throwaway copy of the text is future-proof against both failure modes.
function stripFieldsForFixture(src, id, fields) {
  const needle = '"id":"' + id + '"';
  const recStart = src.indexOf(needle);
  if (recStart < 0) throw new Error('fixture record ' + id + ' not found in file text');
  const recEnd = src.indexOf('\n', recStart);
  let before = src.slice(0, recStart), slice = src.slice(recStart, recEnd), after = src.slice(recEnd);
  fields.forEach(f => { slice = slice.replace(new RegExp(',"' + f + '":-?\\d+(\\.\\d+)?'), ''); });
  slice = slice.replace(/,"prov":\{[^}]*\}/, '');
  return before + slice + after;
}

try {
  console.log('\n=== score-batch harness: rubric-v1 stamping ===');
  const before = loadMovies();
  // Any real movie works as the base; its fields/prov are stripped from the file text below so
  // the test always has a genuinely fresh record to apply to, regardless of real corpus coverage.
  const target = before[0];
  check('setup: found a movie to use as the unscored fixture base (test is meaningless otherwise)',
    !!target, 'movies corpus is empty');
  const fixtureId = target && target.id;
  let fixtureSrc = backup;
  if (fixtureId) {
    fixtureSrc = stripFieldsForFixture(backup, fixtureId,
      ['ontologicalComplexity', 'emotionalWarmth', 'comicIntent', 'aestheticBeauty']);
    fs.writeFileSync(moviesPath, fixtureSrc);
  }

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
      fs.readFileSync(moviesPath, 'utf8') === fixtureSrc, dry);

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
  // must never clobber Phase A/B's hard-won provenance. Any sourced-facts record works as the
  // base; comicIntent is stripped from its file text on the throwaway copy below so there is
  // always a genuine field gap to fill, regardless of real corpus coverage (see
  // stripFieldsForFixture's comment for why this can no longer rely on a real gap existing).
  fs.writeFileSync(moviesPath, backup);
  const sourcedId = before.find(m => m.prov && m.prov.facts === 'sourced')?.id;
  if (sourcedId) {
    const rec = before.find(m => m.id === sourcedId);
    const originalFacts = rec.prov.facts;
    const originalChecked = rec.prov.checked;
    const originalSrc = rec.prov.src;
    // stripFieldsForFixture also strips prov, but this sub-test needs prov KEPT (that's the whole
    // point), so strip just the one field here directly rather than reusing that helper.
    const srcWithGap = (function () {
      const needle = '"id":"' + sourcedId + '"';
      const recStart = backup.indexOf(needle);
      const recEnd = backup.indexOf('\n', recStart);
      const slice = backup.slice(recStart, recEnd)
        .replace(new RegExp(',"comicIntent":-?\\d+(\\.\\d+)?'), '');
      return backup.slice(0, recStart) + slice + backup.slice(recEnd);
    })();
    fs.writeFileSync(moviesPath, srcWithGap);
    const needed = [{ id: sourcedId, field: 'comicIntent', value: 50, note: 'test: placeholder mid-band value' }];
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
  // Re-strip the fixture (not a plain backup restore): the other three fields must still be
  // genuinely undefined going in, or "complete" trivially reads true from their real pre-existing
  // values regardless of what this decision set provides, defeating the point of the check.
  if (fixtureId) {
    fs.writeFileSync(moviesPath, stripFieldsForFixture(backup, fixtureId,
      ['ontologicalComplexity', 'emotionalWarmth', 'comicIntent', 'aestheticBeauty']));
  }
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
