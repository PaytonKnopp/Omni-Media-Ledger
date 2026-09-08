#!/usr/bin/env node
/*
 * Fixture test for the substance harness (scripts/fetch-substance.js).
 *
 * Substance is evidence for a JUDGEMENT, not a fact to apply, so what has to be tested here is
 * different from the fact harness. There is nothing to reconcile and no grade to award. What
 * matters is:
 *
 *   1. tags are normalised and de-duplicated, and compared EXACTLY -- never by substring, which is
 *      how "war" finds "warmth" and has gone wrong twice in this repo's history
 *   2. a work with no evidence is reported as having none, loudly, rather than quietly scoring 0
 *      tags and looking the same as a work nobody asked about
 *   3. synopsis prose is withheld unless explicitly asked for, because this repository is public
 *      and a synopsis is expressive text rather than a fact
 *   4. a substance pack can never leak an index value into a blind worksheet
 *   5. a pack for the wrong medium is refused rather than silently attaching nothing
 */

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { mergeTags, normTag, packEntry } = require(path.join(ROOT, 'scripts/fetch-substance.js'));

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); if (detail) console.log('     ' + detail); failures++; }
}

console.log('\n=== substance harness: tag handling ===');
check('tags are lowercased and internal whitespace collapsed',
  normTag('  Space   Travel ') === 'space travel');
check('duplicates across sources merge to one entry',
  JSON.stringify(mergeTags(['Space', 'space'], ['SPACE  '])) === JSON.stringify(['space']));
check('order is preserved so the first source stays first',
  JSON.stringify(mergeTags(['b', 'a'], ['c'])) === JSON.stringify(['b', 'a', 'c']));
check('an absurdly long "tag" is dropped rather than carried into a worksheet',
  mergeTags(['x'.repeat(61)]).length === 0 && mergeTags(['x'.repeat(60)]).length === 1);
check('empty and missing lists are survivable',
  JSON.stringify(mergeTags(undefined, [], [null, ''], ['a'])) === JSON.stringify(['a']));
// The substring trap, stated as a test so it cannot come back: these two tags must stay distinct.
check('two tags that share a prefix stay two tags (no substring collapsing)',
  mergeTags(['war', 'warmth']).length === 2);

console.log('\n=== substance harness: the pack ===');
const movies = new Function(fs.readFileSync(path.join(ROOT, 'data/movies.js'), 'utf8') + '\nreturn movies;')();
const byId = Object.fromEntries(movies.map(m => [m.id, m]));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fetch-substance-movies.json'), 'utf8'));

const tagOnly = packEntry(byId.m01, fixture.m01, false);
const withProse = packEntry(byId.m01, fixture.m01, true);
check('a matched work carries its merged, de-duplicated tags',
  tagOnly.coverage === 5 && tagOnly.tags.indexOf('space travel') >= 0 &&
  tagOnly.tags.filter(t => t === 'artificial intelligence').length === 1,
  JSON.stringify(tagOnly.tags));
check('synopsis prose is WITHHELD by default (this repository is public)',
  tagOnly.synopsis === undefined);
check('synopsis prose is carried only when explicitly requested',
  typeof withProse.synopsis === 'string' && withProse.synopsis.length > 0);
check('the pack records which source answered, so a score can cite it',
  tagOnly.sources.length === 1 && tagOnly.sources[0].src === 'TMDB');

const missed = packEntry(byId.m03, fixture.m03, false);
const noKey = packEntry(byId.m04, fixture.m04, false);
check('a work the catalogue could not match reports zero coverage and says why',
  missed.coverage === 0 && /no match/.test(missed.missed.join(' ')), JSON.stringify(missed.missed));
check('a work skipped for a missing key is distinguishable from one that was genuinely not found',
  /no TMDB_API_KEY/.test(noKey.missed.join(' ')), JSON.stringify(noKey.missed));

console.log('\n=== substance harness: worksheets stay blind ===');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-subst-'));
execFileSync(process.execPath, [path.join(ROOT, 'scripts/fetch-substance.js'),
  '--medium', 'movie', '--ids', 'm01,m02,m03,m04',
  '--offline', path.join(__dirname, 'fixtures/fetch-substance-movies.json'),
  '--out-dir', tmp], { cwd: ROOT, stdio: 'pipe' });
const packFile = path.join(tmp, fs.readdirSync(tmp).find(f => f.endsWith('.json')));
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
check('an offline run writes a pack carrying the TMDB attribution its terms require',
  /TMDB/.test(pack.attribution || ''), pack.attribution);

const sheet = execFileSync(process.execPath, [path.join(ROOT, 'scripts/score-batch.js'),
  '--worksheet', '--medium', 'movies', '--ids', 'm01,m02,m03,m04',
  '--substance', packFile], { cwd: ROOT, encoding: 'utf8' });
check('the worksheet attaches the evidence for a work that has some',
  /about:\s+.*isolation/.test(sheet), sheet.split('\n').filter(l => /about:/.test(l)).join(' | '));
check('the worksheet says out loud when a work has NO evidence, instead of leaving a blank line',
  (sheet.match(/NO EVIDENCE GATHERED/g) || []).length === 2, sheet);
// The blindness invariant. Every index value for these four works must be absent from the sheet --
// seeing the old number first anchors the answer, which is the drift this pass exists to repair.
const leaked = ['m01', 'm02', 'm03', 'm04'].flatMap(id => {
  const r = byId[id];
  return [['atmosphericDreadIndex', r.atmosphericDreadIndex], ['ontologicalComplexity', r.ontologicalComplexity]]
    .filter(([, v]) => v !== undefined && new RegExp('\\b' + v + '\\b').test(sheet))
    .map(([f, v]) => id + '.' + f + ' (' + v + ') appears in the worksheet');
});
check('no index value reaches the worksheet, with or without a substance pack', leaked.length === 0,
  leaked.join('; '));

// A pack about books must not be attachable to a film worksheet. Silently attaching nothing would
// be indistinguishable from a pack that simply had nothing to say.
fs.writeFileSync(path.join(tmp, 'wrong.json'), JSON.stringify({ medium: 'book', works: [] }));
let refused = false;
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/score-batch.js'), '--worksheet',
    '--medium', 'movies', '--ids', 'm01', '--substance', path.join(tmp, 'wrong.json')],
    { cwd: ROOT, stdio: 'pipe' });
} catch (e) { refused = /refusing to attach evidence/.test(String(e.stderr)); }
check('a substance pack for the wrong medium is refused, not silently ignored', refused);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? '\n' + failures + ' substance-harness check(s) failed.\n'
                     : '\nSubstance harness passed all checks.\n');
process.exit(failures ? 1 : 0);
