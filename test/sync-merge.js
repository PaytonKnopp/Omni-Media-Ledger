#!/usr/bin/env node
/*
 * Merge harness: app/sync-merge.js, the title-by-title merge of two copies of one person's saved
 * data, with no browser (part of test-fast). The browser suite drives the same merge through the
 * real sync code against the mocked Supabase; this pins down the rules themselves.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); failures++; }
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/sync-merge.js'), 'utf8'), ctx, { filename: 'app/sync-merge.js' });
const get = n => vm.runInContext(n, ctx);
const syncPaths = get('syncPaths'), syncChangedPaths = get('syncChangedPaths'), syncMergeSnapshots = get('syncMergeSnapshots');
const syncRecordEdits = get('syncRecordEdits'), syncBuild = get('syncBuild'), EDITS = get('SYNC_EDITS_KEY'), TTL = get('SYNC_EDIT_TTL_S');
const KEYS = ['omniLedgerProfile', 'omniLedgerWatchlist', 'omniLedgerTheme', 'omniLedgerDensity', 'omniLedgerOnboarded', 'omniLedgerTipsDismissed', EDITS];

// A device: its stored strings, edited the way the storage hook edits them (stamp what changed).
function device(snapshot) { return JSON.parse(JSON.stringify(snapshot)); }
function edit(dev, key, fn, atS) {
  const before = dev[key];
  const next = fn(before == null ? null : (key === 'omniLedgerProfile' || key === 'omniLedgerWatchlist') ? JSON.parse(before) : before);
  dev[key] = typeof next === 'string' ? next : JSON.stringify(next);
  dev[EDITS] = syncRecordEdits(dev[EDITS], syncChangedPaths(key, before, dev[key]), atS);
}
const P = s => JSON.parse(s.omniLedgerProfile);
const W = s => JSON.parse(s.omniLedgerWatchlist);

console.log('\n=== merge: what an edit touches ===');
const prof = JSON.stringify({ silverTierIds: ['m1', 'm2'], ratings: { m3: 8 }, creatorBoost: [['Kubrick', 8]], pinnedIdx: ['ref', 'snd'], ownedMedia: { m4: '4K' } });
const paths = syncPaths('omniLedgerProfile', prof);
check('tiers split per title, ratings per title, boosts per name, pins as one choice',
  paths.get('s|m1') === '1' && paths.get('r|m3') === '8' && paths.get('cb|Kubrick') === '8' && paths.get('P|pinnedIdx') === '["ref","snd"]' && paths.get('om|m4') === '"4K"');
check('adding a rating changes exactly that rating', JSON.stringify(syncChangedPaths('omniLedgerProfile', prof,
  JSON.stringify(Object.assign(JSON.parse(prof), { ratings: { m3: 8, m9: 6.5 } })))) === '["r|m9"]');
check('removing a Silver title changes exactly that title', JSON.stringify(syncChangedPaths('omniLedgerProfile', prof,
  JSON.stringify(Object.assign(JSON.parse(prof), { silverTierIds: ['m1'] })))) === '["s|m2"]');
check('a watchlist entry is one path per title', syncPaths('omniLedgerWatchlist', '{"m1":{"watched":true,"added":1}}').has('w|m1'));
check('a setting is one path', syncPaths('omniLedgerTheme', 'lotr').get('k|omniLedgerTheme') === '"lotr"');
check('rebuilding from paths gives back an equal value', (() => {
  const back = syncBuild('omniLedgerProfile', paths, [prof]);
  const a = syncPaths('omniLedgerProfile', back);
  return a.size === paths.size && Array.from(paths).every(([k, v]) => a.get(k) === v);
})());

console.log('\n=== merge: an offline phone and a laptop ===');
const base = { omniLedgerProfile: JSON.stringify({ silverTierIds: ['m1'], ratings: { m2: 8 } }), omniLedgerWatchlist: '{}', omniLedgerTheme: '', omniLedgerOnboarded: '1' };
const laptop = device(base), phone = device(base);
edit(laptop, 'omniLedgerProfile', p => Object.assign(p, { bronzeTierIds: ['m3'] }), 1000);
edit(laptop, 'omniLedgerProfile', p => { p.ratings.m2 = 9; return p; }, 1010);
edit(laptop, 'omniLedgerWatchlist', w => Object.assign(w, { m8: { watched: false, added: 1 } }), 1020);
edit(laptop, 'omniLedgerTheme', () => 'lotr', 1030);
edit(phone, 'omniLedgerProfile', p => { p.silverTierIds.push('m4'); return p; }, 1005);
edit(phone, 'omniLedgerWatchlist', w => Object.assign(w, { m7: { watched: true, added: 2, doneAt: 2, logOnly: true } }), 1015);
// The laptop's copy is what the cloud holds; the phone comes back online with its own unsynced edits.
const m = syncMergeSnapshots(phone, laptop, KEYS, { localWinsTies: true });
check('the phone\'s Silver pick and the laptop\'s Bronze pick both survive',
  P(m.snapshot).silverTierIds.join() === 'm1,m4' && P(m.snapshot).bronzeTierIds.join() === 'm3');
check('the laptop\'s newer rating wins, though the phone is the side with unsynced work', P(m.snapshot).ratings.m2 === 9);
check('watchlist: the phone\'s completion and the laptop\'s Up Next entry both survive', !!W(m.snapshot).m7 && W(m.snapshot).m7.watched && !!W(m.snapshot).m8);
check('the laptop\'s theme reaches the phone', m.snapshot.omniLedgerTheme === 'lotr');
check('the merge reports the phone must show new things and the cloud must be written', m.dataChangedLocal && m.changedRemote);
const again = syncMergeSnapshots(m.snapshot, m.snapshot, KEYS, { localWinsTies: true });
check('merging the result with itself changes nothing, and rewrites no string', !again.dataChangedLocal && !again.changedRemote &&
  KEYS.every(k => again.snapshot[k] === m.snapshot[k]));
const laptopLater = syncMergeSnapshots(laptop, m.snapshot, KEYS, { localWinsTies: false });
check('the laptop, loading the merged copy, gains the phone\'s edits too', P(laptopLater.snapshot).silverTierIds.includes('m4') && !!W(laptopLater.snapshot).m7);

console.log('\n=== merge: removals, conflicts, ties ===');
const a1 = device(base), b1 = device(base);
edit(b1, 'omniLedgerProfile', p => { delete p.ratings.m2; return p; }, 2000);
const rm = syncMergeSnapshots(a1, b1, KEYS, { localWinsTies: true });
check('a rating removed on one device stays removed, not revived by the other\'s stale copy', !('m2' in P(rm.snapshot).ratings));
const a2 = device(base), b2 = device(base);
edit(a2, 'omniLedgerProfile', p => { p.ratings.m5 = 7; return p; }, 3000);
edit(b2, 'omniLedgerProfile', p => { p.ratings.m5 = 9; return p; }, 3010);
check('the same title edited on both: the later edit wins, whichever side it is on',
  P(syncMergeSnapshots(a2, b2, KEYS, { localWinsTies: true }).snapshot).ratings.m5 === 9 &&
  P(syncMergeSnapshots(b2, a2, KEYS, { localWinsTies: true }).snapshot).ratings.m5 === 9);
const t1 = device(base), t2 = device(base);
t1.omniLedgerProfile = JSON.stringify({ silverTierIds: ['m1'], ratings: { m2: 4 } });
check('no timestamps either side (edited before they existed): local wins when it holds unsynced work',
  P(syncMergeSnapshots(t1, t2, KEYS, { localWinsTies: true }).snapshot).ratings.m2 === 4);
check('...and the cloud wins otherwise', P(syncMergeSnapshots(t1, t2, KEYS, { localWinsTies: false }).snapshot).ratings.m2 === 8);
const t3 = device(base), t4 = device(base);
t4.omniLedgerProfile = JSON.stringify({ silverTierIds: ['m1', 'm9'], ratings: { m2: 8 } });
check('an unstamped title only one side has is kept: nothing is deleted without a record of deleting it',
  P(syncMergeSnapshots(t3, t4, KEYS, { localWinsTies: true }).snapshot).silverTierIds.includes('m9'));
const ord1 = device({ omniLedgerProfile: JSON.stringify({ declaredGoatIds: ['a', 'b', 'c'] }) });
const ord2 = device(ord1);
edit(ord2, 'omniLedgerProfile', p => { p.declaredGoatIds.push('d'); return p; }, 5000);
check('order is kept: existing picks stay where they were, new ones join the end',
  P(syncMergeSnapshots(ord1, ord2, KEYS, { localWinsTies: true }).snapshot).declaredGoatIds.join() === 'a,b,c,d');

console.log('\n=== merge: robustness ===');
const broken = { omniLedgerProfile: '{not json', omniLedgerWatchlist: '[]' };
let threw = false;
try { syncMergeSnapshots(broken, base, KEYS, { localWinsTies: true }); } catch (e) { threw = true; }
check('an unreadable stored value merges as one opaque whole instead of throwing', !threw);
const fresh = syncMergeSnapshots({}, base, KEYS, { localWinsTies: true });
check('a device with nothing yet takes the cloud copy as is', fresh.snapshot.omniLedgerProfile === base.omniLedgerProfile && !fresh.changedRemote);
const old = JSON.stringify({ 'r|m1': 100, 'r|m2': 10 ** 9 });
const pruned = JSON.parse(syncRecordEdits(old, ['r|m3'], 10 ** 9 + 60));
check('stamps older than the keep window are dropped when new edits are recorded (' + Math.round(TTL / 86400) + ' days)',
  !('r|m1' in pruned) && pruned['r|m2'] === 10 ** 9 && pruned['r|m3'] === 10 ** 9 + 60);

console.log(failures ? '\n' + failures + ' of ' + checks + ' merge check(s) failed.' : '\nMerge harness passed all ' + checks + ' checks.');
process.exit(failures ? 1 : 0);
