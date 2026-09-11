#!/usr/bin/env node
/*
 * Cold-start recommendation quality test.
 *
 * The app's stated secondary goal for Phase C: give great suggestions to someone who is not
 * Payton, based only on what they tier and own. This builds several synthetic profiles that look
 * nothing like Payton's -- a comedy lover, a warm-family-drama viewer, a literary-fiction reader, a
 * cosy-games player -- each seeded with only 5-8 tiered works (silverTierIds), the same onboarding
 * mechanism a real stranger would use. It then reads the real recommendation engine
 * (buildGeneratedRec, the same function the app itself and test/regression.js use) for all four
 * categories under each profile and reports whether the lists actually differ and actually reflect
 * the seeded taste, or whether every profile just gets the same corpus-wide top-craft list back.
 *
 *   node scripts/cold-start-test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const PROFILES = {
  'comedy lover': ['m137', 'm138', 'm139', 'm140', 'm162', 't115', 't119', 't125'],
  'warm-family-drama viewer': ['m104', 'm101', 'm107', 'm110', 'm440', 'm815'],
  'literary-fiction reader': ['b37', 'b38', 'b39', 'b73', 'b77', 'b80', 'b82', 'b83'],
  'cosy-games player': ['g119', 'g122', 'g132', 'g134', 'g149', 'g158'],
};
const CATS = ['Movies', 'TV Series', 'Video Games', 'Books'];

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

async function waitForBoot(page, timeout) {
  await page.waitForFunction(() => typeof window.ALL !== 'undefined', { timeout: timeout || 60000 }).catch(() => {});
}

async function recsFor(browser, profileObj, label) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  // Seed localStorage BEFORE the app boots, so it comes up already onboarded with this profile --
  // exactly the state a returning user (not first-run) would be in.
  await page.addInitScript(([profileJson]) => {
    try {
      localStorage.setItem('omniLedgerOnboarded', '1');
      localStorage.setItem('omniLedgerProfile', profileJson);
    } catch (e) {}
  }, [JSON.stringify(profileObj)]);

  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await waitForBoot(page);
  await page.waitForFunction(() => typeof window.buildGeneratedRec === 'function', { timeout: 60000 });

  const result = await page.evaluate((cats) => {
    const out = {};
    cats.forEach(cat => {
      const rec = buildGeneratedRec(cat);
      out[cat] = rec.items.map(i => ({ n: i.n, s: i.s, why: i.why }));
    });
    return out;
  }, CATS);

  await page.close();
  if (pageErrors.length) console.error('  [page errors for ' + label + ']', pageErrors.join(' | '));
  return result;
}

async function main() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: findChromium() });
  const allResults = {};
  try {
    // Baseline: blank, no seeding at all -- what a total stranger with zero input sees.
    allResults['(blank, unseeded)'] = await recsFor(browser, {}, '(blank, unseeded)');
    for (const [label, ids] of Object.entries(PROFILES)) {
      allResults[label] = await recsFor(browser, { silverTierIds: ids }, label);
      console.log('scored: ' + label);
    }
  } finally {
    await browser.close();
  }

  const outPath = process.argv[2] || path.join(ROOT, 'evidence', 'cold-start-results.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 1));
  console.log('wrote ' + outPath);

  // Overlap report: for each category, how many of the top-10 titles are IDENTICAL across all
  // profiles? High overlap = the engine isn't personalizing for non-Payton users.
  console.log('\n=== overlap across profiles (top-10 titles per category) ===');
  const labels = Object.keys(allResults);
  CATS.forEach(cat => {
    const sets = labels.map(l => new Set(allResults[l][cat].map(i => i.n)));
    const union = new Set(sets.flatMap(s => [...s]));
    const commonToAll = [...union].filter(t => sets.every(s => s.has(t)));
    console.log('  ' + cat + ': ' + commonToAll.length + ' of ' + union.size + ' distinct titles appear in EVERY profile\'s top 10');
    if (commonToAll.length) console.log('    shared: ' + commonToAll.slice(0, 10).join(' | '));
  });
}

main().catch(e => { console.error(e); process.exit(1); });
