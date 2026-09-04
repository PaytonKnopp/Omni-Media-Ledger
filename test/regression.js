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

// Wait for the page to have finished booting, instead of sleeping a fixed number of milliseconds
// after a load and hoping it was enough.
//
// This matters more than it looks. Boot cost scales with the corpus -- every data/*.js file is
// parsed on every load -- so a sleep tuned to be "comfortably enough" at 2,500 works is a coin
// flip at 5,000 and a reliable failure at 10,000. That is not a hypothetical: one check in the
// account flow already failed intermittently at the current size. A suite that gets less
// trustworthy as the dataset grows is worse than no suite, because it teaches you to ignore it
// exactly when the data is changing fastest.
//
// "Booted" means one of two things, because the app deliberately has two resting states (see
// ARCHITECTURE.md "Boot sequence"): initApp() has run and exported window.ALL, or the app is
// waiting on a gate for the person to pick an account / a starting point.
async function waitForBoot(page, timeout) {
  await page.waitForFunction(() => {
    if (typeof window.ALL !== 'undefined') return true;
    return ['acctGate', 'onboardGate'].some(id => {
      const g = document.getElementById(id);
      return g && !g.classList.contains('hidden');
    });
  }, { timeout: timeout || 30000 }).catch(() => {});
}

// Read the id of the first result card, waiting for the grid to have actually rendered.
//
// A bare `document.querySelector('.cardHead')?.dataset.id` races the render: booting only gets you
// window.ALL, and the 100-card grid is painted after that. Lose the race and the optional-chaining
// hands back `undefined` instead of throwing -- so nothing fails here. The id is then interpolated
// into a selector and compared against `media_id` in the mocked table, where it matches nothing,
// and the check that finally reports FAIL is three steps downstream of the actual problem. That is
// precisely how "declaring Gold upserts a row into the media_status table" failed on CI while the
// same commit passed on the push run: a race, not a regression, reported in the wrong place.
async function firstCardId(page, timeout) {
  const handle = await page.waitForFunction(() => {
    const el = document.querySelector('.cardHead[data-id]');
    return el ? el.dataset.id : false;
  }, { timeout: timeout || 15000 }).catch(() => null);
  return handle ? handle.jsonValue() : undefined;
}

// Read a value once it satisfies `predicate`, rather than sleeping a fixed interval and reading
// whatever happens to be there.
//
// Every caller shares a shape: a tier click reloads the whole page (the scoring pipeline recomputes
// from scratch), the app boots again, and only then does the cloud write land in the mocked table.
// The fixed sleep covering that chain has already crept from 500ms to 900ms as the app got heavier,
// and it grows again with every title added -- so it is a coin flip that gets worse over time.
// Waiting on the value is faster when things are quick and reliable when they are slow.
//
// Returns null instead of throwing when the condition never arrives, so a genuine regression fails
// its own check rather than aborting the run and hiding every check after it.
async function readWhen(page, predicate, arg, timeout) {
  const handle = await page.waitForFunction(predicate, arg, { timeout: timeout || 15000 }).catch(() => null);
  if (!handle) return null;
  return handle.jsonValue().catch(() => null);
}

