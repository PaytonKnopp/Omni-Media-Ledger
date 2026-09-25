#!/usr/bin/env node
/*
 * Committed regression suite for the Omni-Media Ledger.
 *
 * Requires a Chromium binary. Point it at one with PLAYWRIGHT_CHROMIUM_PATH,
 * or run `npx playwright install chromium` once and it'll be found automatically.
 *
 * Usage: node test/regression.js                  (tests index.html)
 *        node test/regression.js index.html       (same, named explicitly)
 *        node test/regression.js --only=account   (just the flows whose name contains "account")
 *
 * --only is for re-checking one failing flow in seconds-to-a-minute instead of re-running the whole
 * ~7-minute suite. The flow names are the "=== ... ===" headers this prints.
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

const recQuality = require('../scripts/rec-quality.js');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const ONLY = ARGS.filter(a => a.startsWith('--only=')).map(a => a.slice('--only='.length).toLowerCase());
const FILES = ARGS.filter(a => !a.startsWith('--'));
const TARGETS = FILES.length ? FILES : ['index.html'];

let failures = 0, checksRun = 0;
function check(label, cond) {
  checksRun++;
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
//
// It then settles (see settle() below): booting is not one step, and what follows it -- the chunked
// grid render, a signed-in account's hydrate and sync -- is still running when window.ALL appears.
async function waitForBoot(page, timeout) {
  await page.waitForFunction(() => {
    if (typeof window.ALL !== 'undefined') return true;
    return ['acctGate', 'onboardGate'].some(id => {
      const g = document.getElementById(id);
      return g && !g.classList.contains('hidden');
    });
  }, { timeout: timeout || 30000 }).catch(() => {});
  await settle(page);
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
//
// Goes through readWhen, which retries across a navigation, rather than a bare waitForFunction:
// several callers ask right after an action that saves and reloads the page (onboarding's "Start
// from the PK Sample"), and a reload landing mid-wait destroyed the context, which a bare wait
// reported as "no card" -- the next step then clicked data-id="undefined" and timed out.
async function firstCardId(page, timeout) {
  const id = await readWhen(page, () => {
    const el = document.querySelector('.cardHead[data-id]');
    return el ? el.dataset.id : false;
  }, undefined, timeout || 15000);
  return id || undefined;
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
  const deadline = Date.now() + (timeout || 15000);
  // A reload landing mid-poll destroys the execution context, and waitForFunction rejects with
  // "Execution context was destroyed". That is NOT a failed condition -- it is the question being
  // asked of a document that no longer exists. Swallowing it made it indistinguishable from "the
  // condition never became true", so the check reported the app as broken when all that happened
  // was a reload arriving at an awkward moment.
  //
  // That is exactly the shape of the two account-flow checks that passed on every local run and
  // failed on CI: a slower runner widens the window for the reload to land inside the poll. The
  // app was never wrong in those runs; the harness was asking a dead page and calling the silence
  // an answer. Retry across the navigation instead, and only give up on a real timeout.
  const transient = /execution context .*destroyed|target closed|frame was detached|navigation/i;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const handle = await page.waitForFunction(predicate, arg, { timeout: Math.max(250, deadline - Date.now()) });
      return await handle.jsonValue();
    } catch (e) {
      lastError = e;
      if (!transient.test(String((e && e.message) || e))) break;
      // eslint-disable-next-line no-restricted-syntax -- a pause between retries, not a wait on the app
      await page.waitForTimeout(100); // let the new document install itself, then ask it again
    }
  }
  // A plain timeout means the condition genuinely never held -- the caller's check should fail and
  // say so. Anything else (a predicate that threw, say) is worth printing, because otherwise it
  // looks identical to a failed assertion and sends the next person hunting in the wrong place.
  if (lastError && !/timeout/i.test(String((lastError && lastError.message) || ''))) {
    console.log('       readWhen gave up: ' + String((lastError && lastError.message) || lastError).split('\n')[0]);
  }
  return null;
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
// Sign in at the account gate and wait for it to actually finish, rather than sleeping.
//
// Signing in does NOT navigate: resolveHandle() fetches the profile, then hides the account gate
// and re-boots the app in place against the new profile. That breaks the usual waiting tools --
// there is no profile edit for clickAndSettle's revision counter to detect, and window.ALL is
// from the previous handle, so waitForBoot() returns immediately and proves nothing.
//
// The account gate closing is the one event that means resolveHandle() actually resolved, so that
// is what to wait on. Then the onboarding gate is read once the app has settled: a brand-new handle
// shows it, a returning one does not, and the caller needs to know which.
//
// This replaces `await page.waitForTimeout(500)`, which is the pattern ARCHITECTURE.md explicitly
// forbids after a boot -- boot cost scales with the corpus, so 500ms is comfortable at 2,500 works,
// a coin flip on a loaded CI runner, and a reliable failure as the library grows. When it lost that
// race the onboarding gate had not appeared yet, the caller skipped clicking "start", the profile
// was never initialised, and the failure surfaced three steps later as "declaring Gold upserts a
// row into the media_status table" -- a check with nothing wrong with it, in a part of the app the
// change under test had not touched.
async function signInAndSettle(page, handle, startBtn) {
  await page.fill('#acctHandleInput', handle);
  await page.click('#acctContinueBtn');
  const signedIn = !!(await readWhen(page, () => {
    const g = document.getElementById('acctGate');
    return !!g && g.classList.contains('hidden');
  }, undefined, 20000));
  // A fresh handle raises the onboarding gate; a returning one boots straight in. Read it once the
  // sign-in has finished everything it started, rather than giving the gate a fixed window to
  // appear in: on a slow enough runner that window closed first, and a brand-new account was taken
  // for a returning one and never onboarded.
  await settle(page);
  const onboarding = await page.evaluate(() => {
    const g = document.getElementById('onboardGate');
    return !!g && !g.classList.contains('hidden');
  });
  if (onboarding && startBtn) {
    await page.click(startBtn);
    await waitForBoot(page);
  }
  return { signedIn: signedIn, onboarding: onboarding };
}

// Click something that changes the profile, and report whether the change actually landed.
//
// Tiering used to reload the whole page, and this helper used to watch for that navigation. It no
// longer does: a tier click recomputes the scores and re-renders in place (see mutateProfile), so
// there is no navigation to wait on and the old marker would survive every successful click.
//
// window.__omniProfileRevision is bumped once per applied profile edit, after the recompute AND
// the re-render, so waiting for it to advance means exactly what the reload wait used to mean:
// the click registered and the app has caught up with it. A false return still distinguishes "the
// button was in the DOM but its handler was not bound yet" from a later, unrelated failure.
//
// Deliberately NOT retried, for the same reason as before: every caller clicks a TIER TOGGLE, so
// a second click undoes the first.
// Expand the first card if it is not already open. Cards survive an edit expanded now, so a bare
// click on the head is a TOGGLE that can close the very panel the next step is about to use.
async function ensureFirstCardExpanded(page) {
  const alreadyOpen = await page.evaluate(() => {
    const card = document.querySelector('#grid .panel');
    const detail = card && card.querySelector('.detail');
    return !!(detail && !detail.classList.contains('hidden'));
  });
  if (!alreadyOpen) {
    await page.click('#grid .panel .cardHead');
    await settle(page);
  }
}
async function clickAndSettle(page, selector, timeout) {
  const before = await page.evaluate(() => window.__omniProfileRevision || 0);
  await page.click(selector);
  return await page.waitForFunction(
    (n) => (window.__omniProfileRevision || 0) > n, before, { timeout: timeout || 30000 })
    .then(() => true).catch(() => false);
}

// ---- Settling: wait for the app to finish its work, not for the clock ----
//
// This suite used to be ~150 instances of "do something, sleep N ms, read the page once". Each
// sleep was tuned on a fast machine, so on a slower or busier CI runner some of them lose the race
// on any given run -- a DIFFERENT handful each time. That is why fixing one flaky check only ever
// uncovered the next one: they were all the same bug, fixed one line at a time.
//
// settle(page) replaces those sleeps. Every page gets SETTLE_INSTRUMENT injected before its own
// scripts run; it tracks the app's pending short-lived async work -- setTimeout / setInterval at or
// under SETTLE_SHORT_MS, requestAnimationFrame callbacks, and in-flight fetches -- and settle()
// returns once none is left and nothing new has been scheduled for a short quiet period. That
// covers everything the app does in reaction to input: search debounces (120ms), the chunked grid
// render (rAF), the edit-sync debounce (800ms) and its read-back retries, the Surprise Me spin
// (setInterval 70ms), and so on. It is as fast as the page on a fast machine and exactly as slow
// as the page on a slow one.
//
// Long timers are NOT waited on by default: toasts (6s), the idle-sync debounce (1.5s), the sync
// retry backoff (5s+), and the request timeouts raced against every cloud call (15s, never cleared)
// would otherwise make every settle take seconds. settle(page, { through: 1500 }) opts in to the
// idle-sync debounce where a check needs it; a check that is ABOUT the retry backoff or a slow
// write waits on its own condition with readWhen instead.
//
// Settle is not an assertion. If the page is still busy at the cap it logs a note and returns, and
// the check that follows decides pass or fail on what is actually there.
const SETTLE_SHORT_MS = 1000;
const SETTLE_INSTRUMENT = `(() => {
  if (window.__omniSettle) return;
  // Every pending timer, keyed by id, with the delay it was scheduled for; settle() decides which
  // delays count as "still working".
  var timers = new Map(), frames = new Set(), fetches = 0, last = performance.now();
  var touch = function () { last = performance.now(); };
  var oST = window.setTimeout, oCT = window.clearTimeout, oSI = window.setInterval, oCI = window.clearInterval;
  var oRAF = window.requestAnimationFrame, oCAF = window.cancelAnimationFrame, oFetch = window.fetch;
  window.setTimeout = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof fn !== 'function') return oST.apply(window, args);
    var id;
    args[0] = function () { timers.delete(id); touch(); return fn.apply(this, arguments); };
    id = oST.apply(window, args);
    timers.set(id, Number(ms) || 0); touch();
    return id;
  };
  window.clearTimeout = function (id) { if (timers.delete(id)) touch(); return oCT.call(window, id); };
  window.setInterval = function (fn, ms) {
    var id = oSI.apply(window, arguments);
    if (typeof fn === 'function') { timers.set(id, Number(ms) || 0); touch(); }
    return id;
  };
  window.clearInterval = function (id) { if (timers.delete(id)) touch(); return oCI.call(window, id); };
  if (oRAF) {
    window.requestAnimationFrame = function (fn) {
      var id = oRAF.call(window, function (t) { frames.delete(id); touch(); return fn(t); });
      frames.add(id); touch();
      return id;
    };
    window.cancelAnimationFrame = function (id) { if (frames.delete(id)) touch(); return oCAF.call(window, id); };
  }
  if (oFetch) {
    window.fetch = function () {
      fetches++; touch();
      var done = function () { fetches--; touch(); };
      return oFetch.apply(window, arguments).then(function (r) { done(); return r; }, function (e) { done(); throw e; });
    };
  }
  // A document that has started to unload is on its way out, not settled: the app ends several
  // flows (onboarding, switching account) with location.reload(), and the next check must read the
  // document that replaces this one.
  var leaving = false;
  window.addEventListener('beforeunload', function () { leaving = true; });
  window.addEventListener('pagehide', function () { leaving = true; });
  var pendingTimers = function (through) {
    var n = 0;
    timers.forEach(function (ms) { if (ms <= through) n++; });
    return n;
  };
  var idle = function (quietMs, through) {
    return !leaving && pendingTimers(through) === 0 && frames.size === 0 && fetches === 0 &&
      performance.now() - last >= quietMs;
  };
  window.__omniSettle = {
    idle: idle,
    // settle() for code already running inside the page (a check written as one page.evaluate).
    // Polls on the ORIGINAL timers, so the waiting does not count as work being waited on.
    whenIdle: function (through) {
      var thr = through || ${SETTLE_SHORT_MS}, t0 = performance.now();
      return new Promise(function (res) {
        oRAF.call(window, function () { oRAF.call(window, function poll() {
          if (idle(50, thr) || performance.now() - t0 > 15000) res(); else oST.call(window, poll, 20);
        }); });
      });
    },
    busy: function (through) {
      return { leaving: leaving, timers: pendingTimers(through), frames: frames.size, fetches: fetches };
    }
  };
})();`;

// Polled from Node rather than with page.waitForFunction, whose own polling timers would run in the
// page and count as the very work being waited on.
//
// opts.through raises which timers count as work still to finish (default SETTLE_SHORT_MS). A check
// that needs the 1.5s idle-sync debounce to have fired -- and the upload it starts to have finished
// -- passes { through: 1500 } rather than sleeping "comfortably longer than 1500ms".
//
// OMNI_SETTLE_DEBUG=1 logs every settle that took over two seconds, with the line that called it --
// the quickest way to find a check that is waiting on far more work than it needs to.
async function settle(page, opts) {
  if (!process.env.OMNI_SETTLE_DEBUG) return settleOnce(page, opts);
  const t0 = Date.now(), caller = (new Error().stack.split('\n')[2] || '').trim();
  try { return await settleOnce(page, opts); }
  finally { if (Date.now() - t0 > 2000) console.log('       [settle ' + (Date.now() - t0) + 'ms ' + caller + ']'); }
}
async function settleOnce(page, opts) {
  const cap = (opts && opts.timeout) || 15000;
  const through = (opts && opts.through) || SETTLE_SHORT_MS;
  const deadline = Date.now() + cap;
  let framed = false;
  while (Date.now() < deadline) {
    try {
      // Two frames first, so input the browser delivers asynchronously (a wheel scroll's scroll
      // event, a layout-driven observer) has been dispatched before "nothing pending" means anything.
      if (!framed) {
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        framed = true;
      }
      const idle = await page.evaluate((thr) => {
        // Mid-boot is not idle: the corpus scripts parse between tasks, and a check in one of those
        // gaps would see an empty queue on a page that has barely started.
        if (document.readyState !== 'complete') return false;
        const booted = typeof window.ALL !== 'undefined' || ['acctGate', 'onboardGate'].some(id => {
          const g = document.getElementById(id);
          return g && !g.classList.contains('hidden');
        });
        if (!booted) return false;
        return !window.__omniSettle || window.__omniSettle.idle(50, thr);
      }, through);
      if (idle) return true;
    } catch (e) {
      if (/has been closed/i.test(String((e && e.message) || e))) return false;
      // A navigation landed mid-wait (the old document is gone); ask the new one from the top.
      framed = false;
    }
    await new Promise(r => setTimeout(r, 25));
  }
  const busy = await page.evaluate((thr) => window.__omniSettle && window.__omniSettle.busy(thr), through).catch(() => null);
  console.log('       (settle: page still busy after ' + cap + 'ms: ' + JSON.stringify(busy) + ')');
  return false;
}

// Every page this suite opens goes through here, so none can miss the settle instrumentation.
//
// OMNI_THROTTLE=<n> additionally slows every page's CPU n-fold via CDP -- what a loaded CI runner
// does to the app. Plain host load does NOT reproduce CI failures here (the page being slow is what
// matters, not the machine being busy), so this is the way to find a timing-dependent check
// locally before CI does: `OMNI_THROTTLE=4 node test/regression.js` should pass just like a normal
// run, only slower. If it doesn't, the failing check is waiting on the clock somewhere.
function instrumentBrowser(browser) {
  const rate = Number(process.env.OMNI_THROTTLE) || 0;
  const throttle = async (page) => {
    if (rate <= 1) return;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: rate });
  };
  const wrapContext = async (ctx) => {
    if (ctx.__omniInstrumented) return ctx;
    ctx.__omniInstrumented = true;
    await ctx.addInitScript(SETTLE_INSTRUMENT);
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async (...a) => { const p = await newPage(...a); await throttle(p); return p; };
    return ctx;
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => wrapContext(await newContext(...a));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => {
    const p = await newPage(...a);
    await p.addInitScript(SETTLE_INSTRUMENT);
    await throttle(p);
    return p;
  };
  if (rate > 1) console.log('(OMNI_THROTTLE: every page runs with its CPU slowed ' + rate + 'x)');
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
    await settle(page);

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
      await settle(page);
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
    await settle(page);

    // Filters actually narrow results
    // No settle here: #resultCount is written synchronously by the change handler, and waiting for
    // "Show: All" to finish drawing ~5,000 cards would cost seconds (16s on a slowed page) for a
    // check that only reads the count. Selecting 100 below supersedes that render.
    await page.selectOption('#limitSel', '9999');
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
    // Back to the default page size. "Show: All" draws all ~5,000 cards, and every filter change
    // below would redraw them -- seconds of work per click that no check here looks at (#resultCount
    // reads "100 of N" either way). The old fixed sleeps never noticed, because they read the count
    // while that render was still running; settle() waits for the page to finish, so it would.
    await page.selectOption('#limitSel', '100');
    await settle(page);

    await page.click('#typeSeg [data-type="movie"]');
    await settle(page);
    check('media-type filter narrows results', (await countOf()) < baseline);
    await page.click('#typeSeg [data-type="book"]');
    await settle(page);
    check('media type is multi-select: Movies + Books shows both kinds',
      (await countOf()) === kindCounts.movie + kindCounts.book);
    await page.click('#typeSeg [data-type="movie"]');
    await settle(page);
    check('clicking a picked media type again removes it', (await countOf()) === kindCounts.book);
    await page.click('#typeSeg [data-type="all"]');
    await settle(page);

    // Waits for the count rather than sleeping: the search has to tear down every card already drawn
    // (all ~5,000 of them when this ran under "Show: All"), so a fixed 300ms passed only while
    // rendering happened to be quick enough.
    await page.fill('#q', 'Nolan');
    await readWhen(page, (b) => { const t = document.getElementById('resultCount').textContent; const m = t.match(/of\s+(\d+)/); return (m ? +m[1] : +t) < b; }, baseline, 5000);
    const nolanCount = await countOf();
    check('omni-search narrows and finds results', nolanCount > 0 && nolanCount < baseline);
    await page.fill('#q', '');
    await settle(page);

    await page.evaluate(() => {
      const el = document.getElementById('minGoat');
      el.value = 80; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page);
    check('GOAT match slider narrows results', (await countOf()) < baseline);
    await page.evaluate(() => {
      const el = document.getElementById('minGoat');
      el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page);

    await page.click('#resetBtn');
    await settle(page);
    check('reset returns to baseline count', (await countOf()) === baseline);

    // Checks ACTUAL rendered visibility (offsetHeight), not just the `hidden` class -- a real bug
    // slipped past this suite for a while because `.rcPop{display:flex}` (in this file's own
    // <style> block, after Tailwind's compiled CSS in the document) silently outranked Tailwind's
    // `.hidden{display:none}` at equal specificity: the class was always being toggled correctly,
    // but the popup never actually stopped rendering underneath. Fixed with `.rcPop.hidden{...}`.
    const platPopVisible = () => page.evaluate(() => document.querySelector('#platCombo .rcPop').offsetHeight > 0);

    // Platform combo opens and closes cleanly (regression: v1.3.1 stuck-open bug)
    await page.click('#platField');
    await settle(page);
    check('platform combo opens on click', await platPopVisible());
    await page.click('h1');
    await settle(page);
    check('platform combo closes on outside click', !(await platPopVisible()));

    // Combo popups close on scroll too, so they don't stay pinned over content as you scroll past
    // them (regression: combo tracked its field correctly while scrolling but never auto-closed).
    await page.click('#platField');
    // eslint-disable-next-line no-restricted-syntax -- the guard is measured in wall-clock time
    await page.waitForTimeout(350); // past the 300ms just-opened guard (see index.html)
    await page.mouse.wheel(0, 400);
    await settle(page);
    check('platform combo closes on scroll', !(await platPopVisible()));

    // The platform combo is multi-select (picking several platforms/studios at once is the whole
    // point), so selecting an option deliberately keeps the popup open for further picks -- it
    // only closes on outside click, scroll, or Escape (all covered by the checks around this one).
    // Confirm a pick registers (the field label updates) without the popup closing underneath it.
    await page.click('#platField');
    await settle(page);
    await page.click('.rcOpt:has-text("A-1 Pictures")');
    await settle(page);
    check('platform combo stays open after selecting an option (multi-select)', await platPopVisible());
    const platLabelAfterPick = await page.textContent('#platField .rcLabel');
    check('selecting a platform option updates the combo label', platLabelAfterPick.includes('A-1 Pictures'));
    await page.click('h1');
    await settle(page);
    check('platform combo closes on outside click after a pick', !(await platPopVisible()));
    await page.click('#resetBtn');
    await settle(page);

    // Scrolling INSIDE the combo's own option list must scroll the list, not close the combo
    // (regression: the close-on-scroll fix above used a capture-phase window scroll listener,
    // which also fires for the list's own internal scrollbar -- closing it on the first tick and
    // making it impossible to ever scroll down to an option below the fold).
    await page.click('#platField');
    await settle(page);
    const listBox = await page.locator('#platCombo .rcList').boundingBox();
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 200);
    await settle(page);
    const scrolledWithinList = await page.evaluate(() => document.querySelector('#platCombo .rcList').scrollTop > 0);
    check('scrolling inside the combo list scrolls it instead of closing the combo', scrolledWithinList && (await platPopVisible()));
    await page.click('h1');
    await settle(page);

    // "Pick Your GOATs" was folded into the GOAT Profile tab itself (no more separate header
    // button/popup): search results appear inline and reuse the same compact tier row every card
    // already has, via #goatSearchInput/#goatSearchResults.
    await page.click('#nav .navBtn[data-view="goat"]');
    await settle(page);
    await page.fill('#goatSearchInput', 'dune');
    await settle(page);
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
    await settle(page);
    const goldBtnState = await page.evaluate(() => {
      const btn = document.querySelector('#goatSearchResults .profEditBtn[data-act="declare"]');
      return btn ? { text: btn.textContent.trim(), title: btn.title, bg: getComputedStyle(btn).backgroundColor } : null;
    });
    check('an active Gold tier button shows no "Gold"/"Declare" text, just the emoji',
      !!goldBtnState && !goldBtnState.text.includes('Gold') && !goldBtnState.text.includes('Declare') && goldBtnState.text.length <= 2);
    check('an active Gold tier button is still visually distinguishable (highlighted background, removable title)',
      !!goldBtnState && goldBtnState.title.includes('click to remove') && goldBtnState.bg !== 'rgba(0, 0, 0, 0)');
    await page.fill('#goatSearchInput', 'dune');
    await settle(page);
    const wasDeclaredBefore = await page.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, targetId);
    // Re-select the button fresh -- the original handle's DOM node was replaced by the
    // Interstellar/dune re-searches above.
    await clickAndSettle(page, '#goatSearchResults .profEditBtn[data-act="declare"][data-id="' + targetId + '"]');
    const isDeclaredAfter = await page.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, targetId);
    check('declaring Gold from the GOAT Profile search toggles it in the profile', isDeclaredAfter === !wasDeclaredBefore);
    const resumedOnGoatView = await page.evaluate(() => {
      const s = document.querySelector('main > section[data-sec="goat"]');
      return s && !s.classList.contains('hidden');
    });
    check('tiering from a non-controller tab leaves you on that tab (no reload, no bounce)', resumedOnGoatView);

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
    await settle(page); // moveToTier applies in place, same as any other tier change
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
    await settle(page);
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
    await settle(page);
    const undoBtn = await page.$('#goatSearchResults .profEditBtn[data-act="declare"][data-id="' + targetId + '"]');
    if (undoBtn) { await clickAndSettle(page, '#goatSearchResults .profEditBtn[data-act="declare"][data-id="' + targetId + '"]'); }
    await page.click('#nav .navBtn[data-view="controller"]');
    await settle(page);

    // Surprise Me: now covers what the old "Tonight" tab did (mood + time budget), so this
    // exercises the merged feature -- a movie-only time-budget filter actually narrows the pool,
    // and the spin panel returns a specific pick.
    await page.click('#surpriseBtn');
    await settle(page);
    await page.selectOption('#spinTime', '60');
    await page.click('#spinGo');
    await settle(page);
    const surpriseHasResult = await page.evaluate(() => {
      const p = document.getElementById('surprisePanel');
      return p && !p.classList.contains('hidden') && p.textContent.length > 0;
    });
    check('Surprise Me (with a time budget set) returns a specific pick', surpriseHasResult);
    await page.click('#surpriseBtn');
    await settle(page);

    // #suggestBtn has the .navBtn-without-data-view shape that caused two real, previously-invisible
    // bugs (the old #tonightBtn and #goatPickerBtn, both since removed/folded elsewhere): its click
    // used to bubble into #nav's delegated view-switcher, calling switchView(undefined) and hiding
    // every section on the page underneath the modal. #suggestBtn has e.stopPropagation() from the
    // start (see index.html), and this run has no cloud configured, so it also checks the graceful
    // "cloud not configured" message rather than a silent no-op or a thrown error.
    await page.click('#suggestBtn');
    await settle(page);
    const suggestGateVisibleNoCloud = await page.evaluate(() => document.getElementById('suggestGate').offsetHeight > 0);
    check('suggestion box opens without cloud configured', suggestGateVisibleNoCloud);
    const suggestListNoCloud = await page.textContent('#suggestList');
    check('suggestion box explains cloud accounts aren\'t configured rather than failing silently', /cloud accounts/i.test(suggestListNoCloud));
    await page.click('#suggestClose');
    await settle(page);
    const controllerVisibleAfterSuggest = await page.evaluate(() => {
      const s = document.querySelector('main > section[data-sec="controller"]');
      return s && !s.classList.contains('hidden');
    });
    check('opening/closing the suggestion box does not hide the underlying view', controllerVisibleAfterSuggest);

    // Quick Tips: a small "?" button next to the theme selector opens a popup with the same
    // pointers the old banner had -- no nav tab, no page space taken up until asked for.
    const tipsHiddenInitially = await page.evaluate(() => document.getElementById('tipsGate').classList.contains('hidden'));
    check('Quick Tips popup is closed by default', tipsHiddenInitially);
    await page.click('#tipsBtn');
    await settle(page);
    const tipsVisibleAfterClick = await page.evaluate(() => !document.getElementById('tipsGate').classList.contains('hidden'));
    check('clicking the ? button opens the Quick Tips popup', tipsVisibleAfterClick);
    await page.click('#tipsClose');
    await settle(page);
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
    // A card's breakdown is built the first time it is opened (see fillCardPanels), so open the
    // first card and close it again: the layout is then real, and the collapsed state later
    // checks expect is left as it was.
    const detailLayoutOk = await page.evaluate(() => {
      const head = document.querySelector('#grid .cardHead');
      if (head) { head.click(); head.click(); }
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
      const tier = document.querySelector('.tierChip');
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
    await settle(page);
    const iconSlider = await page.$('#indexSliders .idxSlider[data-k="icon"]');
    await iconSlider.evaluate(el => { el.value = 60; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page);
    await page.click('#indexSliders .pinIdxBtn[data-k="icon"]');
    await settle(page);
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
    await settle(page);
    const unpinnedState = await page.evaluate(() => ({
      backInAdvanced: !!document.querySelector('#indexSliders .idxSlider[data-k="icon"]'),
      defaultsStillPinned: !!(document.querySelector('#pinnedMainSliders .idxSlider[data-k="snd"]') && document.querySelector('#pinnedMainSliders .idxSlider[data-k="ref"]'))
    }));
    check('unpinning moves the slider back to Advanced, leaving the default pins alone', unpinnedState.backInAdvanced && unpinnedState.defaultsStillPinned);
    await page.click('#resetBtn');
    await settle(page);

    // Tier system (Gold/Silver/Bronze): toggle Bronze on the first result card from its compact,
    // always-visible tier row (not the expanded detail panel), and check the badge, the tier
    // filter, and the tier sort all pick it up. Regression: the tier row's wrapping div originally
    // called stopPropagation() on click to keep the outer card from also toggling open/closed --
    // but that stopped the click from ever bubbling up to the #grid delegated handler that actually
    // runs handleProfileEditClick(), so no tier button worked at all. Fixed by removing it (the
    // delegated handler already checks .profEditBtn before .cardHead, so it was never needed).
    await page.click('#resetBtn');
    await settle(page);
    const firstCardIdValue = await firstCardId(page);
    await clickAndSettle(page, '.panel .profEditBtn[data-act="bronze"][data-id="' + firstCardIdValue + '"]');
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
    // of boosting"). Each click re-renders the grid in place (mutateProfile), so re-locate the same
    // card by id after each one rather than assuming the DOM survives.
    await page.click('.cardHead');
    await settle(page);
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
      await settle(page);
      await page.click('.cardHead');
      await settle(page);
      await page.click('.detail:not(.hidden) .profEditBtn[data-act="creatorbump"][data-delta="4"]');
      await settle(page);
      const weightAfterPlus = await page.evaluate((name) => {
        try {
          const arr = JSON.parse(localStorage.getItem('omniLedgerProfile')).creatorBoost || [];
          const e = arr.find(x => x[0] === name);
          return e ? e[1] : null;
        } catch (e) { return null; }
      }, stepperCreator);
      check('the "+" creator stepper raises the weight', weightAfterPlus === 4);
      // Click "-" twice: once back to 0 (should remove the entry entirely, not leave a stale 0),
      // once more into negative territory. The card is expanded only if it needs to be -- a stepper
      // click no longer reloads the page, and an expanded card now stays expanded through one, so
      // clicking its head unconditionally would CLOSE the card the next step needs open.
      await ensureFirstCardExpanded(page);
      await page.click('.detail:not(.hidden) .profEditBtn[data-act="creatorbump"][data-delta="-4"]');
      await settle(page);
      const weightAtZero = await page.evaluate((name) => {
        try {
          const arr = JSON.parse(localStorage.getItem('omniLedgerProfile')).creatorBoost || [];
          return arr.some(x => x[0] === name);
        } catch (e) { return true; }
      }, stepperCreator);
      check('stepping back to exactly 0 removes the boost entry instead of leaving a stale 0', !weightAtZero);
      await ensureFirstCardExpanded(page);
      await page.click('.detail:not(.hidden) .profEditBtn[data-act="creatorbump"][data-delta="-4"]');
      await settle(page);
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
    await settle(page);
    await page.click('.tierChip[data-tier="bronze"]');
    await settle(page);
    // Exactly the profile's Bronze picks, the one tiered above among them. This used to expect a
    // count of 1, which only held while the PK Sample had no Bronze picks of its own -- the sample
    // refreshed from the payton account carries ten, so the filter rightly shows eleven.
    const bronzeOnly = await page.evaluate(() => {
      let ids = [];
      try { ids = JSON.parse(localStorage.getItem('omniLedgerProfile')).bronzeTierIds || []; } catch (e) { /* none */ }
      const shown = Array.from(document.querySelectorAll('#grid .cardHead[data-id]')).map(h => h.dataset.id);
      return { count: (document.getElementById('resultCount').textContent.match(/\d+/) || [''])[0], ids, shown };
    });
    check('bronze-only tier filter narrows to exactly the Bronze picks, the one just tiered among them',
      +bronzeOnly.count === bronzeOnly.ids.length && bronzeOnly.shown.length === bronzeOnly.ids.length &&
      bronzeOnly.shown.every(id => bronzeOnly.ids.includes(id)) && bronzeOnly.shown.includes(firstCardIdValue));
    await page.click('.tierChip[data-tier="bronze"]'); // required -> excluded
    await settle(page);
    await page.click('.tierChip[data-tier="bronze"]'); // excluded -> neutral
    await settle(page);

    await page.selectOption('#sortSel', 'tier');
    await settle(page);
    const firstAfterTierSort = await firstCardId(page);
    const firstIsHigherTier = await page.evaluate((id) => {
      // A Gold-declared item should outrank the single Bronze item under the tier sort.
      const raw = localStorage.getItem('omniLedgerProfile');
      const p = raw ? JSON.parse(raw) : {};
      return (p.declaredGoatIds || []).includes(id);
    }, firstAfterTierSort);
    check('tier sort ranks a Gold favorite above a Bronze one', firstIsHigherTier);
    await page.click('#resetBtn');
    await settle(page);

    check('no uncaught page errors during desktop pass', pageErrors.length === 0);
    if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
    check('no failing console.assert (dataset integrity check)', consoleAssertFailures.length === 0);
    if (consoleAssertFailures.length) consoleAssertFailures.forEach(e => console.log('     ' + e));
    const contVerifiedText = await page.evaluate(() => {
      const b = document.querySelector('#nav .navBtn[data-view="contenders"]');
      if (b) b.click();
      return document.getElementById('contVerifiedCount').textContent;
    });
    check('contenders spot-check count reflects the live contenders array, not a stale default', /^◉ \d+\/\d+ spot-checked$/.test(contVerifiedText));
    await page.close();
  }

  // ---- Mobile viewport pass ----
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/supabase-js*/**', route => route.abort());
    await page.goto(full);
    await waitForBoot(page);
    await settle(page);
    const gateVisible = await page.evaluate(() => {
      const g = document.getElementById('onboardGate');
      return g && !g.classList.contains('hidden');
    });
    if (gateVisible) {
      const startBtn = isShare ? '#onboardBlank' : '#onboardSample';
      await page.click(startBtn);
      await settle(page);
    }

    const views = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#nav .navBtn[data-view]')).map(b => b.dataset.view));
    let anyOverflow = false;
    for (const v of views) {
      await page.evaluate(vv => {
        const b = document.querySelector('#nav .navBtn[data-view="' + vv + '"]');
        if (b) b.click();
      }, v);
      await settle(page);
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
    await settle(page);
    const activeTabVisible = await page.evaluate(() => {
      const nav = document.getElementById('nav');
      const btn = document.querySelector('#nav .navBtn[data-view="timeline"]');
      const navRect = nav.getBoundingClientRect(), btnRect = btn.getBoundingClientRect();
      return btnRect.left >= navRect.left - 1 && btnRect.right <= navRect.right + 1;
    });
    check('switching to an off-screen tab scrolls it into view', activeTabVisible);

    // Desktop stays completely unaffected by the mobile-only nav treatment above.
    await page.setViewportSize({ width: 1400, height: 900 });
    await settle(page);
    // Desktop: no horizontal scroll -- the ten views on one row once there's room (two even rows of
    // five below that), and "Suggest a feature" centered on its own row underneath.
    const navLayout = () => page.evaluate(() => {
      const nav = document.getElementById('nav'), n = nav.getBoundingClientRect();
      const views = Array.from(nav.querySelectorAll('.navBtn[data-view]'));
      const rows = Array.from(new Set(views.map(b => Math.round(b.getBoundingClientRect().top))));
      const s = document.getElementById('suggestBtn').getBoundingClientRect();
      return {
        noScroll: nav.scrollWidth <= nav.clientWidth + 1 && getComputedStyle(nav).overflowX !== 'auto',
        rows: rows.length, perRow: rows.map(t => views.filter(b => Math.round(b.getBoundingClientRect().top) === t).length),
        suggestBelow: s.top > Math.max.apply(null, views.map(b => b.getBoundingClientRect().bottom)) - 1,
        suggestCentered: Math.abs((s.left + s.width / 2) - (n.left + n.width / 2)) <= 2,
        nothingCut: views.every(b => b.scrollWidth <= b.clientWidth + 1),
      };
    });
    const wide = await navLayout();
    check('at desktop width the nav never scrolls sideways and nothing is cut off', wide.noScroll && wide.nothingCut);
    check('at 1400px all ten views sit on one row, with Suggest a feature centered below',
      wide.rows === 1 && wide.suggestBelow && wide.suggestCentered);
    await page.setViewportSize({ width: 1024, height: 900 });
    await settle(page);
    const mid = await navLayout();
    check('at 1024px the views form two even rows of five, with Suggest a feature centered below',
      mid.noScroll && mid.nothingCut && mid.rows === 2 && mid.perRow.every(c => c === 5) && mid.suggestBelow && mid.suggestCentered);

    // Stat-tile grids are laid out purely by utility classes (#goatStats: grid-cols-3
    // sm:grid-cols-6, #collStats: grid-cols-2 md:grid-cols-4 lg:grid-cols-8). The compiled
    // stylesheet used to lack grid-cols-3, sm:grid-cols-6 and lg:grid-cols-8, so every GOAT tile
    // stacked as its own full-width row even on desktop, and nothing failed. build-css.js --check
    // (test-fast) now keeps the stylesheet in step with the markup; these check it where it shows.
    const tileRows = async (view, sel) => {
      await page.evaluate(vv => document.querySelector('#nav .navBtn[data-view="' + vv + '"]').click(), view);
      await settle(page);
      return page.evaluate(s => {
        const tops = Array.from(document.querySelectorAll(s + ' > *')).map(t => Math.round(t.getBoundingClientRect().top));
        const rows = Array.from(new Set(tops));
        return { n: tops.length, perRow: rows.map(r => tops.filter(t => t === r).length) };
      }, sel);
    };
    await page.setViewportSize({ width: 1400, height: 900 });
    await settle(page);
    const goatWide = await tileRows('goat', '#goatStats');
    check('at 1400px the six GOAT Profile stat tiles sit on one row', goatWide.n === 6 && goatWide.perRow.length === 1);
    const collWide = await tileRows('collection', '#collStats');
    check('at 1400px the eight Collection stat tiles sit on one row', collWide.n === 8 && collWide.perRow.length === 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    const goatPhone = await tileRows('goat', '#goatStats');
    check('on a phone the GOAT Profile stat tiles form two rows of three',
      goatPhone.n === 6 && goatPhone.perRow.length === 2 && goatPhone.perRow.every(c => c === 3));

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
// Persisted in localStorage (not a bare JS object) so the mock store survives a real
// location.reload() -- acct-boot reloads the page after several real operations (onboarding,
// tiering, account delete), and a reload would otherwise wipe an in-memory-only mock, making it
// impossible to assert on state that was written right before the reload. Every simulated device
// here is its own browser context, which starts with empty storage, so devices stay isolated.
//
// Not sessionStorage, which it used to be. A switch the test had just turned off
// (silentlyDropProfileUpserts, refuseProfileWritesSilently) could be back on after the reload that
// followed, and stay on, so every later save in the cloud account flow failed: six checks on CI,
// on code from before and after the change CI failed on. The Chromium in this repo's cloud sessions
// reproduces exactly that with --enable-features=RenderDocument:level/all-frames (a fresh document
// for every reload): a new document that reads sessionStorage while starting up, as this mock's
// init script does, can get it as it was before the old document's last writes -- 12 of 300 reloads
// of a plain page. The mock's store is now exactly as reliable as the app's own data, which lives
// in localStorage: if storage lost writes across a reload, the app would fail before the mock did.
function __mockDefaultDb(){ return { tables: { profiles: {}, suggestions: [], suggestion_votes: [], media_status: [] }, upsertCalls: 0, profileUpsertCalls: 0, insertCalls: 0, deleteCalls: 0 }; }
function __mockLoad(){
  try {
    var db = JSON.parse(localStorage.getItem('__mockDb')) || __mockDefaultDb();
    if (!db.tables.media_status) db.tables.media_status = [];
    if (!db.tables.suggestion_votes) db.tables.suggestion_votes = [];
    return db;
  } catch (e) { return __mockDefaultDb(); }
}
function __mockSave(db){ try { localStorage.setItem('__mockDb', JSON.stringify(db)); } catch (e) {} }
// Behaviour flags live in their own keys rather than inside __mockDb, because the database blob is
// read-modify-written on every request: a write already in flight loads the blob BEFORE a test sets
// a flag on it and saves it back AFTER, silently wiping the flag. That lost update made a test look
// like the app had failed to detect a refused write, when the mock had simply stopped refusing --
// the app was behaving correctly and the test's own premise had been undone underneath it.
function __mockFlag(name){ try { return localStorage.getItem('__mockFlag_' + name) === '1'; } catch (e) { return false; } }
function __mockSetFlag(name, on){ try { localStorage.setItem('__mockFlag_' + name, on ? '1' : '0'); } catch (e) {} }
window.__mockSetFlag = __mockSetFlag;
// updated_at as the server stamps it on every write: unique and increasing, so a conditional write
// against a stale copy misses, as it would against Postgres.
function __mockStamp(db){ db.stampSeq = (db.stampSeq || 0) + 1; return new Date(Date.UTC(2026, 0, 1) + db.stampSeq).toISOString(); }
// Puts a profile row in the store as if some other device had saved it.
window.__mockSeedProfile = function(handle, data){ var db = __mockLoad(); db.tables.profiles[handle] = { handle: handle, data: data, updated_at: __mockStamp(db) }; __mockSave(db); };
Object.defineProperty(window, '__mockTables', { get: function(){ return __mockLoad().tables; } });
Object.defineProperty(window, '__upsertCalls', { get: function(){ return __mockLoad().upsertCalls; } });
Object.defineProperty(window, '__profileUpsertCalls', { get: function(){ return __mockLoad().profileUpsertCalls || 0; } });
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
        if (state.op === 'upsert' || state.op === 'update') {
          db.upsertCalls++;
          db.profileUpsertCalls = (db.profileUpsertCalls || 0) + 1;
          var hfw = state.filters.find(function(f){ return f[0] === 'handle'; });
          var row = state.op === 'upsert' ? state.payload : Object.assign({ handle: hfw && hfw[1] }, state.payload);
          if (state.op === 'update') {
            // Test-only escape hatch (__mockFlag concurrentProfileWriteOnce): another device saves
            // this handle's row between the app's read and its conditional write. Its copy carries a
            // rating of t01 the app has never seen, stamped as a real edit, so a merge must keep it.
            if (__mockFlag('concurrentProfileWriteOnce')) {
              __mockSetFlag('concurrentProfileWriteOnce', false);
              var cur = db.tables.profiles[row.handle];
              if (cur) {
                var other = JSON.parse(JSON.stringify(cur.data || {}));
                var op = JSON.parse(other.omniLedgerProfile || '{}');
                op.ratings = op.ratings || {}; op.ratings.t01 = 7.5;
                other.omniLedgerProfile = JSON.stringify(op);
                var oe = JSON.parse(other.omniLedgerEdits || '{}'); oe['r|t01'] = Math.floor(Date.now() / 1000) + 5;
                other.omniLedgerEdits = JSON.stringify(oe);
                db.tables.profiles[row.handle] = { handle: row.handle, data: other, updated_at: __mockStamp(db) };
              }
            }
            var existing = db.tables.profiles[row.handle];
            var uf = state.filters.find(function(f){ return f[0] === 'updated_at'; });
            // A conditional write whose row moved on (someone else saved since it was read) touches
            // nothing: an empty result, no error -- exactly what PostgREST answers.
            if (!existing || (uf && existing.updated_at !== uf[1])) { __mockSave(db); res({ data: [], error: null }); return; }
          }
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
          // Test-only escape hatch (__mockFlag silentlyDropProfileUpserts) reproducing the exact reported
          // failure: the server ACCEPTS the write (no error returned) but doesn't actually store
          // it -- what a rejecting/rewriting BEFORE trigger, an out-of-date schema, or a filtered
          // write looks like from the client. Unlike failNextProfileUpsert, nothing here reports
          // a problem, which is precisely why it used to destroy data silently.
          if (__mockFlag('silentlyDropProfileUpserts')) {
            __mockSave(db);
            res({ data: [row], error: null });
            return;
          }
          // Test-only escape hatch (__mockFlag refuseProfileWritesSilently) reproducing what Postgres
          // actually does when an RLS UPDATE policy excludes the row being written: the request
          // succeeds, no error is raised, and ZERO rows are written. Distinct from
          // silentlyDropProfileUpserts above, which still claims a row was affected -- here the empty
          // array is the only evidence anything went wrong.
          if (__mockFlag('refuseProfileWritesSilently')) {
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
              db2.tables.profiles[row.handle] = { handle: row.handle, data: row.data, updated_at: __mockStamp(db2) };
              __mockSave(db2);
              res({ data: [row], error: null });
            }, delayMs);
            return;
          }
          db.tables.profiles[row.handle] = { handle: row.handle, data: row.data, updated_at: __mockStamp(db) };
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
          var newRow = Object.assign({ kind: 'feedback', votes: 0 }, state.payload, { id: db.tables.suggestions.length + 1, created_at: new Date().toISOString() });
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
      if (table === 'suggestion_votes') {
        if (state.op === 'insert') {
          var vp = state.payload;
          var already = db.tables.suggestion_votes.some(function(r){ return String(r.suggestion_id) === String(vp.suggestion_id) && r.handle === vp.handle; });
          if (!already) {
            db.tables.suggestion_votes.push({ suggestion_id: vp.suggestion_id, handle: vp.handle });
            var votedRow = db.tables.suggestions.find(function(r){ return String(r.id) === String(vp.suggestion_id); });
            if (votedRow) votedRow.votes = (votedRow.votes || 0) + 1;
          }
          __mockSave(db);
          res({ data: already ? [] : [vp], error: null });
          return;
        }
        if (state.op === 'delete') {
          var vf = state.filters.find(function(f){ return f[0] === 'suggestion_id'; });
          var hf3 = state.filters.find(function(f){ return f[0] === 'handle'; });
          var removed = false;
          db.tables.suggestion_votes = db.tables.suggestion_votes.filter(function(r){
            var matches = (!vf || String(r.suggestion_id) === String(vf[1])) && (!hf3 || r.handle === hf3[1]);
            if (matches) removed = true;
            return !matches;
          });
          if (removed) {
            var unvotedRow = db.tables.suggestions.find(function(r){ return vf && String(r.id) === String(vf[1]); });
            if (unvotedRow) unvotedRow.votes = Math.max((unvotedRow.votes || 0) - 1, 0);
          }
          __mockSave(db);
          res({ data: null, error: null });
          return;
        }
        var vhf = state.filters.find(function(f){ return f[0] === 'handle'; });
        var vrows = db.tables.suggestion_votes.filter(function(r){ return !vhf || r.handle === vhf[1]; });
        res({ data: vrows, error: null });
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
    await settle(page);

    const gateVisible = await page.evaluate(() => !document.getElementById('acctGate').classList.contains('hidden'));
    check('account gate appears when cloud is configured and no handle is remembered', gateVisible);

    // Anyone can sign in as any name, so the PK Sample must not be read from the live 'payton'
    // account (it used to be). Plant a vandalized one; "Start from the PK Sample" below has to
    // ignore it and copy data/pk-sample.js.
    await page.evaluate(() => window.__mockSeedProfile('payton', { omniLedgerOnboarded: '1',
      omniLedgerProfile: JSON.stringify({ declaredGoatIds: ['m01'], vandalized: true }) }));

    const startBtn = isShare ? '#onboardBlank' : '#onboardSample';
    const firstSignIn = await signInAndSettle(page, 'SmokeTestUser', startBtn);
    check('account gate closes after choosing a handle', firstSignIn.signedIn);
    check('brand-new account gets the normal onboarding flow', firstSignIn.onboarding);

    // Regression: "Start from the PK Sample" used to leave PERSONAL_PROFILE's hardcoded defaults
    // sitting in memory without ever writing omniLedgerProfile to localStorage -- meaning nothing
    // was actually saved as this account's own profile unless a later edit happened to trigger a
    // save. It should now write a real, populated profile immediately: a copy of data/pk-sample.js.
    if (!isShare) {
      const seededProfile = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('omniLedgerProfile')); } catch (e) { return null; }
      });
      check('Start from the PK Sample immediately saves a real profile, not just the onboarded flag',
        !!seededProfile && Array.isArray(seededProfile.declaredGoatIds) && seededProfile.declaredGoatIds.length > 0);
      const fromFile = await page.evaluate(() => {
        const p = JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}');
        const same = k => JSON.stringify(p[k]) === JSON.stringify(PK_SAMPLE_PROFILE[k]);
        return p.vandalized === undefined && p.pkSampleOrigin === true &&
          ['declaredGoatIds', 'silverTierIds', 'bronzeTierIds', 'ownedMedia', 'ownedBooksExtra', 'ratings'].every(same);
      });
      check('the PK Sample is copied from data/pk-sample.js, not from whoever last signed in as payton', fromFile);
    }

    const synced = !!(await readWhen(page, () => !!(window.__mockTables && window.__mockTables.profiles['smoketestuser'])));
    check('a profile change syncs to the cloud store under the slugified handle', synced);

    // A second "device" (fresh context) with the same handle should hydrate from the cloud row and
    // skip onboarding, since the mock store already has an onboarded profile for this handle.
    const storedRow = await page.evaluate(() => window.__mockTables.profiles['smoketestuser']);
    await page.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    // OMNI_THROTTLE (see instrumentBrowser) slows this page too. It found two real bugs in this
    // flow; reach for it before guessing at a CI-only failure anywhere in the suite.
    const page2Errors = [];
    page2.on('pageerror', e => page2Errors.push(e.message));
    await page2.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    // addInitScript re-runs before every navigation for the life of this page (including the
    // reload the delete-account flow triggers below) -- guard the seed so it only ever seeds an
    // empty store, rather than stomping real mutations back to the original seed on every reload.
    await page2.addInitScript(MOCK_SUPABASE_SDK + 'if(!localStorage.getItem("__mockDb"))localStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:' + JSON.stringify({ smoketestuser: storedRow }) + ',suggestions:[],media_status:[]},upsertCalls:0,insertCalls:0,deleteCalls:0}));');
    await page2.goto('file://' + tmpPath);
    await waitForBoot(page2);
    await settle(page2);
    await page2.fill('#acctHandleInput', 'smoketestuser');
    await page2.click('#acctContinueBtn');
    await settle(page2);
    const onboardVisible2 = await page2.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    check('same handle on a second device hydrates from the cloud and skips onboarding again', !onboardVisible2);

    // Durability: gold/silver/bronze/owned are written to media_status as real rows as well as
    // into the profiles blob, so an account whose blob is empty/mangled (a stale validation
    // trigger, a partially-applied schema) must still come back from those rows rather than
    // looking brand new. Seeds a handle with picks ONLY in media_status and an empty blob.
    const ctxR = await browser.newContext();
    const pageR = await ctxR.newPage();
    await pageR.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await pageR.addInitScript(MOCK_SUPABASE_SDK + 'if(!localStorage.getItem("__mockDb"))localStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:{recoverme:{handle:"recoverme",data:{}}},suggestions:[],media_status:[{handle:"recoverme",media_id:"m01",tier:"bronze",owned:false},{handle:"recoverme",media_id:"m02",tier:"gold",owned:true}]},upsertCalls:0,insertCalls:0,deleteCalls:0}));');
    await pageR.goto('file://' + tmpPath);
    await settle(pageR);
    await pageR.fill('#acctHandleInput', 'recoverme');
    await pageR.click('#acctContinueBtn');
    await settle(pageR);
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
    await pageN.addInitScript(MOCK_SUPABASE_SDK + 'if(!localStorage.getItem("__mockDb"))localStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:{},suggestions:[],media_status:[]},upsertCalls:0,insertCalls:0,deleteCalls:0}));');
    await pageN.goto('file://' + tmpPath);
    await settle(pageN);
    await pageN.fill('#acctHandleInput', 'brandnew');
    await pageN.click('#acctContinueBtn');
    await settle(pageN);
    const onboardN = await pageN.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    check('a brand-new cloud handle gets the onboarding flow', onboardN);
    await pageN.click(isShare ? '#onboardBlank' : '#onboardSample');
    await settle(pageN);
    const newGoldId = await firstCardId(pageN);
    await clickAndSettle(pageN, '.panel .profEditBtn[data-act="bronze"][data-id="' + newGoldId + '"]');
    // Let any debounced background sync fire too (the 1.5s idle one included), so a racing
    // near-empty write would have landed by the time the row is read.
    await settle(pageN, { through: 1500 });
    const newRowIsReal = await pageN.evaluate((id) => {
      const row = window.__mockTables.profiles['brandnew'];
      if (!row || !row.data) return { ok: false, keys: [] };
      const keys = Object.keys(row.data);
      let hasPick;
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
    await page3.addInitScript(MOCK_SUPABASE_SDK + 'if(!localStorage.getItem("__mockDb"))localStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:' + JSON.stringify({ smoketestuser: storedRow }) + ',suggestions:[],media_status:[]},upsertCalls:0,insertCalls:0,deleteCalls:0,failNextProfileSelectOnce:true}));');
    await page3.goto('file://' + tmpPath);
    await waitForBoot(page3);
    await settle(page3);
    await page3.fill('#acctHandleInput', 'smoketestuser');
    await page3.click('#acctContinueBtn');
    await settle(page3); // one failed attempt + the ~800ms retry delay + a successful second attempt
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
    await settle(page2);
    const acctMenuVisible = await page2.evaluate(() => document.getElementById('acctMenuPop').offsetHeight > 0);
    check('account menu dropdown opens on click', acctMenuVisible);
    const acctStatusText = await page2.textContent('#acctMenuStatus');
    check('account menu shows the signed-in handle', acctStatusText.includes('smoketestuser'));

    // Suggestion box: opening it must not corrupt the view (same #navBtn-without-data-view bug
    // class already found twice with #tonightBtn and the old #goatPickerBtn), it should load
    // against the mocked Supabase client, accept a submission, and show it back in the list.
    const viewBeforeSuggest = await page2.evaluate(() => document.querySelector('section[data-sec]:not(.hidden)').dataset.sec);
    await page2.click('#suggestBtn');
    await settle(page2);
    const suggestGateVisible = await page2.evaluate(() => document.getElementById('suggestGate').offsetHeight > 0);
    check('suggestion box opens on click', suggestGateVisible);
    const viewAfterSuggestOpen = await page2.evaluate(() => document.querySelector('section[data-sec]:not(.hidden)').dataset.sec);
    check('opening the suggestion box does not corrupt the underlying view', viewAfterSuggestOpen === viewBeforeSuggest);

    await page2.fill('#suggestText', 'Smoke test suggestion: add more cowbell.');
    await page2.click('#suggestSubmit');
    await settle(page2);
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
    await settle(page2);
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
    await settle(page2);
    const listAfterEdit = await page2.textContent('#suggestList');
    check('saving an edit updates the suggestion text in the list', listAfterEdit.includes('edited, more cowbell please') && !listAfterEdit.includes('Smoke test suggestion: add more cowbell.'));

    page2.once('dialog', d => d.accept());
    await page2.click('#suggestList .suggestDeleteBtn');
    await settle(page2);
    const listAfterDelete = await page2.textContent('#suggestList');
    const stillInMockStore = await page2.evaluate(() =>
      (window.__mockTables.suggestions || []).some(s => (s.text || '').includes('cowbell')));
    check('deleting a suggestion removes it from the list and the shared table', !listAfterDelete.includes('cowbell') && !stillInMockStore);

    // Not-done/Resolved tabs and who may triage: seed a suggestion from someone else, and one of
    // smoketestuser's own, directly into the mock table (real submissions from those handles) and
    // reload the list. Someone else's lands in "Not done" by default, and smoketestuser -- neither
    // its author nor the app's owner -- can vote on it but not edit, resolve or delete it. Every
    // visitor used to be offered Delete and Mark resolved on everyone's suggestions, so anyone could
    // clear out anyone else's ideas. An author can resolve their own; the owner keeps the ability to
    // triage any suggestion, which they asked for (checked on its own page below).
    await page2.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('__mockDb'));
      const now = new Date().toISOString();
      db.tables.suggestions.push({ id: 9001, text: 'Someone else entirely: more kazoo.', handle: 'a_different_person', status: 'open', created_at: now });
      db.tables.suggestions.push({ id: 9002, text: 'Smoke test: resolve me, please.', handle: 'smoketestuser', status: 'open', created_at: now });
      localStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await page2.click('#suggestTabs [data-tab="open"]');
    // page.reload(), not an in-page location.reload(): that returns before the navigation starts, so
    // the wait after it could be answered by the OLD document -- which has #suggestBtn and ALL too --
    // and the click below then landed on a page about to be thrown away. Waiting for boot rather
    // than sleeping, since the reload re-parses the whole corpus and that cost grows with the data.
    await page2.reload();
    await waitForBoot(page2);
    await page2.click('#suggestBtn');
    // Same again for the list itself -- it renders after an async read of the (mocked) table.
    const otherRowInOpenTab = await page2.waitForFunction(() =>
      Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('more kazoo')),
      { timeout: 10000 }).then(() => true).catch(() => false);
    check('a suggestion from someone else appears in the Not done tab by default', otherRowInOpenTab);
    const otherControls = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('more kazoo'));
      return row ? { vote: !!row.querySelector('.suggestVoteBtn'), edit: !!row.querySelector('.suggestEditBtn'),
        resolve: !!row.querySelector('.suggestResolveBtn'), del: !!row.querySelector('.suggestDeleteBtn') } : null;
    });
    check('on someone else\'s suggestion you can vote, but not edit, resolve or delete it',
      !!otherControls && otherControls.vote && !otherControls.edit && !otherControls.resolve && !otherControls.del);

    // Return a boolean instead of dereferencing a row that may not be there: a missing row is a
    // failed check above, and should stay one -- it should not throw and abort the whole run,
    // taking every later check with it.
    const resolveClicked = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('resolve me'));
      const btn = row && row.querySelector('.suggestResolveBtn');
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('your own suggestion offers a Resolve control', resolveClicked);
    await settle(page2);
    const goneFromOpenAfterResolve = await page2.evaluate(() =>
      !Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('resolve me')));
    check('marking a suggestion resolved removes it from the Not done tab', goneFromOpenAfterResolve);
    await page2.click('#suggestTabs [data-tab="resolved"]');
    await settle(page2);
    const inResolvedTab = await page2.evaluate(() =>
      Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('resolve me')));
    check('...and shows it in the Resolved tab instead', inResolvedTab);
    const resolvedInMockStore = await page2.evaluate(() => {
      const row = (window.__mockTables.suggestions || []).find(s => (s.text || '').includes('resolve me'));
      return row && row.status === 'shipped';
    });
    check('the resolved status actually persisted to the shared table', resolvedInMockStore);
    await page2.click('#suggestTabs [data-tab="open"]');
    await settle(page2);

    // The app's owner keeps the triage they asked for: signed in as "payton", someone else's
    // suggestion offers Resolve and Delete (still not Edit -- the words stay the author's).
    const ctxO = await browser.newContext();
    const pageO = await ctxO.newPage();
    await pageO.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await pageO.addInitScript(MOCK_SUPABASE_SDK + 'if(!localStorage.getItem("__mockDb"))localStorage.setItem("__mockDb", JSON.stringify({tables:{profiles:{},suggestions:[{id:9101,text:"Someone else entirely: more theremin.",handle:"a_different_person",status:"open",created_at:"' + new Date().toISOString() + '"}],media_status:[]},upsertCalls:0,insertCalls:0,deleteCalls:0}));');
    await pageO.goto('file://' + tmpPath);
    await waitForBoot(pageO);
    await settle(pageO);
    await signInAndSettle(pageO, 'payton', '#onboardBlank');
    await pageO.click('#suggestBtn');
    const ownerControls = await readWhen(pageO, () => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('more theremin'));
      return row ? { del: !!row.querySelector('.suggestDeleteBtn'), resolve: !!row.querySelector('.suggestResolveBtn'), edit: !!row.querySelector('.suggestEditBtn') } : false;
    }, undefined, 10000);
    check('the app\'s owner can resolve or delete anyone\'s suggestion (but not edit it)',
      !!ownerControls && ownerControls.del && ownerControls.resolve && !ownerControls.edit);
    await ctxO.close();

    // Media Request is a second, separately-tabbed list sharing the same suggestions table (split
    // by a 'kind' column) -- switching to it should show its own empty state, not the feedback
    // list's items, and submitting there should tag the row so it only ever shows up under Media
    // Request afterward.
    await page2.click('#suggestCatTabs [data-cat="media"]');
    await settle(page2);
    const feedbackHiddenUnderMediaTab = await page2.evaluate(() =>
      !Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('kazoo')));
    check('switching to the Media Request tab hides feedback suggestions', feedbackHiddenUnderMediaTab);
    await page2.selectOption('#suggestMediaType', 'Book');
    await page2.fill('#suggestText', 'Project Hail Mary');
    await page2.click('#suggestSubmit');
    const mediaRowVisible = await page2.waitForFunction(() =>
      Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).some(r => r.textContent.includes('Project Hail Mary')),
      { timeout: 10000 }).then(() => true).catch(() => false);
    check('a submitted media request appears under the Media Request tab', mediaRowVisible);
    const mediaBadgeShown = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('Project Hail Mary'));
      return !!(row && row.querySelector('.suggestMediaBadge') && row.querySelector('.suggestMediaBadge').textContent.includes('Book'));
    });
    check('the media request shows its type as a badge rather than raw bracket text', mediaBadgeShown);
    const mediaKindStored = await page2.evaluate(() => {
      const row = (window.__mockTables.suggestions || []).find(s => (s.text || '').includes('Project Hail Mary'));
      return !!(row && row.kind === 'media');
    });
    check('the media request is stored with kind=media', mediaKindStored);

    // You can't vote on your own suggestion (the count renders as an inert span), so hand this
    // request to another handle in the shared store and make the list re-read it via an edit/save.
    const ownVoteIsInert = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('Project Hail Mary'));
      const v = row && row.querySelector('.suggestVoteBtn');
      return !!(v && v.tagName === 'SPAN' && !v.dataset.id);
    });
    check('your own suggestion shows its vote count but no vote button', ownVoteIsInert);
    await page2.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('__mockDb'));
      const row = db.tables.suggestions.find(s => (s.text || '').includes('Project Hail Mary'));
      if (row) row.handle = 'someoneelse';
      localStorage.setItem('__mockDb', JSON.stringify(db));
      const r = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(x => x.textContent.includes('Project Hail Mary'));
      r.querySelector('.suggestEditBtn').click();
    });
    await page2.click('#suggestList .suggestEditSave');
    await page2.waitForFunction(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('Project Hail Mary'));
      const btn = row && row.querySelector('button.suggestVoteBtn');
      return !!btn;
    }, null, { timeout: 10000 }).catch(() => {});

    const voteBtnClicked = await page2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('Project Hail Mary'));
      const btn = row && row.querySelector('button.suggestVoteBtn');
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('a vote button is offered on a media request', voteBtnClicked);
    const voteRegistered = await page2.waitForFunction(() => {
      const row = Array.from(document.querySelectorAll('#suggestList [data-suggest-id]')).find(r => r.textContent.includes('Project Hail Mary'));
      const btn = row && row.querySelector('.suggestVoteBtn');
      return !!(btn && btn.classList.contains('voted') && btn.textContent.includes('1'));
    }, null, { timeout: 10000 }).then(() => true).catch(() => false);
    check('voting for a suggestion increments its count and marks it as voted', voteRegistered);
    await page2.click('#suggestCatTabs [data-cat="feedback"]');
    await settle(page2);

    await page2.click('#suggestClose');
    await settle(page2);
    const suggestGateHiddenAfterClose = await page2.evaluate(() => document.getElementById('suggestGate').offsetHeight === 0);
    check('suggestion box closes on close button', suggestGateHiddenAfterClose);

    // Delete my account: only visible/usable when signed into a real cloud handle, asks for
    // confirmation (a real browser confirm() dialog -- Playwright intercepts it), then deletes the
    // cloud row and clears local state. Tested before Switch Account below, since switching would
    // sign this handle out and make "delete my own account" no longer applicable.
    await page2.click('#acctMenuField');
    await settle(page2);
    const deleteBtnVisible = await page2.evaluate(() => {
      const b = document.getElementById('acctDeleteBtn');
      return b && !b.classList.contains('hidden');
    });
    check('Delete my account is offered when signed into a real cloud handle', deleteBtnVisible);
    page2.once('dialog', d => d.accept());
    await page2.click('#acctDeleteBtn');
    await settle(page2);
    const deleteCalls = await page2.evaluate(() => window.__deleteCalls || 0);
    check('confirming delete removes the row from the shared Supabase table', deleteCalls >= 1);
    const rowGoneFromStore = await page2.evaluate(() => !window.__mockTables.profiles['smoketestuser']);
    check('the deleted handle\'s row is actually gone from the store', rowGoneFromStore);
    // Deleting the account clears local state and brings the gate back, but not instantly -- the
    // delete round-trips first. Sampling the DOM a fixed 500ms later is a race the moment the
    // machine is busy, and the bare `.classList` on a possibly-absent element throws rather than
    // failing this one check. Wait for the end state instead.
    const deleteSettled = !!(await readWhen(page2, () => {
      const gate = document.getElementById('acctGate');
      return localStorage.getItem('omniLedgerHandle') === null && !!gate && !gate.classList.contains('hidden');
    }, undefined, 10000));
    check('deleting the account clears the remembered handle and re-shows the account gate', deleteSettled);

    // Switch account clears the remembered handle and shows the gate again. Re-sign-in first
    // (delete above signed this device out entirely) so there's an account to switch away from.
    await signInAndSettle(page2, 'smoketestuser2', isShare ? '#onboardBlank' : '#onboardSample');

    // Gold/silver/bronze/owned are also mirrored into the normalized media_status table (see
    // supabase/schema.sql), not just left inside the profiles.data jsonb blob -- so this is
    // exercising both the app's own recommendation-driving state AND that it's actually queryable
    // in the DB per title. Declaring something Gold should upsert a row; un-declaring it should
    // remove that row entirely (nothing left to track once there's no tier and it's not owned).
    const goldCardId = await firstCardId(page2);
    const goldClickLanded = await clickAndSettle(page2, '.panel .profEditBtn[data-act="declare"][data-id="' + goldCardId + '"]');
    check('the Gold button on card ' + goldCardId + ' actually fired (a missed click is not a database bug)',
      goldClickLanded);
    const mediaRowAfterDeclare = await readWhen(page2, (id) => {
      const rows = (window.__mockTables && window.__mockTables.media_status) || [];
      return rows.find(r => r.handle === 'smoketestuser2' && r.media_id === id) || false;
    }, goldCardId);
    check('declaring Gold upserts a row into the media_status table', !!mediaRowAfterDeclare && mediaRowAfterDeclare.tier === 'gold' && mediaRowAfterDeclare.owned === false);

    await clickAndSettle(page2, '.panel .profEditBtn[data-act="declare"][data-id="' + goldCardId + '"]');
    const undeclareLanded = await readWhen(page2, (id) => {
      const t = window.__mockTables;
      // Only answer once the mock store is readable again -- mid-reload it is briefly not, and
      // treating "cannot see the table" as "the row is gone" would pass this check for the wrong reason.
      if (!t || !t.media_status) return false;
      return t.media_status.some(r => r.handle === 'smoketestuser2' && r.media_id === id) ? false : { gone: true };
    }, goldCardId);
    check('un-declaring removes the media_status row entirely (no tier, not owned)', !!undeclareLanded);

    // The controller grid patches only the cards an edit can have changed instead of rebuilding all
    // 100 of them -- the difference between ~210ms of blocked main thread per click and ~30ms. That
    // is only sound if the patched grid is INDISTINGUISHABLE from a full redraw, so assert exactly
    // that: click each tier button under several sorts, and compare the patched DOM against the
    // result of forcing a complete re-render right after. A card reads two things off the rest of
    // the corpus (whyRecommended's citation, crossMediumPairings' ordering), and both bit this
    // before the changed set was widened to cover them -- 8 of 72 comparisons differed.
    const gridEquivalence = await page2.evaluate(async () => {
      const sorts = ['overall', 'tier', 'blend', 'crit', 'yearNew'];
      const sel = document.getElementById('sortSel');
      const originalSort = sel ? sel.value : null;
      const bad = [];
      let compared = 0;
      for (const sortKey of sorts) {
        if (sel && Array.from(sel.options).some(o => o.value === sortKey)) {
          sel.value = sortKey;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          await window.__omniSettle.whenIdle();
        }
        for (const act of ['declare', 'silver', 'bronze', 'own']) {
          for (let n = 0; n < 2; n++) {
            const btns = Array.from(document.querySelectorAll('.panel .profEditBtn[data-act="' + act + '"]'));
            if (!btns.length) continue;
            const btn = btns[(n * 7) % btns.length];
            const id = btn.dataset.id;
            // Start from a fresh full redraw, so anything that landed asynchronously before this
            // click (a late sync or sort re-render on a slow CI box) isn't blamed on the patch.
            window.refresh();
            const fresh = document.querySelector('.panel .profEditBtn[data-act="' + act + '"][data-id="' + id + '"]');
            if (!fresh) continue;
            fresh.click();
            const patched = document.getElementById('grid').innerHTML;
            window.refresh();                    // full redraw, no changed-set shortcut
            if (patched !== document.getElementById('grid').innerHTML) bad.push(sortKey + '/' + act);
            compared++;
            // Undo, so this check leaves the profile exactly as it found it.
            const undo = document.querySelector('.panel .profEditBtn[data-act="' + act + '"][data-id="' + id + '"]');
            if (undo) undo.click();
          }
        }
      }
      if (sel && originalSort !== null) {
        sel.value = originalSort;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { compared: compared, bad: bad };
    });
    check('a patched grid is identical to a full redraw (' + gridEquivalence.compared + ' comparisons across sorts and tiers)',
      gridEquivalence.compared >= 30 && gridEquivalence.bad.length === 0);
    if (gridEquivalence.bad.length) console.log('       diverged on: ' + gridEquivalence.bad.join(', '));

    // An expanded card stays expanded through the edit -- true on the patch path (its neighbours
    // are never touched, and its own rebuild carries the state) and on the full-redraw fallback.
    const stayedOpen = await page2.evaluate(async () => {
      const head = document.querySelector('#grid .cardHead');
      if (!head) return false;
      const id = head.dataset.id;
      head.click();                                       // expand it
      await window.__omniSettle.whenIdle();
      const opened = !document.querySelector('#grid .panel .summaryFace').classList.contains('hidden');
      document.querySelector('.panel .profEditBtn[data-act="bronze"][data-id="' + id + '"]').click();
      await window.__omniSettle.whenIdle();
      const card = document.querySelector('#grid .cardHead[data-id="' + id + '"]').closest('.panel');
      const sf = card.querySelector('.summaryFace');
      const stillOpen = sf && !sf.classList.contains('hidden');
      document.querySelector('.panel .profEditBtn[data-act="bronze"][data-id="' + id + '"]').click();
      return opened && stillOpen;
    });
    check('an expanded card stays expanded when you tier it', stayedOpen);
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 15000);

    // A RUN of edits -- marking several titles owned one after another, the workflow the in-place
    // toggles exist to make possible -- must coalesce into far fewer uploads than clicks, and must
    // still get every title's row into media_status. Before the shared debounce, each click fired
    // its own verified upsert AND read-back, so twenty owned clicks queued twenty round-trips.
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);
    // Only titles not already owned: Owned is a toggle, so clicking one that's already on turns it
    // off, and the check below would then (correctly) not find it in media_status as owned.
    const runIds = await page2.evaluate(() => Array.from(document.querySelectorAll('.panel .profEditBtn[data-act="own"]'))
      .filter(b => !/click to remove/.test(b.title || '')).slice(0, 5).map(b => b.dataset.id));
    const upsertsBeforeRun = await page2.evaluate(() => window.__profileUpsertCalls);
    // Dispatched back-to-back in one pass, which is what a run of clicks actually looks like and
    // what the debounce is for. Driving them through Playwright instead would put a few hundred
    // milliseconds of its own between clicks and measure the harness, not the app.
    const revBefore = await page2.evaluate(() => window.__omniProfileRevision || 0);
    await page2.evaluate((ids) => {
      // Re-query each button: every edit re-renders the grid, so the previous node is gone.
      ids.forEach(id => {
        const b = document.querySelector('.panel .profEditBtn[data-act="own"][data-id="' + id + '"]');
        if (b) b.click();
      });
    }, runIds);
    const allApplied = await page2.waitForFunction(
      (n) => (window.__omniProfileRevision || 0) >= n, revBefore + runIds.length, { timeout: 15000 })
      .then(() => true).catch(() => false);
    check('every click in a rapid run of ' + runIds.length + ' is applied', allApplied);
    const runLanded = !!(await readWhen(page2, (ids) => {
      const rows = (window.__mockTables && window.__mockTables.media_status) || [];
      return ids.every(id => rows.some(r => r.handle === 'smoketestuser2' && r.media_id === id && r.owned === true));
    }, runIds, 15000));
    check('a run of Owned clicks gets every title into media_status', runLanded);
    const upsertsForRun = (await page2.evaluate(() => window.__profileUpsertCalls)) - upsertsBeforeRun;
    check('a rapid run of ' + runIds.length + ' edits coalesces into fewer profile uploads than clicks (was one each), got ' + upsertsForRun,
      upsertsForRun > 0 && upsertsForRun < runIds.length);

    // The watchlist is a tracked key like any other, but it used to be the one piece of real user
    // data that only ever got the slower incidental-write sync. It now takes the same path as a
    // tier click, so a heart reaches the cloud snapshot on its own.
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);
    const wlId = await page2.evaluate(() => {
      const b = document.querySelector('.panel .wlBtn');
      if (!b) return null;
      b.click();
      return b.dataset.wl;
    });
    const wlInCloud = !!(await readWhen(page2, (id) => {
      const row = window.__mockTables && window.__mockTables.profiles && window.__mockTables.profiles['smoketestuser2'];
      if (!row || !row.data) return false;
      try { return Object.prototype.hasOwnProperty.call(JSON.parse(row.data.omniLedgerWatchlist || '{}'), id); }
      catch (e) { return false; }
    }, wlId, 10000));
    check('a watchlist heart reaches the cloud on the same path as a tier click', !!wlId && wlInCloud);
    // Put it back so nothing downstream inherits a stray watchlist entry.
    await page2.evaluate((id) => { const b = document.querySelector('.panel .wlBtn[data-wl="' + id + '"]'); if (b) b.click(); }, wlId);
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);

    // Undo the run, so the rest of the flow sees the profile it expects.
    for (const rid of runIds) await clickAndSettle(page2, '.panel .profEditBtn[data-act="own"][data-id="' + rid + '"]');
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);

    // THE reported bug, reproduced end to end: "I select bronze from the main card, it shows up,
    // then I refresh the page and it's gone." The server accepts the write but doesn't store it
    // (silentlyDropProfileUpserts), which is what a rejecting/rewriting trigger or an out-of-date
    // schema looks like from the browser -- no error, nothing to notice. The app's own reload after
    // tiering is covered by the one-shot skip-hydrate flag, so the damage only showed up on the
    // SECOND, manual refresh, which is exactly what this walks through: declare, let the app
    // reload, then reload again by hand and confirm the pick is still there.
    const bronzeCardId = await firstCardId(page2);
    // Let the sync layer go quiet before pretending the cloud has started dropping writes.
    //
    // Profile writes are serialised on one chain (pushChain in index.html) and ANY successful push
    // calls clearPending(). A push still in flight when the flag flips therefore succeeds, lands
    // after the bronze edit below, and clears the pending mark that edit had just set -- so the
    // check reads "the app reported a silently-dropped write as saved" when the app did nothing
    // wrong. That is the check that failed on CI while passing locally.
    //
    // Order matters: flip the flag FIRST, then drain. Anything already in flight or already
    // scheduled resolves inside that window, while there is still nothing pending for it to clear.
    // Draining before the flag would leave the same push free to resolve after the edit instead.
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);
    await page2.evaluate(() => window.__mockSetFlag('silentlyDropProfileUpserts', true));
    await settle(page2, { through: 1500 }); // anything the idle-sync debounce had queued has now run
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);
    await clickAndSettle(page2, '.panel .profEditBtn[data-act="bronze"][data-id="' + bronzeCardId + '"]');
    const bronzeRightAfterClick = await page2.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').bronzeTierIds || []).includes(id); }
      catch (e) { return false; }
    }, bronzeCardId);
    check('a Bronze pick is applied locally even when the cloud write silently does not store it', bronzeRightAfterClick);

    const pendingAfterSilentDrop = !!(await readWhen(page2,
      () => localStorage.getItem('omniLedgerPendingSync') === '1', undefined, 8000));
    // If this ever fails again, say WHY rather than leaving a bare FAIL. It has cost three CI
    // cycles already, twice because the harness misread a settled page and once for a real race,
    // and a bare boolean cannot tell those apart from the log.
    if (!pendingAfterSilentDrop) {
      console.log('       state: ' + JSON.stringify(await page2.evaluate(() => {
        const db = JSON.parse(localStorage.getItem('__mockDb') || '{}');
        const read = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
        const cloud = read((((db.tables || {}).profiles || {})['smoketestuser2'] || {}).data ?
          ((db.tables.profiles['smoketestuser2'].data) || {}).omniLedgerProfile : '{}');
        return {
          pending: localStorage.getItem('omniLedgerPendingSync'),
          syncError: (localStorage.getItem('omniLedgerLastSyncError') || '(none)').slice(0, 80),
          skipHydrateArmed: sessionStorage.getItem('omniLedgerSkipHydrateOnce'),
          bronzeLocal: (read(localStorage.getItem('omniLedgerProfile')).bronzeTierIds || []).length,
          bronzeInCloud: (cloud.bronzeTierIds || []).length,
          dropFlagStillSet: localStorage.getItem('__mockFlag_silentlyDropProfileUpserts') === '1',
        };
      })));
    }
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
    await page2.evaluate(() => window.__mockSetFlag('silentlyDropProfileUpserts', false));
    await page2.reload();
    await waitForBoot(page2);
    // Polled rather than slept: boot has to notice the pending mark, re-push, and then verify the
    // write with a read-back (plus a possible retry), so a fixed wait here is guesswork that gets
    // brittle every time that path gains a round trip.
    const healed = await page2.waitForFunction((id) => {
      const row = window.__mockTables && window.__mockTables.profiles && window.__mockTables.profiles['smoketestuser2'];
      if (!row) return false;
      let stored;
      try { stored = (JSON.parse(row.data.omniLedgerProfile || '{}').bronzeTierIds || []).includes(id); }
      catch (e) { return false; }
      return stored && localStorage.getItem('omniLedgerPendingSync') !== '1';
    }, bronzeCardId, { timeout: 10000 }).then(() => true).catch(() => false);
    check('an unsynced change is pushed and verified on its own once the cloud works again', healed);

    // A write the DATABASE silently refuses (RLS UPDATE policy filtering out the conflicting row in
    // ON CONFLICT DO UPDATE: 2xx, no error, zero rows written) has to be caught too -- this is the
    // shape a real Supabase project reports when its policies are wrong, and the only evidence is
    // the empty result set, which the app could not see at all before it asked for the rows back.
    // Same quiesce, same reason: a push still in flight from the heal above would succeed and
    // clear the pending mark the next edit sets.
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);
    await page2.evaluate(() => window.__mockSetFlag('refuseProfileWritesSilently', true));
    await settle(page2, { through: 1500 }); // anything the idle-sync debounce had queued has now run
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);
    await clickAndSettle(page2, '.panel .profEditBtn[data-act="silver"][data-id="' + bronzeCardId + '"]');
    // Wait for BOTH halves together. The pending mark is set the moment the edit is written, but
    // the error message only lands once the push has round-tripped and been rejected -- so reading
    // pending with a wait and the reason with a bare evaluate samples them at different instants,
    // and on a slower runner the reason is still empty when it is read.
    const refusalDetected = !!(await readWhen(page2, () =>
      localStorage.getItem('omniLedgerPendingSync') === '1' &&
      /wrote no row/.test(localStorage.getItem('omniLedgerLastSyncError') || ''),
      undefined, 10000));
    check('a write the database silently refuses (zero rows written) is caught, not counted as saved',
      refusalDetected);

    await page2.reload();
    await waitForBoot(page2);
    const silverSurvivedRefusal = await page2.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').silverTierIds || []).includes(id); }
      catch (e) { return false; }
    }, bronzeCardId);
    check('a pick survives a refresh even when the database refuses the write outright', silverSurvivedRefusal);

    await page2.evaluate(() => window.__mockSetFlag('refuseProfileWritesSilently', false));
    await page2.reload();
    await waitForBoot(page2);

    // Put the card back the way the rest of the flow expects it (it started with no tier at all).
    await clickAndSettle(page2, '.panel .profEditBtn[data-act="silver"][data-id="' + bronzeCardId + '"]');
    await clickAndSettle(page2, '.panel .profEditBtn[data-act="bronze"][data-id="' + bronzeCardId + '"]');
    // ...and let every upload that queued finish before the next check arms a one-shot failure.
    // Armed while one of these was still pending, the failure was spent on THAT write, the declare
    // below synced fine, and "a failed sync retries on its own" then failed with nothing to retry --
    // the last check to fail on CI before this file stopped sleeping.
    await settle(page2, { through: 1500 });
    await readWhen(page2, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 10000);

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
      const db = JSON.parse(localStorage.getItem('__mockDb'));
      db.failNextProfileUpsert = true;
      localStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await clickAndSettle(page2, '.panel .profEditBtn[data-act="declare"][data-id="' + secondGoldId + '"]');
    await settle(page2); // the edit debounce has fired and the (failing) upsert has been attempted
    const survivedFailedSync = await page2.evaluate((id) => {
      try { return (JSON.parse(localStorage.getItem('omniLedgerProfile')).declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, secondGoldId);
    check('a self-triggered reload does not get clobbered when its own sync fails', survivedFailedSync);

    // ...and the failed sync now heals itself while the tab just sits there. Before, a failure was
    // only ever retried by the NEXT edit or the next boot, so a tab left open after one stayed
    // rose-dotted and unsynced indefinitely -- correct about the data, but waiting on the person to
    // do something about it. The declare above failed its one upsert (failNextProfileUpsert is
    // one-shot), so nothing here touches the app: the backoff's first attempt lands on its own.
    const healedByRetry = !!(await readWhen(page2, (id) => {
      const row = window.__mockTables && window.__mockTables.profiles && window.__mockTables.profiles['smoketestuser2'];
      if (!row || !row.data) return false;
      let stored;
      try { stored = (JSON.parse(row.data.omniLedgerProfile || '{}').declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
      return stored && localStorage.getItem('omniLedgerPendingSync') !== '1';
    }, secondGoldId, 20000));
    check('a failed sync retries on its own, with no further edit and no reload', healedByRetry);

    // Root-cause regression for the bug that kept recurring in real use even after the Phase 34
    // fix: withTimeout races the real network request against a timeout, but doesn't cancel the
    // loser -- so a request that's merely SLOW (a cold-starting free-tier project, a weak mobile
    // connection -- not a dead connection) used to lose that race under the old 4s cutoff, and the
    // app would proceed to switch accounts (clearing the only local copy) with the real write still
    // in flight, which the ensuing navigation would then kill outright. Proves the fix -- a much
    // longer real timeout (15s) plus refusing to switch at all when a sync genuinely fails -- by
    // making the mock's next profile write take 6s (comfortably past the old cutoff, comfortably
    // under the new one) and confirming the switch actually waits for it to land rather than
    // barreling past. The write is made slow BEFORE the edit, so it is that edit's own upload that
    // is still in flight when Switch is pressed: a sync with nothing left to send now skips the
    // write altogether (the cloud already matches), so a slow write set up afterwards never happens.
    const thirdGoldId = await page2.evaluate(() => {
      const heads = Array.from(document.querySelectorAll('.cardHead'));
      return heads[2] && heads[2].dataset.id;
    });
    await page2.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('__mockDb'));
      db.slowNextProfileUpsertMs = 6000;
      localStorage.setItem('__mockDb', JSON.stringify(db));
    });
    await clickAndSettle(page2, '.panel .profEditBtn[data-act="declare"][data-id="' + thirdGoldId + '"]');
    await settle(page2);
    await page2.click('#acctMenuField');
    await settle(page2);
    await page2.click('#acctSwitchBtn');
    await settle(page2);
    const stillOnOldAccountMidFlush = await page2.evaluate(() => localStorage.getItem('omniLedgerHandle') === 'smoketestuser2');
    check('switching does not proceed while a slow-but-alive sync is still in flight', stillOnOldAccountMidFlush);
    // Waited on rather than slept: the write takes 6s by design, and a page slowed by a busy runner
    // takes longer still to act on it. The mock table lives in localStorage, so it survives the
    // reload the switch ends with.
    const thirdDeclareLandedInCloud = !!(await readWhen(page2, (id) => {
      const row = window.__mockTables && window.__mockTables.profiles['smoketestuser2'];
      try { return !!row && (JSON.parse(row.data.omniLedgerProfile || '{}').declaredGoatIds || []).includes(id); }
      catch (e) { return false; }
    }, thirdGoldId, 20000));
    check('the slow write actually lands in the cloud once the timeout is realistic', thirdDeclareLandedInCloud);
    const switchedAfterSlowSync = !!(await readWhen(page2, () => {
      const g = document.getElementById('acctGate');
      return localStorage.getItem('omniLedgerHandle') === null && !!g && !g.classList.contains('hidden');
    }, undefined, 15000));
    check('the switch itself completes once the slow sync finishes', switchedAfterSlowSync);
    await settle(page2);

    // Re-sign in once more so the plain (non-slow) switch-account check below has a normal account
    // to switch away from.
    await page2.fill('#acctHandleInput', 'smoketestuser2');
    await page2.click('#acctContinueBtn');
    await settle(page2);
    const onboardVisible4 = await page2.evaluate(() => !document.getElementById('onboardGate').classList.contains('hidden'));
    if (onboardVisible4) { await page2.click(isShare ? '#onboardBlank' : '#onboardSample'); await waitForBoot(page2); }

    await page2.click('#acctMenuField');
    await settle(page2);
    await page2.click('#acctSwitchBtn');
    // Switching flushes any pending sync first, then clears and reloads.
    const switched = !!(await readWhen(page2, () => {
      const g = document.getElementById('acctGate');
      return localStorage.getItem('omniLedgerHandle') === null && !!g && !g.classList.contains('hidden');
    }, undefined, 15000));
    check('switch account clears the remembered handle and re-shows the account gate', switched);

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
  await settle(page);
  await page.click('#onboardSeed');
  await settle(page);
  const itemCount = await page.evaluate(() => document.querySelectorAll('.onboardSeedItem').length);
  check('quick-rate offers 16 varied picks', itemCount === 16);

  const firstId = await page.evaluate(() => document.querySelector('.onboardSeedItem').dataset.id);
  await page.click('.onboardSeedItem .onboardSeedTierBtn[data-tier="gold"]');
  await settle(page);
  const goldActiveAfterTap = await page.evaluate(() => {
    const btn = document.querySelector('.onboardSeedItem .onboardSeedTierBtn[data-tier="gold"]');
    return btn && /background:\s*#fbbf24/.test(btn.getAttribute('style') || '');
  });
  check('tapping Gold on a pick tiers it Gold, right there in onboarding', goldActiveAfterTap);

  await page.click('#onboardSeedMore');
  await settle(page);
  const idsAfterReshuffle = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.onboardSeedItem')).map(el => el.dataset.id));
  check('"show different picks" keeps the loved item visible', idsAfterReshuffle.includes(firstId));
  check('"show different picks" adds genuinely new items, not a reshuffled duplicate of the same 16', idsAfterReshuffle.length > 16);
  const noDuplicates = new Set(idsAfterReshuffle).size === idsAfterReshuffle.length;
  check('reshuffled batch has no duplicate items', noDuplicates);

  // Back is a genuine no-op cancel back to the other starting options (unlike Skip, which commits
  // a blank profile) -- nothing should be saved, and re-entering Quick-rate should still work.
  await page.click('#onboardSeedBack');
  await settle(page);
  const choiceVisibleAfterBack = await page.evaluate(() => !document.getElementById('onboardChoiceScreen').classList.contains('hidden'));
  const seedHiddenAfterBack = await page.evaluate(() => document.getElementById('onboardSeedScreen').classList.contains('hidden'));
  const nothingSavedAfterBack = await page.evaluate(() => localStorage.getItem('omniLedgerProfile') === null);
  check('Back returns to the other starting options without saving anything', choiceVisibleAfterBack && seedHiddenAfterBack && nothingSavedAfterBack);

  await page.click('#onboardSeed');
  await settle(page);

  await page.click('#onboardSeedContinue');
  await settle(page);
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
  await settle(page);
  await page.click('#onboardBlank');
  await waitForBoot(page);
  await settle(page);

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
  await settle(page);
  const firstId = await page.evaluate(() => {
    const b = document.querySelector('#goatSearchResults .profEditBtn[data-act="bronze"]');
    return b ? b.dataset.id : null;
  });
  check('a from-scratch profile still offers tier buttons in the GOAT Profile search', !!firstId);
  await page.click('#goatSearchResults .profEditBtn[data-act="bronze"][data-id="' + firstId + '"]');
  await settle(page);

  const savedBronze = await page.evaluate((id) => {
    try { return (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').bronzeTierIds || []).includes(id); }
    catch (e) { return false; }
  }, firstId);
  check('tiering Bronze on a from-scratch profile saves it', savedBronze);

  await page.click('[data-view="goat"]');
  await settle(page);
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
  await settle(page);
  await page.click('#onboardGoatPicker');
  await settle(page);
  const allCount = await page.evaluate(() => document.querySelectorAll('.goatPickerItem').length);
  check('GOAT Picker shows results with no filter applied', allCount > 0);
  await page.click('#goatPickerType button[data-t="movie"]');
  await settle(page);
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

// The Collection tab groups medium -> edition, both levels collapsible, every row a link into the
// Global Controller. Each of those is a thing a careless render can silently drop (a nested
// <details> that renders flat, a format button that navigates instead of setting the format), so
// they're asserted here rather than left to be noticed by eye.
async function runCollectionFlow(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
  await waitForBoot(page);
  await settle(page);
  const gateVisible = await page.evaluate(() => {
    const g = document.getElementById('onboardGate');
    return g && !g.classList.contains('hidden');
  });
  if (gateVisible) {
    await page.click(file === 'share.html' ? '#onboardBlank' : '#onboardSample');
    await waitForBoot(page);
  }
  await page.click('button[data-view="collection"]');
  await settle(page);

  const info = await page.evaluate(() => {
    const media = Array.from(document.querySelectorAll('#collFormats details.collMedium'));
    return {
      media: media.map(d => ({
        ck: d.dataset.ck,
        formats: Array.from(d.querySelectorAll('details.collGroup')).map(f => f.dataset.ck)
      })),
      jumpables: document.querySelectorAll('#collFormats .panel.goatJump[data-q]').length,
      pickerFormats: Array.from(document.querySelectorAll('#collFormats [data-act="setformat"]'))
        .map(b => b.dataset.fmt).filter((v, i, a) => a.indexOf(v) === i),
      legacyLabels: /Softcover|Boxed Set|BD\/DVD|Deluxe/.test(document.getElementById('collFormats').innerHTML)
    };
  });
  check('Collection groups by medium, not one flat list of formats', info.media.length >= 2 && info.media.every(m => m.ck.indexOf('m:') === 0));
  check('each non-game medium nests its editions inside it', info.media.filter(m => m.ck !== 'm:game').every(m => m.formats.length >= 1 && m.formats.every(f => f.indexOf('f:') === 0)));
  check('games stay a flat list -- no invented physical edition tier', (info.media.find(m => m.ck === 'm:game') || { formats: [] }).formats.length === 0);
  check('every owned title in the Collection links into the Global Controller', info.jumpables > 0);
  check('books are offered Paperback, never "Softcover"', info.pickerFormats.includes('Paperback') && !info.pickerFormats.includes('Softcover'));
  check('Box Set is a pickable edition', info.pickerFormats.includes('Box Set'));
  check('Deluxe is not an edition in any medium', !info.pickerFormats.includes('Deluxe'));
  check('no legacy edition spelling survives normalization', !info.legacyLabels);

  // Collapse state: a closed section stays closed, and is remembered outside the profile blob.
  await page.evaluate(() => { document.querySelector('#collFormats details.collMedium > summary').click(); });
  await settle(page);
  const stored = await page.evaluate(() => localStorage.getItem('omniLedgerCollOpen') || '');
  check('collapsing a section is remembered', /:false/.test(stored));
  await page.evaluate(() => { document.querySelector('#collFormats .collAll[data-open="0"]').click(); });
  await settle(page);
  const allClosed = await page.evaluate(() => Array.from(document.querySelectorAll('#collFormats details[data-ck]')).every(d => !d.open));
  check('Collapse all closes every medium and edition', allClosed);
  await page.evaluate(() => { document.querySelector('#collFormats .collAll[data-open="1"]').click(); });
  await settle(page);
  const allOpen = await page.evaluate(() => Array.from(document.querySelectorAll('#collFormats details[data-ck]')).every(d => d.open));
  check('Expand all reopens every medium and edition', allOpen);

  // Setting an edition must not navigate. The picker sits inside a row that is ITSELF a link to the
  // Global Controller, and both handlers are bound on `document` -- where stopPropagation() cannot
  // separate them. Asserting the view AFTER the click (and after the recompute reload it triggers)
  // is the only version of this check that can fail when they are wired wrong; checking beforehand
  // proves nothing. Scroll position is asserted with it: declaring editions in a run is the whole
  // point of the buttons, and being thrown back to the top of a 179-item tab each time defeats it.
  const fmtTarget = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#collFormats .panel.goatJump'));
    const card = cards[Math.min(20, cards.length - 1)];
    card.scrollIntoView({ block: 'center' });
    const btn = card.querySelector('[data-act="setformat"]');
    return { title: card.dataset.q, fmt: btn ? btn.dataset.fmt : null };
  });
  await settle(page);
  const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#collFormats .panel.goatJump'));
    cards[Math.min(20, cards.length - 1)].querySelector('[data-act="setformat"]').click();
  });
  await page.waitForLoadState('load');
  await settle(page);
  const afterFmt = await page.evaluate(() => ({ view: state.view, y: Math.round(window.scrollY) }));
  check('picking an edition does not navigate away from the Collection', afterFmt.view === 'collection');
  check('picking an edition keeps your place in the list', scrollBefore < 400 || Math.abs(afterFmt.y - scrollBefore) < 300);
  if (afterFmt.view !== 'collection' || (scrollBefore >= 400 && Math.abs(afterFmt.y - scrollBefore) >= 300)) {
    console.log('     target=' + fmtTarget.title + ' fmt=' + fmtTarget.fmt + ' scroll ' + scrollBefore + ' -> ' + afterFmt.y + ' view=' + afterFmt.view);
  }

  await page.evaluate(() => { document.querySelector('#collFormats .panel.goatJump[data-q]').click(); });
  await settle(page);
  const afterJump = await page.evaluate(() => ({ view: state.view, q: state.q }));
  check('clicking an owned title opens it in the Global Controller', afterJump.view === 'controller' && !!afterJump.q);

  // Group by Series
  await page.click('button[data-view="collection"]');
  await settle(page);
  await page.click('#seriesToggle');
  await settle(page);
  const series = await page.evaluate(() => ({
    cards: document.querySelectorAll('#collSeries .panel').length,
    jump: document.querySelectorAll('#collSeries .goatJump[data-q]').length,
    seriesVisible: !document.getElementById('collSeries').classList.contains('hidden'),
    formatsHidden: document.getElementById('collFormats').classList.contains('hidden')
  }));
  check('Group by Series renders franchise cards', series.cards > 0);
  check('Group by Series swaps out the format view rather than stacking on it', series.seriesVisible && series.formatsHidden);
  check('series entries link into the Global Controller too', series.jump > 0);
  await page.evaluate(() => { document.querySelector('#collSeries .goatJump[data-q]').click(); });
  await settle(page);
  const seriesJumped = await page.evaluate(() => state.view);
  check('clicking a series entry opens it in the Global Controller', seriesJumped === 'controller');

  await page.close();
  check('no uncaught page errors during the Collection pass', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

// A profile saved BEFORE the edition vocabulary was settled must keep loading correctly, forever:
// that is the whole reason normalization happens on read instead of by rewriting stored profiles.
// This seeds a profile carrying every retired spelling and asserts it renders as the current one,
// with nothing lost and the stored strings left exactly as they were.
async function runLegacyProfileFlow(browser, file) {
  const legacy = {
    ownedMedia: { m120: '4K', m106: 'BD/DVD', m444: 'BD/DVD', t17: 'Box Set', t97: 'Boxed Set' },
    ownedBooksExtra: { b01: 'Softcover', b02: 'Hardcover', b05: 'Deluxe', b153: 'Boxed Set', b09: 'Owned' },
    ownedGameIds: ['g45'], declaredGoatIds: ['m120'], silverTierIds: ['m106'], watchlist: { c02: 1 }
  };
  const seededOwned = 5 + 5 + 1;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/supabase-js*/**', route => route.abort());
  await page.addInitScript(p => {
    localStorage.setItem('omniLedgerProfile', JSON.stringify(p));
    localStorage.setItem('omniLedgerOnboarded', '1');
  }, legacy);
  await page.goto('file://' + path.join(ROOT, file));
  await waitForBoot(page);
  await settle(page);
  await page.evaluate(() => document.querySelector('button[data-view="collection"]').click());
  await settle(page);

  const r = await page.evaluate(() => ({
    chips: Array.from(document.querySelectorAll('#collFormats details.collGroup .chip')).map(c => c.textContent),
    legacyOnScreen: /Softcover|Boxed Set|BD\/DVD|Deluxe/.test(document.getElementById('collFormats').innerHTML),
    owned: ALL.filter(x => x.owned).length,
    stored: localStorage.getItem('omniLedgerProfile') || '',
    gold: (PERSONAL_PROFILE.declaredGoatIds || []).length,
    silver: (PERSONAL_PROFILE.silverTierIds || []).length
  }));
  check('a profile saved before the vocabulary change still loads every owned title', r.owned === seededOwned);
  check('no retired edition spelling reaches the screen from an old profile', !r.legacyOnScreen);
  check('a retired spelling resolves to a current one, not its own bucket', r.chips.includes('Paperback') && r.chips.includes('Box Set') && !r.chips.includes('Softcover'));
  check('an owned title with no declared edition is labelled, not dropped', r.chips.includes('Format not set'));
  check('tiers on an old profile survive the load', r.gold === 1 && r.silver === 1);
  check('reading an old profile never rewrites it', r.stored.indexOf('Softcover') >= 0 && r.stored.indexOf('BD/DVD') >= 0);
  await ctx.close();
  check('no uncaught page errors loading a pre-change profile', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

// Personal ratings (0-10, one decimal, any medium): the bookAffinity -> ratings migration that
// runs once on boot for an old saved profile, the on-card rating popup end to end (ghost prompt,
// open, save, re-open pre-filled, clear, cancel-does-not-save), the GOAT Match blend, and the new
// Global Controller filter/sort. Two fresh contexts -- migration only makes sense against a profile
// that predates `ratings`, so it needs its own boot separate from the interactive-UI pass below.
async function runRatingFlow(browser, file) {
  const legacy = { bookAffinity: { b19: 92, b20: 74 }, declaredGoatIds: [] };
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const pageA = await ctxA.newPage();
  await pageA.route('**/supabase-js*/**', route => route.abort());
  await pageA.addInitScript(p => {
    localStorage.setItem('omniLedgerProfile', JSON.stringify(p));
    localStorage.setItem('omniLedgerOnboarded', '1');
  }, legacy);
  await pageA.goto('file://' + path.join(ROOT, file));
  await waitForBoot(pageA);
  await settle(pageA);
  const migrated = await pageA.evaluate(() => ({
    ratings: PERSONAL_PROFILE.ratings,
    hasBookAffinity: Object.prototype.hasOwnProperty.call(PERSONAL_PROFILE, 'bookAffinity'),
    stored: localStorage.getItem('omniLedgerProfile') || ''
  }));
  check('a legacy bookAffinity profile migrates into ratings on boot',
    !!migrated.ratings && migrated.ratings.b19 === 9.2 && migrated.ratings.b20 === 7.4);
  check('bookAffinity is dropped from the in-memory profile after migration', !migrated.hasBookAffinity);
  check('the migration is written back to localStorage, not just held in memory',
    migrated.stored.indexOf('bookAffinity') === -1 && migrated.stored.indexOf('"b19":9.2') >= 0);
  await ctxA.close();

  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const pageB = await ctxB.newPage();
  const pageErrors = [];
  pageB.on('pageerror', e => pageErrors.push(e.message));
  await pageB.route('**/supabase-js*/**', route => route.abort());
  await pageB.addInitScript(() => { localStorage.setItem('omniLedgerOnboarded', '1'); });
  await pageB.goto('file://' + path.join(ROOT, file));
  await waitForBoot(pageB);
  await settle(pageB);

  const cardId = await firstCardId(pageB);
  const initiallyUnrated = await pageB.evaluate((id) => {
    const btn = document.querySelector('.panel .rateBtn[data-id="' + id + '"]');
    return !!btn && !btn.classList.contains('rated') && /Rate/.test(btn.textContent);
  }, cardId);
  check('an unrated card shows a ghost "Rate" prompt, not a number', initiallyUnrated);

  await pageB.click('.panel .rateBtn[data-id="' + cardId + '"]');
  const gateOpened = await readWhen(pageB, () => !document.getElementById('rateGate').classList.contains('hidden'));
  check('clicking Rate opens the rating popup', !!gateOpened);
  const titleMatches = await pageB.evaluate((id) =>
    document.getElementById('rateGateTitle').textContent === ALL.find(x => x.id === id).title, cardId);
  check('the popup names the work being rated', titleMatches);

  await pageB.fill('#rateGateNum', '8.5');
  let rev = await pageB.evaluate(() => window.__omniProfileRevision || 0);
  await pageB.click('#rateGateSave');
  await pageB.waitForFunction((n) => (window.__omniProfileRevision || 0) > n, rev, { timeout: 10000 }).catch(() => {});
  const afterSave = await pageB.evaluate((id) => {
    const btn = document.querySelector('.panel .rateBtn[data-id="' + id + '"]');
    return {
      gateHidden: document.getElementById('rateGate').classList.contains('hidden'),
      btnText: btn ? btn.textContent : '',
      rated: !!btn && btn.classList.contains('rated'),
      stored: (JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').ratings || {})[id],
      myRating: ALL.find(x => x.id === id).myRating
    };
  }, cardId);
  check('saving a rating closes the popup', afterSave.gateHidden);
  check('the card face updates to show the saved rating', afterSave.rated && /8\.5/.test(afterSave.btnText));
  check('the rating is saved into the profile', afterSave.stored === 8.5);
  check("the derived it.myRating reflects the saved rating", afterSave.myRating === 8.5);

  await pageB.click('.panel .rateBtn[data-id="' + cardId + '"]');
  await readWhen(pageB, () => !document.getElementById('rateGate').classList.contains('hidden'));
  const prefilled = await pageB.evaluate(() => document.getElementById('rateGateNum').value);
  check("reopening the popup pre-fills the value you already gave it", prefilled === '8.5');

  rev = await pageB.evaluate(() => window.__omniProfileRevision || 0);
  await pageB.click('#rateGateClear');
  await pageB.waitForFunction((n) => (window.__omniProfileRevision || 0) > n, rev, { timeout: 10000 }).catch(() => {});
  const afterClear = await pageB.evaluate((id) => {
    const btn = document.querySelector('.panel .rateBtn[data-id="' + id + '"]');
    return {
      btnText: btn ? btn.textContent : '',
      rated: !!btn && btn.classList.contains('rated'),
      stored: JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}').ratings || {}
    };
  }, cardId);
  check('clearing the rating reverts the card to the ghost prompt', !afterClear.rated && /Rate/.test(afterClear.btnText));
  check('clearing the rating removes it from the profile', !(cardId in afterClear.stored));

  await pageB.click('.panel .rateBtn[data-id="' + cardId + '"]');
  await readWhen(pageB, () => !document.getElementById('rateGate').classList.contains('hidden'));
  await pageB.fill('#rateGateNum', '3.3');
  await pageB.click('#rateGateCancel');
  await settle(pageB);
  const afterCancel = await pageB.evaluate((id) => ({
    gateHidden: document.getElementById('rateGate').classList.contains('hidden'),
    myRating: ALL.find(x => x.id === id).myRating
  }), cardId);
  check('Cancel closes the popup without saving', afterCancel.gateHidden && afterCancel.myRating == null);

  const blend = await pageB.evaluate((id) => {
    const before = ALL.find(x => x.id === id).gm;
    setRating(id, 10);
    const highGm = ALL.find(x => x.id === id).gm, highOverride = ALL.find(x => x.id === id).gmOverride;
    setRating(id, 0);
    const lowGm = ALL.find(x => x.id === id).gm;
    clearRating(id);
    const resetGm = ALL.find(x => x.id === id).gm;
    return { before, highGm, highOverride, lowGm, resetGm };
  }, cardId);
  check('rating something 10 pulls its GOAT Match up toward 100', blend.highGm >= blend.before);
  check('a 10 rating is flagged as the reason for the match score', blend.highOverride === 'rated');
  check('rating something 0 pulls its GOAT Match down, not just up', blend.lowGm < blend.highGm);
  check('clearing the rating returns GOAT Match to its unrated value', blend.resetGm === blend.before);

  const filterResult = await pageB.evaluate((id) => {
    setRating(id, 10);
    state.minMyRating = 5; refresh();
    const passesHighBar = filtered().some(x => x.id === id);
    state.minMyRating = 0; state.ratedOnly = true; refresh();
    const inRatedOnly = filtered().some(x => x.id === id);
    const anyUnrated = filtered().some(x => x.myRating == null);
    state.ratedOnly = false; state.unratedOnly = true; refresh();
    const excludedFromUnratedOnly = !filtered().some(x => x.id === id);
    state.unratedOnly = false;
    const sortedFirst = filtered().slice().sort(SORTS.myrating)[0].id === id;
    clearRating(id); refresh();
    return { passesHighBar, inRatedOnly, anyUnrated, excludedFromUnratedOnly, sortedFirst };
  }, cardId);
  check('"My Rating ≥" filters to works rated at least that high', filterResult.passesHighBar);
  check('"Rated by me only" keeps a rated work and excludes unrated ones', filterResult.inRatedOnly && !filterResult.anyUnrated);
  check('"Unrated only" excludes a work you rated', filterResult.excludedFromUnratedOnly);
  check('sorting by "My Rating" puts your highest-rated work first', filterResult.sortedFirst);

  // "My Tiers" groups by tier (unchanged) but should now break ties within a tier by your own
  // rating before falling back to GOAT Match -- a Gold pick you loved belongs above a Gold pick
  // you were lukewarm on, not ordered by the algorithm's estimate.
  const tierSortResult = await pageB.evaluate(() => {
    const golds = ALL.filter(x => x.goat);
    if (golds.length < 2) return null;
    const [gx, gy] = golds;
    clearRating(gx.id); clearRating(gy.id);
    setRating(gx.id, 6);
    setRating(gy.id, 9.5);
    const sorted = ALL.filter(x => x.goat).sort(SORTS.tier);
    const idxX = sorted.findIndex(w => w.id === gx.id);
    const idxY = sorted.findIndex(w => w.id === gy.id);
    clearRating(gx.id); clearRating(gy.id);
    return { idxX, idxY };
  });
  check('"My Tiers" sort ranks a higher-rated Gold pick above a lower-rated one',
    !!tierSortResult && tierSortResult.idxY < tierSortResult.idxX);

  // Collection tab: the right side of every card is now ONLY the same ☆ Rate / ★ N.N control the
  // Global Controller cards use -- no quality score, no GOAT dot alongside it any more (per
  // explicit direction: rate your owned stuff right there, nothing else competing for that space).
  // "Sort: My rating" still ranks by it.
  const collResult = await pageB.evaluate(() => {
    const owned = ALL.filter(x => x.owned);
    if (owned.length < 2) return null;
    const [ox, oy] = owned.slice(0, 2);
    clearRating(ox.id); clearRating(oy.id);
    const unratedHTML = collItemCardHTML(ox, '#38bdf8');
    setRating(ox.id, 3);
    setRating(oy.id, 9.7);
    state.collSort = 'myrating';
    const sorted = owned.slice().sort(collSortFn());
    const idxX = sorted.findIndex(w => w.id === ox.id);
    const idxY = sorted.findIndex(w => w.id === oy.id);
    const ratedHTML = collItemCardHTML(oy, '#38bdf8');
    const hasRateBtn = /rateBtn/.test(unratedHTML) && /rateBtn/.test(ratedHTML);
    const showsRatingValue = ratedHTML.indexOf('9.7') >= 0;
    // Neither card should carry the old ovr score or GOAT dot any more.
    const noOvrOnUnrated = unratedHTML.indexOf('tabular-nums" style="color:#38bdf8">' + ox.ovr) === -1;
    const noOvrOnRated = ratedHTML.indexOf('tabular-nums" style="color:#38bdf8">' + oy.ovr) === -1;
    const noGoatDot = unratedHTML.indexOf('GOAT') === -1 && ratedHTML.indexOf('GOAT') === -1;
    clearRating(ox.id); clearRating(oy.id);
    state.collSort = 'az';
    return { idxX, idxY, hasRateBtn, showsRatingValue, noOvrOnUnrated, noOvrOnRated, noGoatDot };
  });
  check('Collection "Sort: My rating" ranks your higher-rated owned item first',
    !!collResult && collResult.idxY < collResult.idxX);
  check('every Collection card carries the same Rate control as the Global Controller',
    !!collResult && collResult.hasRateBtn && collResult.showsRatingValue);
  check('the Collection card no longer shows a quality score or GOAT dot next to it',
    !!collResult && collResult.noOvrOnUnrated && collResult.noOvrOnRated && collResult.noGoatDot);

  // And a real click, not just the string output: rating something from inside the Collection tab
  // has to go through the exact same popup and land in the exact same field the Global Controller
  // uses, so it shows up back there immediately with nothing separate to keep in sync.
  const collClick = await pageB.evaluate(() => { switchView('collection'); return true; });
  await settle(pageB);
  const collCardId = await pageB.evaluate(() => {
    const btn = document.querySelector('#collFormats .rateBtn');
    return btn ? btn.dataset.id : null;
  });
  if (collCardId) {
    await pageB.evaluate((id) => { clearRating(id); }, collCardId);
    await settle(pageB);
    await pageB.click('#collFormats .rateBtn[data-id="' + collCardId + '"]');
    const gateOpenedFromColl = await readWhen(pageB, () => !document.getElementById('rateGate').classList.contains('hidden'));
    check('clicking Rate on a Collection card opens the same popup', !!gateOpenedFromColl);
    await pageB.fill('#rateGateNum', '7.2');
    const revC = await pageB.evaluate(() => window.__omniProfileRevision || 0);
    await pageB.click('#rateGateSave');
    await pageB.waitForFunction((n) => (window.__omniProfileRevision || 0) > n, revC, { timeout: 10000 }).catch(() => {});
    const afterCollSave = await pageB.evaluate((id) => ({
      myRating: ALL.find(x => x.id === id).myRating,
      cardShowsIt: (document.querySelector('#collFormats .rateBtn[data-id="' + id + '"]') || {}).textContent
    }), collCardId);
    check('rating from the Collection card lands in the same field the Global Controller reads', afterCollSave.myRating === 7.2);
    check('the Collection card itself updates to show it, right there', /7\.2/.test(afterCollSave.cardShowsIt || ''));
    await pageB.evaluate((id) => { clearRating(id); }, collCardId);
  } else {
    check('clicking Rate on a Collection card opens the same popup', false, 'no .rateBtn found in Collection');
  }

  await ctxB.close();
  check('no uncaught page errors during the rating pass', pageErrors.length === 0);
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
  await settle(page);
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
    await settle(page);
  };

  // Contenders Ledger: search + sort narrow and reorder results.
  await goto('contenders');
  const contBefore = await page.evaluate(() => document.querySelectorAll('#contenderGrid > div').length);
  await page.fill('#contSearch', 'dune');
  await settle(page);
  const contAfter = await page.evaluate(() => document.querySelectorAll('#contenderGrid > div').length);
  check('Contenders search narrows the result set', contAfter > 0 && contAfter <= contBefore);
  await page.fill('#contSearch', '');
  await settle(page);

  // Creator Archives: scope, sort, % owned, and the view-in-Controller jump all work.
  await goto('creators');
  await page.click('[data-scope="authors"]');
  await settle(page);
  const authorsOnlyCount = await page.evaluate(() => document.querySelectorAll('#creatorGrid > div').length);
  check('Creator Archives scoped to Authors shows a card grid', authorsOnlyCount > 0 && authorsOnlyCount <= 50);
  await page.selectOption('#creatorSortSel', 'az');
  await settle(page);
  const ownedPctVisible = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#creatorGrid')).some(g => /% owned/.test(g.innerText)));
  check('creator cards show a % owned stat', ownedPctVisible);
  const jumpWorked = await page.evaluate(async () => {
    const jump = document.querySelector('#creatorGrid .goatJump');
    if (!jump) return false;
    jump.click();
    await window.__omniSettle.whenIdle();
    return document.querySelector('main > section[data-sec="controller"]') &&
      !document.querySelector('main > section[data-sec="controller"]').classList.contains('hidden');
  });
  check('clicking a creator\'s "View in Controller" jumps to the Global Controller', jumpWorked);
  await goto('creators');
  await page.click('[data-scope="all"]');
  await settle(page);

  // Reference Matrices: nav search filters brackets, owned-only actually restricts rows.
  await goto('matrix');
  const navBefore = await page.evaluate(() => document.querySelectorAll('#matrixNav a').length);
  await page.fill('#matrixNavSearch', 'horror');
  await settle(page);
  const navAfter = await page.evaluate(() => document.querySelectorAll('#matrixNav a').length);
  check('Matrices bracket search narrows the quick-jump nav', navAfter > 0 && navAfter < navBefore);
  await page.fill('#matrixNavSearch', '');
  await settle(page);
  await page.click('#matrixOwnedOnly');
  await settle(page);
  const ownedOnlyLabelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#matrixWrap .chip')).some(c => /owned/.test(c.textContent)));
  check('Matrices owned-only toggle relabels bracket counts as "owned"', ownedOnlyLabelled);
  await page.click('#matrixOwnedOnly');
  await settle(page);

  // Visualization Suite: bubble min-score filters, and the decade chart includes all 4 media kinds.
  await goto('viz');
  await settle(page);
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
  await settle(page);
  const bubbleLbl = await page.textContent('#bubbleMinLbl');
  check('bubble min-score slider updates its live label', bubbleLbl.includes('80'));

  // Taste Flow (chart C) must stay accurate regardless of the Global Controller's filters -- it
  // answers "where does my whole taste profile come from," not "what's in the current filtered
  // view" the way chart A does, so a search/filter that excludes everything tiered/owned (the
  // exact case that used to blank it entirely) must not empty it.
  await goto('controller');
  await page.fill('#q', 'zzzz-no-real-title-matches-this');
  await page.dispatchEvent('#q', 'input');
  await settle(page);
  await goto('viz');
  await settle(page);
  const sankeyHTML = await page.evaluate(() => (document.getElementById('sankeyWrap') || {}).innerHTML || '');
  check('Taste Flow (chart C) still shows your full tier breakdown when Global Controller filters exclude everything',
    sankeyHTML.indexOf('skRibbon') >= 0 && sankeyHTML.indexOf('Nothing tiered or owned') === -1);
  await goto('controller');
  await page.fill('#q', '');
  await page.dispatchEvent('#q', 'input');
  await settle(page);

  // Timeline: medium filter narrows the chart, and the in-tab decade zoom preview works without navigating away.
  await goto('timeline');
  await settle(page);
  await page.click('[data-tm="movie"]');
  await settle(page);
  const zoomOpened = await page.evaluate(async () => {
    const btn = document.querySelector('#tlChart .tlZoomBtn');
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await window.__omniSettle.whenIdle();
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
  await settle(page);

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

  // PERSONAL_PROFILE.creatorBoost matches by literal `String.includes` against a work's `creator`
  // field (recomputeTasteScores, GOAT_CREATOR_BOOST.forEach) -- there is no normalization step. A
  // corpus-side rewrite of a creator's display spelling (even one that preserves the same real
  // people, just reordered or reformatted -- e.g. a fact-harness "canonicalization") silently
  // orphans that boost with no error anywhere: the work's gm score just quietly drops. Caught live:
  // renaming "Joel & Ethan Coen" to "Ethan Coen, Joel Coen" on 10 films zeroed a +5 boost on all of
  // them with every other check still green.
  const orphanedCreatorBoosts = await page.evaluate(() =>
    (PERSONAL_PROFILE.creatorBoost || [])
      .filter(([name]) => !ALL.some(x => x.creator && x.creator.includes(name)))
      .map(([name]) => name));
  check('every creator in PERSONAL_PROFILE.creatorBoost matches at least one work',
    orphanedCreatorBoosts.length === 0, orphanedCreatorBoosts.join(', '));

  // Every gm boost must be monotonic in the field it reads: more of the quality can never earn
  // less of the boost. This is not a style preference -- the dread boost was written as a band
  // (`dread>80 && dread<=95`), so it rose to +1.5 at 95 and dropped to zero at 96, leaving the
  // sixteen most dread-soaked works in the corpus as the only ones earning nothing for it. That
  // inverts the signal precisely where it should be strongest, and nothing anywhere failed.
  //
  // Checked over the real corpus rather than with synthetic values, because the defect is only
  // visible where works actually sit on the scale.
  const boostMonotonic = await page.evaluate(() => {
    const bad = [];
    ['dread', 'myst', 'tech', 'warmth', 'comedy', 'beauty'].forEach(field => {
      const label = { dread: 'Atmospheric dread', myst: 'Ontological depth', tech: 'Technical craft',
        warmth: 'Emotional warmth', comedy: 'Comic intent', beauty: 'Aesthetic beauty' }[field];
      const got = x => {
        const b = (x.gmBoosts || []).find(e => e[1] === label);
        return b ? b[2] : 0;
      };
      // A work genuinely unscored for this construct (undefined, flagged rather than guessed at)
      // is excluded from the monotonic check entirely, same reasoning as the filter fix in
      // ledger-app.js: undefined has no defensible position on the scale, so sorting it in would
      // just be comparing "we don't know" against real values as though 0 were a real answer.
      const pts = ALL.filter(x => x[field] !== undefined).map(x => ({ v: x[field], b: got(x), t: x.title }))
        .sort((a, b) => a.v - b.v);
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].b < pts[i - 1].b - 1e-9) {
          bad.push(field + ': "' + pts[i].t + '" (' + field + ' ' + pts[i].v + ') earns ' + pts[i].b +
            ' but "' + pts[i - 1].t + '" (' + pts[i - 1].v + ') earns ' + pts[i - 1].b);
          break;
        }
      }
    });
    return bad;
  });
  check('every gm boost is monotonic in the index it reads (more of it never earns less)',
    boostMonotonic.length === 0);
  if (boostMonotonic.length) console.log('     ' + boostMonotonic.join('\n     '));

  // A recommendation is a suggestion of something you have NOT already claimed. Owned and Gold were
  // excluded; Silver and Bronze were not -- and tiering a work raises its gm toward that rung's
  // floor, so a Silver pick you don't own outranked untiered works of the same quality and got
  // handed back to you as a discovery. It never showed on Payton's profile because his Silver list
  // is nearly all also-owned, so this is tested adversarially: tier an unowned work Silver and
  // Bronze in turn and confirm it leaves the list. The corpus can't demonstrate the bug, so the
  // test builds the case that can.
  //
  // The diversity half is the other way a recommendation list fails without failing: ten films by
  // one director is a working pipeline and a useless answer.
  const recs = await page.evaluate(() => {
    if (typeof buildGeneratedRec !== 'function') return ['buildGeneratedRec is not exposed'];
    const bad = [];
    // A title is not unique across media (e.g. the 2021 film "Dune" and Frank Herbert's novel
    // "Dune" share a title) -- buildGeneratedRec itself already scopes by kind, so the victim
    // lookup below must too, or it can resolve to the wrong medium's same-titled record and tier
    // that one instead, leaving the actually-recommended work untouched and this check failing
    // for a title-collision reason that has nothing to do with whether exclusion itself works.
    const kindByCat = { Movies: 'movie', Books: 'book', 'TV Series': 'tv', 'Video Games': 'game' };
    const names = c => c.items.map(i => i.n);
    ['Movies', 'TV Series', 'Video Games', 'Books'].forEach(cat => {
      const cur = buildGeneratedRec(cat);
      if (cur.items.length < 5) { bad.push(cat + ': only ' + cur.items.length + ' recommendations'); return; }
      const listed = names(cur);
      const kind = kindByCat[cat];
      const creators = new Set(cur.items.map(i => {
        const w = ALL.find(x => x.kind === kind && x.title === i.n);
        return w ? w.creator : i.n;
      }));
      if (creators.size < 4) {
        bad.push(cat + ': ' + cur.items.length + ' recommendations from only ' + creators.size + ' creators');
      }
      // Pick a work that IS being recommended, then tier it and check it leaves.
      const victim = ALL.find(x => x.kind === kind && x.title === listed[0]);
      if (!victim) { bad.push(cat + ': cannot resolve its top recommendation "' + listed[0] + '"'); return; }
      ['silver', 'bronze'].forEach(rung => {
        victim[rung] = true;
        const after = names(buildGeneratedRec(cat));
        victim[rung] = false;
        if (after.indexOf(victim.title) >= 0) {
          bad.push(cat + ': "' + victim.title + '" is still recommended after being tiered ' + rung);
        }
      });
      if (names(buildGeneratedRec(cat)).indexOf(victim.title) < 0) {
        bad.push(cat + ': un-tiering "' + victim.title + '" did not restore it (test left state dirty)');
      }
    });
    return bad;
  });
  check('recommendations exclude everything already tiered, and span more than a few creators',
    recs.length === 0);
  if (recs.length) console.log('     ' + recs.slice(0, 6).join('\n     '));

  // Provenance must come from a per-record stamp, never from a record's ID or from whether the
  // shelf holds a copy. The app used to call a work "Verified data" if its ID fell under a
  // per-medium ceiling (m<=221, t<=144, g<=158, b<=171) or if it was owned -- so 661 works claimed
  // verified facts on the strength of having been typed in early. NOTES.md Phase 10 records
  // Casablanca and Rififi as prov:verified AND factually wrong, which is the whole problem: the
  // badge was measuring import order, not truth.
  //
  // Two things are checked. First that nothing claims verified facts without a stamp saying so --
  // no corpus record carries one yet, so today every work must read as an estimate. Second that
  // the resolver actually honours a stamp when one arrives in Phase 5, and defaults honestly when
  // the stamp is junk; that is what keeps this check meaningful after the corpus gets stamped.
  const provenance = await page.evaluate(() => {
    const bad = [];
    if (typeof provStampOf !== 'function') return ['provStampOf is not exposed'];
    ALL.forEach(x => {
      const stamped = x.provStamp && x.provStamp.facts === 'sourced';
      if (x.prov === 'verified' && !stamped) {
        bad.push('"' + x.title + '" (' + x.id + ') reads as verified with no sourced stamp');
      }
    });
    const cases = [
      [undefined, 'estimated', 'unscored'],
      [null, 'estimated', 'unscored'],
      ['sourced', 'estimated', 'unscored'],
      [{ facts: 'nonsense', indices: 'nonsense' }, 'estimated', 'unscored'],
      [{ facts: 'sourced', indices: 'rubric-v1' }, 'sourced', 'rubric-v1'],
      [{ facts: 'edition-dependent' }, 'edition-dependent', 'unscored'],
      [{ facts: 'corroborated' }, 'corroborated', 'unscored'],
    ];
    cases.forEach(c => {
      const got = provStampOf(c[0]);
      if (got.facts !== c[1] || got.indices !== c[2]) {
        bad.push('provStampOf(' + JSON.stringify(c[0]) + ') gave ' + got.facts + '/' + got.indices +
          ', expected ' + c[1] + '/' + c[2]);
      }
    });
    return bad;
  });
  check('provenance is read from a per-record stamp, not inferred from ID or ownership',
    provenance.length === 0);
  if (provenance.length) console.log('     ' + provenance.slice(0, 5).join('\n     '));

  // The tier ladder must stay a ladder at every score, not just at the scores someone spot-checked.
  // Silver > Bronze > owned has to hold across the whole 0-100 range, because the rungs are applied
  // to a work's own gm and a person's library is spread across all of it.
  //
  // This is the check for a real defect: the rungs used to blend with different weights (Silver
  // 0.45, Bronze 0.65, owned 0.5), which makes them lines of different slopes, and lines of
  // different slopes cross. Owned overtook Bronze below gm 86.7, so Bronze did nothing whatsoever
  // to anything you already owned -- which is most of what anyone tiers. Sampling one score would
  // have missed it; the crossover is what matters, so every score gets checked.
  const ladder = await page.evaluate(() => {
    if (typeof tierTarget !== 'function') return ['tierTarget is not exposed'];
    const bad = [];
    for (let gm = 0; gm <= 100; gm++) {
      const s = tierTarget(gm, 'silver'), b = tierTarget(gm, 'bronze'), o = tierTarget(gm, 'owned');
      if (!(s > b && b > o)) bad.push('gm ' + gm + ': silver ' + s + ', bronze ' + b + ', owned ' + o);
      if (s >= 100) bad.push('gm ' + gm + ': silver ' + s + ' reaches Gold, which is a pin at 100');
    }
    return bad;
  });
  check('the tier ladder holds at every score (Gold > Silver > Bronze > owned)', ladder.length === 0);
  if (ladder.length) console.log('     ' + ladder.slice(0, 5).join('\n     '));

  // Two filters pulled equally hard must count equally. The Match score used to weight each active
  // dimension by its position in activeDims() -- a hardcoded list of if-statements in source order
  // -- so ★ GOAT beat everything by being written first and Complexity came last however hard you
  // pulled it. That is an artifact of typing order silently ranking every filtered result, and it
  // penalises exactly the tastes whose dimensions happen to appear late in the list.
  //
  // Tested by symmetry rather than by asserting a number: two works identical except that their
  // values on two equally-set dimensions are swapped must score the same. That holds under any
  // sane weighting and fails under a positional one, without pinning the formula itself.
  const matchSymmetry = await page.evaluate(() => {
    if (typeof computeMatch !== 'function') return ['computeMatch is not exposed'];
    const saved = JSON.stringify(state.idx);
    try {
      Object.keys(state.idx).forEach(k => { state.idx[k] = 0; });
      state.idx.scary = 50; state.idx.funny = 50;   // pulled equally hard
      const base = ALL[0];
      const mk = (scary, funny) => Object.assign({}, base, { scary: scary, funny: funny });
      const a = mk(90, 10), b = mk(10, 90);
      computeMatch([a, b], state);
      return a._m === b._m ? []
        : ['swapping two equally-weighted dimensions changed the Match score: ' + a._m + ' vs ' + b._m];
    } finally {
      state.idx = JSON.parse(saved);
    }
  });
  check('Match weights active filters by how hard they are pulled, not by their source order',
    matchSymmetry.length === 0);
  if (matchSymmetry.length) console.log('     ' + matchSymmetry.join('\n     '));

  // A content rating must be a function of a work's content, never of its name. certify() used to
  // carry a hardcoded prefix match on six film titles alongside its dread threshold.
  //
  // Renaming the real corpus does NOT catch that, and the first version of this check did exactly
  // that and passed with the bug restored -- proving nothing. All six of those titles already
  // cleared the dread threshold, so the clause decided nothing *today*; it was a trap armed for
  // later, since it matched on PREFIX. The next "Possession of Hannah Grace" or "The Thing About
  // Pam" would inherit a rating off its first two words.
  //
  // So the adversarial case has to be built rather than looked for: take mild works, give them the
  // names of the corpus's most dread-soaked ones, and require the rating not to move. That is the
  // scenario the corpus does not contain yet and will the moment it grows.
  const titleIndependent = await page.evaluate(() => {
    if (typeof certify !== 'function') return ['certify is not exposed'];
    const screen = ALL.filter(x => x.kind === 'movie' || x.kind === 'tv');
    const byDread = screen.slice().sort((a, b) => b.dread - a.dread);
    const scaryNames = byDread.slice(0, 25).map(x => x.title);
    const mild = byDread.slice(-25);
    const bad = [];
    mild.forEach(work => {
      const own = certify(work);
      scaryNames.forEach(name => {
        const wearing = certify(Object.assign({}, work, { title: name }));
        if (wearing !== own) {
          bad.push('"' + work.title + '" (dread ' + work.dread + ') certifies ' + own +
            ' normally but ' + wearing + ' while named "' + name + '"');
        }
      });
    });
    return bad.slice(0, 8);
  });
  check('a work\'s content rating does not depend on its title', titleIndependent.length === 0);
  if (titleIndependent.length) console.log('     ' + titleIndependent.join('\n     '));

  // A game's content rating must not be derived from immersionTensionIndex. That field rides in
  // the shared `dread` slot, but RUBRIC.md construct 2 defines it as absorption -- how completely
  // a game takes you in -- explicitly NOT menace. Rating maturity from it says anything hard to
  // put down must be for adults, and it did exactly that: 71 of 258 games certified M with no
  // violent or horror genre, Outer Wilds and Return of the Obra Dinn among them.
  //
  // Tested by moving the field to both extremes and requiring the rating to hold, which is a
  // property no amount of pattern-tuning can fake, and which stays true when Phase 5 replaces
  // these inferences with real ESRB data.
  const ratingIgnoresImmersion = await page.evaluate(() => {
    if (typeof certify !== 'function') return ['certify is not exposed'];
    const bad = [];
    ALL.filter(x => x.kind === 'game').forEach(x => {
      const base = certify(x);
      [0, 50, 100].forEach(v => {
        const moved = certify(Object.assign({}, x, { dread: v }));
        if (moved !== base) {
          bad.push(x.id + ' "' + x.title + '": ' + base + ' -> ' + moved + ' when immersion = ' + v);
        }
      });
    });
    return bad.slice(0, 8);
  });
  check('a game\'s content rating ignores immersionTensionIndex (absorption is not maturity)',
    ratingIgnoresImmersion.length === 0);
  if (ratingIgnoresImmersion.length) console.log('     ' + ratingIgnoresImmersion.join('\n     '));

  // Every genre a person boosts must reach at least one work, and must count once per work.
  //
  // Both halves come from real regressions. Moving genre boosts from substring matching to the
  // declared taxonomy silently cost five works their boost -- Outer Wilds, Majora's Mask, Chrono
  // Trigger, Into the Breach and The End of Eternity -- because the boost keyword "time" is a
  // concept nothing is tagged with, and the old substring match had been catching "Time Loop" and
  // "Time Travel" by accident. Nothing errored; the scores just quietly dropped. And the defect
  // the taxonomy exists to fix was the mirror image: one tag drawing two boosts because two
  // keywords both appeared inside its name.
  const boostReach = await page.evaluate(() => {
    const bad = [];
    const boosts = (PERSONAL_PROFILE.genreBoost || []);
    boosts.forEach(([keyword]) => {
      const hits = ALL.filter(x => (x.gmBoosts || []).some(b => b[0] === 'genre' && b[1] === keyword));
      if (!hits.length) bad.push('genre boost "' + keyword + '" matches no work at all');
    });
    // Counted once: a work must never carry the same genre boost twice, however many of its tags
    // inherit from that keyword.
    ALL.forEach(x => {
      const seen = {};
      (x.gmBoosts || []).filter(b => b[0] === 'genre').forEach(b => {
        seen[b[1]] = (seen[b[1]] || 0) + 1;
        if (seen[b[1]] === 2) bad.push(x.id + ' "' + x.title + '" collects the "' + b[1] + '" boost more than once');
      });
    });
    return bad.slice(0, 8);
  });
  check('every boosted genre reaches at least one work, and counts once per work', boostReach.length === 0);
  if (boostReach.length) console.log('     ' + boostReach.join('\n     '));

  // ---- The personal taste model -------------------------------------------------------------
  //
  // The point of rating, tiering and shelving things is that the app gets better at the ~5,000
  // works you have said nothing about. For a long time it mostly did not: a rating moved that one
  // work's own score and taught the profile almost nothing, genre weights were counted rather than
  // measured (so the commonest genre in the corpus won on any profile), and creator and per-axis
  // affinity were not learned at all. Each check below pins one half of that contract, and all of
  // them build their own adversarial case rather than reading the sample profile, because the
  // sample profile cannot demonstrate a defect it does not happen to trigger.
  const tasteLearning = await page.evaluate(() => {
    if (typeof setRating !== 'function' || typeof clearRating !== 'function' || typeof tasteModel !== 'function') {
      return ['setRating/clearRating/tasteModel are not exposed'];
    }
    const bad = [];
    const virgin = ALL.filter(x => !x.owned && !x.goat && !x.silver && !x.bronze && x.myRating == null);
    const restore = [];
    const rate = (x, v) => { restore.push(x.id); setRating(x.id, v); };
    const undo = () => { restore.splice(0).forEach(id => clearRating(id)); };
    // The model keys genres by the taxonomy's own spelling ("Cosmic Horror"), because that is what
    // the UI reads them back as; a work's precomputed match keys are lowercased, because that is
    // what boost lookup needs. Resolve across the two rather than assuming either.
    const gw = k => { const m = tasteModel().genre, kk = Object.keys(m).find(x => x.toLowerCase() === k); return kk ? m[kk] : 0; };

    // Pick the genre keyword with the most never-touched works behind it, so there is both a
    // teaching set and an untouched held-out work that shares it.
    const byKey = new Map();
    virgin.forEach(x => x._gkeys.forEach(k => { (byKey.get(k) || byKey.set(k, []).get(k)).push(x); }));
    // Deliberately not the biggest group. A keyword sitting on a third of the corpus barely moves
    // when five more works vote for it (correctly -- that is the base-rate correction this model
    // exists for), so it is the wrong instrument for asking whether teaching works at all. The
    // largest group under a few dozen works is both distinctive enough to move and common enough
    // to leave a held-out work behind.
    let key = null, group = [];
    byKey.forEach((v, k) => { if (v.length >= 8 && v.length <= 60 && v.length > group.length) { key = k; group = v; } });

    if (group.length < 8) {
      bad.push('no genre keyword has 8 untouched works to teach from');
    } else {
      // (1) A rating has to generalise. Teach five, hold one out, and require the held-out work to
      //     move -- this is the whole difference between "the app remembers what I typed" and "the
      //     app learned something from it".
      const teach = group.slice(0, 5), held = group[6];
      const before = held.gm, beforeW = gw(key);
      teach.forEach(x => rate(x, 10));
      const afterOne = gw(key);
      if (!(held.gm > before)) {
        bad.push('rating five "' + key + '" works 10/10 left an untouched sixth at ' + before);
      }
      if (!(afterOne > beforeW)) bad.push('teaching five works did not raise the "' + key + '" weight');
      undo();

      // (2) Evidence has to accumulate. One favorite carrying a genre must count for less than
      //     five do -- the old model clamped at +/-15, so past about five favorites every genre
      //     hit the same ceiling and stopped distinguishing anything.
      rate(teach[0], 10);
      const w1 = gw(key);
      teach.slice(1).forEach(x => rate(x, 10));
      const w5 = gw(key);
      if (!(w5 > w1)) bad.push('five favorites in "' + key + '" weigh no more than one (' + w5 + ' vs ' + w1 + ')');
      undo();

      // (3) A rating is read against this person's own scale, not a fixed 5/10 midpoint. Rating
      //     the same works 10 must teach strictly more than rating them 7 -- under the old fixed
      //     midpoint a 7 was still a solid positive vote for every genre it touched, which is why
      //     profiles that (like most real ones) only ever rate things they chose to watch ended up
      //     boosting nearly every genre in the corpus and discriminating between none of them.
      teach.forEach(x => rate(x, 7));
      const wLow = gw(key);
      undo();
      teach.forEach(x => rate(x, 10));
      const wHigh = gw(key);
      undo();
      if (!(wHigh > wLow)) bad.push('a 7/10 teaches as much as a 10/10 in "' + key + '" (' + wLow + ' vs ' + wHigh + ')');
    }

    // (4) Creator affinity is learned from the same three signals. Tiering four Kubrick films used
    //     to teach the app nothing whatsoever about Kubrick -- only the hand-set creatorBoost list
    //     ever moved a creator, and most people will never open that control.
    const byCreator = new Map();
    virgin.forEach(x => (x._creators || []).forEach(c => { (byCreator.get(c) || byCreator.set(c, []).get(c)).push(x); }));
    let cname = null, cworks = [];
    byCreator.forEach((v, c) => { if (v.length > cworks.length) { cname = c; cworks = v; } });
    if (cworks.length >= 4) {
      const held = cworks[cworks.length - 1];
      const before = held.gm;
      cworks.slice(0, 3).forEach(x => rate(x, 10));
      const learned = tasteModel().creator[cname] || 0;
      const cited = (held.gmBoosts || []).some(b => b[0] === 'creator' && b[1] === cname);
      if (!(learned > 0)) bad.push('rating three works by ' + cname + ' taught no creator affinity');
      if (!(held.gm > before)) bad.push('a fourth ' + cname + ' work did not move after three were rated 10');
      if (!cited) bad.push('the fourth ' + cname + ' work does not name the creator among its reasons');
      undo();
    }

    // (5) Disliking has to be expressible. Every weight the old model could produce from a rating
    //     was positive for anything at or above 5/10, so "I have rated eleven comedies and did not
    //     care for any of them" was information the engine had no way to hold.
    const model = tasteModel();
    if (!Object.keys(model.genre).some(k => model.genre[k] < 0)) {
      bad.push('no genre can ever carry a negative weight');
    }
    // (6) The per-axis multipliers stay inside their declared band and are exactly neutral where
    //     there is no evidence -- they scale a boost, so a value at or below zero would invert it
    //     and break the monotonicity the check above guarantees.
    Object.keys(model.axisMul).forEach(f => {
      const v = model.axisMul[f];
      if (!(v >= 0.4 - 1e-9 && v <= 1.6 + 1e-9)) bad.push('axis multiplier ' + f + ' = ' + v + ' is outside 0.4-1.6');
    });
    return bad;
  });
  check('ratings, tiers and ownership teach the profile, not just their own work\'s score',
    tasteLearning.length === 0);
  if (tasteLearning.length) console.log('     ' + tasteLearning.join('\n     '));

  // The score bands have to mean something, and keep meaning it as the corpus grows. "Anything in
  // the nineties is a strong, strong match" is a claim about the distribution, and an additive
  // formula with a clamp cannot hold it: raise the weight of the personal half (which is the whole
  // point of a personal score) and works pile against the 99 ceiling, losing exactly the
  // differentiation at the top the number exists for. Asserted as a proportion rather than a count
  // so it stays true at 5,000 works and at 50,000.
  const bands = await page.evaluate(() => {
    const n = ALL.length;
    const at = lo => ALL.filter(x => x.gm >= lo).length;
    return { n: n, ninety: at(90), ninetyfive: at(95), floor: at(41), median: ALL.map(x => x.gm).sort((a, b) => a - b)[Math.floor(n / 2)] };
  });
  check('the nineties are the top few percent of matches, not a third of the library',
    bands.ninety > 0 && bands.ninety / bands.n <= 0.07 && bands.ninetyfive / bands.n <= 0.025,
    bands.ninety + ' of ' + bands.n + ' at 90+, ' + bands.ninetyfive + ' at 95+');
  check('the scale still uses its whole range rather than bunching at the top',
    bands.median >= 55 && bands.median <= 80, 'median ' + bands.median);

  // Every filter is a question. Narrowing to Scariest >= 80 found the right 300 works and then
  // ordered them by overall critical standing -- the one thing the person had just said was not
  // what they were asking. computeMatch() had been running on the filtered list before every sort
  // for as long as it has existed; nothing read the number it produced.
  const filterAnswered = await page.evaluate(() => {
    const bad = [];
    if (!SORTS.match) return ['there is no sort that reads the Match score'];
    const saved = { sort: state.sort, idx: JSON.stringify(state.idx) };
    try {
      Object.keys(state.idx).forEach(k => { state.idx[k] = 0; });
      state.sort = 'overall';
      state.idx.scary = 60;
      if (typeof maybeAutoSort === 'function') maybeAutoSort();
      const list = filtered();
      if (list.length < 20) return ['not enough works clear Scariest >= 60 to test the ordering'];
      computeMatch(list, state);
      const ranked = list.slice().sort(SORTS.match);
      const headScary = ranked.slice(0, 10).reduce((s, x) => s + x.scary, 0) / 10;
      const tailScary = ranked.slice(-10).reduce((s, x) => s + x.scary, 0) / 10;
      if (!(headScary > tailScary)) {
        bad.push('sorting by Match put works averaging ' + headScary.toFixed(1) + ' Scariest above ones averaging ' + tailScary.toFixed(1));
      }
    } finally {
      state.sort = saved.sort; state.idx = JSON.parse(saved.idx);
    }
    return bad;
  });
  check('a pulled slider is answered by the ordering, not only by the filter',
    filterAnswered.length === 0);
  if (filterAnswered.length) console.log('     ' + filterAnswered.join('\n     '));

  // A rating can only be given after finishing something, so a rated work is no more a discovery
  // than an owned or tiered one -- and the rating blend pulls anything you loved straight to the
  // top of the very list that is supposed to show you what is next.
  const recsExcludeRated = await page.evaluate(() => {
    const kindByCat = { Movies: 'movie', Books: 'book', 'TV Series': 'tv', 'Video Games': 'game' };
    const bad = [];
    Object.keys(kindByCat).forEach(cat => {
      const kind = kindByCat[cat];
      const victim = buildGeneratedRec(cat).items[0];
      const work = victim && ALL.find(x => x.kind === kind && x.title === victim.n);
      if (!work) { bad.push(cat + ': cannot resolve its top recommendation'); return; }
      setRating(work.id, 9.5);
      const after = buildGeneratedRec(cat).items.map(i => i.n);
      clearRating(work.id);
      if (after.indexOf(work.title) >= 0) bad.push(cat + ': "' + work.title + '" is still recommended after being rated 9.5');
    });
    return bad;
  });
  check('a work you have already rated is not handed back as a recommendation',
    recsExcludeRated.length === 0);
  if (recsExcludeRated.length) console.log('     ' + recsExcludeRated.join('\n     '));


  // URL bookmarking: filters set across three different tabs all round-trip through a fresh load.
  await goto('timeline');
  const bookmarkUrl = page.url();
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page2.route('**/supabase-js*/**', route => route.abort());
  const page2Errors = [];
  page2.on('pageerror', e => page2Errors.push(e.message));
  await page2.goto(bookmarkUrl);
  await waitForBoot(page2);
  await settle(page2);
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

