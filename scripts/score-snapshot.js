#!/usr/bin/env node
/*
 * Derived-value snapshot for the corpus, and a differ for two snapshots.
 *
 * Why this exists
 * ---------------
 * Every score the app shows is *derived* -- gm, the 21 specialised indices, the content rating,
 * genre-family membership. None of it is stored anywhere. So editing one number in data/*.js can
 * move a work you were not looking at, in a surface you were not testing, and nothing errors and
 * nothing in the test suite notices. That has already happened once in this repo.
 *
 * This takes the derived values for all works, before and after a change, and reports exactly what
 * moved. The rule the quality pass runs on: a batch is accepted only when every line of its diff is
 * explainable, and anything that moved outside the batch is a bug, not an improvement.
 *
 * It reads the values out of the REAL app in a real browser rather than reimplementing the scoring
 * engine here. A reimplementation is a second copy of the thing under test: it agrees right up
 * until the moment the answer matters, and then it silently vindicates a change the shipped code
 * would have rejected. window.ALL (app/ledger-app.js) is the same object every screen renders from.
 *
 *   node scripts/score-snapshot.js out.json                 snapshot the PK sample profile
 *   node scripts/score-snapshot.js --profile blank out.json snapshot a blank profile
 *   node scripts/score-snapshot.js --diff before.json after.json
 *
 * --profile blank matters as much as the default. A brand-new person with no declared taste gets
 * scored by the corpus alone, so it is the only view that shows corpus bias with the owner's own
 * profile subtracted out. Both are worth snapshotting around any change to data or the engine.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ===================== the fields a snapshot captures ===================== */

// Everything derived that a screen can show. Ordered so a diff reads in a stable order.
// Keep in sync with IDX_KEYS in app/ledger-app.js -- a new index the app computes but this does
// not capture is an index a data change can silently move.
const INDEX_KEYS = ['snd', 'ref', 'ch', 'emo', 'awe', 'cozy', 'perf', 'icon', 'scary', 'real',
  'reality', 'shock', 'sci', 'funny', 'hist', 'vibe2', 'crit', 'aud', 'tech', 'dread', 'myst'];

// Captured per work alongside the indices above.
const SCALAR_KEYS = ['gm', 'gmBase', 'gmBoostTotal', 'gmOverride', 'ovr', 'rating', 'prov',
  'owned', 'goat', 'silver', 'bronze'];

/* ===================== snapshot ===================== */

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const candidates = ['/opt/pw-browsers', path.join(require('os').homedir(), '.cache', 'ms-playwright')];
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    for (const dir of fs.readdirSync(base)) {
      if (!dir.startsWith('chromium')) continue;
      const p = path.join(base, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

// Same definition of "booted" as test/regression.js, and for the same reason: boot cost scales
// with the corpus, so a fixed sleep gets less trustworthy exactly as the data changes fastest.
async function waitForBoot(page, timeout) {
  await page.waitForFunction(() => {
    if (typeof window.ALL !== 'undefined') return true;
    return ['acctGate', 'onboardGate'].some(id => {
      const g = document.getElementById(id);
      return g && !g.classList.contains('hidden');
    });
  }, { timeout: timeout || 60000 }).catch(() => {});
}

async function snapshot(profile) {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: findChromium() });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    // Block the Supabase CDN so the snapshot does not depend on whether this machine has outbound
    // network access -- an unreachable CDN and a reachable one must produce the same numbers.
    await page.route('**/supabase-js*/**', route => route.abort());
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await waitForBoot(page);

    // Choose a starting point at the onboarding gate. Both paths save a profile and reload, so
    // wait for the second boot rather than the first.
    const gateVisible = await page.evaluate(() => {
      const g = document.getElementById('onboardGate');
      return g && !g.classList.contains('hidden');
    });
    if (gateVisible) {
      await page.click(profile === 'blank' ? '#onboardBlank' : '#onboardSample');
      await waitForBoot(page);
    }
    await page.waitForFunction(() => typeof window.ALL !== 'undefined', { timeout: 60000 });

    const works = await page.evaluate(([indexKeys, scalarKeys]) => {
      return ALL.map(x => {
        const row = { id: x.id, kind: x.kind, title: x.title };
        scalarKeys.forEach(k => { row[k] = x[k] === undefined ? null : x[k]; });
        indexKeys.forEach(k => { row[k] = x[k] === undefined ? null : x[k]; });
        row.fam = (x.fam || []).slice().sort();
        return row;
      });
    }, [INDEX_KEYS, SCALAR_KEYS]);

    if (pageErrors.length) {
      throw new Error('page errors during snapshot: ' + pageErrors.join(' | '));
    }
    if (!works.length) throw new Error('snapshot captured zero works');

    return {
      profile: profile || 'pk',
      capturedFields: { scalars: SCALAR_KEYS, indices: INDEX_KEYS },
      count: works.length,
      works: works.sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id)),
    };
  } finally {
    await browser.close();
  }
}

