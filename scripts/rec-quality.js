#!/usr/bin/env node
/*
 * Recommendation quality, measured the way a person would judge it: hide some of their favorites
 * and see whether the engine finds them again.
 *
 * The PK Sample (data/pk-sample.js) is a real person's profile: Gold, Silver and Bronze favorites,
 * an owned shelf, ratings, hand-set boosts. Its tiered favorites are split into folds; for each
 * fold, every trace of those titles is removed from the profile -- tier, rating, ownership, and
 * any pass -- and the real scoring pass (recomputeProfileDerived, the same code the app runs) ranks
 * everything the reduced profile has not tried. A good engine puts the hidden favorites near the
 * top of that list, far above where acclaim alone would put them.
 *
 * Three rankers are compared on the same candidates:
 *   engine    what the taste model learns from ratings, tiers and ownership alone (hand-set
 *             boosts removed -- nothing the person wrote down about these titles' creators)
 *   profile   the reduced profile as the person actually uses it, hand-set boosts included
 *   baseline  no personal evidence at all: the calibrated critical/audience/craft score
 *
 *   node scripts/rec-quality.js           print the report
 *   node scripts/rec-quality.js --json    print it as JSON
 *
 * test/regression.js ("recommendation quality") runs the same measurement on every pull request
 * and fails if the engine stops clearly beating the baseline, or drops below floors set a little
 * under what it measures today -- so a change to the scoring can be judged by a number, not by
 * eyeballing one profile's list.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FOLDS = 5;

/* Runs in the page. Mutates the live profile in memory only (never storage) and restores it. */
function evalInPage(opts) {
  const P = window.PERSONAL_PROFILE;
  const original = JSON.parse(JSON.stringify(P));
  const byId = window.byId;
  const all = window.ALL;
  const folds = opts.folds;
  const setProfile = p => {
    Object.keys(P).forEach(k => { delete P[k]; });
    Object.assign(P, JSON.parse(JSON.stringify(p)));
    window.recomputeProfileDerived();
  };
  // The legacy "every book up to this id is owned" rule cannot leave one title out, so it is
  // expanded into explicit entries first -- the same ownership, one id at a time.
  const base = JSON.parse(JSON.stringify(original));
  if (base.ownedBookIdCeiling) {
    base.ownedBooksExtra = base.ownedBooksExtra || {};
    all.forEach(x => {
      if (x.kind === 'book' && parseInt(x.id.slice(1), 10) <= base.ownedBookIdCeiling && !base.ownedBooksExtra[x.id]) base.ownedBooksExtra[x.id] = 'Owned';
    });
    base.ownedBookIdCeiling = 0;
  }
  const favorites = [].concat(base.declaredGoatIds || [], base.silverTierIds || [], base.bronzeTierIds || [])
    .filter((id, i, a) => byId.get(id) && a.indexOf(id) === i).sort();
  const without = (p, held) => {
    const q = JSON.parse(JSON.stringify(p)), h = new Set(held);
    ['declaredGoatIds', 'silverTierIds', 'bronzeTierIds', 'ownedGameIds'].forEach(k => { if (q[k]) q[k] = q[k].filter(id => !h.has(id)); });
    ['ratings', 'ownedMedia', 'ownedBooksExtra', 'notInterested'].forEach(k => { if (q[k]) held.forEach(id => { delete q[k][id]; }); });
    return q;
  };
  const noBoosts = p => { const q = JSON.parse(JSON.stringify(p)); delete q.creatorBoost; delete q.bookCreatorBoost; delete q.genreBoost; delete q.vibeBoost; return q; };
  const rankers = {
    engine: held => noBoosts(without(base, held)),
    profile: held => without(base, held),
    baseline: () => ({}),
  };
  const out = {};
  Object.keys(rankers).forEach(name => { out[name] = { ranks: [], ndcg: [] }; });
  let candidates = 0;
  for (let f = 0; f < folds; f++) {
    const held = favorites.filter((_, i) => i % folds === f);
    // The candidates: everything the reduced profile has not already tried -- what a
    // recommendation list is drawn from. Fixed per fold, so every ranker faces the same list.
    setProfile(without(base, held));
    const pool = all.filter(x => !x.owned && !x.goat && !x.silver && !x.bronze && x.myRating == null).map(x => x.id);
    candidates = pool.length;
    Object.keys(rankers).forEach(name => {
      setProfile(rankers[name](held));
      const order = pool.map(id => byId.get(id)).sort((a, b) => (b.gm - a.gm) || (b.ovr - a.ovr) || (a.id < b.id ? -1 : 1));
      const rankOf = new Map(order.map((x, i) => [x.id, i + 1]));
      const ranks = held.map(id => rankOf.get(id));
      out[name].ranks.push.apply(out[name].ranks, ranks);
      // Binary-relevance NDCG@100 for this fold: its hidden titles against an ideal list that
      // puts exactly those first.
      const dcg = ranks.filter(x => x <= 100).reduce((s, x) => s + 1 / Math.log2(x + 1), 0);
      let idcg = 0; for (let i = 1; i <= Math.min(ranks.length, 100); i++) idcg += 1 / Math.log2(i + 1);
      out[name].ndcg.push(idcg ? dcg / idcg : 0);
    });
  }
  setProfile(original);
  const summary = {};
  Object.keys(out).forEach(name => {
    const r = out[name].ranks.slice().sort((a, b) => a - b), n = r.length;
    const hit = k => r.filter(x => x <= k).length / n;
    summary[name] = {
      hidden: n,
      hitAt25: +hit(25).toFixed(3), hitAt100: +hit(100).toFixed(3), hitAt250: +hit(250).toFixed(3),
      medianRank: r[Math.floor(n / 2)],
      meanPercentile: +(r.reduce((s, x) => s + x, 0) / n / candidates * 100).toFixed(1),
      ndcgAt100: +(out[name].ndcg.reduce((s, x) => s + x, 0) / out[name].ndcg.length).toFixed(3),
    };
  });
  return { favorites: favorites.length, folds, candidates, summary };
}

