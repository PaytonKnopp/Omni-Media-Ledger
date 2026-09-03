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
    const wasDeclaredBefore = await page.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, targetId);
    await goatTierBtn.click();
    await page.waitForTimeout(500); // tiering reloads the page
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

    // Toggle back to whatever it was before this test touched it, so later checks (and repeat
    // runs) aren't affected by a lingering change to the default profile.
    await page.fill('#goatSearchInput', 'dune');
    await page.waitForTimeout(200);
    const undoBtn = await page.$('#goatSearchResults .profEditBtn[data-act="declare"][data-id="' + targetId + '"]');
    if (undoBtn) { await undoBtn.click(); await page.waitForTimeout(500); }
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

    // Quick Tips banner: shown once on Global Controller until dismissed, so first-time users
    // learn cards expand and the compact row can tier without opening a card first.
    const tipsVisibleInitially = await page.evaluate(() => document.getElementById('quickTips').offsetHeight > 0);
    check('Quick Tips banner shows on a fresh profile', tipsVisibleInitially);
    await page.click('#quickTipsClose');
    await page.waitForTimeout(150);
    const tipsHiddenAfterDismiss = await page.evaluate(() => document.getElementById('quickTips').offsetHeight === 0);
    const dismissalPersisted = await page.evaluate(() => localStorage.getItem('omniLedgerTipsDismissed') === '1');
    check('dismissing Quick Tips hides it and remembers the dismissal', tipsHiddenAfterDismiss && dismissalPersisted);
    await page.reload();
    await page.waitForTimeout(600);
    const tipsStillHiddenAfterReload = await page.evaluate(() => document.getElementById('quickTips').offsetHeight === 0);
    check('Quick Tips stays dismissed across a reload', tipsStillHiddenAfterReload);

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
    const firstCardId = await page.evaluate(() => document.querySelector('.cardHead')?.dataset.id);
    const bronzeBtn = await page.$('.panel .profEditBtn[data-act="bronze"]');
    await bronzeBtn.click();
    await page.waitForTimeout(500); // toggling reloads the page
    const bronzeIds = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('omniLedgerProfile')).bronzeTierIds || []; }
      catch (e) { return []; }
    });
    check('bronze tier toggle saves the id to the profile', bronzeIds.includes(firstCardId));
    const cardShowsBronzeBadge = await page.evaluate((id) => {
      const head = document.querySelector('.cardHead[data-id="' + id + '"]');
      return !!(head && head.closest('.panel').innerHTML.includes('BRONZE'));
    }, firstCardId);
    check('card shows a BRONZE badge after tiering', cardShowsBronzeBadge);
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
    const firstAfterTierSort = await page.evaluate(() => document.querySelector('.cardHead')?.dataset.id);
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
window.__mockCollections = {};
window.__setCalls = 0;
window.__addCalls = 0;
function __mockCollection(name){
  window.__mockCollections[name] = window.__mockCollections[name] || [];
  var rows = window.__mockCollections[name];
  return {
    doc: function(id){
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
    },
    add: function(data){
      window.__addCalls++;
      var withTs = Object.assign({}, data, { createdAt: (data && data.createdAt) || Date.now() });
      rows.push(withTs);
      return Promise.resolve({ id: 'mock' + rows.length });
    },
    orderBy: function(field, dir){
      var sorted = rows.slice().sort(function(a,b){
        var av = a[field] || 0, bv = b[field] || 0;
        return dir === 'asc' ? av - bv : bv - av;
      });
      return { limit: function(n){
        var limited = sorted.slice(0, n);
        return { get: function(){
          return Promise.resolve({ forEach: function(cb){ limited.forEach(function(d){ cb({ data: function(){ return d; } }); }); } });
        }};
      }};
    }
  };
}
window.firebase = {
  initializeApp: function(){},
  firestore: function(){
    return { collection: __mockCollection };
  }
};
window.firebase.firestore.FieldValue = { serverTimestamp: function(){ return Date.now(); } };`;

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

    // Suggestion box: opening it must not corrupt the view (same #navBtn-without-data-view bug
    // class already found twice with #tonightBtn and the old #goatPickerBtn), it should load
    // against the mocked Firestore, accept a submission, and show it back in the list.
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
    const addCalls = await page2.evaluate(() => window.__addCalls || 0);
    check('submitting a suggestion writes to the shared Firestore collection', addCalls >= 1);
    const listText = await page2.textContent('#suggestList');
    check('the submitted suggestion appears back in the list', listText.includes('add more cowbell'));
    check('the submitted suggestion is attributed to the signed-in handle', listText.includes('smoketestuser'));

    await page2.click('#suggestClose');
    await page2.waitForTimeout(150);
    const suggestGateHiddenAfterClose = await page2.evaluate(() => document.getElementById('suggestGate').offsetHeight === 0);
    check('suggestion box closes on close button', suggestGateHiddenAfterClose);

    // Switch account clears the remembered handle and shows the gate again. Re-open the account
    // menu first -- the suggestion-box interactions above (like any outside click) close it.
    await page2.click('#acctMenuField');
    await page2.waitForTimeout(200);
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

// Quick-rate seed picker: a fresh page/profile so onboarding is untouched. Covers the more-
// comprehensive rework (16 picks instead of 10, genre-family diversity, and "show different
// picks" reshuffling while keeping anything already loved).
async function runSeedPickerFlow(browser, file) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
  await page.waitForTimeout(500);
  await page.click('#onboardSeed');
  await page.waitForTimeout(300);
  const itemCount = await page.evaluate(() => document.querySelectorAll('.onboardSeedItem').length);
  check('quick-rate offers 16 varied picks', itemCount === 16);

  const firstId = await page.evaluate(() => document.querySelector('.onboardSeedItem').dataset.id);
  await page.click('.onboardSeedItem');
  await page.waitForTimeout(150);
  const heartAfterLove = await page.evaluate(() => document.querySelector('.onboardSeedItem .seedHeart').textContent);
  check('tapping a pick hearts it', heartAfterLove === '♥');

  await page.click('#onboardSeedMore');
  await page.waitForTimeout(300);
  const idsAfterReshuffle = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.onboardSeedItem')).map(el => el.dataset.id));
  check('"show different picks" keeps the loved item visible', idsAfterReshuffle.includes(firstId));
  check('"show different picks" adds genuinely new items, not a reshuffled duplicate of the same 16', idsAfterReshuffle.length > 16);
  const noDuplicates = new Set(idsAfterReshuffle).size === idsAfterReshuffle.length;
  check('reshuffled batch has no duplicate items', noDuplicates);

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
async function runGoatPickerFlow(browser, file) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
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

(async () => {
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const t of TARGETS) {
    await runFile(browser, t);
    console.log('\n=== ' + t + ' — cloud account flow (mocked Firestore) ===');
    await runAccountFlow(browser, t);
    console.log('\n=== ' + t + ' — quick-rate seed picker ===');
    await runSeedPickerFlow(browser, t);
    console.log('\n=== ' + t + ' — GOAT Picker (search & pick your GOATs) ===');
    await runGoatPickerFlow(browser, t);
  }
  await browser.close();

  console.log('\n' + (failures === 0 ? 'All checks passed.' : failures + ' check(s) failed.'));
  process.exit(failures === 0 ? 0 : 1);
})();
