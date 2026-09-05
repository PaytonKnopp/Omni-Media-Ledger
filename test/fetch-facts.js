#!/usr/bin/env node
/*
 * Fixture test for the Phase 5 fact harness.
 *
 * The point of testing this offline is not that the network is inconvenient -- it is that the
 * decisions that matter here are made AFTER the network. Whether two catalogues corroborate each
 * other, whether a disagreement is a correction or a question for a human, and whether an edit is
 * allowed to touch data/ are all pure functions of the responses. So the responses are recorded
 * fixtures and the decisions are asserted directly. A live run replays through exactly this path.
 *
 * The fixture is built from real corpus records and plausible catalogue answers, one per case:
 *   m01  both sources agree with the corpus                    -> confirmed, grade A
 *   m02  both agree with each other, corpus runtime is wrong   -> proposed-change, grade A
 *        ...and the studio differs only by naming convention   -> soft field, grade B, not applied
 *   m03  the two sources disagree with each other on runtime   -> sources-disagree, never applied
 *   m04  one source errored; the survivor is uncorroborated    -> grade B, review queue
 *   m05  no key, so no source at all                           -> no-source, nothing claimed
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const { reconcile, valuesAgree, redactKeys } = require(path.join(ROOT, 'scripts/fetch-facts.js'));

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); if (detail) console.log('     ' + detail); failures++; }
}

console.log('\n=== fact harness: value comparison ===');
check('text comparison ignores case and punctuation',
  valuesAgree({ text: true }, 'Stanley Kubrick', 'stanley  kubrick!'));
check('text comparison does NOT match on a substring',
  !valuesAgree({ text: true }, 'Stanley Kubrick', 'Kubrick'));
check('numeric comparison is exact -- no quiet tolerance band deciding what does not matter',
  valuesAgree({}, 149, 149) && !valuesAgree({}, 149, 150));
check('list comparison needs real overlap, not one shared entry in twenty',
  valuesAgree({ list: true }, ['PC', 'PS5'], ['PS5', 'PC']) &&
  !valuesAgree({ list: true }, ['PC', 'PS5', 'Xbox', 'Switch'], ['PS5']));
check('a missing value never agrees with anything',
  !valuesAgree({ text: true }, undefined, 'Stanley Kubrick') && !valuesAgree({}, 149, null));

// A recorded run is meant to be committed, so the one place a key could reach disk is the URL
// stored beside each observation. OMDb spells the parameter `apikey` and TMDB `api_key`; both, and
// the IGDB secrets, have to be gone.
check('API keys are redacted out of every recorded URL, whichever way the parameter is spelled',
  !/SECRET/.test([
    redactKeys('https://www.omdbapi.com/?apikey=SECRET&t=Alien'),
    redactKeys('https://api.themoviedb.org/3/movie/1?api_key=SECRET'),
    redactKeys('https://id.twitch.tv/oauth2/token?client_secret=SECRET&grant_type=x'),
    redactKeys('https://x/?access_token=SECRET'),
  ].join(' ')));

console.log('\n=== fact harness: reconciliation ===');
const movies = new Function(fs.readFileSync(path.join(ROOT, 'data/movies.js'), 'utf8') + '\nreturn movies;')();
const byId = Object.fromEntries(movies.map(m => [m.id, m]));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fetch-facts-movies.json'), 'utf8'));
const got = {};
for (const id of Object.keys(fixture)) {
  const usable = fixture[id].filter(o => o.fields);
  got[id] = Object.fromEntries(reconcile('movie', byId[id], usable).map(p => [p.field, p]));
}

check('two sources agreeing with the corpus confirm it at grade A',
  got.m01.runtime.status === 'confirmed' && got.m01.runtime.grade === 'A',
  JSON.stringify(got.m01.runtime));
check('two sources agreeing against the corpus propose a grade-A correction',
  got.m02.runtime.status === 'proposed-change' && got.m02.runtime.grade === 'A' && got.m02.runtime.proposed === 144,
  JSON.stringify(got.m02.runtime));
check('a naming-convention field is never grade A, even fully corroborated',
  got.m02.studio.grade === 'B',
  JSON.stringify(got.m02.studio));
check('sources that disagree with each other are a question, not a correction',
  got.m03.runtime.status === 'sources-disagree' && got.m03.runtime.grade === 'B' &&
  Array.isArray(got.m03.runtime.alternatives) && got.m03.runtime.alternatives.length === 1,
  JSON.stringify(got.m03.runtime));
check('a lone surviving source is grade B however confident it sounds',
  got.m04.runtime.status === 'proposed-change' && got.m04.runtime.grade === 'B',
  JSON.stringify(got.m04.runtime));
check('no sources means no claim at all',
  got.m05.runtime.status === 'no-source' && got.m05.runtime.grade === null,
  JSON.stringify(got.m05.runtime));
check('nothing in the fixture is ever graded C',
  !Object.values(got).some(w => Object.values(w).some(p => p.grade === 'C')));

console.log('\n=== fact harness: apply is narrow, and refuses when it cannot be sure ===');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-facts-'));
execFileSync(process.execPath, [path.join(ROOT, 'scripts/fetch-facts.js'),
  '--medium', 'movie', '--ids', 'm01,m02,m03,m04,m05',
  '--offline', path.join(__dirname, 'fixtures/fetch-facts-movies.json'),
  '--out-dir', tmp], { cwd: ROOT, stdio: 'pipe' });
const outJson = fs.readdirSync(tmp).find(f => f.endsWith('.json'));
const outMd = fs.readdirSync(tmp).find(f => f.endsWith('.md'));
check('fetch-facts writes an evidence file and a review queue offline', !!outJson && !!outMd);

const queue = fs.readFileSync(path.join(tmp, outMd), 'utf8');
check('the review queue names the disagreement a human has to settle',
  queue.includes('Barry Lyndon') && queue.includes('sources-disagree'), queue.slice(0, 300));
// The Shining IS in the queue -- but for its studio naming, not for the runtime the harness is
// about to correct on its own. That distinction is the queue's whole job.
const shiningBlock = queue.split('## ').find(b => b.startsWith('The Shining')) || '';
check('the review queue asks about the soft field and not the grade-A correction it will apply',
  shiningBlock.includes('studio') && !shiningBlock.includes('runtime'), shiningBlock);

const dry = execFileSync(process.execPath, [path.join(ROOT, 'scripts/apply-facts.js'),
  path.join(tmp, outJson)], { cwd: ROOT, encoding: 'utf8' });
check('a dry run applies exactly the one grade-A correction',
  /1 grade-A corrections/.test(dry) && /m02\.runtime: 146 -> 144/.test(dry), dry);
check('a dry run stamps the records whose hard facts are fully sourced, and only those',
  /2 records stamped prov:sourced/.test(dry), dry);
check('a dry run writes nothing',
  fs.readFileSync(path.join(ROOT, 'data/movies.js'), 'utf8').includes('"runtime":146'));

// The refusal path: an evidence file whose "current" value is not what the corpus actually says
// (a stale evidence file, or a corpus edited underneath it) must be refused, not force-fitted.
const stale = JSON.parse(fs.readFileSync(path.join(tmp, outJson), 'utf8'));
stale.works.find(w => w.id === 'm02').proposals.find(p => p.field === 'runtime').current = 999;
fs.writeFileSync(path.join(tmp, 'stale.json'), JSON.stringify(stale));
const refusal = execFileSync(process.execPath, [path.join(ROOT, 'scripts/apply-facts.js'),
  path.join(tmp, 'stale.json')], { cwd: ROOT, encoding: 'utf8' });
check('stale evidence is refused rather than applied to whatever is on the line now',
  /REFUSED/.test(refusal) && /m02\.runtime: expected/.test(refusal), refusal);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? '\n' + failures + ' fact-harness check(s) failed.\n' : '\nFact harness passed all checks.\n');
process.exit(failures ? 1 : 0);