async function measure(page) {
  return page.evaluate(evalInPage, { folds: FOLDS });
}

function report(m) {
  const lines = ['Recommendation quality -- ' + m.favorites + ' PK Sample favorites hidden ' + m.folds + ' folds at a time, ranked among ~' + m.candidates + ' untried titles', ''];
  lines.push('ranker     hit@25  hit@100  hit@250  median rank  mean pctile  ndcg@100');
  Object.keys(m.summary).forEach(k => {
    const s = m.summary[k];
    lines.push(k.padEnd(10) + String(s.hitAt25).padStart(7) + String(s.hitAt100).padStart(9) + String(s.hitAt250).padStart(9) +
      String(s.medianRank).padStart(13) + (s.meanPercentile + '%').padStart(13) + String(s.ndcgAt100).padStart(10));
  });
  return lines.join('\n');
}

module.exports = { measure, report, FOLDS };

if (require.main === module) {
  (async () => {
    const { chromium } = require('playwright-core');
    const candidates = ['/opt/pw-browsers', path.join(require('os').homedir(), '.cache', 'ms-playwright')];
    let executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    for (const b of candidates) {
      if (executablePath || !fs.existsSync(b)) continue;
      for (const d of fs.readdirSync(b)) {
        const p = path.join(b, d, 'chrome-linux', 'chrome');
        if (d.startsWith('chromium') && fs.existsSync(p)) { executablePath = p; break; }
      }
    }
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    try {
      const page = await browser.newPage();
      // Local-only: never talk to a real cloud project from a measurement script.
      await page.route('**/supabase-js*/**', r => r.abort());
      await page.goto('file://' + path.join(ROOT, 'index.html'));
      await page.waitForSelector('#onboardSample', { state: 'visible', timeout: 60000 });
      await page.click('#onboardSample');
      await page.waitForFunction(() => window.ALL && window.recomputeProfileDerived && document.querySelector('.cardHead[data-id]'), null, { timeout: 60000 });
      const m = await measure(page);
      console.log(process.argv.includes('--json') ? JSON.stringify(m, null, 2) : report(m));
    } finally {
      await browser.close();
    }
  })().catch(e => { console.error(e); process.exit(1); });
}