/* ===================== diff ===================== */

// A diff is only useful if it is readable at a glance, so it reports three separate things:
// which works changed and how, which FIELDS moved across the whole corpus (the shape of the
// change), and the aggregate score movement. The middle one is what catches a change that was
// meant to touch one field and touched three.
function diff(beforeFile, afterFile) {
  const a = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
  const b = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
  if (a.profile !== b.profile) {
    console.log('WARNING: comparing different profiles (' + a.profile + ' vs ' + b.profile + ')');
  }
  const byIdA = new Map(a.works.map(w => [w.id, w]));
  const byIdB = new Map(b.works.map(w => [w.id, w]));

  const added = b.works.filter(w => !byIdA.has(w.id));
  const removed = a.works.filter(w => !byIdB.has(w.id));
  const fields = SCALAR_KEYS.concat(INDEX_KEYS);

  const changed = [];
  const fieldCounts = {};
  let gmDelta = 0, gmMoved = 0;
  for (const wa of a.works) {
    const wb = byIdB.get(wa.id);
    if (!wb) continue;
    const deltas = [];
    for (const f of fields) {
      if (JSON.stringify(wa[f]) !== JSON.stringify(wb[f])) {
        deltas.push(f + ': ' + JSON.stringify(wa[f]) + ' -> ' + JSON.stringify(wb[f]));
        fieldCounts[f] = (fieldCounts[f] || 0) + 1;
      }
    }
    if (JSON.stringify(wa.fam) !== JSON.stringify(wb.fam)) {
      deltas.push('fam: ' + JSON.stringify(wa.fam) + ' -> ' + JSON.stringify(wb.fam));
      fieldCounts.fam = (fieldCounts.fam || 0) + 1;
    }
    if (deltas.length) {
      changed.push({ id: wa.id, title: wa.title, deltas });
      if (typeof wa.gm === 'number' && typeof wb.gm === 'number' && wa.gm !== wb.gm) {
        gmDelta += wb.gm - wa.gm; gmMoved++;
      }
    }
  }

  console.log('\n=== snapshot diff (' + path.basename(beforeFile) + ' -> ' + path.basename(afterFile) + ') ===');
  console.log('  profile: ' + a.profile + '   works: ' + a.count + ' -> ' + b.count);
  if (added.length) console.log('  ADDED   ' + added.length + ': ' + added.slice(0, 10).map(w => w.id).join(', ') + (added.length > 10 ? ' ...' : ''));
  if (removed.length) console.log('  REMOVED ' + removed.length + ': ' + removed.slice(0, 10).map(w => w.id).join(', ') + (removed.length > 10 ? ' ...' : ''));

  if (!changed.length && !added.length && !removed.length) {
    console.log('  no derived value changed.');
    return 0;
  }

  console.log('\n  fields that moved, across the whole corpus:');
  Object.entries(fieldCounts).sort((x, y) => y[1] - x[1])
    .forEach(e => console.log('    ' + e[0].padEnd(14) + String(e[1]).padStart(5) + ' works'));

  console.log('\n  works whose derived values changed: ' + changed.length);
  if (gmMoved) {
    console.log('    gm moved on ' + gmMoved + ' works, net ' + (gmDelta >= 0 ? '+' : '') + gmDelta +
      ' (mean ' + (gmDelta / gmMoved).toFixed(2) + ' per moved work)');
  }
  const CAP = parseInt(process.env.SNAPSHOT_DIFF_CAP || '60', 10);
  changed.slice(0, CAP).forEach(c => {
    console.log('    ' + c.id.padEnd(7) + c.title.slice(0, 44).padEnd(46) + c.deltas.join('; '));
  });
  if (changed.length > CAP) {
    console.log('    ...and ' + (changed.length - CAP) + ' more (SNAPSHOT_DIFF_CAP=' + CAP + ')');
  }
  return changed.length;
}

/* ===================== cli ===================== */

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--diff') {
    if (argv.length !== 3) { console.error('usage: score-snapshot.js --diff before.json after.json'); process.exit(2); }
    diff(argv[1], argv[2]);
    return;
  }
  let profile = 'pk';
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile') { profile = argv[++i]; continue; }
    rest.push(argv[i]);
  }
  if (!['pk', 'blank'].includes(profile)) { console.error('--profile must be pk or blank'); process.exit(2); }
  const out = rest[0];
  if (!out) { console.error('usage: score-snapshot.js [--profile pk|blank] out.json'); process.exit(2); }

  const snap = await snapshot(profile);
  fs.writeFileSync(out, JSON.stringify(snap, null, 1));
  console.log('wrote ' + out + ': ' + snap.count + ' works, profile=' + snap.profile);
}

main().catch(e => { console.error(e); process.exit(1); });