// Boot a fresh page on the PK Sample, local-only, and wait until the result grid is drawn.
async function bootSample(browser, file, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1400, height: 1000 } });
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
  await waitForBoot(page);
  const gate = await page.evaluate(() => { const g = document.getElementById('onboardGate'); return !!g && !g.classList.contains('hidden'); });
  if (gate) { await page.click('#onboardSample'); await waitForBoot(page); }
  await firstCardId(page);
  return { page, pageErrors };
}
const readWL = (page, id) => page.evaluate((i) => {
  try { return JSON.parse(localStorage.getItem('omniLedgerWatchlist') || '{}')[i] || null; } catch (e) { return null; }
}, id);

// Completed (watched / read / played): marked from any card, filed under the Watchlist tab's
// Completed section, filterable in the Global Controller, and kept out of every "what next" list.
async function runCompletedFlow(browser, file) {
  const { page, pageErrors } = await bootSample(browser, file);

  // An untouched title: not on the watchlist, not owned, not tiered.
  const id = await page.evaluate(() => {
    const WLraw = JSON.parse(localStorage.getItem('omniLedgerWatchlist') || '{}');
    const seg = Array.from(document.querySelectorAll('#grid .doneSeg')).find(b => {
      const x = window.byId.get(b.dataset.id);
      return x && !x.owned && !x.goat && !x.silver && !x.bronze && !WLraw[x.id];
    });
    return seg ? seg.dataset.id : null;
  });
  check('every result card has a Watched / Read / Played button', !!id);
  if (!id) { await page.close(); return; }
  const revBefore = await page.evaluate(() => window.__omniProfileRevision || 0);

  await page.click('#grid .doneSeg[data-id="' + id + '"]');
  const marked = await readWhen(page, (i) => {
    const seg = document.querySelector('#grid .doneSeg[data-id="' + i + '"]');
    const corner = document.querySelector('#grid .wlBtn[data-wl="' + i + '"]');
    return seg && seg.getAttribute('aria-pressed') === 'true' && corner && corner.textContent === '✓'
      ? { toast: !!document.querySelector('#appToast.show'), toastText: document.querySelector('#appToast').textContent } : false;
  }, id, 5000);
  check('marking a card completed flips its button and its corner to ✓, in place', !!marked);
  check('marking a card completed shows a confirmation that says where it went, with Undo',
    !!marked && marked.toast && /Completed/.test(marked.toastText) && /Undo/.test(marked.toastText));
  const entry = await readWL(page, id);
  check('a completion from a card is saved as a dated, log-only watchlist entry',
    !!entry && entry.watched === true && entry.logOnly === true && typeof entry.doneAt === 'number');
  check('marking something completed does not re-run the taste scoring pass',
    (await page.evaluate(() => window.__omniProfileRevision || 0)) === revBefore);
  check('the Watchlist nav count counts Up Next only, not the Completed history',
    await page.evaluate(() => !/\(\d+\)/.test(document.getElementById('wlNavCount').textContent) || !!Object.values(JSON.parse(localStorage.getItem('omniLedgerWatchlist'))).some(e => !e.watched)));

  // Undo from the toast removes a log-only entry entirely.
  await page.click('#appToast [data-toast="undo"]');
  await settle(page);
  check('Undo on the toast forgets a completion that was never queued', (await readWL(page, id)) === null);
  check('after Undo the card is back to an empty heart',
    await page.evaluate((i) => document.querySelector('#grid .wlBtn[data-wl="' + i + '"]').textContent === '♡', id));

  // Queued first, then completed: undoing puts it back in Up Next rather than dropping it.
  await page.click('#grid .wlBtn[data-wl="' + id + '"]');
  await page.click('#grid .doneSeg[data-id="' + id + '"]');
  await settle(page);
  const queuedDone = await readWL(page, id);
  check('completing a queued title keeps it (not log-only) and stamps a date',
    !!queuedDone && queuedDone.watched === true && !queuedDone.logOnly && typeof queuedDone.doneAt === 'number');
  await page.click('#grid .wlBtn[data-wl="' + id + '"]'); // the corner now shows ✓ and undoes it
  await settle(page);
  const backToQueue = await readWL(page, id);
  check('undoing a completed title that was queued returns it to Up Next',
    !!backToQueue && backToQueue.watched === false && !('doneAt' in backToQueue) &&
    await page.evaluate((i) => document.querySelector('#grid .wlBtn[data-wl="' + i + '"]').textContent === '♥', id));
  await page.click('#grid .doneSeg[data-id="' + id + '"]');

  // Global Controller filters.
  await page.check('#notDoneToggle');
  check('"Not yet" hides completed titles from the results',
    await readWhen(page, (i) => !document.querySelector('#grid .cardHead[data-id="' + i + '"]'), id, 5000));
  await page.check('#doneToggle');
  const doneOnly = await readWhen(page, () => {
    const ids = Array.from(document.querySelectorAll('#grid .cardHead')).map(h => h.dataset.id);
    const wl = JSON.parse(localStorage.getItem('omniLedgerWatchlist') || '{}');
    return ids.length && ids.every(i => wl[i] && wl[i].watched) ? ids : false;
  }, undefined, 5000);
  check('"Watched / read / played" shows only completed titles', !!doneOnly && doneOnly.includes(id));
  check('the two completed filters are mutually exclusive',
    await page.evaluate(() => !document.getElementById('notDoneToggle').checked && window.state.doneOnly && !window.state.notDoneOnly));
  check('the completed filter appears as a removable active-filter chip',
    await page.evaluate(() => !!document.querySelector('#activeBar .activeChip[data-clr="done"]')));
  const urlHasDone = await readWhen(page, () => /[?&]done=1/.test(location.search), undefined, 3000);
  check('the completed filter is kept in the URL, so a bookmark restores it', !!urlHasDone);
  await page.click('#activeBar #clearAllF');
  await settle(page);
  check('Clear all resets the completed filters',
    await page.evaluate(() => !window.state.doneOnly && !window.state.notDoneOnly && !document.getElementById('doneToggle').checked));

  // Best Untried Matches: nothing already finished, owned, tiered or rated.
  await page.click('#discoverBtn');
  check('Best Untried Matches also excludes anything completed',
    await readWhen(page, (i) => window.state.notDoneOnly && !document.querySelector('#grid .cardHead[data-id="' + i + '"]'), id, 5000));
  check('Best Untried Matches shows only unrated, unowned, untiered, unfinished works, with every box it set ticked',
    await page.evaluate(() => {
      const wl = JSON.parse(localStorage.getItem('omniLedgerWatchlist') || '{}');
      const ids = Array.from(document.querySelectorAll('#grid .cardHead')).map(h => h.dataset.id);
      return ids.length > 0 && ids.every(i => { const x = window.byId.get(i); return x && x.myRating == null && !x.owned && !x.goat && !x.silver && !x.bronze && !(wl[i] && wl[i].watched); }) &&
        ['notOwnedToggle', 'notDoneToggle', 'unratedToggle'].every(t => document.getElementById(t).checked);
    }));
  await page.click('#discoverBtn');
  check('the shared "untried" test (Surprise Me\u2019s Discover pool) leaves out tiered and rated works',
    await page.evaluate(() => window.ALL.filter(x => x.goat || x.myRating != null).every(x => !window.isUntried(x))));
  check('turning Best Untried Matches off clears what it switched on',
    await page.evaluate(() => !window.state.notOwnedOnly && !window.state.notDoneOnly && !window.state.unratedOnly && !document.getElementById('unratedToggle').checked));

  // Recommendations never hand back something already finished.
  const topRec = await page.evaluate(() => {
    const rec = window.buildGeneratedRec('Movies');
    const top = rec.items[0] && window.ALL.find(x => x.kind === 'movie' && x.title === rec.items[0].n);
    if (!top) return null;
    window.state.q = top.title; document.getElementById('q').value = top.title; window.refresh();
    return { id: top.id, title: top.title };
  });
  let recGone = null;
  if (topRec) {
    await page.click('#grid .doneSeg[data-id="' + topRec.id + '"]');
    await settle(page);
    recGone = await page.evaluate((t) => !window.buildGeneratedRec('Movies').items.some(i => i.n === t), topRec.title);
    await page.evaluate(() => { window.state.q = ''; document.getElementById('q').value = ''; window.refresh(); });
  }
  check('marking the top movie recommendation completed removes it from the GOAT recommendations', recGone === true);

  // Watchlist tab: Completed section, dated, date editable, sorted by completion.
  await page.evaluate(() => window.switchView('watchlist'));
  await page.click('#wlFilter button[data-wf="done"]');
  const wlDone = await readWhen(page, (i) => {
    const row = document.querySelector('#wlGrid .wlItem[data-id="' + i + '"]');
    const input = row && row.querySelector('.wlDoneDate');
    return row && input ? { value: input.value, label: document.querySelector('#wlFilter button[data-wf="done"]').textContent } : false;
  }, id, 5000);
  check('a completed title appears in the Watchlist tab’s Completed section with its date',
    !!wlDone && /^\d{4}-\d{2}-\d{2}$/.test(wlDone.value) && /^Completed \(\d+\)$/.test(wlDone.label));
  await page.fill('#wlGrid .wlItem[data-id="' + id + '"] .wlDoneDate', '2019-06-15');
  await page.dispatchEvent('#wlGrid .wlItem[data-id="' + id + '"] .wlDoneDate', 'change');
  await settle(page);
  const edited = await readWL(page, id);
  check('the completion date can be changed for something logged after the fact',
    !!edited && new Date(edited.doneAt).getFullYear() === 2019 && new Date(edited.doneAt).getMonth() === 5 && new Date(edited.doneAt).getDate() === 15);
  check('Watchlist recommendations never include owned, tiered or already-saved titles',
    await page.evaluate(() => Array.from(document.querySelectorAll('#wlRecs .wlAdd')).every(b => {
      const x = window.byId.get(b.dataset.id);
      return x && !x.owned && !x.goat && !x.silver && !x.bronze && x.myRating == null;
    })));

  // Survives a reload; the Timeline can show just what you have finished.
  await page.reload();
  await waitForBoot(page);
  check('completed state survives a reload', !!(await readWL(page, id)) && (await readWL(page, id)).watched === true);
  await page.evaluate(() => window.switchView('timeline'));
  await page.click('#tlScope button[data-t="done"]');
  check('the Timeline has a Completed scope counting finished titles',
    await readWhen(page, () => {
      const first = document.querySelector('#tlStats .panel');
      return !!first && /Completed works/i.test(first.textContent) && parseInt(first.textContent, 10) > 0;
    }, undefined, 5000));

  // Phone width: the tier row, now five segments long, still fits on one line -- including the
  // widest one it gets: a film or series ("✓ Watched" is the longest of Watched / Read / Played)
  // that you have rated 10, so the last segment reads "★ 10.0" instead of a bare ☆. Rate one here
  // rather than rely on the PK Sample happening to put such a title near the top.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => window.switchView('controller'));
  await firstCardId(page);
  const ratedId = await page.evaluate(() => {
    const seg = Array.from(document.querySelectorAll('#grid .doneSeg')).slice(0, 20).find(b => /Watched/.test(b.textContent));
    return seg ? seg.dataset.id : null;
  });
  if (ratedId) { await page.evaluate((i) => window.setRating(i, 10), ratedId); await settle(page); }
  await firstCardId(page);
  const rows360 = await page.evaluate((i) => {
    const rows = Array.from(document.querySelectorAll('#grid .tierRow')).slice(0, 20);
    return {
      wrapped: rows.filter(r => {
        const tops = Array.from(r.children).map(c => Math.round(c.getBoundingClientRect().top));
        return Math.max.apply(null, tops) - Math.min.apply(null, tops) > 4;
      }).length,
      rated: rows.some(r => /10\.0/.test((r.querySelector('.rateBtn.rated[data-id="' + i + '"]') || {}).textContent || '')),
    };
  }, ratedId);
  check('the card tier row stays on one line on a 360px phone, a rated title\'s included',
    rows360.wrapped === 0 && rows360.rated);

  await page.close();
  check('no uncaught page errors during the completed flow', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

// Franchise / series vs. standalone: a mutually exclusive pair of Global Controller filters, kept
// in the URL and the active-filter bar like the other pairs. Membership comes from the curated
// series, title-root matching and a hand-checked list for sequels and spin-offs whose titles share
// nothing, so one of each is checked by name.
async function runFranchiseFilterFlow(browser, file) {
  const { page, pageErrors } = await bootSample(browser, file);

  // The top filter row on desktop: search, media type, platform and Reset share one top edge and
  // one height, with every label on a single line, at the narrowest desktop width and a wide one.
  for (const w of [1024, 1400]) {
    await page.setViewportSize({ width: w, height: 1000 });
    const row = await page.evaluate(() => {
      const r = ['q', 'typeSeg', 'platField', 'resetBtn'].map(id => document.getElementById(id).getBoundingClientRect());
      const labels = Array.from(document.querySelectorAll('#topFilterRow .fieldlbl')).map(l => l.getBoundingClientRect().height);
      return { tops: r.map(x => Math.round(x.top)), heights: r.map(x => Math.round(x.height)), labels };
    });
    check('at ' + w + 'px the top filter row lines up: one top edge, one height, one-line labels',
      new Set(row.tops).size === 1 && new Set(row.heights).size === 1 && row.labels.every(h => h < 20));
  }

  await page.check('#franchiseToggle');
  const franchiseIds = await readWhen(page, () => {
    const ids = Array.from(document.querySelectorAll('#grid .cardHead')).map(h => h.dataset.id);
    return window.state.franchiseOnly && ids.length && ids.every(i => window.inFranchise(window.byId.get(i))) ? ids : false;
  }, undefined, 5000);
  check('"Franchise / series" shows only works that belong to a franchise', !!franchiseIds);
  check('the franchise filter appears as a removable active-filter chip',
    await page.evaluate(() => !!document.querySelector('#activeBar .activeChip[data-clr="franchise"]')));
  check('Reset Filters turns solid red with a count while a filter is on',
    !!await readWhen(page, () => { const b = document.getElementById('resetBtn'); return b.classList.contains('hasFilters') && document.getElementById('resetCount').textContent === '1' && !document.getElementById('resetCount').hidden; }, undefined, 3000));
  check('the franchise filter is kept in the URL',
    !!await readWhen(page, () => /[?&]franchise=1/.test(location.search), undefined, 3000));

  await page.check('#standaloneToggle');
  const standaloneIds = await readWhen(page, () => {
    const ids = Array.from(document.querySelectorAll('#grid .cardHead')).map(h => h.dataset.id);
    return window.state.standaloneOnly && ids.length && ids.every(i => !window.inFranchise(window.byId.get(i))) ? ids : false;
  }, undefined, 5000);
  check('"Standalone only" shows only works outside any franchise', !!standaloneIds);
  check('the two franchise filters are mutually exclusive',
    await page.evaluate(() => !document.getElementById('franchiseToggle').checked && !window.state.franchiseOnly));
  check('no standalone result carries a franchise badge',
    await page.evaluate(() => !document.querySelector('#grid .franchiseChip')));
  check('the corpus splits into both franchise and standalone works',
    await page.evaluate(() => {
      const all = window.ALL.length, fr = window.ALL.filter(x => window.inFranchise(x)).length;
      return fr > 0 && fr < all;
    }));

  // A spin-off and a sequel whose titles share nothing with their series, the film a curated series
  // is named for, and a one-off, each checked by name.
  const named = await page.evaluate(() => {
    const find = (kind, title) => window.ALL.find(x => x.kind === kind && x.title === title);
    const f = x => !!x && window.inFranchise(x);
    return {
      saul: f(find('tv', 'Better Call Saul')),
      words: f(find('book', 'Words of Radiance')),
      matrix: f(find('movie', 'The Matrix')),
      parasite: !!find('movie', 'Parasite') && !f(find('movie', 'Parasite')),
    };
  });
  check('a spin-off with an unrelated title (Better Call Saul) counts as franchise', named.saul);
  check('a sequel with an unrelated title (Words of Radiance) counts as franchise', named.words);
  check('the film a curated series is named for (The Matrix) counts as franchise', named.matrix);
  check('a one-off (Parasite) counts as standalone', named.parasite);

  await page.fill('#q', 'Better Call Saul');
  check('Standalone only hides a spin-off even when searched for by name',
    await readWhen(page, () => window.state.q === 'Better Call Saul' && !document.querySelector('#grid .cardHead'), undefined, 5000));
  await page.check('#franchiseToggle');
  check('Franchise / series shows that spin-off',
    !!await readWhen(page, () => {
      const t = Array.from(document.querySelectorAll('#grid .cardTitle')).map(e => e.textContent);
      return t.includes('Better Call Saul') ? t : false;
    }, undefined, 5000));

  await page.click('#activeBar #clearAllF');
  await settle(page);
  check('with nothing filtered, Reset Filters goes back to its outlined look with no count',
    await page.evaluate(() => !document.getElementById('resetBtn').classList.contains('hasFilters') && document.getElementById('resetCount').hidden));
  check('Clear all resets the franchise filters',
    await page.evaluate(() => !window.state.franchiseOnly && !window.state.standaloneOnly &&
      !document.getElementById('franchiseToggle').checked && !document.getElementById('standaloneToggle').checked));
  await page.close();

  // A bookmark restores the filter, box ticked.
  const url = 'file://' + path.join(ROOT, file) + '?standalone=1';
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page2.route('**/supabase-js*/**', route => route.abort());
  page2.on('pageerror', e => pageErrors.push(e.message));
  await page2.goto(url);
  await waitForBoot(page2);
  check('a ?standalone=1 bookmark restores the filter with its box ticked',
    !!await readWhen(page2, () => window.state && window.state.standaloneOnly && document.getElementById('standaloneToggle').checked, undefined, 5000));

  // On desktop every toggle pair stacks, the opposite option directly under the one it answers.
  const stacked = await page2.evaluate(() => ['ownershipToggleGroup', 'doneToggleGroup', 'ratingToggleGroup', 'franchiseToggleGroup'].every(id => {
    const ls = document.getElementById(id).querySelectorAll('label');
    const a = ls[0].getBoundingClientRect(), b = ls[1].getBoundingClientRect();
    return Math.abs(a.left - b.left) < 2 && b.top >= a.bottom - 1;
  }));
  check('on desktop each toggle pair stacks, the opposite option right under its partner', stacked);

  // On a phone the pair is one card, like Owned / Not owned, with both labels on the same row.
  await page2.setViewportSize({ width: 360, height: 800 });
  const phone = await readWhen(page2, () => {
    const g = document.getElementById('franchiseToggleGroup');
    if (!g) return false;
    const ls = g.querySelectorAll('label');
    const a = ls[0].getBoundingClientRect(), b = ls[1].getBoundingClientRect(), r = g.getBoundingClientRect();
    return { card: getComputedStyle(g).borderTopStyle === 'solid', sameRow: Math.abs(a.top - b.top) < 4,
      fits: r.right <= document.documentElement.clientWidth + 0.5 };
  }, undefined, 5000);
  check('on a phone the franchise pair is one bordered card, both options on one row, no overflow',
    !!phone && phone.card && phone.sameRow && phone.fits);
  await page2.close();

  check('no uncaught page errors during the franchise filter flow', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

// Remembering filters: a refresh keeps them (the URL), a fresh open starts clean but offers the
// last set back as one chip, and the Show count is remembered outright.
async function runRestoreFiltersFlow(browser, file) {
  const { page, pageErrors } = await bootSample(browser, file);
  const bare = 'file://' + path.join(ROOT, file);
  const openFresh = async (url) => { await page.goto(url || bare); await waitForBoot(page); await firstCardId(page); };
  const saved = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('omniLedgerLastFilters')); } catch (e) { return null; } });
  const offerShown = () => page.evaluate(() => !!document.getElementById('restoreFilters'));

  await page.check('#standaloneToggle');
  await page.check('#notOwnedToggle');
  check('the last set of filters is saved on this device as it changes',
    !!await readWhen(page, () => { const v = localStorage.getItem('omniLedgerLastFilters'); return v && /standalone=1/.test(v) && /notowned=1/.test(v) ? v : false; }, undefined, 5000));
  await page.selectOption('#limitSel', '250');
  check('the Show count is saved as a preference',
    !!await readWhen(page, () => localStorage.getItem('omniLedgerShowLimit') === '250', undefined, 3000));

  await openFresh();
  check('a fresh open starts with no filters applied',
    await page.evaluate(() => !window.state.standaloneOnly && !window.state.notOwnedOnly && !document.getElementById('standaloneToggle').checked));
  check('a fresh open offers the last filters back as one chip, labelled with what they were',
    !!await readWhen(page, () => { const b = document.getElementById('restoreFilters'); return b && /Standalone only/.test(b.title) && /Not owned/.test(b.title); }, undefined, 5000));
  check('a fresh open keeps the remembered Show count',
    await page.evaluate(() => window.state.limit === 250 && document.getElementById('limitSel').value === '250'));

  await openFresh();
  check('the offer survives another fresh open that did nothing (starting clean does not erase it)', await offerShown());

  await page.click('#restoreFilters');
  check('Restore puts every saved filter back, boxes ticked, as active chips',
    !!await readWhen(page, () => window.state.standaloneOnly && window.state.notOwnedOnly &&
      document.getElementById('standaloneToggle').checked && document.getElementById('notOwnedToggle').checked &&
      !document.getElementById('restoreFilters') && !!document.querySelector('#activeBar .activeChip[data-clr="standalone"]'), undefined, 5000));

  check('restored filters are written back into the URL',
    !!await readWhen(page, () => /standalone=1/.test(location.search) && /notowned=1/.test(location.search), undefined, 5000));
  await page.reload();
  await waitForBoot(page); await firstCardId(page);
  check('a refresh keeps the filters and offers nothing',
    await page.evaluate(() => window.state.standaloneOnly && !document.getElementById('restoreFilters')));

  await page.click('#activeBar #clearAllF');
  check('Clear all forgets the saved filters', !!await readWhen(page, () => localStorage.getItem('omniLedgerLastFilters') === null, undefined, 5000));
  await openFresh();
  check('after Clear all, a fresh open offers nothing', !await offerShown());

  await page.check('#franchiseToggle');
  await readWhen(page, () => /franchise=1/.test(localStorage.getItem('omniLedgerLastFilters') || ''), undefined, 5000);
  await openFresh();
  await page.click('#forgetFilters');
  check('✕ forgets the offer and the saved filters', !await offerShown() && (await saved()) === null);
  await openFresh();
  check('once forgotten, a fresh open offers nothing', !await offerShown());

  await page.check('#franchiseToggle');
  await readWhen(page, () => /franchise=1/.test(localStorage.getItem('omniLedgerLastFilters') || ''), undefined, 5000);
  await openFresh();
  await page.check('#ratedToggle');
  check('starting a new set of filters retires the offer and replaces what was saved',
    !!await readWhen(page, () => { const v = localStorage.getItem('omniLedgerLastFilters') || ''; return !document.getElementById('restoreFilters') && /rated=1/.test(v) && !/franchise=1/.test(v); }, undefined, 5000));

  const plant = (o) => page.evaluate((o) => localStorage.setItem('omniLedgerLastFilters', JSON.stringify(o)), o);
  await page.click('#activeBar #clearAllF');
  await readWhen(page, () => localStorage.getItem('omniLedgerLastFilters') === null, undefined, 5000);
  await plant({ qs: 'franchise=1', at: Date.now() - 8 * 24 * 3600 * 1000, handle: '' });
  await openFresh();
  check('filters saved more than a week ago are not offered, and are dropped', !await offerShown() && (await saved()) === null);

  await plant({ qs: 'franchise=1', at: Date.now(), handle: 'someone-else' });
  await openFresh();
  check('filters saved under another account are never offered', !await offerShown());

  await plant({ qs: 'franchise=1', at: Date.now(), handle: '' });
  await openFresh(bare + '?standalone=1');
  check('arriving with filters in the link applies those and offers nothing',
    await page.evaluate(() => window.state.standaloneOnly && !window.state.franchiseOnly && !document.getElementById('restoreFilters')));

  // A long saved set on a narrow phone: the chip truncates, its ✕ stays beside it, nothing overflows.
  await plant({ qs: 'q=space&notowned=1&notdone=1&standalone=1&unrated=1&g=Sci-Fi', at: Date.now(), handle: '' });
  await page.setViewportSize({ width: 320, height: 800 });
  await openFresh();
  const fit = await readWhen(page, () => {
    const o = document.getElementById('restoreOffer'), r = document.getElementById('restoreFilters'), x = document.getElementById('forgetFilters');
    if (!o) return false;
    const a = r.getBoundingClientRect(), b = x.getBoundingClientRect();
    return { fits: o.getBoundingClientRect().right <= document.documentElement.clientWidth + 0.5, sameRow: Math.abs(a.top - b.top) < 3,
      more: /\+\d/.test(r.textContent), barFits: (b => b.scrollWidth <= b.clientWidth)(document.getElementById('activeBar')) };
  }, undefined, 5000);
  check('on a 320px phone the offer fits on one line with its ✕, showing how many more it holds',
    !!fit && fit.fits && fit.sameRow && fit.more && fit.barFits);

  await page.close();
  check('no uncaught page errors during the restore-filters flow', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

// Clicks got cheaper by memoizing the per-card corpus scans and building a card's hidden panels
// only when it is opened. Both are only acceptable if nothing a person can see changed, so both
// are held to the originals here: the lookups against the full-scan implementations they replaced,
// across the entire corpus, before and after a profile edit.
async function runRenderPerfFlow(browser, file) {
  const { page, pageErrors } = await bootSample(browser, file);

  // Tabs nobody has opened are not built at boot: applyStateToStaticControls marks them stale and
  // switchView draws each the first time it is opened. They used to be drawn on every load, twice
  // over -- Reference Matrices alone was ~56,000 of the page's ~72,000 elements, all hidden.
  const LAZY_TABS = { matrix: '#matrixWrap', creators: '#creatorGrid', contenders: '#contenderGrid', goat: '#goatRecs' };
  const builtAtBoot = await page.evaluate(tabs => ({
    view: window.state.view,
    sizes: Object.keys(tabs).map(v => document.querySelectorAll(tabs[v] + ' *').length),
    total: document.getElementsByTagName('*').length,
  }), LAZY_TABS);
  check('hidden tabs are not built at boot (Matrices, Creators, Contenders, GOAT Profile)',
    builtAtBoot.view === 'controller' && builtAtBoot.sizes.every(n => n === 0));
  console.log('     (' + builtAtBoot.total + ' elements on the page after boot)');
  const builtOnOpen = [];
  for (const v of Object.keys(LAZY_TABS)) {
    await page.evaluate(vv => document.querySelector('#nav .navBtn[data-view="' + vv + '"]').click(), v);
    await settle(page);
    builtOnOpen.push(await page.evaluate(sel => document.querySelectorAll(sel + ' *').length, LAZY_TABS[v]));
  }
  check('each of them is built the first time it is opened', builtOnOpen.every(n => n > 0));
  await page.evaluate(() => document.querySelector('#nav .navBtn[data-view="controller"]').click());
  await settle(page);

  const compare = () => page.evaluate(() => {
    const ALL = window.ALL;
    const rank = x => x.goat ? 4 : x.silver ? 3 : x.bronze ? 2 : x.myRating != null ? 1 : 0;
    const bestAnchor = c => c.length ? c.slice().sort((a, b) => (rank(b) - rank(a)) || (b.gm - a.gm))[0] : null;
    const anchorPhrase = ex => ex.goat ? ('one of your Gold favorites, ' + esc(ex.title)) : ex.silver ? ('your Silver favorite ' + esc(ex.title)) : ex.bronze ? ('your Bronze pick ' + esc(ex.title)) : ex.myRating != null ? ('you rated ' + esc(ex.title) + ' ' + (+ex.myRating.toFixed(1)) + '/10') : ('you own ' + esc(ex.title));
    // Tiered, rated 7+, or owned and not rated below 7.
    const sig = x => x.goat || x.silver || x.bronze || (x.myRating != null ? x.myRating >= 7 : x.owned);
    // Rated, tiered or finished: never offered as a companion.
    const been = x => x.goat || x.silver || x.bronze || x.myRating != null || window.wlDone(x.id);
    // Full-scan implementations of the same rules, the memoized ones are held to.
    function whyRef(it) {
      if (it.owned || it.goat || it.silver || it.bronze || it.myRating != null) return '';
      if (it.creator) {
        const ex = bestAnchor(ALL.filter(x => sig(x) && x.creator && x.creator === it.creator && x.id !== it.id));
        if (ex) { const noun = it.kind === 'book' ? 'author' : (it.kind === 'game' ? 'studio' : 'director'); return 'Because ' + anchorPhrase(ex) + ' — same ' + noun + '.'; }
      }
      const fams = it.fam || [];
      if (fams.length) {
        const e1 = bestAnchor(ALL.filter(x => sig(x) && x.kind === it.kind && (x.fam || []).some(f => fams.includes(f))));
        if (e1) { const sf = fams.find(f => (e1.fam || []).includes(f)) || fams[0]; return 'Because ' + anchorPhrase(e1) + ' — shares your taste for ' + esc(sf) + '.'; }
        const e2 = bestAnchor(ALL.filter(x => sig(x) && (x.fam || []).some(f => fams.includes(f))));
        if (e2) { const sf = fams.find(f => (e2.fam || []).includes(f)) || fams[0]; return 'Matches your ' + esc(sf) + ' taste (' + anchorPhrase(e2) + ').'; }
      }
      if (it.vibe) { const ex = bestAnchor(ALL.filter(x => sig(x) && x.vibe === it.vibe)); if (ex) return 'Same mood as ' + esc(ex.title) + ' (' + esc(it.vibe) + ').'; }
      return '';
    }
    function threadRef(it) {
      const others = ALL.filter(x => x.kind !== it.kind && x.id !== it.id && !been(x));
      if (it.creator) { const s = others.filter(x => x.creator && x.creator === it.creator).sort((a, b) => b.gm - a.gm); if (s.length) return s[0].id; }
      const fams = it.fam || [];
      if (fams.length) { const s = others.filter(x => (x.fam || []).some(f => fams.includes(f))); if (s.length) { s.sort((a, b) => (b.gm + b.ovr) - (a.gm + a.ovr)); return s[0].id; } }
      if (it.vibe) { const s = others.filter(x => x.vibe === it.vibe).sort((a, b) => b.gm - a.gm); if (s.length) return s[0].id; }
      return null;
    }
    function pairRef(it, n) {
      return ALL.filter(x => x.kind !== it.kind && !been(x)).map(x => {
        const shared = (it.genres || []).filter(g => (x.genres || []).indexOf(g) >= 0).length;
        const vibeMatch = (it.vibe && x.vibe === it.vibe) ? 1 : 0;
        return { x, shared, vibeMatch, score: shared * 10 + vibeMatch * 8 + x.gm * 0.15 };
      }).filter(s => s.shared > 0 || s.vibeMatch).sort((a, b) => b.score - a.score).slice(0, n);
    }
    const fmt = a => a.map(s => s.x.id + ':' + s.shared + ':' + s.vibeMatch + ':' + s.score).join(',');
    const bad = [];
    ALL.forEach(it => {
      if (whyRef(it) !== window.whyRecommended(it)) bad.push('why:' + it.id);
      const t = window.crossThread(it);
      if (threadRef(it) !== (t ? t.it.id : null)) bad.push('thread:' + it.id);
      if (fmt(pairRef(it, 3)) !== fmt(window.crossMediumPairings(it, 3))) bad.push('pairs:' + it.id);
    });
    return { n: ALL.length, bad: bad.slice(0, 5), count: bad.length };
  });
  const before = await compare();
  check('memoized card lookups match the original full-corpus scans for all ' + before.n + ' works', before.count === 0);
  if (before.count) console.log('     ' + before.count + ' mismatches, e.g. ' + before.bad.join(' '));
  await clickAndSettle(page, '#grid .tierSeg[data-act="silver"]');
  await clickAndSettle(page, '#grid .tierSeg[data-act="own"]');
  const after = await compare();
  check('...and still match after the profile changes (the memo is invalidated)', after.count === 0);
  if (after.count) console.log('     ' + after.count + ' mismatches, e.g. ' + after.bad.join(' '));

  const lazy = await page.evaluate(() => {
    const card = document.querySelector('#grid .panel');
    const shells = card.querySelectorAll('.summaryFace[data-lazy], .detail[data-lazy]').length;
    const emptyBefore = !card.querySelector('.detail').children.length;
    card.querySelector('.cardHead').click();
    const detail = card.querySelector('.detail');
    const filled = !card.querySelector('[data-lazy]') && !!detail.querySelector('.fidGrid') && !detail.classList.contains('hidden');
    card.querySelector('.cardHead').click();
    card.querySelector('.cardHead').click();
    return { shells, emptyBefore, filled, reopened: !card.querySelector('.detail').classList.contains('hidden') };
  });
  check('a collapsed card carries empty panel shells, not its hidden summary and breakdown',
    lazy.shells === 2 && lazy.emptyBefore);
  check('opening a card builds its summary and breakdown, and re-opening keeps them', lazy.filled && lazy.reopened);

  await page.close();
  check('no uncaught page errors during the render-performance pass', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
}

// Offline support. Three layers, each checked on its own terms:
//   1. sw.js's precache list is exactly what index.html loads (a file added to the page but not
//      the list opens offline into a broken app -- nothing else would catch that).
//   2. Served over http, the service worker installs, and a reload with the network cut still boots.
//   3. With cloud accounts on (mocked), an edit made offline is kept, not reported as a failure,
//      survives an offline reload without waiting on the cloud, and uploads when the connection
//      returns.
async function runOfflineFlow(browser, file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listOf = (name) => {
    const m = sw.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
    return m ? (m[1].match(/'[^']+'/g) || []).map(s => s.slice(1, -1)) : [];
  };
  const precache = listOf('PRECACHE'), cdn = listOf('CDN_SCRIPTS');
  const refs = Array.from(html.matchAll(/(?:src|href)="([^"#]+)"/g)).map(m => m[1]);
  const local = refs.filter(r => !/^https?:/.test(r)), remote = refs.filter(r => /^https?:/.test(r));
  const missing = local.filter(r => !precache.includes(r));
  check('sw.js precaches every local file index.html loads', precache.length > 0 && missing.length === 0);
  if (missing.length) console.log('     not precached: ' + missing.join(', '));
  const absent = precache.filter(r => r !== './' && !fs.existsSync(path.join(ROOT, r)));
  check('every file sw.js precaches exists', absent.length === 0);
  if (absent.length) console.log('     missing on disk: ' + absent.join(', '));
  check('sw.js caches exactly the CDN scripts index.html loads',
    remote.length === cdn.length && remote.every(r => cdn.includes(r)));
  check('the service worker is only registered for http(s) pages, never file://',
    /serviceWorker\.register\('sw\.js'\)/.test(html) && /\^https\?:\$/.test(html));

  // 2. A real service worker, over http.
  const http = require('http');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u.endsWith('/')) u += 'index.html';
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  try {
    await ctx.route('**/supabase-js*/**', route => route.abort());
    await ctx.route('**/cdnjs.cloudflare.com/**', route => route.abort());
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(base + (file === 'index.html' ? '' : file));
    await waitForBoot(page);
    const gate = await page.evaluate(() => { const g = document.getElementById('onboardGate'); return !!g && !g.classList.contains('hidden'); });
    if (gate) { await page.click('#onboardSample'); await waitForBoot(page); }
    await firstCardId(page);
    const active = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(r => !!r.active),
      new Promise(r => setTimeout(() => r(false), 20000))]));
    check('served over http, the service worker installs and activates', active);
    await ctx.setOffline(true);
    await page.reload();
    await waitForBoot(page);
    const cards = await firstCardId(page);
    check('with the network cut, a reload still opens the app with its results', !!cards);
    await page.goto(base + 'index.html?view=watchlist');
    await waitForBoot(page);
    check('offline, a link carrying filters in its URL opens from the same saved page',
      await page.evaluate(() => !!window.ALL && window.state.view === 'watchlist'));
    await ctx.setOffline(false);
    check('no uncaught page errors during the offline (service worker) pass', pageErrors.length === 0);
    if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  } finally {
    await ctx.close();
    server.close();
  }

  // 3. Cloud accounts while offline (mocked Supabase, as in runAccountFlow).
  const patched = html.replace(/var SUPABASE_CONFIG=\{[^}]*\};/, 'var SUPABASE_CONFIG={url:"https://dummy.supabase.co",anonKey:"dummy-anon-key"};');
  const tmpPath = path.join(ROOT, '_test_offline_' + file);
  fs.writeFileSync(tmpPath, patched);
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  try {
    const page = await ctx2.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript(MOCK_SUPABASE_SDK);
    await page.goto('file://' + tmpPath);
    await waitForBoot(page);
    await signInAndSettle(page, 'OfflineUser', '#onboardSample');
    await firstCardId(page);
    await readWhen(page, () => localStorage.getItem('omniLedgerPendingSync') !== '1', undefined, 15000);

    await ctx2.setOffline(true);
    const id = await page.evaluate(() => document.querySelector('#grid .doneSeg').dataset.id);
    const uploadsBefore = await page.evaluate(() => window.__mockTables ? JSON.stringify(window.__mockTables.profiles.offlineuser || null).length : -1);
    await page.click('#grid .doneSeg[data-id="' + id + '"]');
    const offlineState = await readWhen(page, () => {
      const st = document.getElementById('acctMenuStatus');
      return !!st && /Offline/.test(st.textContent);
    }, undefined, 8000);
    check('an edit made offline reports "saved on this device", not a sync failure', !!offlineState);
    check('an edit made offline stays marked as not yet uploaded',
      await page.evaluate(() => localStorage.getItem('omniLedgerPendingSync') === '1'));
    check('nothing is uploaded while offline',
      (await page.evaluate(() => window.__mockTables ? JSON.stringify(window.__mockTables.profiles.offlineuser || null).length : -1)) === uploadsBefore);

    const t0 = Date.now();
    await page.reload();
    await waitForBoot(page);
    const bootMs = Date.now() - t0;
    check('offline, a signed-in account reopens from this device without waiting on the cloud', await page.evaluate(() => !!window.ALL));
    check('...and still has the edit made offline',
      await page.evaluate((i) => { const w = JSON.parse(localStorage.getItem('omniLedgerWatchlist') || '{}'); return !!(w[i] && w[i].watched); }, id));
    if (bootMs > 12000) console.log('     (offline reboot took ' + bootMs + 'ms)');

    await ctx2.setOffline(false);
    const uploaded = await readWhen(page, (i) => {
      const row = window.__mockTables && window.__mockTables.profiles.offlineuser;
      if (!row) return false;
      const data = row.data || row;
      try { const w = JSON.parse(data.omniLedgerWatchlist || '{}'); return !!(w[i] && w[i].watched) && localStorage.getItem('omniLedgerPendingSync') !== '1'; } catch (e) { return false; }
    }, id, 20000);
    check('coming back online uploads the edit made offline, without another edit or a reload', !!uploaded);
    check('no uncaught page errors during the offline (cloud) pass', pageErrors.length === 0);
    if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  } finally {
    await ctx2.close();
    try { fs.unlinkSync(tmpPath); } catch (e) { /* already gone */ }
  }
}

// A fresh browser that picks "Start blank" at the gate: nothing rated, tiered or owned.
async function bootBlank(browser, file) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route('**/supabase-js*/**', route => route.abort());
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('file://' + path.join(ROOT, file));
  await waitForBoot(page);
  const gate = await page.evaluate(() => { const g = document.getElementById('onboardGate'); return !!g && !g.classList.contains('hidden'); });
  if (gate) { await page.click('#onboardBlank'); await waitForBoot(page); }
  await firstCardId(page);
  return { page, pageErrors };
}
// Types into the Omni-Search box and returns the titles on screen once that query has rendered.
async function searchTitles(page, q) {
  await page.fill('#q', q);
  return readWhen(page, qq => window.state.q === qq && document.querySelector('#grid .cardHead')
    ? Array.from(document.querySelectorAll('#grid .cardHead')).map(h => window.byId.get(h.dataset.id).title) : false, q, 10000);
}