// Click something that tiers a work, and don't come back until the resulting reload has finished.
//
// Tiering writes the profile, flushes the cloud sync, then reloads the page (the scoring pipeline
// recomputes from scratch rather than being patched in place). Every step after the click reads
// state, so none of them may run against the outgoing document.
//
// Detecting that needs a marker, not a timer, and not a state check either:
//   - A fixed sleep is the thing being replaced. It has already crept 500ms -> 900ms as the app
//     got heavier and grows again with every title added.
//   - waitForBoot alone cannot do it: window.ALL still exists in the OLD document, so it can
//     return before the navigation has even started.
//   - Waiting on the write landing cannot do it either: the flush happens BEFORE the reload, so
//     the value arrives while the page is still on its way out. Doing that is what made two
//     reload cycles overlap and broke the pending-sync checks on CI.
// Stamping the document and waiting for the stamp to be gone is unambiguous: only a new document
// lacks it.
async function clickAndReload(page, selector, timeout) {
  await page.evaluate(() => { window.__preReloadMarker = true; });
  await page.click(selector);
  await page.waitForFunction(() => !window.__preReloadMarker, { timeout: timeout || 20000 }).catch(() => {});
  await waitForBoot(page);
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

// Every file index.html pulls in via <script src>. Each must both be referenced by the HTML and
// parse on its own -- a missing tag and a syntax error are equally fatal, and neither is obvious
// from a browser that just renders a blank page.
const DATA_FILES = [
  'data/movies.js', 'data/tv.js', 'data/games.js', 'data/books.js',
  'data/creators.js', 'data/contenders.js',
  'app/ledger-app.js'
];

function syntaxCheck(file) {
  const html = fs.readFileSync(file, 'utf8');
  const acctMatch = html.match(/<script id="account-sync">([\s\S]*?)<\/script>/);
  if (!acctMatch) return { ok: false, error: 'account-sync script block not found' };
  try { new Function(acctMatch[1]); }
  catch (e) { return { ok: false, error: 'account-sync: ' + e.message }; }
  for (const df of DATA_FILES) {
    if (!html.includes('<script src="' + df + '">')) {
      return { ok: false, error: 'missing <script src="' + df + '"> in index.html' };
    }
    try { new Function(fs.readFileSync(path.join(ROOT, df), 'utf8')); }
    catch (e) { return { ok: false, error: df + ': ' + e.message }; }
  }
  // The app must define initApp and must NOT run on load -- account-sync calls it only once the
  // signed-in profile is resolved. If it ever went back to executing at parse time, every account
  // would boot against whatever profile happened to be in localStorage first.
  const appSrc = fs.readFileSync(path.join(ROOT, 'app/ledger-app.js'), 'utf8');
  if (!/function\s+initApp\s*\(/.test(appSrc)) {
    return { ok: false, error: 'app/ledger-app.js no longer defines initApp()' };
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
    // This flow tests the local-only onboarding path deliberately (runAccountFlow below covers
    // cloud behavior with a mocked Supabase client) -- blocking the real Supabase CDN here makes
    // that deterministic across environments instead of accidentally depending on whether the
    // sandbox running this suite happens to have outbound network access to it.
    await page.route('**/supabase-js*/**', route => route.abort());
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const consoleAssertFailures = [];
    page.on('console', m => { if (m.type() === 'assert') consoleAssertFailures.push(m.text()); });
    await page.goto(full);
    await waitForBoot(page);
    await page.waitForTimeout(600);

    const gateVisible = await page.evaluate(() => {
      const g = document.getElementById('onboardGate');
      return g && !g.classList.contains('hidden');
    });
    check('onboarding gate appears on a fresh profile', gateVisible);

    if (gateVisible) {
      const startBtn = isShare ? '#onboardBlank' : '#onboardSample';
      await page.click(startBtn);
      // Choosing a start path saves a profile and reloads the page. Wait for that to finish rather
      // than sleeping: mid-reload the fresh document shows the gate again until the app has booted
      // far enough to decide onboarding is done, so a sleep landing inside that window reports
      // "the gate never dismissed" -- and the check right after reads #nav on a document that is
      // still navigating and counts zero nav buttons. Two failures, one race, neither of them a
      // real regression, and both of them get likelier as the corpus makes the reload heavier.
      await waitForBoot(page);
    }

    const gateGoneAfterStart = !!(await readWhen(page, () => {
      const g = document.getElementById('onboardGate');
      return g && g.classList.contains('hidden');
    }));
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

    // The platform combo is multi-select (picking several platforms/studios at once is the whole
    // point), so selecting an option deliberately keeps the popup open for further picks -- it
    // only closes on outside click, scroll, or Escape (all covered by the checks around this one).
    // Confirm a pick registers (the field label updates) without the popup closing underneath it.
    await page.click('#platField');
    await page.waitForTimeout(150);
    await page.click('.rcOpt:has-text("A-1 Pictures")');
    await page.waitForTimeout(150);
    check('platform combo stays open after selecting an option (multi-select)', await platPopVisible());
    const platLabelAfterPick = await page.textContent('#platField .rcLabel');
    check('selecting a platform option updates the combo label', platLabelAfterPick.includes('A-1 Pictures'));
    await page.click('h1');
    await page.waitForTimeout(150);
    check('platform combo closes on outside click after a pick', !(await platPopVisible()));
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

    // "Pick Your GOATs" was folded into the GOAT Profile tab itself (no more separate header
    // button/popup): search results appear inline and reuse the same compact tier row every card
    // already has, via #goatSearchInput/#goatSearchResults.
    await page.click('#nav .navBtn[data-view="goat"]');
    await page.waitForTimeout(200);
    await page.fill('#goatSearchInput', 'dune');
    await page.waitForTimeout(200);
    const searchHasResults = await page.evaluate(() => document.querySelectorAll('#goatSearchResults .panel').length > 0);
    check('GOAT Profile search returns results inline', searchHasResults);
    const goatTierBtn = await page.$('#goatSearchResults .profEditBtn[data-act="declare"]');
    const targetId = await goatTierBtn.evaluate(el => el.dataset.id);
    // Regression (superseded): the compact tier row's active-state label used to be derived from
    // the raw data-act value (act.charAt(0).toUpperCase()+act.slice(1)), which happens to spell
    // "Silver" and "Bronze" correctly but turned Gold's act ("declare") into "Declare" instead of
    // "Gold". Fixed once by showing the real tier name when active -- then redesigned again per
    // explicit user preference: Gold/Silver/Bronze are pure emoji now, active or not, with no name
    // text at all (only Owned still gets a persistent text label, so it reads as different from
    // the other three at a glance). Active state is shown via the background color and the title
    // attribute's "click to remove" instead. "Interstellar" is Gold by default in the sample
    // profile, so search for it directly rather than hoping "dune" includes an already-Gold item.
    await page.fill('#goatSearchInput', 'Interstellar');
    await page.waitForTimeout(200);
    const goldBtnState = await page.evaluate(() => {
      const btn = document.querySelector('#goatSearchResults .profEditBtn[data-act="declare"]');
      return btn ? { text: btn.textContent.trim(), title: btn.title, bg: getComputedStyle(btn).backgroundColor } : null;
    });
    check('an active Gold tier button shows no "Gold"/"Declare" text, just the emoji',
      !!goldBtnState && !goldBtnState.text.includes('Gold') && !goldBtnState.text.includes('Declare') && goldBtnState.text.length <= 2);
    check('an active Gold tier button is still visually distinguishable (highlighted background, removable title)',
      !!goldBtnState && goldBtnState.title.includes('click to remove') && goldBtnState.bg !== 'rgba(0, 0, 0, 0)');
    await page.fill('#goatSearchInput', 'dune');
    await page.waitForTimeout(200);
    const wasDeclaredBefore = await page.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, targetId);
    // Re-select the button fresh -- the original handle's DOM node was replaced by the
    // Interstellar/dune re-searches above.
    await clickAndReload(page, '#goatSearchResults .profEditBtn[data-act="declare"][data-id="' + targetId + '"]');
    const isDeclaredAfter = await page.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, targetId);
    check('declaring Gold from the GOAT Profile search toggles it in the profile', isDeclaredAfter === !wasDeclaredBefore);
    const resumedOnGoatView = await page.evaluate(() => {
      const s = document.querySelector('main > section[data-sec="goat"]');
      return s && !s.classList.contains('hidden');
    });
    check('tiering from a non-controller tab returns to that same tab after the reload', resumedOnGoatView);

    // Personal GOAT Profile's declared section: the 4 corpus-backed categories (Movies/Books/TV
    // Shows/Video Game) render live Gold/Silver/Bronze groups computed from actual tier data,
    // not from the old static declaredCanon list (which only ever tracked Gold) -- so a Silver
    // pick is now actually visible on this page at all, grouped separately from Gold.
    const declaredHtml = await page.evaluate(() => document.getElementById('goatDeclared').innerHTML);
    check('declared Movies section shows a labeled Gold group', declaredHtml.includes('🥇 Gold') && declaredHtml.includes('Oppenheimer'));
    check('declared Movies section shows a labeled Silver group (previously invisible on this page)', declaredHtml.includes('🥈 Silver') && declaredHtml.includes('The Shining'));

    // Drag-and-drop re-tiering: dragging a chip from its current tier's zone into a different
    // tier's zone in the same medium's panel should re-tier it exactly like using the tier
    // buttons would -- Oppenheimer starts Gold in the sample profile, drag it into the Silver
    // zone of the same (Movies) panel and confirm the profile actually moved it, not just the DOM.
    const oppId = await page.evaluate(() => {
      const chip = Array.from(document.querySelectorAll('#goatDeclared .tierDragChip'))
        .find(c => c.dataset.q === 'Oppenheimer');
      return chip ? chip.dataset.dragId : null;
    });
    check('Oppenheimer renders as a draggable Gold chip in the GOAT Profile', !!oppId);
    await page.evaluate((id) => {
      const chip = document.querySelector('#goatDeclared .tierDropZone[data-tier="gold"] .tierDragChip[data-drag-id="' + id + '"]');
      const silverZone = document.querySelector('#goatDeclared .tierDropZone[data-tier="silver"][data-kind="movie"]');
      const dt = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      silverZone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, oppId);
    await page.waitForTimeout(900); // moveToTier reloads the page, same as any other tier change
    const movedToSilver = await page.evaluate((id) => {
      try {
        const p = JSON.parse(localStorage.getItem('omniLedgerProfile'));
        return !(p.declaredGoatIds || []).includes(id) && (p.silverTierIds || []).includes(id);
      } catch (e) { return false; }
    }, oppId);
    check('dragging a Gold chip into the Silver zone re-tiers it Silver in the saved profile', movedToSilver);

    // Drag it back to Gold the same way, restoring the sample profile for anything downstream
    // that (like the check above) expects Oppenheimer to still be Gold.
    await page.evaluate((id) => {
      const chip = document.querySelector('#goatDeclared .tierDropZone[data-tier="silver"] .tierDragChip[data-drag-id="' + id + '"]');
      const goldZone = document.querySelector('#goatDeclared .tierDropZone[data-tier="gold"][data-kind="movie"]');
      const dt = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      goldZone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, oppId);
    await page.waitForTimeout(900);
    const movedBackToGold = await page.evaluate((id) => {
      try {
        const p = JSON.parse(localStorage.getItem('omniLedgerProfile'));
        return (p.declaredGoatIds || []).includes(id) && !(p.silverTierIds || []).includes(id);
      } catch (e) { return false; }
    }, oppId);
    check('dragging it back to the Gold zone restores Gold (a real move, not a one-way copy)', movedBackToGold);

    // Toggle back to whatever it was before this test touched it, so later checks (and repeat
    // runs) aren't affected by a lingering change to the default profile.
    await page.fill('#goatSearchInput', 'dune');
    await page.waitForTimeout(200);
    const undoBtn = await page.$('#goatSearchResults .profEditBtn[data-act="declare"][data-id="' + targetId + '"]');
    if (undoBtn) { await clickAndReload(page, '#goatSearchResults .profEditBtn[data-act="declare"][data-id="' + targetId + '"]'); }
    await page.click('#nav .navBtn[data-view="controller"]');
    await page.waitForTimeout(200);

    // Surprise Me: now covers what the old "Tonight" tab did (mood + time budget), so this
    // exercises the merged feature -- a movie-only time-budget filter actually narrows the pool,
    // and the spin panel returns a specific pick.
    await page.click('#surpriseBtn');
    await page.waitForTimeout(200);
    await page.selectOption('#spinTime', '60');
    await page.click('#spinGo');
    await page.waitForTimeout(200);
    const surpriseHasResult = await page.evaluate(() => {
      const p = document.getElementById('surprisePanel');
      return p && !p.classList.contains('hidden') && p.textContent.length > 0;
    });
    check('Surprise Me (with a time budget set) returns a specific pick', surpriseHasResult);
    await page.click('#surpriseBtn');
    await page.waitForTimeout(200);

    // #suggestBtn has the .navBtn-without-data-view shape that caused two real, previously-invisible
    // bugs (the old #tonightBtn and #goatPickerBtn, both since removed/folded elsewhere): its click
    // used to bubble into #nav's delegated view-switcher, calling switchView(undefined) and hiding
    // every section on the page underneath the modal. #suggestBtn has e.stopPropagation() from the
    // start (see index.html), and this run has no cloud configured, so it also checks the graceful
    // "cloud not configured" message rather than a silent no-op or a thrown error.
    await page.click('#suggestBtn');
    await page.waitForTimeout(200);
    const suggestGateVisibleNoCloud = await page.evaluate(() => document.getElementById('suggestGate').offsetHeight > 0);
    check('suggestion box opens without cloud configured', suggestGateVisibleNoCloud);
    const suggestListNoCloud = await page.textContent('#suggestList');
    check('suggestion box explains cloud accounts aren\'t configured rather than failing silently', /cloud accounts/i.test(suggestListNoCloud));
    await page.click('#suggestClose');
    await page.waitForTimeout(200);
    const controllerVisibleAfterSuggest = await page.evaluate(() => {
      const s = document.querySelector('main > section[data-sec="controller"]');
      return s && !s.classList.contains('hidden');
    });
    check('opening/closing the suggestion box does not hide the underlying view', controllerVisibleAfterSuggest);

    // Version log: each entry now leads with a short plain-English summary instead of dropping
    // users straight into developer-facing bullet notes, with a per-entry toggle to see the full
    // detail. Regression target: the toggle must actually reveal the hidden notes, not just flip
    // a class that has no visual effect (the exact bug class from the v1.9.1 combo-dropdown fix).
    await page.click('#versionBtn');
    await page.waitForTimeout(200);
    const versionGateVisible = await page.evaluate(() => document.getElementById('versionGate').offsetHeight > 0);
    check('version log opens on click', versionGateVisible);
    const firstEntryHasSummary = await page.evaluate(() => {
      const first = document.querySelector('#versionLog > div');
      return !!(first && first.querySelector('p') && first.querySelector('p').textContent.length > 0);
    });
    check('version log shows a plain-language summary for the latest entry', firstEntryHasSummary);
    const detailsBtn = await page.$('#versionLog .verDetailsBtn');
    if (detailsBtn) {
      const detailsHiddenBefore = await detailsBtn.evaluate(b => document.querySelector('.verDetails[data-i="' + b.dataset.i + '"]').offsetHeight === 0);
      await detailsBtn.click();
      await page.waitForTimeout(150);
      const detailsVisibleAfter = await detailsBtn.evaluate(b => document.querySelector('.verDetails[data-i="' + b.dataset.i + '"]').offsetHeight > 0);
      check('"Show full details" actually reveals the detailed notes', detailsHiddenBefore && detailsVisibleAfter);
    } else {
      check('"Show full details" actually reveals the detailed notes', false);
    }
    await page.click('#versionClose');
    await page.waitForTimeout(150);

    // Quick Tips: a small "?" button next to the theme selector opens a popup with the same
    // pointers the old banner had -- no nav tab, no page space taken up until asked for.
    const tipsHiddenInitially = await page.evaluate(() => document.getElementById('tipsGate').classList.contains('hidden'));
    check('Quick Tips popup is closed by default', tipsHiddenInitially);
    await page.click('#tipsBtn');
    await page.waitForTimeout(150);
    const tipsVisibleAfterClick = await page.evaluate(() => !document.getElementById('tipsGate').classList.contains('hidden'));
    check('clicking the ? button opens the Quick Tips popup', tipsVisibleAfterClick);
    await page.click('#tipsClose');
    await page.waitForTimeout(150);
    const tipsHiddenAfterClose = await page.evaluate(() => document.getElementById('tipsGate').classList.contains('hidden'));
    check('closing Quick Tips hides the popup again', tipsHiddenAfterClose);

    // Per-work "most relevant 3" front bars: regression for the old behavior where every movie
    // showed the identical Image/Dread/Mind trio, every book the identical Prose/Ideas/Depth trio,
    // etc., regardless of what was actually distinctive about that specific work. Different top
    // results should show different combinations of leading stats.
    const frontBarLabelSets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cardMicro')).slice(0, 8)
        .map(el => Array.from(el.querySelectorAll('.lbl')).map(s => s.textContent).join(',')));
    check('front bars vary per work instead of a fixed trio per medium', new Set(frontBarLabelSets).size > 1);

    // Detail panel layout: GOAT Match and Cosmic Horror used to be full-width flex rows with the
    // entire idxGrid nested INSIDE fidGrid as a single grid item (so the whole 15-index block got
    // squeezed into one column's width while Cosmic Horror sat oddly alone) -- now they're plain
    // siblings, each a normal full-width responsive grid, with GOAT Match/Cosmic Horror folded into
    // the same idxGrid as everything else instead of sitting apart from it.
    const detailLayoutOk = await page.evaluate(() => {
      const detail = document.querySelector('.detail');
      if (!detail) return false;
      const fidGrid = detail.querySelector('.fidGrid');
      const idxGrid = detail.querySelector('.idxGrid');
      if (!fidGrid || !idxGrid) return false;
      const nested = fidGrid.contains(idxGrid);
      const goatInIdxGrid = idxGrid.textContent.includes('GOAT Match');
      const cosmicInIdxGrid = idxGrid.textContent.includes('Cosmic Horror');
      return !nested && goatInIdxGrid && cosmicInIdxGrid;
    });
    check('GOAT Match and Cosmic Horror share the same grid as the other indices, not nested apart', detailLayoutOk);

    // Filter reorganization: Genre, Owned/Not-owned, and Tier are now always visible without
    // opening Advanced Filters (previously buried inside it). Pinning moves a specialized index
    // slider from Advanced to the main row instead of duplicating it, preserving its live value.
    const alwaysVisible = await page.evaluate(() => {
      const genre = document.getElementById('genreChips');
      const owned = document.getElementById('ownedToggle');
      const tier = document.querySelector('.tierChk');
      return !!(genre && genre.offsetParent !== null && owned && owned.offsetParent !== null && tier && tier.offsetParent !== null);
    });
    check('genre, owned/not-owned, and tier filters are visible without opening Advanced Filters', alwaysVisible);

    // Note: "snd" (Soundtrack) and "ref" (4K Reference) are pinned by DEFAULT on a fresh profile
    // (see DEFAULT_PINNED_IDX) -- they're 2 of the "5 quick filters" up top out of the box, alongside
    // Technical Fidelity/GOAT Match/Cosmic Horror. So this test pins/unpins a different index ("icon",
    // not default-pinned) to actually exercise the toggle rather than starting from an already-pinned state.
    const defaultPinsVisible = await page.evaluate(() => {
      const main = document.getElementById('pinnedMainSliders');
      return !!(main.querySelector('.idxSlider[data-k="snd"]') && main.querySelector('.idxSlider[data-k="ref"]'));
    });
    check('Soundtrack and 4K Reference are pinned to the main row by default on a fresh profile', defaultPinsVisible);
    await page.click('#advToggle');
    await page.waitForTimeout(150);
    const iconSlider = await page.$('#indexSliders .idxSlider[data-k="icon"]');
    await iconSlider.evaluate(el => { el.value = 60; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    await page.click('#indexSliders .pinIdxBtn[data-k="icon"]');
    await page.waitForTimeout(150);
    const pinnedState = await page.evaluate(() => {
      const mainSlider = document.querySelector('#pinnedMainSliders .idxSlider[data-k="icon"]');
      const stillInAdvanced = document.querySelector('#indexSliders .idxSlider[data-k="icon"]');
      return { moved: !!mainSlider && !stillInAdvanced, valuePreserved: mainSlider && mainSlider.value === '60' };
    });
    check('pinning a slider moves it to the main row (not duplicated)', pinnedState.moved);
    check('pinning preserves the slider\'s current value', pinnedState.valuePreserved);
    const pinnedSaved = await page.evaluate(() => (JSON.parse(localStorage.getItem('omniLedgerProfile')).pinnedIdx || []).includes('icon'));
    check('pinned index is saved to the profile', pinnedSaved);
    await page.click('#pinnedMainSliders .pinIdxBtn[data-k="icon"]');
    await page.waitForTimeout(150);
    const unpinnedState = await page.evaluate(() => ({
      backInAdvanced: !!document.querySelector('#indexSliders .idxSlider[data-k="icon"]'),
      defaultsStillPinned: !!(document.querySelector('#pinnedMainSliders .idxSlider[data-k="snd"]') && document.querySelector('#pinnedMainSliders .idxSlider[data-k="ref"]'))
    }));
    check('unpinning moves the slider back to Advanced, leaving the default pins alone', unpinnedState.backInAdvanced && unpinnedState.defaultsStillPinned);
    await page.click('#resetBtn');
    await page.waitForTimeout(150);

    // Tier system (Gold/Silver/Bronze): toggle Bronze on the first result card from its compact,
    // always-visible tier row (not the expanded detail panel), and check the badge, the tier
    // filter, and the tier sort all pick it up. Regression: the tier row's wrapping div originally
    // called stopPropagation() on click to keep the outer card from also toggling open/closed --
    // but that stopped the click from ever bubbling up to the #grid delegated handler that actually
    // runs handleProfileEditClick(), so no tier button worked at all. Fixed by removing it (the
    // delegated handler already checks .profEditBtn before .cardHead, so it was never needed).
    await page.click('#resetBtn');
    await page.waitForTimeout(300);
    const firstCardIdValue = await firstCardId(page);
    await clickAndReload(page, '.panel .profEditBtn[data-act="bronze"][data-id="' + firstCardIdValue + '"]');
    const bronzeIds = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('omniLedgerProfile')).bronzeTierIds || []; }
      catch (e) { return []; }
    });
    check('bronze tier toggle saves the id to the profile', bronzeIds.includes(firstCardIdValue));
    // The card's top badge row deliberately no longer repeats a text "BRONZE" pill -- the tiering
    // icon row (tierRowHTML) lower on the card is the single indicator of tier now, so check that
    // instead: the bronze medal segment should be in its active (highlighted) state.
    const cardShowsBronzeBadge = await page.evaluate((id) => {
      const head = document.querySelector('.cardHead[data-id="' + id + '"]');
      const panel = head && head.closest('.panel');
      const bronzeBtn = panel && panel.querySelector('.profEditBtn[data-act="bronze"]');
      return !!(bronzeBtn && /background:\s*#cd7f32/.test(bronzeBtn.getAttribute('style') || ''));
    }, firstCardIdValue);
    check('card shows an active Bronze tier icon after tiering (not a redundant text badge)', cardShowsBronzeBadge);
    const detailStillHidden = await page.evaluate(() => {
      const d = document.querySelector('.detail');
      return !d || d.classList.contains('hidden');
    });
    check('tiering from the compact row does not also expand the card', detailStillHidden);

    // Creator boost/bury stepper: replaces the old one-way "+Boost <creator>" button with a +/-
    // control, so nudging a creator DOWN is exactly as available as nudging one up ("the opposite
    // of boosting"). Each click reloads the page (mutateProfileAndReload), so re-locate the same
    // card by id after each one rather than assuming the DOM survives.
    await page.click('.cardHead');
    await page.waitForTimeout(200);
    const stepperCreator = await page.evaluate(() => {
      const btn = document.querySelector('.detail:not(.hidden) .profEditBtn[data-act="creatorbump"]');
      return btn ? btn.dataset.creator : null;
    });
    if (stepperCreator) {
      // Force a clean starting point (no existing boost for this creator) so the stepper's
      // increment/decrement/removal-at-zero behavior is deterministic, regardless of whatever
      // weight the sample profile's own presets happen to already have for this name.
      await page.evaluate((name) => {
        const p = JSON.parse(localStorage.getItem('omniLedgerProfile'));
        p.creatorBoost = (p.creatorBoost || []).filter(e => e[0] !== name);
        localStorage.setItem('omniLedgerProfile', JSON.stringify(p));
      }, stepperCreator);
      await page.reload();
      await page.waitForTimeout(600);
      await page.click('.cardHead');
      await page.waitForTimeout(200);
      await page.click('.detail:not(.hidden) .profEditBtn[data-act="creatorbump"][data-delta="4"]');
      await page.waitForTimeout(500);
      const weightAfterPlus = await page.evaluate((name) => {
        try {
          const arr = JSON.parse(localStorage.getItem('omniLedgerProfile')).creatorBoost || [];
          const e = arr.find(x => x[0] === name);
          return e ? e[1] : null;
        } catch (e) { return null; }
      }, stepperCreator);
      check('the "+" creator stepper raises the weight', weightAfterPlus === 4);
      // Re-expand the same card (it re-rendered after reload) and click "-" twice: once back to 0
      // (should remove the entry entirely, not leave a stale 0), once more into negative territory.
      await page.click('.cardHead[data-id]');
      await page.waitForTimeout(200);
      await page.click('.detail:not(.hidden) .profEditBtn[data-act="creatorbump"][data-delta="-4"]');
      await page.waitForTimeout(500);
      const weightAtZero = await page.evaluate((name) => {
        try {
          const arr = JSON.parse(localStorage.getItem('omniLedgerProfile')).creatorBoost || [];
          return arr.some(x => x[0] === name);
        } catch (e) { return true; }
      }, stepperCreator);
      check('stepping back to exactly 0 removes the boost entry instead of leaving a stale 0', !weightAtZero);
      await page.click('.cardHead[data-id]');
      await page.waitForTimeout(200);
      await page.click('.detail:not(.hidden) .profEditBtn[data-act="creatorbump"][data-delta="-4"]');
      await page.waitForTimeout(500);
      const weightAfterMinus = await page.evaluate((name) => {
        try {
          const arr = JSON.parse(localStorage.getItem('omniLedgerProfile')).creatorBoost || [];
          const e = arr.find(x => x[0] === name);
          return e ? e[1] : null;
        } catch (e) { return null; }
      }, stepperCreator);
      check('the "-" creator stepper can push the weight negative ("the opposite of boosting")', weightAfterMinus === -4);
    } else {
      check('the "+" creator stepper raises the weight', false);
      check('stepping back to exactly 0 removes the boost entry instead of leaving a stale 0', false);
      check('the "-" creator stepper can push the weight negative ("the opposite of boosting")', false);
    }

    await page.click('#advToggle');
    await page.waitForTimeout(150);
    await page.click('.tierChk[data-tier="bronze"]');
    await page.waitForTimeout(200);
    const bronzeOnlyCount = await page.textContent('#resultCount');
    check('bronze-only tier filter narrows to just the tiered item', bronzeOnlyCount.trim() === '1');
    await page.click('.tierChk[data-tier="bronze"]');
    await page.waitForTimeout(150);

    await page.selectOption('#sortSel', 'tier');
    await page.waitForTimeout(200);
    const firstAfterTierSort = await firstCardId(page);
    const firstIsHigherTier = await page.evaluate((id) => {
      // A Gold-declared item should outrank the single Bronze item under the tier sort.
      const raw = localStorage.getItem('omniLedgerProfile');
      const p = raw ? JSON.parse(raw) : {};
      return (p.declaredGoatIds || []).includes(id);
    }, firstAfterTierSort);
    check('tier sort ranks a Gold favorite above a Bronze one', firstIsHigherTier);
    await page.click('#resetBtn');
    await page.waitForTimeout(200);

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
    await page.route('**/supabase-js*/**', route => route.abort());
    await page.goto(full);
    await waitForBoot(page);
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

    // Mobile nav: #nav becomes a single horizontally-scrollable row instead of wrapping into
    // several (previously 11 buttons wrapped into 5-6 rows before any real content was visible).
    const navIsScrollRow = await page.evaluate(() => {
      const nav = document.getElementById('nav');
      const cs = getComputedStyle(nav);
      return cs.flexWrap === 'nowrap' && cs.overflowX !== 'visible' && nav.scrollWidth > nav.clientWidth;
    });
    check('#nav is a single horizontally-scrollable row on mobile, not wrapped rows', navIsScrollRow);

    // Switching to a tab that starts off-screen in that scroll row should bring it into view
    // (switchView's scrollIntoView) rather than leaving the active tab stranded off to the side.
    await page.evaluate(() => document.getElementById('nav').scrollTo(0, 0));
    await page.evaluate(() => document.querySelector('#nav .navBtn[data-view="timeline"]').click());
    await page.waitForTimeout(300);
    const activeTabVisible = await page.evaluate(() => {
      const nav = document.getElementById('nav');
      const btn = document.querySelector('#nav .navBtn[data-view="timeline"]');
      const navRect = nav.getBoundingClientRect(), btnRect = btn.getBoundingClientRect();
      return btnRect.left >= navRect.left - 1 && btnRect.right <= navRect.right + 1;
    });
    check('switching to an off-screen tab scrolls it into view', activeTabVisible);

    // Desktop stays completely unaffected by the mobile-only nav treatment above.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(200);
    const navWrapsOnDesktop = await page.evaluate(() => getComputedStyle(document.getElementById('nav')).flexWrap === 'wrap');
    check('#nav still wraps normally (no horizontal scroll) at desktop width', navWrapsOnDesktop);

    await page.close();
  }
}

