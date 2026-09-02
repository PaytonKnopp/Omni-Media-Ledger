#!/usr/bin/env node
/*
 * Committed regression suite for the Omni-Media Ledger.
 *
 * Requires a Chromium binary. Point it at one with PLAYWRIGHT_CHROMIUM_PATH,
 * or run `npx playwright install chromium` once and it'll be found automatically.
 *
 * Usage: node test/smoke.js            (tests index.html)
 *        node test/smoke.js index.html (same, named explicitly)
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
  : ['index.html'];

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

const DATA_FILES = ['data/movies.js', 'data/tv.js', 'data/games.js', 'data/books.js'];

function syntaxCheck(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/<script id="ledger-app"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { ok: false, error: 'ledger-app script block not found' };
  try { new Function(m[1]); }
  catch (e) { return { ok: false, error: 'ledger-app: ' + e.message }; }
  const acctMatch = html.match(/<script id="acct-boot">([\s\S]*?)<\/script>/);
  if (acctMatch) {
    try { new Function(acctMatch[1]); }
    catch (e) { return { ok: false, error: 'acct-boot: ' + e.message }; }
  }
  for (const df of DATA_FILES) {
    if (!html.includes('<script src="' + df + '">')) {
      return { ok: false, error: 'missing <script src="' + df + '"> -- corpus split (see NOTES.md) requires all four' };
    }
    try { new Function(fs.readFileSync(path.join(ROOT, df), 'utf8')); }
    catch (e) { return { ok: false, error: df + ': ' + e.message }; }
  }
  return { ok: true };
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
    const consoleAssertFailures = [];
    page.on('console', m => { if (m.type() === 'assert') consoleAssertFailures.push(m.text()); });
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

    // Checks ACTUAL rendered visibility (offsetHeight), not just the `hidden` class -- a real bug
    // slipped past this suite for a while because `.rcPop{display:flex}` (in this file's own
    // <style> block, after Tailwind's compiled CSS in the document) silently outranked Tailwind's
    // `.hidden{display:none}` at equal specificity: the class was always being toggled correctly,
    // but the popup never actually stopped rendering underneath. Fixed with `.rcPop.hidden{...}`.
    const platPopVisible = () => page.evaluate(() => document.querySelector('#platCombo .rcPop').offsetHeight > 0);

    // Platform combo opens and closes cleanly (regression: v1.3.1 stuck-open bug)
    await page.click('#platField');
    await page.waitForTimeout(150);
    check('platform combo opens on click', await platPopVisible());
    await page.click('h1');
    await page.waitForTimeout(150);
    check('platform combo closes on outside click', !(await platPopVisible()));

    // Combo popups close on scroll too, so they don't stay pinned over content as you scroll past
    // them (regression: combo tracked its field correctly while scrolling but never auto-closed).
    await page.click('#platField');
    await page.waitForTimeout(350); // past the 300ms just-opened guard (see index.html)
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
    check('platform combo closes on scroll', !(await platPopVisible()));

    // Selecting an option closes the popup too (regression: this exact path -- click an option,
    // popup silently stayed visually open despite the `hidden` class being applied -- is what the
    // display:flex/display:none cascade bug above actually looked like to a user).
    await page.click('#platField');
    await page.waitForTimeout(150);
    await page.click('.rcOpt:has-text("A-1 Pictures")');
    await page.waitForTimeout(150);
    check('platform combo closes after selecting an option', !(await platPopVisible()));
    await page.click('#resetBtn');
    await page.waitForTimeout(200);

    // Scrolling INSIDE the combo's own option list must scroll the list, not close the combo
    // (regression: the close-on-scroll fix above used a capture-phase window scroll listener,
    // which also fires for the list's own internal scrollbar -- closing it on the first tick and
    // making it impossible to ever scroll down to an option below the fold).
    await page.click('#platField');
    await page.waitForTimeout(150);
    const listBox = await page.locator('#platCombo .rcList').boundingBox();
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);
    const scrolledWithinList = await page.evaluate(() => document.querySelector('#platCombo .rcList').scrollTop > 0);
    check('scrolling inside the combo list scrolls it instead of closing the combo', scrolledWithinList && (await platPopVisible()));
    await page.click('h1');
    await page.waitForTimeout(150);

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
    check('no failing console.assert (dataset integrity check)', consoleAssertFailures.length === 0);
    if (consoleAssertFailures.length) consoleAssertFailures.forEach(e => console.log('     ' + e));
    const contCountText = await page.evaluate(() => {
      const b = document.querySelector('#nav .navBtn[data-view="contenders"]');
      if (b) b.click();
      return document.getElementById('contCount').textContent;
    });
    check('contenders count reflects the live contenders array, not a stale default', /^\d+ contenders$/.test(contCountText));
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

// Cloud accounts (see NOTES.md "Cloud accounts"): exercised here against a mocked Firestore, since
// this suite has no real Firebase project to talk to. Patches a temp copy of the file with a dummy
// "configured" FIREBASE_CONFIG and stubs the gstatic SDK URLs with an in-memory mock store that
// implements the same collection().doc().get()/.set() surface acct-boot actually calls -- so this
// exercises the real acct-boot code path, not a re-implementation of it.
const MOCK_FIRESTORE_SDK = `
window.__mockStore = {};
window.__setCalls = 0;
window.firebase = {
  initializeApp: function(){},
  firestore: function(){
    return { collection: function(name){
      return { doc: function(id){
        var key = name + '/' + id;
        return {
          get: function(){
            return Promise.resolve({
              exists: Object.prototype.hasOwnProperty.call(window.__mockStore, key),
              data: function(){ return window.__mockStore[key]; }
            });
          },
          set: function(data){ window.__mockStore[key] = data; window.__setCalls++; return Promise.resolve(); }
        };
      }};
    }};
  }
};`;

async function runAccountFlow(browser, file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const patched = src.replace(
    /var FIREBASE_CONFIG=\{[^}]*\};/,
    'var FIREBASE_CONFIG={apiKey:"dummy",authDomain:"d",projectId:"d",storageBucket:"d",messagingSenderId:"1",appId:"1"};'
  );
  if (patched === src) { check(file + ': FIREBASE_CONFIG placeholder found to patch for account-flow test', false); return; }
  const tmpPath = path.join(ROOT, '_test_acct_' + file);
  fs.writeFileSync(tmpPath, patched);
  try {
    const isShare = file === 'share.html';
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/firebasejs/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript(MOCK_FIRESTORE_SDK);
    await page.goto('file://' + tmpPath);
    await page.waitForTimeout(400);

    const gateVisible = await page.evaluate(() => !document.getElementById('acctGate').classList.contains('hidden'));
    check('account gate appears when cloud is configured and no handle is remembered', gateVisible);

    await page.fill('#acctHandleInput', 'SmokeTestUser');
    await page.click('#acctContinueBtn');
    await page.waitForTimeout(500);
    const gateHidden = await page.evaluate(() => document.getElementById('acctGate').classList.contains('hidden'));
    check('account gate closes after choosing a handle', gateHidden);

    const startBtn = isShare ? '#onboardBlank' : '#onboardSample';
    const onboardVisible = await page.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    check('brand-new account gets the normal onboarding flow', onboardVisible);
    if (onboardVisible) { await page.click(startBtn); await page.waitForTimeout(300); }

    await page.waitForTimeout(2200); // cloud sync debounce is 1500ms
    const synced = await page.evaluate(() => !!window.__mockStore['profiles/smoketestuser']);
    check('a profile change syncs to the cloud store under the slugified handle', synced);

    // A second "device" (fresh context) with the same handle should hydrate from the cloud doc and
    // skip onboarding, since the mock store already has an onboarded profile for this handle.
    const storedDoc = await page.evaluate(() => window.__mockStore['profiles/smoketestuser']);
    await page.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    const page2Errors = [];
    page2.on('pageerror', e => page2Errors.push(e.message));
    await page2.route('**/firebasejs/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page2.addInitScript(MOCK_FIRESTORE_SDK + 'window.__mockStore=' + JSON.stringify({ 'profiles/smoketestuser': storedDoc }) + ';');
    await page2.goto('file://' + tmpPath);
    await page2.waitForTimeout(400);
    await page2.fill('#acctHandleInput', 'smoketestuser');
    await page2.click('#acctContinueBtn');
    await page2.waitForTimeout(500);
    const onboardVisible2 = await page2.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    check('same handle on a second device hydrates from the cloud and skips onboarding again', !onboardVisible2);

    // The account menu (top-right dropdown) opens and shows the signed-in state.
    await page2.click('#acctMenuField');
    await page2.waitForTimeout(200);
    const acctMenuVisible = await page2.evaluate(() => document.getElementById('acctMenuPop').offsetHeight > 0);
    check('account menu dropdown opens on click', acctMenuVisible);
    const acctStatusText = await page2.textContent('#acctMenuStatus');
    check('account menu shows the signed-in handle', acctStatusText.includes('smoketestuser'));

    // Switch account clears the remembered handle and shows the gate again.
    await page2.click('#acctSwitchBtn');
    await page2.waitForTimeout(500);
    const handleAfterSwitch = await page2.evaluate(() => localStorage.getItem('omniLedgerHandle'));
    const gateAfterSwitch = await page2.evaluate(() => !document.getElementById('acctGate').classList.contains('hidden'));
    check('switch account clears the remembered handle and re-shows the account gate', handleAfterSwitch === null && gateAfterSwitch);

    check('no uncaught page errors during the account-flow pass', pageErrors.length === 0 && page2Errors.length === 0);
    if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
    if (page2Errors.length) page2Errors.forEach(e => console.log('     ' + e));

    await ctx2.close();
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

(async () => {
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const t of TARGETS) {
    await runFile(browser, t);
    console.log('\n=== ' + t + ' — cloud account flow (mocked Firestore) ===');
    await runAccountFlow(browser, t);
  }
  await browser.close();

  console.log('\n' + (failures === 0 ? 'All checks passed.' : failures + ' check(s) failed.'));
  process.exit(failures === 0 ? 0 : 1);
})();