// Omni-Search: app/search.js folds accents and punctuation, matches every word in any order and
// field, forgives typos, and puts the best match first (test/search.js holds the matcher itself to
// many more queries; this checks the Global Controller wiring and ordering on the real page).
async function runSearchFlow(browser, file) {
  const { page, pageErrors } = await bootSample(browser, file);
  const amelie = await searchTitles(page, 'amelie');
  check('"amelie" finds Amélie, first', !!amelie && amelie[0] === 'Amélie');
  check('the search is kept in the URL', !!await readWhen(page, () => /[?&]q=amelie/.test(location.search), undefined, 3000));
  const godfather = await searchTitles(page, 'godfater');
  check('"godfater" (a typo) finds The Godfather, first', !!godfather && godfather[0] === 'The Godfather');
  const zelda = await searchTitles(page, 'zelda breath');
  check('"zelda breath" finds The Legend of Zelda: Breath of the Wild', !!zelda && zelda.includes('The Legend of Zelda: Breath of the Wild'));
  const kubrick1968 = await searchTitles(page, 'kubrick 1968');
  check('"kubrick 1968" finds 2001: A Space Odyssey and nothing else', !!kubrick1968 && kubrick1968.length === 1 && kubrick1968[0] === '2001: A Space Odyssey');
  const lotr = await searchTitles(page, 'lord of the rings return of the king');
  check('"lord of the rings return of the king" finds the film despite the colon', !!lotr && lotr.includes('The Lord of the Rings: The Return of the King'));
  const dune = await searchTitles(page, 'dune');
  check('"dune" puts an exact title first, ahead of the default Best Overall order', !!dune && dune[0] === 'Dune');
  const scifi = await searchTitles(page, 'sci-fi');
  check('"sci-fi" is the genre: the leading results are all Sci-Fi', !!scifi && scifi.length >= 20 &&
    await page.evaluate(() => Array.from(document.querySelectorAll('#grid .cardHead')).slice(0, 20)
      .every(h => { const x = window.byId.get(h.dataset.id); return (x.genres || []).concat(x.fam || []).some(g => /sci-fi/i.test(g)); })));
  // Inside one relevance bucket the chosen sort still decides: every Kubrick hit is a creator match.
  await page.selectOption('#sortSel', 'yearNew');
  const kubrickYears = await readWhen(page, () => {
    if (window.state.sort !== 'yearNew') return false;
    return Array.from(document.querySelectorAll('#grid .cardHead')).map(h => window.byId.get(h.dataset.id).year);
  }, undefined, 5000);
  await searchTitles(page, 'kubrick');
  const years = await page.evaluate(() => Array.from(document.querySelectorAll('#grid .cardHead')).map(h => window.byId.get(h.dataset.id).year));
  check('a creator search still follows the chosen sort (Kubrick, newest first)',
    !!kubrickYears && years.length > 5 && years.every((y, i) => i === 0 || years[i - 1] >= y));
  await page.selectOption('#sortSel', 'overall');
  await page.fill('#q', '');
  await readWhen(page, () => window.state.q === '' ? true : false, undefined, 5000);
  check('no uncaught page errors during the search flow', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  await page.close();
}

// The headline number on a card is the personal match, labelled, and nothing calls it a match for
// someone's taste until the app knows something about that taste -- a blank profile used to be
// told a film "is as beautiful to look at as your favorites" and "Very strong match for your taste".
async function runHonestMatchFlow(browser, file) {
  const { page, pageErrors } = await bootBlank(browser, file);
  const ringOf = () => page.evaluate(() => {
    const h = document.querySelector('#grid .cardHead[data-id]');
    const r = h.querySelector('.matchRing');
    const x = window.byId.get(h.dataset.id);
    return { id: x.id, gm: x.gm, label: r && r.querySelector('.matchRingLbl').textContent, aria: r && r.getAttribute('aria-label'),
      num: r && r.querySelector('svg text').textContent, crit: (h.querySelector('.critChip') || {}).textContent, xcrit: x.crit };
  });
  const blank = await ringOf();
  check('the ring shows the work\'s match number, not its critics\' score', blank.num === String(blank.gm));
  check('the critics\' score moved to its own labelled chip', blank.crit === 'Crit ' + blank.xcrit);
  check('with nothing personal known, the ring is labelled "Score" and says it is not personalized yet',
    blank.label === 'Score' && /Overall score/.test(blank.aria) && /Not personalized/i.test(blank.aria));
  await ensureFirstCardExpanded(page);
  const blankFit = await page.evaluate(() => (document.querySelector('#grid .panel .summaryFace') || {}).innerText || '');
  check('a blank profile\'s card does not claim a match for "your taste"', !/your taste/i.test(blankFit) && /Overall score/.test(blankFit));
  const blankWhys = await page.evaluate(() => ['Movies', 'TV Series', 'Video Games', 'Books'].map(c => {
    const r = window.buildGeneratedRec(c); return { basis: r.basis, whys: r.items.map(i => i.why) };
  }));
  check('a blank profile\'s recommendations never say "your favorites", "you favor" or "your taste"',
    blankWhys.every(c => c.whys.every(w => !/your favorites|you favor|your taste/i.test(w))));
  check('and each list says what it is ranked by instead',
    blankWhys.every(c => /^No ratings, favorites or owned titles yet/.test(c.basis)));

  // One rating is evidence: the same surfaces now speak personally, and say how much they know.
  const ratedId = blank.id;
  await page.evaluate(id => window.setRating(id, 8.5), ratedId);
  await readWhen(page, () => window.PERSONAL_PROFILE.ratings && Object.keys(window.PERSONAL_PROFILE.ratings).length === 1, undefined, 5000);
  await settle(page);
  const after = await page.evaluate(rid => {
    const h = Array.from(document.querySelectorAll('#grid .cardHead[data-id]')).find(e => e.dataset.id !== rid);
    const r = h.querySelector('.matchRing');
    return { id: h.dataset.id, label: r.querySelector('.matchRingLbl').textContent, aria: r.getAttribute('aria-label') };
  }, ratedId);
  check('after one rating the ring reads "Match" and says what it is based on',
    after.label === 'Match' && /based on 1 rating/.test(after.aria));
  const basisAfter = await page.evaluate(() => window.buildGeneratedRec('Movies').basis);
  check('recommendations say they are ranked by taste, based on that rating', /based on 1 rating/.test(basisAfter));

  // Best Untried Matches sorts by match -- so the rings now read in order.
  await page.click('#discoverBtn');
  const rings = await readWhen(page, () => {
    if (window.state.sort !== 'gm') return false;
    return Array.from(document.querySelectorAll('#grid .matchRing svg text')).slice(0, 30).map(t => +t.textContent);
  }, undefined, 5000);
  check('in Best Untried Matches the rings read in descending order', !!rings && rings.length > 5 && rings.every((v, i) => i === 0 || rings[i - 1] >= v));
  check('no uncaught page errors during the honest-match flow', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  await page.close();
}

// Merging instead of overwriting (app/sync-merge.js, mergeAndWrite in index.html). The cloud copy
// used to be replaced wholesale by whichever device wrote last, and a device with unsynced edits
// won outright on its next load -- so an edit made on an offline phone erased everything done on
// the laptop meanwhile, and two open tabs erased each other. "Another device" here is the mocked
// table edited directly, the way the laptop's own sync would have left it: its changes carry edit
// stamps, as every edit made by this version does.
async function runMergeFlow(browser, file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const patched = html.replace(/var SUPABASE_CONFIG=\{[^}]*\};/, 'var SUPABASE_CONFIG={url:"https://dummy.supabase.co",anonKey:"dummy-anon-key"};');
  const tmpPath = path.join(ROOT, '_test_merge_' + file);
  fs.writeFileSync(tmpPath, patched);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  // The other device's save: `edit(data, now)` runs against a copy of the stored row, in the page.
  const otherDeviceSaves = (page, fnBody, arg) => page.evaluate(({ fnBody, arg }) => {
    const db = JSON.parse(localStorage.getItem('__mockDb'));
    const data = JSON.parse(JSON.stringify(db.tables.profiles.mergeuser.data));
    (new Function('data', 'now', 'arg', fnBody))(data, Math.floor(Date.now() / 1000) + 2, arg);
    window.__mockSeedProfile('mergeuser', data);
  }, { fnBody, arg });
  const cloud = page => page.evaluate(() => {
    const row = window.__mockTables.profiles.mergeuser;
    return row ? { p: JSON.parse(row.data.omniLedgerProfile || '{}'), w: JSON.parse(row.data.omniLedgerWatchlist || '{}') } : null;
  });
  try {
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/supabase-js*/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.addInitScript(MOCK_SUPABASE_SDK);
    await page.goto('file://' + tmpPath);
    await waitForBoot(page);
    await signInAndSettle(page, 'MergeUser', '#onboardSample');
    await firstCardId(page);
    await readWhen(page, () => localStorage.getItem('omniLedgerPendingSync') !== '1' && !!window.__mockTables.profiles.mergeuser, undefined, 15000);
    // Four untouched titles: X rated offline here, Y rated and Z queued on the other device, W and V later.
    const ids = await page.evaluate(() => window.ALL.filter(x => window.isUntried(x) && x.id !== 't01').slice(0, 5).map(x => x.id));
    const [X, Y, Z, W, V] = ids;
    check('setup: the account saved to the (mocked) cloud and five untouched titles were found', ids.length === 5);

    // 1. Offline here, while the other device saves.
    await ctx.setOffline(true);
    await page.evaluate(id => window.setRating(id, 6.5), X);
    check('an edit made offline stays pending', await page.evaluate(() => localStorage.getItem('omniLedgerPendingSync') === '1'));
    const upNextBefore = await page.evaluate(() => (document.getElementById('wlNavCount').textContent.match(/\d+/) || ['0'])[0]);
    await otherDeviceSaves(page, `
      const prof = JSON.parse(data.omniLedgerProfile); prof.ratings = prof.ratings || {}; prof.ratings[arg.Y] = 9;
      data.omniLedgerProfile = JSON.stringify(prof);
      const wl = JSON.parse(data.omniLedgerWatchlist || '{}'); wl[arg.Z] = { watched: false, added: Date.now() };
      data.omniLedgerWatchlist = JSON.stringify(wl);
      const ed = JSON.parse(data.omniLedgerEdits || '{}'); ed['r|' + arg.Y] = now; ed['w|' + arg.Z] = now;
      data.omniLedgerEdits = JSON.stringify(ed);`, { Y, Z });
    await ctx.setOffline(false);
    const merged = await readWhen(page, ({ X, Y, Z }) => {
      const row = window.__mockTables.profiles.mergeuser;
      const p = JSON.parse(row.data.omniLedgerProfile || '{}'), w = JSON.parse(row.data.omniLedgerWatchlist || '{}');
      return (p.ratings || {})[X] === 6.5 && (p.ratings || {})[Y] === 9 && !!w[Z] && localStorage.getItem('omniLedgerPendingSync') !== '1';
    }, { X, Y, Z }, 20000);
    check('back online, the cloud keeps both: the rating made offline and the other device\'s rating and Up Next entry', !!merged);
    const onScreen = await readWhen(page, ({ Y, n }) => window.byId.get(Y).myRating === 9 &&
      (document.getElementById('wlNavCount').textContent.match(/\d+/) || ['0'])[0] === String(n) ? true : false, { Y, n: +upNextBefore + 1 }, 10000);
    check('...and this device shows the other device\'s edits without a reload', !!onScreen);

    // 2. A write racing the other device's save: read, merge and write again.
    await page.evaluate(() => window.__mockSetFlag('concurrentProfileWriteOnce', true));
    await page.evaluate(id => window.setRating(id, 8), W);
    const raced = await readWhen(page, W => {
      const p = JSON.parse(window.__mockTables.profiles.mergeuser.data.omniLedgerProfile || '{}');
      return (p.ratings || {})[W] === 8 && (p.ratings || {}).t01 === 7.5 && window.byId.get('t01').myRating === 7.5 &&
        localStorage.getItem('omniLedgerPendingSync') !== '1';
    }, W, 20000);
    check('a write that loses a race with another device\'s save merges and writes again: both ratings survive', !!raced);

    // 3. A removal on the other device is not undone by this one's older copy.
    await otherDeviceSaves(page, `
      const prof = JSON.parse(data.omniLedgerProfile); delete prof.ratings[arg.Y]; data.omniLedgerProfile = JSON.stringify(prof);
      const ed = JSON.parse(data.omniLedgerEdits || '{}'); ed['r|' + arg.Y] = now + 10; data.omniLedgerEdits = JSON.stringify(ed);`, { Y });
    await page.evaluate(id => window.setRating(id, 7), V);
    const removed = await readWhen(page, ({ Y, V }) => {
      const p = JSON.parse(window.__mockTables.profiles.mergeuser.data.omniLedgerProfile || '{}');
      return !(Y in (p.ratings || {})) && (p.ratings || {})[V] === 7 && window.byId.get(Y).myRating == null ? true : false;
    }, { Y, V }, 20000);
    check('a rating removed on the other device stays removed here, instead of being uploaded back', !!removed);
    check('every edit carries its own stamp in the synced copy',
      await page.evaluate(({ X, W, V }) => {
        const ed = JSON.parse(window.__mockTables.profiles.mergeuser.data.omniLedgerEdits || '{}');
        return ['r|' + X, 'r|' + W, 'r|' + V].every(p => ed[p] > 0);
      }, { X, W, V }));
    check('no uncaught page errors during the cloud merge pass', pageErrors.length === 0);
    if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  } finally {
    await ctx.close();
    try { fs.unlinkSync(tmpPath); } catch (e) { /* already gone */ }
  }

  // 4. Two tabs of one browser (no cloud needed): each sees the other's edits, neither erases them.
  const ctxT = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  try {
    await ctxT.route('**/supabase-js*/**', route => route.abort());
    const tabErrors = [];
    const t1 = await ctxT.newPage();
    t1.on('pageerror', e => tabErrors.push(e.message));
    await t1.goto('file://' + path.join(ROOT, file));
    await waitForBoot(t1);
    const gate = await t1.evaluate(() => { const g = document.getElementById('onboardGate'); return !!g && !g.classList.contains('hidden'); });
    if (gate) { await t1.click('#onboardSample'); await waitForBoot(t1); }
    await firstCardId(t1);
    const t2 = await ctxT.newPage();
    t2.on('pageerror', e => tabErrors.push(e.message));
    await t2.goto('file://' + path.join(ROOT, file));
    await waitForBoot(t2);
    await firstCardId(t2);
    const pick = page => page.evaluate(() => Array.from(document.querySelectorAll('#grid .cardHead[data-id]')).map(h => h.dataset.id)
      .filter(id => { const x = window.byId.get(id); return !x.goat && !x.silver && !x.bronze && !x.owned; }).slice(0, 4));
    const [A, , C] = await pick(t1);
    const [, B, , D] = await pick(t2);
    await clickAndSettle(t1, '.panel .profEditBtn[data-act="bronze"][data-id="' + A + '"]');
    const seen = await readWhen(t2, id => window.byId.get(id).bronze === true, A, 10000);
    check('a Bronze pick made in one tab shows up in the other open tab', !!seen);
    await clickAndSettle(t2, '.panel .profEditBtn[data-act="bronze"][data-id="' + B + '"]');
    const bothTiers = await t1.evaluate(({ A, B }) => {
      const p = JSON.parse(localStorage.getItem('omniLedgerProfile') || '{}');
      return (p.bronzeTierIds || []).includes(A) && (p.bronzeTierIds || []).includes(B) && window.byId.get(B).bronze === true;
    }, { A, B });
    check('an edit in the second tab keeps the first tab\'s edit, and the first tab sees it', bothTiers);
    await t1.click('.wlBtn[data-wl="' + C + '"]');
    await readWhen(t2, id => !!JSON.parse(localStorage.getItem('omniLedgerWatchlist') || '{}')[id], C, 5000);
    await t2.click('#grid .doneSeg[data-id="' + D + '"]');
    const bothWl = await readWhen(t1, ({ C, D }) => {
      const w = JSON.parse(localStorage.getItem('omniLedgerWatchlist') || '{}');
      return !!w[C] && !!(w[D] && w[D].watched) && window.wlDone(D) ? true : false;
    }, { C, D }, 5000);
    check('watchlist edits in two tabs both survive, and each tab sees the other\'s', !!bothWl);
    check('no uncaught page errors in either tab', tabErrors.length === 0);
    if (tabErrors.length) tabErrors.forEach(e => console.log('     ' + e));
  } finally {
    await ctxT.close();
  }
}

// Recommendation quality, as a number: favorites are hidden and the engine has to find them again
// among everything untried -- for the PK Sample and for four cold-start personas that look nothing
// like it. scripts/rec-quality.js explains the method and holds the checks; the floors sit a little
// under what the engine measures today, so a scoring change that quietly makes suggestions worse
// fails here, on its pull request, rather than in someone's list.
async function runRecQualityFlow(browser, file) {
  const { page, pageErrors } = await bootSample(browser, file);
  const before = await page.evaluate(() => ({ profile: JSON.stringify(window.PERSONAL_PROFILE),
    stored: localStorage.getItem('omniLedgerProfile'), gm: window.ALL.map(x => x.gm).join(',') }));
  const m = await recQuality.measure(page);
  console.log(recQuality.report(m, { table: true }).split('\n').map(l => '     ' + l).join('\n'));
  recQuality.verdicts(m).forEach(v => check(v.label, v.ok));
  const after = await page.evaluate(() => ({ profile: JSON.stringify(window.PERSONAL_PROFILE),
    stored: localStorage.getItem('omniLedgerProfile'), gm: window.ALL.map(x => x.gm).join(',') }));
  check('measuring leaves the profile, its saved copy and every match score exactly as they were',
    after.profile === before.profile && after.stored === before.stored && after.gm === before.gm);
  check('no uncaught page errors during the recommendation-quality flow', pageErrors.length === 0);
  if (pageErrors.length) pageErrors.forEach(e => console.log('     ' + e));
  await page.close();
}

// Each flow opens its own pages and contexts, so one flow throwing says nothing about the others.
// A throw used to abort the whole run: one missing element late in the account flow took the ~150
// checks after it down too, and a single timing problem read as a wall of red. Now it counts as
// one failure, named after its flow, and the run carries on to the next flow.
async function runFlow(browser, name, fn) {
  if (ONLY.length && !ONLY.some(o => name.toLowerCase().includes(o))) return;
  console.log('\n=== ' + name + ' ===');
  try {
    await fn();
  } catch (e) {
    check(name + ': flow ran to completion without throwing', false);
    console.log('     ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n     '));
    // Whatever it left open would otherwise sit there eating memory through every later flow.
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
}

(async () => {
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  instrumentBrowser(browser);
  for (const t of TARGETS) {
    await runFlow(browser, t + ' — main walkthrough (onboarding, every view, filters, phone layout)', () => runFile(browser, t));
    await runFlow(browser, t + ' — cloud account flow (mocked Supabase)', () => runAccountFlow(browser, t));
    await runFlow(browser, t + ' — quick-rate seed picker', () => runSeedPickerFlow(browser, t));
    await runFlow(browser, t + ' — GOAT Picker (search & pick your GOATs)', () => runGoatPickerFlow(browser, t));
    await runFlow(browser, t + ' — starting from scratch', () => runFromScratchFlow(browser, t));
    await runFlow(browser, t + ' — Collection tab (medium/format grouping, collapse, links)', () => runCollectionFlow(browser, t));
    await runFlow(browser, t + ' — a profile saved before the edition vocabulary changed', () => runLegacyProfileFlow(browser, t));
    await runFlow(browser, t + ' — personal ratings (migration, popup, GOAT Match blend, filters)', () => runRatingFlow(browser, t));
    await runFlow(browser, t + ' — tab filters, search/sort, URL bookmarking', () => runTabFiltersFlow(browser, t));
    await runFlow(browser, t + ' — completed (watched / read / played)', () => runCompletedFlow(browser, t));
    await runFlow(browser, t + ' — franchise / standalone filter', () => runFranchiseFilterFlow(browser, t));
    await runFlow(browser, t + ' — remembering filters (restore offer, Show count)', () => runRestoreFiltersFlow(browser, t));
    await runFlow(browser, t + ' — render performance (memoized lookups, lazy card panels)', () => runRenderPerfFlow(browser, t));
    await runFlow(browser, t + ' — offline (service worker, cloud sync while offline)', () => runOfflineFlow(browser, t));
    await runFlow(browser, t + ' — Omni-Search (accents, typos, every word, best match first)', () => runSearchFlow(browser, t));
    await runFlow(browser, t + ' — honest match (labelled ring, no taste claims without evidence)', () => runHonestMatchFlow(browser, t));
    await runFlow(browser, t + ' — merging edits across devices and tabs', () => runMergeFlow(browser, t));
    await runFlow(browser, t + ' — recommendation quality (hidden favorites found again)', () => runRecQualityFlow(browser, t));
  }
  await browser.close();

  if (ONLY.length && checksRun === 0) {
    console.log('\n--only matched no flow: ' + ONLY.join(', '));
    process.exit(1);
  }
  console.log('\n' + (failures === 0 ? 'All checks passed.' : failures + ' check(s) failed.'));
  process.exit(failures === 0 ? 0 : 1);
})();