// Cloud accounts (see NOTES.md "Cloud accounts (Supabase)"): exercised here against a mocked
// Supabase client, since this suite has no real Supabase project to talk to. Patches a temp copy
// of the file with a dummy "configured" SUPABASE_CONFIG and stubs the CDN script URL with an
// in-memory mock store that implements the same .from(table).select/eq/maybeSingle/order/limit/
// upsert/insert surface acct-boot and the suggestion box actually call -- so this exercises the
// real acct-boot code path, not a re-implementation of it.
const MOCK_SUPABASE_SDK = `
// Persisted in sessionStorage (not a bare JS object) so the mock store survives a real
// location.reload() within the same tab -- acct-boot reloads the page after several real
// operations (onboarding, tiering, account delete), and a reload would otherwise wipe an
// in-memory-only mock, making it impossible to assert on state that was written right before
// the reload. A brand-new browser context (a real "second device" in these tests) still starts
// with empty sessionStorage, so isolation between simulated devices is unaffected.
function __mockDefaultDb(){ return { tables: { profiles: {}, suggestions: [], media_status: [] }, upsertCalls: 0, insertCalls: 0, deleteCalls: 0 }; }
function __mockLoad(){
  try {
    var db = JSON.parse(sessionStorage.getItem('__mockDb')) || __mockDefaultDb();
    if (!db.tables.media_status) db.tables.media_status = [];
    return db;
  } catch (e) { return __mockDefaultDb(); }
}
function __mockSave(db){ try { sessionStorage.setItem('__mockDb', JSON.stringify(db)); } catch (e) {} }
Object.defineProperty(window, '__mockTables', { get: function(){ return __mockLoad().tables; } });
Object.defineProperty(window, '__upsertCalls', { get: function(){ return __mockLoad().upsertCalls; } });
Object.defineProperty(window, '__insertCalls', { get: function(){ return __mockLoad().insertCalls; } });
Object.defineProperty(window, '__deleteCalls', { get: function(){ return __mockLoad().deleteCalls; } });
function __mockBuilder(table){
  var state = { filters: [], order: null, limitN: null, single: false, op: 'select', payload: null };
  var builder = {
    select: function(){ return builder; },
    eq: function(col, val){ state.filters.push([col, val]); return builder; },
    in: function(col, vals){ state.filters.push([col, vals, 'in']); return builder; },
    order: function(col, opts){ state.order = { col: col, ascending: !opts || opts.ascending !== false }; return builder; },
    limit: function(n){ state.limitN = n; return builder; },
    maybeSingle: function(){ state.single = true; return builder; },
    upsert: function(payload){ state.op = 'upsert'; state.payload = payload; return builder; },
    insert: function(payload){ state.op = 'insert'; state.payload = payload; return builder; },
    update: function(payload){ state.op = 'update'; state.payload = payload; return builder; },
    delete: function(){ state.op = 'delete'; return builder; },
    then: function(resolve, reject){ return execute().then(resolve, reject); },
    catch: function(fn){ return execute().catch(fn); },
    finally: function(fn){ return execute().finally(fn); }
  };
  function execute(){
    return new Promise(function(res){
      var db = __mockLoad();
      if (table === 'profiles') {
        if (state.op === 'upsert') {
          db.upsertCalls++;
          // Test-only escape hatch (window.__mockFailNextProfileUpsert) to simulate a write that
          // reaches the server but fails, or times out client-side -- without it, there's no way
          // to test what happens when a self-triggered reload's own sync doesn't land, since every
          // real declare/own action always re-uploads the full current (correct) local snapshot,
          // which would silently heal any staleness a test tried to inject into the mock store
          // directly.
          if (db.failNextProfileUpsert) {
            db.failNextProfileUpsert = false;
            __mockSave(db);
            res({ data: null, error: { message: 'simulated upsert failure' } });
            return;
          }
          var row = state.payload;
          // Test-only escape hatch (db.silentlyDropProfileUpserts) reproducing the exact reported
          // failure: the server ACCEPTS the write (no error returned) but doesn't actually store
          // it -- what a rejecting/rewriting BEFORE trigger, an out-of-date schema, or a filtered
          // write looks like from the client. Unlike failNextProfileUpsert, nothing here reports
          // a problem, which is precisely why it used to destroy data silently.
          if (db.silentlyDropProfileUpserts) {
            __mockSave(db);
            res({ data: [row], error: null });
            return;
          }
          // Test-only escape hatch (db.refuseProfileWritesSilently) reproducing what Postgres
          // actually does when an RLS UPDATE policy excludes the conflicting row in an
          // INSERT ... ON CONFLICT DO UPDATE: the request succeeds, no error is raised, and ZERO
          // rows are written. Distinct from silentlyDropProfileUpserts above, which still claims a
          // row was affected -- here the empty array is the only evidence anything went wrong.
          if (db.refuseProfileWritesSilently) {
            __mockSave(db);
            res({ data: [], error: null });
            return;
          }
          var delayMs = db.slowNextProfileUpsertMs || 0;
          // Test-only escape hatch (db.slowNextProfileUpsertMs) simulating a request that's simply
          // SLOW rather than failed outright -- a real network round trip taking longer than
          // whatever timeout the app races it against, without the connection actually being dead.
          // This is what a Supabase free-tier project waking from an idle cold start, or a slow
          // mobile connection, looks like: the write still lands, just later than a too-short
          // timeout would wait for.
          if (delayMs > 0) {
            db.slowNextProfileUpsertMs = 0;
            __mockSave(db);
            setTimeout(function(){
              var db2 = __mockLoad();
              db2.tables.profiles[row.handle] = { handle: row.handle, data: row.data };
              __mockSave(db2);
              res({ data: [row], error: null });
            }, delayMs);
            return;
          }
          db.tables.profiles[row.handle] = { handle: row.handle, data: row.data };
          __mockSave(db);
          res({ data: [row], error: null });
          return;
        }
        if (state.op === 'delete') {
          db.deleteCalls++;
          var df = state.filters.find(function(f){ return f[0] === 'handle'; });
          if (df) delete db.tables.profiles[df[1]];
          __mockSave(db);
          res({ data: null, error: null });
          return;
        }
        // Test-only escape hatch (db.failNextProfileSelectOnce) simulating one bad/slow read on
        // sign-in (a cold-starting free-tier project's first request of a session, typically) that
        // a retry immediately recovers from -- distinct from failNextProfileUpsert above, which is
        // about a WRITE never landing, not a read failing on the way in.
        if (db.failNextProfileSelectOnce) {
          db.failNextProfileSelectOnce = false;
          __mockSave(db);
          res({ data: null, error: { message: 'simulated read failure' } });
          return;
        }
        var hf = state.filters.find(function(f){ return f[0] === 'handle'; });
        var found = hf ? db.tables.profiles[hf[1]] : null;
        res(state.single ? { data: found || null, error: null } : { data: found ? [found] : [], error: null });
        return;
      }
      if (table === 'suggestions') {
        if (state.op === 'insert') {
          db.insertCalls++;
          var newRow = Object.assign({}, state.payload, { id: db.tables.suggestions.length + 1, created_at: new Date().toISOString() });
          db.tables.suggestions.push(newRow);
          __mockSave(db);
          res({ data: [newRow], error: null });
          return;
        }
        if (state.op === 'update') {
          var uf = state.filters.find(function(f){ return f[0] === 'id'; });
          var srow = uf ? db.tables.suggestions.find(function(r){ return String(r.id) === String(uf[1]); }) : null;
          if (srow) Object.assign(srow, state.payload);
          __mockSave(db);
          res({ data: srow ? [srow] : [], error: null });
          return;
        }
        if (state.op === 'delete') {
          db.deleteCalls++;
          var df2 = state.filters.find(function(f){ return f[0] === 'id'; });
          if (df2) db.tables.suggestions = db.tables.suggestions.filter(function(r){ return String(r.id) !== String(df2[1]); });
          __mockSave(db);
          res({ data: null, error: null });
          return;
        }
        var rows = db.tables.suggestions.slice();
        if (state.order) rows.sort(function(a,b){
          var av = a[state.order.col], bv = b[state.order.col];
          return state.order.ascending ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
        if (state.limitN != null) rows = rows.slice(0, state.limitN);
        res({ data: rows, error: null });
        return;
      }
      if (table === 'media_status') {
        if (state.op === 'upsert') {
          db.upsertCalls++;
          var payloadRows = Array.isArray(state.payload) ? state.payload : [state.payload];
          payloadRows.forEach(function(r){
            var idx = db.tables.media_status.findIndex(function(x){ return x.handle === r.handle && x.media_id === r.media_id; });
            var saved = { handle: r.handle, media_id: r.media_id, tier: r.tier || null, owned: !!r.owned };
            if (idx >= 0) db.tables.media_status[idx] = saved; else db.tables.media_status.push(saved);
          });
          __mockSave(db);
          res({ data: payloadRows, error: null });
          return;
        }
        if (state.op === 'delete') {
          db.deleteCalls++;
          var hf2 = state.filters.find(function(f){ return f[0] === 'handle'; });
          var inf = state.filters.find(function(f){ return f[2] === 'in'; });
          db.tables.media_status = db.tables.media_status.filter(function(x){
            var matchesHandle = hf2 ? x.handle === hf2[1] : true;
            var matchesIn = inf ? inf[1].indexOf(x.media_id) !== -1 : true;
            return !(matchesHandle && matchesIn); // keep rows that do NOT match the delete criteria
          });
          __mockSave(db);
          res({ data: null, error: null });
          return;
        }
        var mf = state.filters.find(function(f){ return f[0] === 'handle'; });
        var mrows = db.tables.media_status.filter(function(x){ return !mf || x.handle === mf[1]; });
        res({ data: mrows, error: null });
        return;
      }
      res({ data: null, error: { message: 'unknown mock table: ' + table } });
    });
  }
  return builder;
}
window.supabase = { createClient: function(){ return { from: function(table){ return __mockBuilder(table); } }; } };`;

