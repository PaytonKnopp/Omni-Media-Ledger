#!/usr/bin/env node
/*
 * Committed regression suite for the Omni-Media Ledger.
 *
 * Requires a Chromium binary. Point it at one with PLAYWRIGHT_CHROMIUM_PATH,
 * or run `npx playwright install chromium` once and it'll be found automatically.
 *
 * Usage: node test/smoke.js            (tests index.html and share.html)
 *        node test/smoke.js index.html (tests just one file)
 */
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  try { ({ chromium } = require('playwright')); }
  catch (e2) {
    console.error('Neither playwright-core nor playwright is installed.');
    console.error('Run: npm install -D playwright-core   (then npx playwright install chromium)');
    process.exit(1);
  }
}

const ROOT = path.resolve(__dirname, '..');
const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['index.html', 'share.html'];

let failures = 0;
function check(label, cond) {
  if (cond) { console.log('  ok   -', label); }
  else { console.log('  FAIL -', label); failures++; }
}

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  const candidates = [
    '/opt/pw-browsers',
    path.join(require('os').homedir(), '.cache', 'ms-playwright'),
  ];
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    for (const dir of fs.readdirSync(base)) {
      if (!dir.startsWith('chromium')) continue;
      const p = path.join(base, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined; // let Playwright try its own default resolution
}

function syntaxCheck(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script id="ledger-app">([\s\S]*?)<\/script>/);
  if (!m) return { ok: false, error: 'ledger-app script block not found' };
  try { new Function(m[1]); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function runFile(browser, file) {
  console.log('\n=== ' + file + ' ===');
  const full = 'file://' + path.join(ROOT, file);

  const syn = syntaxCheck(path.join(ROOT, file));
  check('script block parses without a syntax error', syn.ok);
  if (!syn.ok) { console.log('     ' + syn.error); return; }

  const isShare = file === 'share.html';

  // ---- Desktop pass ----
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(full);
    await page.waitForTimeout(600);

    const gateVisible = await page.evaluate(() => {
      const g = document.getElementById('onboardGate');
      return g && !g.classList.contains('hidden');
    });
    check('onboarding gate appears on a fresh profile', gateVisible);

    if (gateVisible) {
      const startBtn = isShare ? '#onboardBlank' : '#onboardSample';
      await page.click(startBtn);
      await page.waitForTimeout(500);
    }

    const gateGoneAfterStart = await page.evaluate(() => {
      const g = document.getElementById('onboardGate');
      return g && g.classList.contains('hidden');
    });
    check('onboarding gate dismisses after choosing a start path', gateGoneAfterStart);

    // Views render with content
    const views = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#nav .navBtn[data-view]')).map(b => b.dataset.view));
    check('all 10 primary views are present', views.length === 10);
    for (const v of views) {
      await page.evaluate(vv => {
        const b = document.querySelector('#nav .navBtn[data-view="' + vv + '"]');
        if (b) b.click();
      }, v);
      await page.waitForTimeout(300);
      const info = await page.evaluate(vv => {
        const sec = document.querySelector('main > section[data-sec="' + vv + '"]');
        return sec ? { visible: !sec.classList.contains('hidden'), hasContent: sec.innerText.length > 0 } : null;
      }, v);
      check('view "' + v + '" renders visible content', !!info && info.visible && info.hasContent);
    }
    await page.evaluate(() => {
      const b = document.querySelector('#nav .navBtn[data-view="controller"]');
      if (b) b.click();
    });
    await page.waitForTimeout(300);

    // Filters actually narrow results
    await page.selectOption('#limitSel', '9999');
    await page.waitForTimeout(200);
    const countOf = async () => {
      const t = await page.textContent('#resultCount');
      const m = t.match(/of\s+(\d+)/);
      return m ? parseInt(m[1]) : parseInt(t);
    };
    const baseline = await countOf();
    const kindCounts = await page.evaluate(() => ({
      movie: ALL.filter(x => x.kind === 'movie').length,
      tv: ALL.filter(x => x.kind === 'tv').length,
      game: ALL.filter(x => x.kind === 'game').length,
      book: ALL.filter(x => x.kind === 'book').length,
    }));
    const kindSum = kindCounts.movie + kindCounts.tv + kindCounts.game + kindCounts.book;
    check('baseline corpus count matches sum of per-kind counts (' + baseline + ' = ' +
      kindCounts.movie + 'm+' + kindCounts.tv + 't+' + kindCounts.game + 'g+' + kindCounts.book + 'b)',
      baseline === kindSum && baseline > 0);

    await page.click('#typeSeg [data-type="movie"]');
    await page.waitForTimeout(250);
    check('media-type filter narrows results', (await countOf()) < baseline);
    await page.click('#typeSeg [data-type="all"]');
    await page.waitForTimeout(200);

    await page.fill('#q', 'Nolan');
    await page.waitForTimeout(300);
    const nolanCount = await countOf();
    check('omni-search narrows and finds results', nolanCount > 0 && nolanCount < baseline);
    await page.fill('#q', '');
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const el = document.getElementById('minGoat');
      el.value = 80; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(250);
    check('GOAT match slider narrows results', (await countOf()) < baseline);
    await page.evaluate(() => {
      const el = document.getElementById('minGoat');
      el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    await page.click('#resetBtn');
    await page.waitForTimeout(300);
    check('reset returns to baseline count', (await countOf()) === baseline);

    // Platform combo opens and closes cleanly (regression: v1.3.1 stuck-open bug)
    await page.click('#platField');
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => !document.querySelector('#platCombo .rcPop').classList.contains('hidden'));
    check('platform combo opens on click', opened);
    await page.click('h1');
    await page.waitForTimeout(150);
    const closed = await page.evaluate(() => document.querySelector('#platCombo .rcPop').classList.contains('hidden'));
    check('platform combo closes on outside click', closed);

    // GOAT Picker: search, stage, finalize round-trip
    await page.click('#goatPickerBtn');
    await page.waitForTimeout(300);
    await page.fill('#goatPickerSearch', 'dune');
    await page.waitForTimeout(200);
    await page.click('.goatPickerItem');
    await page.waitForTimeout(200);
    const stagedCount = await page.textContent('#goatPickerCount');
    check('GOAT Picker stages a search result', parseInt(stagedCount) > 0);
    await page.click('#goatPickerCancel');
    await page.waitForTimeout(200);
    const pickerClosed = await page.evaluate(() => document.getElementById('goatPickerGate').classList.contains('hidden'));
    check('GOAT Picker closes on cancel', pickerClosed);

    check('no uncaught page errors during desktop pass', pageErrors.length === 0);
    if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
    await page.close();
  }

  // ---- Mobile viewport pass ----
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(full);
    await page.waitForTimeout(600);
    const gateVisible = await page.evaluate(() => {
      const g = document.getElementById('onboardGate');
      return g && !g.classList.contains('hidden');
    });
    if (gateVisible) {
      const startBtn = isShare ? '#onboardBlank' : '#onboardSample';
      await page.click(startBtn);
      await page.waitForTimeout(500);
    }

    const views = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#nav .navBtn[data-view]')).map(b => b.dataset.view));
    let anyOverflow = false;
    for (const v of views) {
      await page.evaluate(vv => {
        const b = document.querySelector('#nav .navBtn[data-view="' + vv + '"]');
        if (b) b.click();
      }, v);
      await page.waitForTimeout(300);
      const hOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      if (hOverflow) { anyOverflow = true; console.log('     horizontal overflow on view: ' + v); }
    }
    check('no horizontal overflow on any view at 390px width', !anyOverflow);
    await page.close();
  }
}

(async () => {
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const t of TARGETS) {
    await runFile(browser, t);
  }
  await browser.close();

  console.log('\n' + (failures === 0 ? 'All checks passed.' : failures + ' check(s) failed.'));
  process.exit(failures === 0 ? 0 : 1);
})();
