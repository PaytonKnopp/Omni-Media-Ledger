#!/usr/bin/env node
/*
 * Retired duplicate ids (app/format.js RETIRED_WORK_IDS): a saved profile or watchlist that still
 * carries one must land on the kept record at boot, without losing or doubling anything.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/format.js'), 'utf8'), ctx, { filename: 'app/format.js' });
const remap = vm.runInContext('remapRetiredIds', ctx);
const RETIRED = vm.runInContext('RETIRED_WORK_IDS', ctx);

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); if (detail !== undefined) console.log('     ' + JSON.stringify(detail)); failures++; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n=== retired duplicate ids ===');

const profile = {
  declaredGoatIds: ['m01', 'm1942', 'm47'],   // retired id and its kept record both gold
  silverTierIds: ['t140'],
  bronzeTierIds: ['m1582'],
  ratings: { m1949: 8.5, m1834: 7, m345: 9 },  // m345 is the kept record: its own rating wins
  ownedMedia: { m1941: '4K' },
  cosmicHorrorDeclaredIds: ['m02'],
  theme: 'dark',
};
const frozen = JSON.parse(JSON.stringify(profile));
const r = remap(profile, { m1948: { watched: 1 }, m1547: { rank: 2 }, m1940: { rank: 3 } });

check('reports that something moved', r.changed === true);
check('a retired gold id folds into the kept record without a duplicate entry', same(r.profile.declaredGoatIds, ['m01', 'm47']), r.profile.declaredGoatIds);
check('tier lists move to the kept id', same(r.profile.silverTierIds, ['t357']) && same(r.profile.bronzeTierIds, ['m127']), [r.profile.silverTierIds, r.profile.bronzeTierIds]);
check('a rating moves to the kept id; the kept record\'s own rating wins a clash', same(r.profile.ratings, { m345: 9, m68: 8.5 }), r.profile.ratings);
check('ownership moves with its format', same(r.profile.ownedMedia, { m1286: '4K' }), r.profile.ownedMedia);
check('fields with no retired ids, and non-id fields, are untouched', same(r.profile.cosmicHorrorDeclaredIds, ['m02']) && r.profile.theme === 'dark');
check('watchlist: the kept record\'s entry wins a clash, a lone retired entry moves', same(r.watchlist, { m1547: { rank: 2 }, m1810: { rank: 3 } }), r.watchlist);
check('the input objects are not mutated', same(profile, frozen));

const clean = remap({ declaredGoatIds: ['m01'], ratings: { m02: 7 } }, { m03: { rank: 1 } });
check('a profile with no retired ids reports no change', clean.changed === false);
check('null inputs pass through', remap(null, null).changed === false);
check('no retired id maps onto another retired id', Object.values(RETIRED).every(to => !(to in RETIRED)));

console.log(failures ? '\n' + failures + ' retired-id check(s) failed.\n' : '\nRetired-id checks passed.\n');
process.exit(failures ? 1 : 0);