async function runAccountFlow(browser, file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const patched = src.replace(
    /var SUPABASE_CONFIG=\{[^}]*\};/,
    'var SUPABASE_CONFIG={url:"https://dummy.supabase.co",anonKey:"dummy-anon-key"};'
  );
  if (patched === src) { check(file + ': SUPABASE_CONFIG placeholder found to patch for account-flow test', false); return; }
  const tmpPath = path.join(ROOT, '_test_acct_' + file);
  fs.writeFileSync(tmpPath, patched);
  try {
    const isShare = file === 'share.html';
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript(MOCK_SUPABASE_SDK);
    await page.goto('file://' + tmpPath);
    await waitForBoot(page);
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
    if (onboardVisible) { await page.click(startBtn); await page.waitForTimeout(500); }

    // Regression: "Start from the PK Sample" used to leave PERSONAL_PROFILE's hardcoded defaults
    // sitting in memory without ever writing omniLedgerProfile to localStorage -- meaning nothing
    // was actually saved as this account's own profile unless a later edit happened to trigger a
    // save. It should now write a real, populated profile immediately (a clone of the built-in
    // defaults here, since this mock has no 'payton' row to fetch live).
    if (!isShare) {
      const seededProfile = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('omniLedgerProfile')); } catch (e) { return null; }
      });
      check('Start from the PK Sample immediately saves a real profile, not just the onboarded flag',
        !!seededProfile && Array.isArray(seededProfile.declaredGoatIds) && seededProfile.declaredGoatIds.length > 0);
    }

    await page.waitForTimeout(2200); // cloud sync debounce is 1500ms
    const synced = await page.evaluate(() => !!(window.__mockTables && window.__mockTables.profiles['smoketestuser']));
    check('a profile change syncs to the cloud store under the slugified handle', synced);

    // A second "device" (fresh context) with the same handle should hydrate from the cloud row and
    // skip onboarding, since the mock store already has an onboarded profile for this handle.
    const storedRow = await page.evaluate(() => window.__mockTables.profiles['smoketestuser']);
    await page.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    const page2Errors = [];
    page2.on('pageerror', e => page2Errors.push(e.message));
    await page2.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    // addInitScript re-runs before every navigation for the life of this page (including the
    // reload the delete-account flow triggers below) -- guard the seed so it only ever seeds an
    // empty store, rather than stomping real mutations back to the original seed on every reload.
    await page2.addInitScript(MOCK_SUPABASE_SDK + 'if(!sessionStorage.getItem("__mockDb"))sessionStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:' + JSON.stringify({ smoketestuser: storedRow }) + ',suggestions:[],media_status:[]},upsertCalls:0,insertCalls:0,deleteCalls:0}));');
    await page2.goto('file://' + tmpPath);
    await waitForBoot(page2);
    await page2.waitForTimeout(400);
    await page2.fill('#acctHandleInput', 'smoketestuser');
    await page2.click('#acctContinueBtn');
    await page2.waitForTimeout(500);
    const onboardVisible2 = await page2.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    check('same handle on a second device hydrates from the cloud and skips onboarding again', !onboardVisible2);

    // Durability: gold/silver/bronze/owned are written to media_status as real rows as well as
    // into the profiles blob, so an account whose blob is empty/mangled (a stale validation
    // trigger, a partially-applied schema) must still come back from those rows rather than
    // looking brand new. Seeds a handle with picks ONLY in media_status and an empty blob.
    const ctxR = await browser.newContext();
    const pageR = await ctxR.newPage();
    await pageR.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await pageR.addInitScript(MOCK_SUPABASE_SDK + 'if(!sessionStorage.getItem("__mockDb"))sessionStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:{recoverme:{handle:"recoverme",data:{}}},suggestions:[],media_status:[{handle:"recoverme",media_id:"m01",tier:"bronze",owned:false},{handle:"recoverme",media_id:"m02",tier:"gold",owned:true}]},upsertCalls:0,insertCalls:0,deleteCalls:0}));');
    await pageR.goto('file://' + tmpPath);
    await pageR.waitForTimeout(400);
    await pageR.fill('#acctHandleInput', 'recoverme');
    await pageR.click('#acctContinueBtn');
    await pageR.waitForTimeout(1200);
    const recovered = await pageR.evaluate(() => {
      try {
        const p = JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}');
        return (p.bronzeTierIds || []).includes('m01') && (p.declaredGoatIds || []).includes('m02');
      } catch (e) { return false; }
    });
    check('an account whose profile blob is empty is rebuilt from its saved media_status rows', recovered);

    // End-to-end version of the reported bug: sign in with a brand-new name, complete onboarding,
    // tier something, and confirm what actually lands in the database is the real profile -- NOT
    // the {"omniLedgerTheme":""} row that a stale, near-empty background sync used to leave behind
    // after racing (and beating) the real save.
    const ctxN = await browser.newContext();
    const pageN = await ctxN.newPage();
    await pageN.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await pageN.addInitScript(MOCK_SUPABASE_SDK + 'if(!sessionStorage.getItem("__mockDb"))sessionStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:{},suggestions:[],media_status:[]},upsertCalls:0,insertCalls:0,deleteCalls:0}));');
    await pageN.goto('file://' + tmpPath);
    await pageN.waitForTimeout(400);
    await pageN.fill('#acctHandleInput', 'brandnew');
    await pageN.click('#acctContinueBtn');
    await pageN.waitForTimeout(600);
    const onboardN = await pageN.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    check('a brand-new cloud handle gets the onboarding flow', onboardN);
    await pageN.click(isShare ? '#onboardBlank' : '#onboardSample');
    await pageN.waitForTimeout(900);
    const newGoldId = await firstCardId(pageN);
    await clickAndReload(pageN, '.panel .profEditBtn[data-act="bronze"][data-id="' + newGoldId + '"]');
    await pageN.waitForTimeout(300);
    // Let any debounced background sync fire too, so a racing near-empty write would be caught.
    await pageN.waitForTimeout(2200);
    const newRowIsReal = await pageN.evaluate((id) => {
      const row = window.__mockTables.profiles['brandnew'];
      if (!row || !row.data) return { ok: false, keys: [] };
      const keys = Object.keys(row.data);
      let hasPick = false;
      try { hasPick = (JSON.parse(row.data.omniLedgerProfile || '{}').bronzeTierIds || []).includes(id); }
      catch (e) { hasPick = false; }
      return { ok: hasPick && !!row.data.omniLedgerOnboarded, keys: keys };
    }, newGoldId);
    check('a brand-new account stores its real profile, not a theme-only row',
      newRowIsReal.ok && !(newRowIsReal.keys.length === 1 && newRowIsReal.keys[0] === 'omniLedgerTheme'));
    const newAcctSynced = await pageN.evaluate(() => localStorage.getItem('omniLedgerPendingSync') !== '1');
    check('a brand-new account reports itself as saved, not perpetually unsynced', newAcctSynced);
    await pageN.close();
    const recoveredSkipsOnboarding = await pageR.evaluate(() => document.getElementById('onboardGate').classList.contains('hidden'));
    check('a recovered account is not treated as brand new', recoveredSkipsOnboarding);
    await pageR.close();

    // Root-cause regression for "logging back into my account doesn't remember anything": signing
    // in used to use an unrelated, unfixed 8-second timeout for the READ that fetches an existing
    // account's data (separate from the WRITE timeout fixed earlier), with no retry -- one slow or
    // failed read (a cold-starting free-tier project's first request is a completely normal way to
    // hit this) meant an account with real, saved cloud data would silently look brand new, with no
    // visible explanation (the error message used to be set and then hidden again in the very next
    // line). Confirms a single failed read during sign-in is now retried automatically and the
    // account still hydrates its real data instead of falling into onboarding.
    const ctx3 = await browser.newContext();
    const page3 = await ctx3.newPage();
    await page3.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page3.addInitScript(MOCK_SUPABASE_SDK + 'if(!sessionStorage.getItem("__mockDb"))sessionStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:' + JSON.stringify({ smoketestuser: storedRow }) + ',suggestions:[],media_status:[]},upsertCalls:0,insertCalls:0,deleteCalls:0,failNextProfileSelectOnce:true}));');
    await page3.goto('file://' + tmpPath);
    await waitForBoot(page3);
    await page3.waitForTimeout(400);
    await page3.fill('#acctHandleInput', 'smoketestuser');
    await page3.click('#acctContinueBtn');
    await page3.waitForTimeout(1500); // one failed attempt + ~800ms retry delay + a successful second attempt
    // Checks actual hydration, not just "onboarding didn't show" -- a naive version of this check
    // (onboardGate still hidden) would pass even with the retry completely disabled, since a sign-
    // in that gets stuck on a persistent error ALSO never reaches onboardGate; that's stuck, not
    // recovered. Confirms the account gate itself closed (sign-in actually completed, not stuck
    // showing an error) AND the real declared-favorites data from the cloud row landed locally.
    const acctGateHiddenAfterRetry = await page3.evaluate(() => document.getElementById('acctGate').classList.contains('hidden'));
    const onboardVisibleRetry = await page3.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    const hydratedAfterRetry = await page3.evaluate(() => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').declaredGoatIds || []).length > 0; }
      catch (e) { return false; }
    });
    check('a sign-in read that fails once still hydrates correctly after the automatic retry',
      acctGateHiddenAfterRetry && !onboardVisibleRetry && hydratedAfterRetry);
    await page3.close();

    // The account menu (top-right dropdown) opens and shows the signed-in state.
    await page2.click('#acctMenuField');
    await page2.waitForTimeout(200);
    const acctMenuVisible = await page2.evaluate(() => document.getElementById('acctMenuPop').offsetHeight > 0);
    check('account menu dropdown opens on click', acctMenuVisible);
    const acctStatusText = await page2.textContent('#acctMenuStatus');
    check('account menu shows the signed-in handle', acctStatusText.includes('smoketestuser'));

    // Suggestion box: opening it must not corrupt the view (same #navBtn-without-data-view bug
    // class already found twice with #tonightBtn and the old #goatPickerBtn), it should load
    // against the mocked Supabase client, accept a submission, and show it back in the list.
    const viewBeforeSuggest = await page2.evaluate(() => document.querySelector('section[data-sec]:not(.hidden)').dataset.sec);
    await page2.click('#suggestBtn');
    await page2.waitForTimeout(300);
    const suggestGateVisible = await page2.evaluate(() => document.getElementById('suggestGate').offsetHeight > 0);
    check('suggestion box opens on click', suggestGateVisible);
    const viewAfterSuggestOpen = await page2.evaluate(() => document.querySelector('section[data-sec]:not(.hidden)').dataset.sec);
    check('opening the suggestion box does not corrupt the underlying view', viewAfterSuggestOpen === viewBeforeSuggest);

    await page2.fill('#suggestText', 'Smoke test suggestion: add more cowbell.');
    await page2.click('#suggestSubmit');
    await page2.waitForTimeout(300);
    const insertCalls = await page2.evaluate(() => window.__insertCalls || 0);
    check('submitting a suggestion writes to the shared Supabase table', insertCalls >= 1);
    const listText = await page2.textContent('#suggestList');
    check('the submitted suggestion appears back in the list', listText.includes('add more cowbell'));
    check('the submitted suggestion is attributed to the signed-in handle', listText.includes('smoketestuser'));

    // Edit/Delete are only offered on a suggestion whose handle matches the signed-in handle --
    // this one was just submitted as smoketestuser, so both controls should be present.
    const ownControlsVisible = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]'))
        .find(r => r.textContent.includes('add more cowbell'));
      return !!(row && row.querySelector('.suggestEditBtn') && row.querySelector('.suggestDeleteBtn'));
    });
    check('Edit and Delete are offered on your own suggestion', ownControlsVisible);

    await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]'))
        .find(r => r.textContent.includes('add more cowbell'));
      row.querySelector('.suggestEditBtn').click();
    });
    await page2.waitForTimeout(150);
    const editAreaHasOriginalText = await page2.evaluate(() => {
      const ta = document.querySelector('#suggestList .suggestEditArea');
      return ta ? ta.value.includes('add more cowbell') : false;
    });
    check('Edit opens an inline textarea pre-filled with the original text', editAreaHasOriginalText);

    await page2.evaluate(() => {
      const ta = document.querySelector('#suggestList .suggestEditArea');
      ta.value = 'Smoke test suggestion: edited, more cowbell please.';
    });
    await page2.click('#suggestList .suggestEditSave');
    await page2.waitForTimeout(300);
    const listAfterEdit = await page2.textContent('#suggestList');
    check('saving an edit updates the suggestion text in the list', listAfterEdit.includes('edited, more cowbell please') && !listAfterEdit.includes('Smoke test suggestion: add more cowbell.'));

    page2.once('dialog', d => d.accept());
    await page2.click('#suggestList .suggestDeleteBtn');
    await page2.waitForTimeout(300);
    const listAfterDelete = await page2.textContent('#suggestList');
    const stillInMockStore = await page2.evaluate(() =>
      (window.__mockTables.suggestions || []).some(s => (s.text || '').includes('cowbell')));
    check('deleting a suggestion removes it from the list and the shared table', !listAfterDelete.includes('cowbell') && !stillInMockStore);

    // Not-done/Resolved tabs and cross-user delete: seed a suggestion from someone else directly
    // into the mock table (a real submission from another handle), reload the list, and confirm
    // it lands in "Not done" by default, has Delete offered even though it isn't smoketestuser's
    // own (per the user's explicit "the ability to clear out and remove any suggestion" request --
    // a scope change from the earlier "only your own" default), and moves to "Resolved" once marked.
    await page2.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('__mockDb'));
      db.tables.suggestions.push({ id: 9001, text: 'Someone else entirely: more kazoo.', handle: 'a_different_person', status: 'open', created_at: new Date().toISOString() });
      sessionStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await page2.click('#suggestTabs [data-tab="open"]');
    await page2.evaluate(() => window.location.reload());
    // Wait for the app to actually finish booting rather than sleeping a fixed 600ms and hoping.
    // The reload re-parses the whole corpus, so the boot cost grows with the dataset: a sleep long
    // enough today is a flaky failure at twice the data, and this one already failed intermittently.
    await page2.waitForFunction(() => !!document.getElementById('suggestBtn') && typeof ALL !== 'undefined', { timeout: 30000 });
    await page2.click('#suggestBtn');
    // Same again for the list itself -- it renders after an async read of the (mocked) table.
    const otherRowInOpenTab = await page2.waitForFunction(() =>
      Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('more kazoo')),
      { timeout: 10000 }).then(() => true).catch(() => false);
    check('a suggestion from someone else appears in the Not done tab by default', otherRowInOpenTab);
    const otherHasDeleteNoEdit = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('more kazoo'));
      return !!(row && row.querySelector('.suggestDeleteBtn') && !row.querySelector('.suggestEditBtn'));
    });
    check('Delete (but not Edit) is offered on a suggestion someone else submitted', otherHasDeleteNoEdit);

    // Return a boolean instead of dereferencing a row that may not be there: a missing row is a
    // failed check above, and should stay one -- it should not throw and abort the whole run,
    // taking every later check with it.
    const resolveClicked = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('more kazoo'));
      const btn = row && row.querySelector('.suggestResolveBtn');
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('a suggestion from someone else offers a Resolve control', resolveClicked);
    await page2.waitForTimeout(300);
    const goneFromOpenAfterResolve = await page2.evaluate(() =>
      !Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('more kazoo')));
    check('marking a suggestion resolved removes it from the Not done tab', goneFromOpenAfterResolve);
    await page2.click('#suggestTabs [data-tab="resolved"]');
    await page2.waitForTimeout(200);
    const inResolvedTab = await page2.evaluate(() =>
      Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('more kazoo')));
    check('...and shows it in the Resolved tab instead', inResolvedTab);
    const resolvedInMockStore = await page2.evaluate(() => {
      const row = (window.__mockTables.suggestions || []).find(s => (s.text || '').includes('more kazoo'));
      return row && row.status === 'shipped';
    });
    check('the resolved status actually persisted to the shared table', resolvedInMockStore);
    await page2.click('#suggestTabs [data-tab="open"]');
    await page2.waitForTimeout(200);

    await page2.click('#suggestClose');
    await page2.waitForTimeout(150);
    const suggestGateHiddenAfterClose = await page2.evaluate(() => document.getElementById('suggestGate').offsetHeight === 0);
    check('suggestion box closes on close button', suggestGateHiddenAfterClose);

    // Delete my account: only visible/usable when signed into a real cloud handle, asks for
    // confirmation (a real browser confirm() dialog -- Playwright intercepts it), then deletes the
    // cloud row and clears local state. Tested before Switch Account below, since switching would
    // sign this handle out and make "delete my own account" no longer applicable.
    await page2.click('#acctMenuField');
    await page2.waitForTimeout(200);
    const deleteBtnVisible = await page2.evaluate(() => {
      const b = document.getElementById('acctDeleteBtn');
      return b && !b.classList.contains('hidden');
    });
    check('Delete my account is offered when signed into a real cloud handle', deleteBtnVisible);
    page2.once('dialog', d => d.accept());
    await page2.click('#acctDeleteBtn');
    await page2.waitForTimeout(500);
    const deleteCalls = await page2.evaluate(() => window.__deleteCalls || 0);
    check('confirming delete removes the row from the shared Supabase table', deleteCalls >= 1);
    const rowGoneFromStore = await page2.evaluate(() => !window.__mockTables.profiles['smoketestuser']);
    check('the deleted handle\'s row is actually gone from the store', rowGoneFromStore);
    const handleAfterDelete = await page2.evaluate(() => localStorage.getItem('omniLedgerHandle'));
    const gateAfterDelete = await page2.evaluate(() => !document.getElementById('acctGate').classList.contains('hidden'));
    check('deleting the account clears the remembered handle and re-shows the account gate', handleAfterDelete === null && gateAfterDelete);

    // Switch account clears the remembered handle and shows the gate again. Re-sign-in first
    // (delete above signed this device out entirely) so there's an account to switch away from.
    await page2.fill('#acctHandleInput', 'smoketestuser2');
    await page2.click('#acctContinueBtn');
    await page2.waitForTimeout(500);
    const onboardVisible3 = await page2.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    if (onboardVisible3) { await page2.click(isShare ? '#onboardBlank' : '#onboardSample'); await waitForBoot(page2); }

    // Gold/silver/bronze/owned are also mirrored into the normalized media_status table (see
    // supabase/schema.sql), not just left inside the profiles.data jsonb blob -- so this is
    // exercising both the app's own recommendation-driving state AND that it's actually queryable
    // in the DB per title. Declaring something Gold should upsert a row; un-declaring it should
    // remove that row entirely (nothing left to track once there's no tier and it's not owned).
    const goldCardId = await firstCardId(page2);
    await clickAndReload(page2, '.panel .profEditBtn[data-act="declare"][data-id="' + goldCardId + '"]');
    const mediaRowAfterDeclare = await readWhen(page2, (id) => {
      const rows = (window.__mockTables && window.__mockTables.media_status) || [];
      return rows.find(r => r.handle === 'smoketestuser2' && r.media_id === id) || false;
    }, goldCardId);
    check('declaring Gold upserts a row into the media_status table', !!mediaRowAfterDeclare && mediaRowAfterDeclare.tier === 'gold' && mediaRowAfterDeclare.owned === false);

    await clickAndReload(page2, '.panel .profEditBtn[data-act="declare"][data-id="' + goldCardId + '"]');
    const undeclareLanded = await readWhen(page2, (id) => {
      const t = window.__mockTables;
      // Only answer once the mock store is readable again -- mid-reload it is briefly not, and
      // treating "cannot see the table" as "the row is gone" would pass this check for the wrong reason.
      if (!t || !t.media_status) return false;
      return t.media_status.some(r => r.handle === 'smoketestuser2' && r.media_id === id) ? false : { gone: true };
    }, goldCardId);
    check('un-declaring removes the media_status row entirely (no tier, not owned)', !!undeclareLanded);

    // THE reported bug, reproduced end to end: "I select bronze from the main card, it shows up,
    // then I refresh the page and it's gone." The server accepts the write but doesn't store it
    // (silentlyDropProfileUpserts), which is what a rejecting/rewriting trigger or an out-of-date
    // schema looks like from the browser -- no error, nothing to notice. The app's own reload after
    // tiering is covered by the one-shot skip-hydrate flag, so the damage only showed up on the
    // SECOND, manual refresh, which is exactly what this walks through: declare, let the app
    // reload, then reload again by hand and confirm the pick is still there.
    const bronzeCardId = await firstCardId(page2);
    await page2.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('__mockDb'));
      db.silentlyDropProfileUpserts = true;
      sessionStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await clickAndReload(page2, '.panel .profEditBtn[data-act="bronze"][data-id="' + bronzeCardId + '"]');
    const bronzeRightAfterClick = await page2.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').bronzeTierIds || []).includes(id); }
      catch (e) { return false; }
    }, bronzeCardId);
    check('a Bronze pick is applied locally even when the cloud write silently does not store it', bronzeRightAfterClick);

    const pendingAfterSilentDrop = !!(await readWhen(page2,
      () => localStorage.getItem('omniLedgerPendingSync') === '1', undefined, 8000));
    check('a write the server accepts but never stores is detected, not reported as saved', pendingAfterSilentDrop);

    await page2.reload();          // the manual refresh where picks used to disappear
    await waitForBoot(page2);
    const bronzeSurvivedManualRefresh = await page2.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').bronzeTierIds || []).includes(id); }
      catch (e) { return false; }
    }, bronzeCardId);
    check('the pick survives a manual refresh instead of being reverted by the stale cloud row', bronzeSurvivedManualRefresh);

    // Recovery: once the server starts storing writes again, the still-pending change is pushed on
    // its own and the profile stops being marked unsynced -- it heals rather than needing a redo.
    await page2.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('__mockDb'));
      db.silentlyDropProfileUpserts = false;
      sessionStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await page2.reload();
    await waitForBoot(page2);
    // Polled rather than slept: boot has to notice the pending mark, re-push, and then verify the
    // write with a read-back (plus a possible retry), so a fixed wait here is guesswork that gets
    // brittle every time that path gains a round trip.
    const healed = await page2.waitForFunction((id) => {
      const row = window.__mockTables && window.__mockTables.profiles && window.__mockTables.profiles['smoketestuser2'];
      if (!row) return false;
      let stored = false;
      try { stored = (JSON.parse(row.data.omniLedgerProfile || '{}').bronzeTierIds || []).includes(id); }
      catch (e) { return false; }
      return stored && localStorage.getItem('omniLedgerPendingSync') !== '1';
    }, bronzeCardId, { timeout: 10000 }).then(() => true).catch(() => false);
    check('an unsynced change is pushed and verified on its own once the cloud works again', healed);

    // A write the DATABASE silently refuses (RLS UPDATE policy filtering out the conflicting row in
    // ON CONFLICT DO UPDATE: 2xx, no error, zero rows written) has to be caught too -- this is the
    // shape a real Supabase project reports when its policies are wrong, and the only evidence is
    // the empty result set, which the app could not see at all before it asked for the rows back.
    await page2.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('__mockDb'));
      db.refuseProfileWritesSilently = true;
      sessionStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await clickAndReload(page2, '.panel .profEditBtn[data-act="silver"][data-id="' + bronzeCardId + '"]');
    const pendingAfterRefusal = !!(await readWhen(page2,
      () => localStorage.getItem('omniLedgerPendingSync') === '1', undefined, 8000));
    const refusalReason = await page2.evaluate(() => localStorage.getItem('omniLedgerLastSyncError') || '');
    check('a write the database silently refuses (zero rows written) is caught, not counted as saved',
      pendingAfterRefusal && /wrote no row/.test(refusalReason));

    await page2.reload();
    await waitForBoot(page2);
    const silverSurvivedRefusal = await page2.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').silverTierIds || []).includes(id); }
      catch (e) { return false; }
    }, bronzeCardId);
    check('a pick survives a refresh even when the database refuses the write outright', silverSurvivedRefusal);

    await page2.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('__mockDb'));
      db.refuseProfileWritesSilently = false;
      sessionStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await page2.reload();
    await page2.waitForTimeout(1200);

    // Put the card back the way the rest of the flow expects it (it started with no tier at all).
    await page2.click('.panel .profEditBtn[data-act="silver"][data-id="' + bronzeCardId + '"]');
    await page2.waitForTimeout(900);
    await page2.click('.panel .profEditBtn[data-act="bronze"][data-id="' + bronzeCardId + '"]');
    await page2.waitForTimeout(900);

    // Root-cause regression for the real bug this was all chasing: a reload the app triggers
    // itself right after syncing (declare/own/import/reset/onboarding) used to ALWAYS re-fetch-
    // and-hydrate from the cloud on the very next boot(), even though local state was already the
    // correct, just-written copy -- so a sync that failed or was slow could get silently reverted
    // the moment the page reloaded, with no error visible to the user. Proven here by forcing the
    // NEXT profile upsert to fail (via the mock's failNextProfileUpsert escape hatch -- a real
    // declare/own action always re-uploads the full current local snapshot on its own, which would
    // otherwise silently heal any staleness a test tried to inject into the mock store directly,
    // making a naive version of this test pass even without the fix). If boot() still re-hydrates
    // unconditionally after a reload whose own sync just failed, the declare that triggered it
    // gets wiped by the older cloud row; if the fix holds, the local edit survives regardless.
    const secondGoldId = await page2.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('.cardHead'));
      return heads[1] && heads[1].dataset.id;
    });
    await page2.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('__mockDb'));
      db.failNextProfileUpsert = true;
      sessionStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await page2.click('.panel .profEditBtn[data-act="declare"][data-id="' + secondGoldId + '"]');
    await page2.waitForTimeout(600);
    const survivedFailedSync = await page2.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, secondGoldId);
    check('a self-triggered reload does not get clobbered when its own sync fails', survivedFailedSync);

    // Root-cause regression for the bug that kept recurring in real use even after the Phase 34
    // fix: withTimeout races the real network request against a timeout, but doesn't cancel the
    // loser -- so a request that's merely SLOW (a cold-starting free-tier project, a weak mobile
    // connection -- not a dead connection) used to lose that race under the old 4s cutoff, and the
    // app would proceed to switch accounts (clearing the only local copy) with the real write still
    // in flight, which the ensuing navigation would then kill outright. Proves the fix -- a much
    // longer real timeout (15s) plus refusing to switch at all when a sync genuinely fails -- by
    // making the mock's next profile write take 6s (comfortably past the old cutoff, comfortably
    // under the new one) and confirming the switch actually waits for it to land rather than
    // barreling past.
    const thirdGoldId = await page2.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('.cardHead'));
      return heads[2] && heads[2].dataset.id;
    });
    await page2.click('.panel .profEditBtn[data-act="declare"][data-id="' + thirdGoldId + '"]');
    await page2.waitForTimeout(900);
    await page2.evaluate(() => {
      const db = JSON.parse(sessionStorage.getItem('__mockDb'));
      db.slowNextProfileUpsertMs = 6000;
      sessionStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await page2.click('#acctMenuField');
    await page2.waitForTimeout(200);
    await page2.click('#acctSwitchBtn');
    await page2.waitForTimeout(900);
    const stillOnOldAccountMidFlush = await page2.evaluate(() => localStorage.getItem('omniLedgerHandle') === 'smoketestuser2');
    check('switching does not proceed while a slow-but-alive sync is still in flight', stillOnOldAccountMidFlush);
    await page2.waitForTimeout(7000); // let the deliberately-slow 6s write actually land
    const thirdDeclareLandedInCloud = await page2.evaluate((id) =>
      !!(window.__mockTables.profiles['smoketestuser2'] &&
         JSON.parse(window.__mockTables.profiles['smoketestuser2'].data.omniLedgerProfile || '{}').declaredGoatIds || []).includes && (
      (JSON.parse(window.__mockTables.profiles['smoketestuser2'].data.omniLedgerProfile || '{}').declaredGoatIds || []).includes(id)
    ), thirdGoldId);
    check('the slow write actually lands in the cloud once the timeout is realistic', thirdDeclareLandedInCloud);
    const handleAfterSlowSwitch = await page2.evaluate(() => localStorage.getItem('omniLedgerHandle'));
    const gateAfterSlowSwitch = await page2.evaluate(() => !document.getElementById('acctGate').classList.contains('hidden'));
    check('the switch itself completes once the slow sync finishes', handleAfterSlowSwitch === null && gateAfterSlowSwitch);

    // Re-sign in once more so the plain (non-slow) switch-account check below has a normal account
    // to switch away from.
    await page2.fill('#acctHandleInput', 'smoketestuser2');
    await page2.click('#acctContinueBtn');
    await page2.waitForTimeout(500);
    const onboardVisible4 = await page2.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    if (onboardVisible4) { await page2.click(isShare ? '#onboardBlank' : '#onboardSample'); await waitForBoot(page2); }

    await page2.click('#acctMenuField');
    await page2.waitForTimeout(200);
    await page2.click('#acctSwitchBtn');
    await page2.waitForTimeout(900); // switching now flushes any pending sync first, then clears and reloads
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

// Quick-rate seed picker: a fresh page/profile so onboarding is untouched. Covers the more-
// comprehensive rework (16 picks instead of 10, genre-family diversity, and "show different
// picks" reshuffling while keeping anything already loved).
async function runSeedPickerFlow(browser, file) {
  const page = await browser.newPage();
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
  await waitForBoot(page);
  await page.waitForTimeout(500);
  await page.click('#onboardSeed');
  await page.waitForTimeout(300);
  const itemCount = await page.evaluate(() => document.querySelectorAll('.onboardSeedItem').length);
  check('quick-rate offers 16 varied picks', itemCount === 16);

  const firstId = await page.evaluate(() => document.querySelector('.onboardSeedItem').dataset.id);
  await page.click('.onboardSeedItem .onboardSeedTierBtn[data-tier="gold"]');
  await page.waitForTimeout(150);
  const goldActiveAfterTap = await page.evaluate(() => {
    const btn = document.querySelector('.onboardSeedItem .onboardSeedTierBtn[data-tier="gold"]');
    return btn && /background:\s*#fbbf24/.test(btn.getAttribute('style') || '');
  });
  check('tapping Gold on a pick tiers it Gold, right there in onboarding', goldActiveAfterTap);

  await page.click('#onboardSeedMore');
  await page.waitForTimeout(300);
  const idsAfterReshuffle = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.onboardSeedItem')).map(el => el.dataset.id));
  check('"show different picks" keeps the loved item visible', idsAfterReshuffle.includes(firstId));
  check('"show different picks" adds genuinely new items, not a reshuffled duplicate of the same 16', idsAfterReshuffle.length > 16);
  const noDuplicates = new Set(idsAfterReshuffle).size === idsAfterReshuffle.length;
  check('reshuffled batch has no duplicate items', noDuplicates);

  // Back is a genuine no-op cancel back to the other starting options (unlike Skip, which commits
  // a blank profile) -- nothing should be saved, and re-entering Quick-rate should still work.
  await page.click('#onboardSeedBack');
  await page.waitForTimeout(200);
  const choiceVisibleAfterBack = await page.evaluate(() => !document.getElementById('onboardChoiceScreen').classList.contains('hidden'));
  const seedHiddenAfterBack = await page.evaluate(() => document.getElementById('onboardSeedScreen').classList.contains('hidden'));
  const nothingSavedAfterBack = await page.evaluate(() => localStorage.getItem('omniLedgerProfile') === null);
  check('Back returns to the other starting options without saving anything', choiceVisibleAfterBack && seedHiddenAfterBack && nothingSavedAfterBack);

  await page.click('#onboardSeed');
  await page.waitForTimeout(300);

  await page.click('#onboardSeedContinue');
  await page.waitForTimeout(500);
  const declaredIncludesLoved = await page.evaluate((id) => {
    try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
    catch (e) { return false; }
  }, firstId);
  check('continuing saves the loved pick into the new profile', declaredIncludesLoved);
  check('no uncaught page errors during the seed-picker pass', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  await page.close();
}

// "Search & pick your GOATs" (the full-screen onboarding modal, not the GOAT Profile tab's inline
// search): covers the added Type filter and per-row context (genre, critic score) that replaced a
// bare, single-line list.
// Starting from scratch (a blank profile) and tiering something is the path a brand-new person
// actually takes. The GOAT Profile's declared section used to render only the categories listed in
// declaredCanon -- which the sample profile fills in but a from-scratch account leaves empty -- so
// a Bronze (or Gold, or Silver) pick made from a card had literally nowhere to appear on that page.
// It looked exactly like the pick hadn't saved, even though it had.
async function runFromScratchFlow(browser, file) {
  const page = await browser.newPage();
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
  await waitForBoot(page);
  await page.waitForTimeout(500);
  await page.click('#onboardBlank');
  await waitForBoot(page);
  await page.waitForTimeout(300);

  // initTheme() re-writes omniLedgerTheme with the value it just read on every boot. That no-op
  // write must NOT be treated as an edit: on a fresh account it was the only tracked key present,
  // so it scheduled a sync whose whole snapshot was {"omniLedgerTheme":""} -- a near-empty upload
  // that raced and overwrote the real save, leaving exactly that row in the database.
  const noopThemeWriteIsIgnored = await page.evaluate(() => {
    localStorage.removeItem('omniLedgerPendingSync');
    const current = localStorage.getItem('omniLedgerTheme') || '';
    localStorage.setItem('omniLedgerTheme', current); // identical value -- not an edit
    return localStorage.getItem('omniLedgerPendingSync') !== '1';
  });
  check('re-writing a tracked key with an unchanged value does not count as an edit', noopThemeWriteIsIgnored);
  const realThemeChangeCounts = await page.evaluate(() => {
    localStorage.removeItem('omniLedgerPendingSync');
    localStorage.setItem('omniLedgerTheme', 'lotr'); // a genuine change
    return localStorage.getItem('omniLedgerPendingSync') === '1';
  });
  check('a genuine change to a tracked key still marks the profile unsynced', realThemeChangeCounts);

  await page.click('[data-view="goat"]');
  await page.waitForTimeout(400);
  const firstId = await page.evaluate(() => {
    const b = document.querySelector('#goatSearchResults .profEditBtn[data-act="bronze"]');
    return b ? b.dataset.id : null;
  });
  check('a from-scratch profile still offers tier buttons in the GOAT Profile search', !!firstId);
  await page.click('#goatSearchResults .profEditBtn[data-act="bronze"][data-id="' + firstId + '"]');
  await page.waitForTimeout(900); // tiering reloads the page

  const savedBronze = await page.evaluate((id) => {
    try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').bronzeTierIds || []).includes(id); }
    catch (e) { return false; }
  }, firstId);
  check('tiering Bronze on a from-scratch profile saves it', savedBronze);

  await page.click('[data-view="goat"]');
  await page.waitForTimeout(400);
  const declaredShowsBronze = await page.evaluate(() => {
    const el = document.getElementById('goatDeclared');
    return !!el && /bronze/i.test(el.textContent) && el.textContent.trim().length > 0;
  });
  check('a Bronze pick appears in the GOAT Profile declared section on a from-scratch account', declaredShowsBronze);

  await page.close();
  check('no uncaught page errors during the from-scratch pass', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

async function runGoatPickerFlow(browser, file) {
  const page = await browser.newPage();
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
  await waitForBoot(page);
  await page.waitForTimeout(500);
  await page.click('#onboardGoatPicker');
  await page.waitForTimeout(300);
  const allCount = await page.evaluate(() => document.querySelectorAll('.goatPickerItem').length);
  check('GOAT Picker shows results with no filter applied', allCount > 0);
  await page.click('#goatPickerType button[data-t="movie"]');
  await page.waitForTimeout(200);
  const moviesOnly = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.goatPickerItem'));
    return rows.length > 0 && rows.every(r => r.dataset.id.startsWith('m'));
  });
  check('Type filter narrows the GOAT Picker to just that medium', moviesOnly);
  const resultCountText = await page.evaluate(() => document.getElementById('goatPickerResultCount').textContent);
  check('Type filter updates the result-count label', /Showing \d+ of \d+ match/.test(resultCountText));
  const firstRowHasGenreAndScore = await page.evaluate(() => {
    const row = document.querySelector('.goatPickerItem');
    if (!row) return false;
    return /\d{2,3}/.test(row.textContent) && row.textContent.includes('·');
  });
  check('each result row shows genre and score context, not just a bare title', firstRowHasGenreAndScore);
  await page.close();
  check('no uncaught page errors during the GOAT Picker pass', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

async function runTabFiltersFlow(browser, file) {
  const full = 'file://' + path.join(ROOT, file);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(full);
  await waitForBoot(page);
  await page.waitForTimeout(600);
  const gateVisible = await page.evaluate(() => {
    const g = document.getElementById('onboardGate');
    return g && !g.classList.contains('hidden');
  });
  if (gateVisible) {
    await page.click(file === 'share.html' ? '#onboardBlank' : '#onboardSample');
    await waitForBoot(page);
  }
  const goto = async (v) => {
    await page.evaluate(vv => {
      const b = document.querySelector('#nav .navBtn[data-view="' + vv + '"]');
      if (b) b.click();
    }, v);
    await page.waitForTimeout(300);
  };

  // Contenders Ledger: search + sort narrow and reorder results.
  await goto('contenders');
  const contBefore = await page.evaluate(() => document.querySelectorAll('#contenderGrid > div').length);
  await page.fill('#contSearch', 'dune');
  await page.waitForTimeout(250);
  const contAfter = await page.evaluate(() => document.querySelectorAll('#contenderGrid > div').length);
  check('Contenders search narrows the result set', contAfter > 0 && contAfter <= contBefore);
  await page.fill('#contSearch', '');
  await page.waitForTimeout(250);

  // Creator Archives: scope, sort, % owned, and the view-in-Controller jump all work.
  await goto('creators');
  await page.click('[data-scope="authors"]');
  await page.waitForTimeout(250);
  const authorsOnlyCount = await page.evaluate(() => document.querySelectorAll('#creatorGrid > div').length);
  check('Creator Archives scoped to Authors shows a card grid', authorsOnlyCount > 0 && authorsOnlyCount <= 30);
  await page.selectOption('#creatorSortSel', 'az');
  await page.waitForTimeout(250);
  const ownedPctVisible = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#creatorGrid')).some(g => /% owned/.test(g.innerText)));
  check('creator cards show a % owned stat', ownedPctVisible);
  const jumpWorked = await page.evaluate(async () => {
    const jump = document.querySelector('#creatorGrid .goatJump');
    if (!jump) return false;
    jump.click();
    await new Promise(r => setTimeout(r, 350));
    return document.querySelector('main > section[data-sec="controller"]') &&
      !document.querySelector('main > section[data-sec="controller"]').classList.contains('hidden');
  });
  check('clicking a creator\'s "View in Controller" jumps to the Global Controller', jumpWorked);
  await goto('creators');
  await page.click('[data-scope="all"]');
  await page.waitForTimeout(200);

  // Reference Matrices: nav search filters brackets, owned-only actually restricts rows.
  await goto('matrix');
  const navBefore = await page.evaluate(() => document.querySelectorAll('#matrixNav a').length);
  await page.fill('#matrixNavSearch', 'horror');
  await page.waitForTimeout(250);
  const navAfter = await page.evaluate(() => document.querySelectorAll('#matrixNav a').length);
  check('Matrices bracket search narrows the quick-jump nav', navAfter > 0 && navAfter < navBefore);
  await page.fill('#matrixNavSearch', '');
  await page.waitForTimeout(250);
  await page.click('#matrixOwnedOnly');
  await page.waitForTimeout(250);
  const ownedOnlyLabelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#matrixWrap .chip')).some(c => /owned/.test(c.textContent)));
  check('Matrices owned-only toggle relabels bracket counts as "owned"', ownedOnlyLabelled);
  await page.click('#matrixOwnedOnly');
  await page.waitForTimeout(200);

  // Visualization Suite: bubble min-score filters, and the decade chart includes all 4 media kinds.
  await goto('viz');
  await page.waitForTimeout(400);
  // Chart.js loads from a CDN (see the chartFail fallback in index.html) -- in a network-restricted
  // sandbox that never resolves, so window.CH.decade never gets created through no fault of the app.
  // Only assert on the dataset contents when the chart runtime actually loaded; otherwise this check
  // can't say anything either way and shouldn't be reported as a failure.
  const decadeChartLoaded = await page.evaluate(() => !!(window.CH && window.CH.decade));
  if (decadeChartLoaded) {
    const decadeDatasetLabels = await page.evaluate(() => window.CH.decade.data.datasets.map(d => d.label));
    check('Timeline/decade chart plots all 4 media kinds (Movies/TV/Games/Books)',
      ['Movies', 'TV', 'Games', 'Books'].every(k => decadeDatasetLabels.includes(k)));
  } else {
    console.log('  skip -- Chart.js CDN unavailable in this environment, decade-chart dataset check skipped');
  }
  await page.fill('#bubbleMin', '80');
  await page.dispatchEvent('#bubbleMin', 'input');
  await page.waitForTimeout(250);
  const bubbleLbl = await page.textContent('#bubbleMinLbl');
  check('bubble min-score slider updates its live label', bubbleLbl.includes('80'));

  // Timeline: medium filter narrows the chart, and the in-tab decade zoom preview works without navigating away.
  await goto('timeline');
  await page.waitForTimeout(300);
  await page.click('[data-tm="movie"]');
  await page.waitForTimeout(300);
  const zoomOpened = await page.evaluate(async () => {
    const btn = document.querySelector('#tlChart .tlZoomBtn');
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const zb = document.getElementById('tlDecadeZoom');
    return !!(zb && zb.innerHTML.trim().length && document.querySelector('main > section[data-sec="timeline"]') && !document.querySelector('main > section[data-sec="timeline"]').classList.contains('hidden'));
  });
  check('Timeline decade zoom previews in place without leaving the tab', zoomOpened);

  // ---- Corpus-quality invariants, asserted through the running app ----
  // These are the app-side halves of checks scripts/validate-corpus.js enforces on the data. They
  // live here because what matters is not that a field holds a tidy value, but that the derived
  // thing the user actually sees comes out right -- and each of these was a real defect found by
  // walking the app, not a hypothetical.
  await goto('controller');
  await page.waitForTimeout(200);

  // Books: content certification. "Verse" must mean poetry. It used to be decided by searching a
  // book's genre strings for "poetry", which matched the compound family label "Literary & Poetry"
  // carried by 225 mostly-prose books -- so The Great Gatsby, Anna Karenina, Middlemarch and 197
  // others were all certified as poetry, on their cards and in the content-rating filter.
  const verse = await page.evaluate(() => {
    const books = ALL.filter(x => x.kind === 'book');
    const v = books.filter(x => x.rating === 'Verse');
    return {
      total: v.length,
      allAreVerseForm: v.every(x => x.format === 'Poetry'),
      gatsby: (books.find(x => x.title === 'The Great Gatsby') || {}).rating,
      karenina: (books.find(x => x.title === 'Anna Karenina') || {}).rating,
    };
  });
  check('books certified "Verse" are all actually poetry (' + verse.total + ' of them)', verse.total > 0 && verse.allAreVerseForm);
  check('a prose novel carrying the "Literary & Poetry" family label is not certified as Verse',
    verse.gatsby && verse.gatsby !== 'Verse' && verse.karenina && verse.karenina !== 'Verse');

  // Books: every card's format chip shows a real book form, never a placeholder or a copy of the
  // vibe. 42 books used to render a bare "—" chip and ~90 rendered their vibe string twice.
  const bookForms = await page.evaluate(() => {
    const forms = new Set(ALL.filter(x => x.kind === 'book').map(x => x.format));
    return {
      values: [...forms],
      anyEchoesItsOwnVibe: ALL.some(x => x.kind === 'book' && x.format === x.vibe),
    };
  });
  const KNOWN_BOOK_FORMS = ['Novel', 'Non-Fiction', 'Poetry', 'Short Stories', 'Graphic Novel', 'Memoir', 'Essays'];
  check('every book\'s form chip is a known book form, not a placeholder',
    bookForms.values.length > 0 && bookForms.values.every(f => KNOWN_BOOK_FORMS.includes(f)));
  check('no book\'s form chip is just a copy of its vibe chip', !bookForms.anyEchoesItsOwnVibe);

  // TV: the structure filter offers exactly two options, so every series must be reachable by one
  // of them. Three stray structuralType values ("Limited Series", "Continuation Film", "Anime
  // Series") used to leave 28 of 250 series matching neither.
  const tvStruct = await page.evaluate(() => {
    const tv = ALL.filter(x => x.kind === 'tv');
    return {
      total: tv.length,
      reachable: tv.filter(x => x.format === 'Limited/Mini-Series' || x.format === 'Multi-Season Epic').length,
    };
  });
  check('every TV series is reachable by the structure filter (' + tvStruct.reachable + '/' + tvStruct.total + ')',
    tvStruct.total > 0 && tvStruct.reachable === tvStruct.total);

  // Genre families are what the family lens, the family filter, cross-medium pairings, the rabbit
  // hole and the relationship graph all navigate by. A work no family matches is invisible to all
  // of them at once, while still looking perfectly fine on its own card.
  const famless = await page.evaluate(() => ALL.filter(x => !x.fam || !x.fam.length).map(x => x.id));
  check('every work in the corpus maps to at least one genre family', famless.length === 0);
  if (famless.length) console.log('     ' + famless.slice(0, 10).join(', '));

  // A creator spelled two ways splits their filmography: a creator boost matched with
  // String.includes lifts only one spelling, and Creator Archives lists them as two people.
  const creatorSplit = await page.evaluate(() => {
    const strip = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const buckets = {};
    ALL.forEach(x => {
      const k = strip(x.creator).replace(/[^a-z0-9]/g, '');
      (buckets[k] = buckets[k] || new Set()).add(x.creator);
    });
    return Object.values(buckets).filter(v => v.size > 1).map(v => [...v].join(' vs '));
  });
  check('no creator in the corpus is spelled two different ways', creatorSplit.length === 0);
  if (creatorSplit.length) console.log('     ' + creatorSplit.slice(0, 6).join(' | '));

  // URL bookmarking: filters set across three different tabs all round-trip through a fresh load.
  await goto('timeline');
  const bookmarkUrl = page.url();
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page2.route('**/supabase-js*/**', route => route.abort());
  const page2Errors = [];
  page2.on('pageerror', e => page2Errors.push(e.message));
  await page2.goto(bookmarkUrl);
  await waitForBoot(page2);
  await page2.waitForTimeout(700);
  const restored = await page2.evaluate(() => ({
    view: document.querySelector('#nav .navBtn.active') ? document.querySelector('#nav .navBtn.active').dataset.view : null,
    tlMedOn: !!document.querySelector('[data-tm="movie"].on'),
  }));
  check('a bookmarked Timeline URL restores the active view', restored.view === 'timeline');
  check('a bookmarked Timeline URL restores the medium filter', restored.tlMedOn);
  await page2.close();

  await page.close();
  check('no uncaught page errors during the tab-filters pass', pageErrors.length === 0 && page2Errors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  if (page2Errors.length) page2Errors.forEach(e => console.log('     ' + e));
}

(async () => {
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const t of TARGETS) {
    await runFile(browser, t);
    console.log('\n=== ' + t + ' — cloud account flow (mocked Supabase) ===');
    await runAccountFlow(browser, t);
    console.log('\n=== ' + t + ' — quick-rate seed picker ===');
    await runSeedPickerFlow(browser, t);
    console.log('\n=== ' + t + ' — GOAT Picker (search & pick your GOATs) ===');
    await runGoatPickerFlow(browser, t);
    console.log('\n=== ' + t + ' — starting from scratch ===');
    await runFromScratchFlow(browser, t);
    console.log('\n=== ' + t + ' — tab filters, search/sort, URL bookmarking ===');
    await runTabFiltersFlow(browser, t);
  }
  await browser.close();

  console.log('\n' + (failures === 0 ? 'All checks passed.' : failures + ' check(s) failed.'));
  process.exit(failures === 0 ? 0 : 1);
})();
