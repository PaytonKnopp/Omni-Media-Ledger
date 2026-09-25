#!/usr/bin/env node
/*
 * Recommendation quality, measured the way a person would judge it: hide some of their favorites
 * and see whether the engine finds them again.
 *
 * Two kinds of profile are measured, because an engine can be tuned to one person and fail the next:
 *
 *   PK Sample   a real person's profile (data/pk-sample.js): Gold, Silver and Bronze favorites, an
 *               owned shelf, ratings, hand-set boosts. Its favorites are split into 5 folds; each
 *               fold is hidden in turn.
 *   personas    the four cold-start profiles from scripts/cold-start-test.js -- a comedy lover, a
 *               family-drama viewer, a literary-fiction reader, a cosy-games player -- each only
 *               six to eight favorites, the state a stranger is in after onboarding. Each favorite
 *               is hidden in turn (leave-one-out), so the other five to seven must find it.
 *
 * Hiding a favorite removes every trace of it -- tier, rating, ownership -- and the real
 * scoring pass (recomputeProfileDerived, the same code the app runs) then ranks everything the
 * reduced profile has not tried. A good engine puts the hidden favorites near the top of that list,
 * far above where acclaim alone would put them.
 *
 * The rankers compared on the same candidates:
 *   engine    what the taste model learns from ratings, tiers and ownership alone (for the PK
 *             Sample, hand-set boosts removed -- nothing the person wrote down about the hidden
 *             titles' creators or genres)
 *   profile   the PK Sample as the person actually uses it, hand-set boosts included
 *   baseline  no personal evidence at all: the calibrated critical/audience/craft score, which is
 *             what everyone would see if the match were not personal
 *
 *   npm run rec-quality                     print the report (exits 1 if a check below fails)
 *   node scripts/rec-quality.js --json      print the raw numbers as JSON
 *
 * test/regression.js ("recommendation quality") runs the same measurement and the same CHECKS on
 * every pull request, so a change to the scoring is judged by a number, not by eyeballing one
 * profile's list.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { PROFILES: PERSONAS } = require('./cold-start-test.js');

const ROOT = path.resolve(__dirname, '..');
const FOLDS = 5;
const CASES = [{ name: 'PK Sample', folds: FOLDS }].concat(
  Object.keys(PERSONAS).map(name => ({ name, persona: true, profile: { silverTierIds: PERSONAS[name] } })));

/* Runs in the page. Mutates the live profile in memory only (never storage) and restores it. */
function evalInPage(opts) {
  const P = window.PERSONAL_PROFILE;
  const byId = window.byId;
  const all = window.ALL;
  const clone = o => JSON.parse(JSON.stringify(o));
  const original = clone(P);
  const setProfile = p => {
    Object.keys(P).forEach(k => { delete P[k]; });
    Object.assign(P, clone(p));
    window.recomputeProfileDerived();
  };
  const BOOSTS = ['creatorBoost', 'bookCreatorBoost', 'genreBoost', 'vibeBoost'];
  const hasBoosts = p => BOOSTS.some(k => p[k] && Object.keys(p[k]).length);
  const noBoosts = p => { const q = clone(p); BOOSTS.forEach(k => { delete q[k]; }); return q; };
  const without = (p, held) => {
    const q = clone(p), h = new Set(held);
    ['declaredGoatIds', 'silverTierIds', 'bronzeTierIds', 'ownedGameIds'].forEach(k => { if (q[k]) q[k] = q[k].filter(id => !h.has(id)); });
    ['ratings', 'ownedMedia', 'ownedBooksExtra'].forEach(k => { if (q[k]) held.forEach(id => { delete q[k][id]; }); });
    return q;
  };
  // The legacy "every book up to this id is owned" rule cannot leave one title out, so it is
  // expanded into explicit entries first -- the same ownership, one id at a time.
  const expandCeiling = p => {
    if (!p.ownedBookIdCeiling) return p;
    p.ownedBooksExtra = p.ownedBooksExtra || {};
    all.forEach(x => {
      if (x.kind === 'book' && parseInt(x.id.slice(1), 10) <= p.ownedBookIdCeiling && !p.ownedBooksExtra[x.id]) p.ownedBooksExtra[x.id] = 'Owned';
    });
    p.ownedBookIdCeiling = 0;
    return p;
  };
  const snapshot = () => new Map(all.map(x => [x.id, x.gm]));
  // A candidate list in the order a recommendation list reads it: match first, then the overall
  // score, then id so the order is deterministic. (Breaking ties on the unrounded score behind the
  // whole number shown instead of on acclaim was measured and scored no better.)
  const ranksOf = (pool, gm, held) => {
    const order = pool.slice().sort((a, b) => (gm.get(b) - gm.get(a)) || (byId.get(b).ovr - byId.get(a).ovr) || (a < b ? -1 : 1));
    const at = new Map(order.map((id, i) => [id, i + 1]));
    return held.map(id => at.get(id));
  };

  const out = [];
  try {
    // With no evidence the score is the same for every case and fold: compute it once.
    setProfile({});
    const baselineGm = snapshot();
    opts.cases.forEach(c => {
      const base = c.profile ? clone(c.profile) : expandCeiling(clone(original));
      const favorites = [].concat(base.declaredGoatIds || [], base.silverTierIds || [], base.bronzeTierIds || [])
        .filter((id, i, a) => byId.get(id) && a.indexOf(id) === i).sort();
      const folds = Math.min(c.folds || favorites.length, favorites.length);
      const names = hasBoosts(base) ? ['engine', 'profile', 'baseline'] : ['engine', 'baseline'];
      const raw = {};
      names.forEach(n => { raw[n] = { ranks: [], pcts: [], ndcg: [] }; });
      let poolTotal = 0;
      for (let f = 0; f < folds; f++) {
        const held = favorites.filter((_, i) => i % folds === f);
        const reduced = without(base, held);
        setProfile(reduced);
        // The candidates: everything the reduced profile has not already tried -- what a
        // recommendation list is drawn from. Fixed per fold, so every ranker faces the same list.
        const pool = all.filter(x => !x.owned && !x.goat && !x.silver && !x.bronze && x.myRating == null).map(x => x.id);
        poolTotal += pool.length;
        const scores = { baseline: baselineGm };
        if (names.includes('profile')) { scores.profile = snapshot(); setProfile(noBoosts(reduced)); }
        scores.engine = snapshot();
        names.forEach(n => {
          const ranks = ranksOf(pool, scores[n], held);
          ranks.forEach(r => { raw[n].ranks.push(r); raw[n].pcts.push(r / pool.length * 100); });
          // Binary-relevance NDCG@100 for this fold: its hidden titles against an ideal list that
          // puts exactly those first.
          const dcg = ranks.filter(r => r <= 100).reduce((s, r) => s + 1 / Math.log2(r + 1), 0);
          let idcg = 0;
          for (let i = 1; i <= Math.min(ranks.length, 100); i++) idcg += 1 / Math.log2(i + 1);
          raw[n].ndcg.push(idcg ? dcg / idcg : 0);
        });
      }
      out.push({ name: c.name, persona: !!c.persona, favorites: favorites.length, folds, candidates: Math.round(poolTotal / folds), raw });
    });
  } finally {
    setProfile(original);
  }
  return out;
}

function summarize(raw) {
  const r = raw.ranks.slice().sort((a, b) => a - b), n = r.length;
  const hit = k => +(r.filter(x => x <= k).length / n).toFixed(3);
  return {
    hidden: n,
    hitAt25: hit(25), hitAt100: hit(100), hitAt250: hit(250),
    medianRank: r[Math.floor(n / 2)],
    meanPercentile: +(raw.pcts.reduce((s, x) => s + x, 0) / n).toFixed(1),
    ndcgAt100: +(raw.ndcg.reduce((s, x) => s + x, 0) / raw.ndcg.length).toFixed(3),
  };
}

/* Every measured case summarized, plus the personas pooled into one row (six to eight hidden titles
   each are too few to judge alone; twenty-eight together are not). */
async function measure(page) {
  const cases = await page.evaluate(evalInPage, { cases: CASES });
  const pooledRaw = {};
  cases.filter(c => c.persona).forEach(c => {
    Object.keys(c.raw).forEach(n => {
      const p = pooledRaw[n] || (pooledRaw[n] = { ranks: [], pcts: [], ndcg: [] });
      ['ranks', 'pcts', 'ndcg'].forEach(k => { p[k].push.apply(p[k], c.raw[n][k]); });
    });
  });
  const rows = cases.map(c => ({ name: c.name, persona: c.persona, favorites: c.favorites, folds: c.folds, candidates: c.candidates,
    summary: Object.fromEntries(Object.keys(c.raw).map(n => [n, summarize(c.raw[n])])) }));
  rows.push({ name: 'personas, pooled', pooled: true, favorites: cases.filter(c => c.persona).reduce((s, c) => s + c.favorites, 0),
    summary: Object.fromEntries(Object.keys(pooledRaw).map(n => [n, summarize(pooledRaw[n])])) });
  return { cases: rows };
}

/* What "the engine works" means, as checks. Floors sit a little under what the engine measures
   today (see the report), so a deliberate tuning change has room to move but a regression that
   loses a real share of the hidden favorites fails. Lower mean percentile is better: 5% means the
   average hidden favorite was in the top twentieth of everything untried. */
const CHECKS = [
  ['PK Sample: the engine finds at least 45% of hidden favorites in its top 100 (baseline 13%)',
    m => row(m, 'PK Sample').engine.hitAt100 >= 0.45],
  ['PK Sample: the engine\'s median hidden favorite ranks in the top 130 of ~4,800 (baseline ~600)',
    m => row(m, 'PK Sample').engine.medianRank <= 130],
  ['PK Sample: hand-set boosts, used as the person uses them, do not make the ranking worse',
    m => row(m, 'PK Sample').profile.meanPercentile <= row(m, 'PK Sample').engine.meanPercentile],
  ['personas: from their other five to seven favorites, at least 58% of hidden ones land in the top 100 (baseline 21%)',
    m => row(m, 'personas, pooled').engine.hitAt100 >= 0.58],
  ['personas: the average hidden favorite lands in the top 4% of ~5,000 untried titles (baseline 24%)',
    m => row(m, 'personas, pooled').engine.meanPercentile <= 4],
  ['every persona: the typical hidden favorite ranks in the top 320 of ~5,000 (the comedy lover, the hardest, was 443 before closeness and acclaim weighting)',
    m => m.cases.filter(c => c.persona).every(c => c.summary.engine.medianRank <= 320)],
  ['every profile: the engine ranks hidden favorites far above acclaim alone (mean percentile at most half the baseline\'s)',
    m => m.cases.every(c => c.summary.engine.meanPercentile <= c.summary.baseline.meanPercentile / 2)],
];
function row(m, name) { return m.cases.find(c => c.name === name).summary; }
function verdicts(m) { return CHECKS.map(([label, ok]) => ({ label, ok: !!ok(m) })); }

function report(m, opts) {
  const lines = ['Recommendation quality -- favorites hidden and looked for among everything untried', ''];
  lines.push('profile / ranker              hidden  hit@25  hit@100  hit@250  median rank  mean pctile  ndcg@100');
  m.cases.forEach(c => {
    const head = c.pooled ? c.name : c.name + ' (' + c.favorites + ' favorites, ' + (c.folds === c.favorites ? 'leave-one-out' : c.folds + ' folds') + ', ~' + c.candidates + ' candidates)';
    lines.push(head);
    Object.keys(c.summary).forEach(k => {
      const s = c.summary[k];
      lines.push(('  ' + k).padEnd(30) + String(s.hidden).padStart(7) + String(s.hitAt25).padStart(8) + String(s.hitAt100).padStart(9) +
        String(s.hitAt250).padStart(9) + String(s.medianRank).padStart(13) + (s.meanPercentile + '%').padStart(13) + String(s.ndcgAt100).padStart(10));
    });
  });
  if (!(opts && opts.table)) {
    lines.push('');
    verdicts(m).forEach(v => lines.push((v.ok ? '  ok   - ' : '  FAIL - ') + v.label));
  }
  return lines.join('\n');
}

module.exports = { measure, report, verdicts, CASES };

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
    let failed;
    try {
      const page = await browser.newPage();
      // Local-only: never talk to a real cloud project from a measurement script.
      await page.route('**/supabase-js*/**', r => r.abort());
      await page.goto('file://' + path.join(ROOT, 'index.html'));
      await page.waitForSelector('#onboardSample', { state: 'visible', timeout: 60000 });
      await page.click('#onboardSample');
      await page.waitForFunction(() => window.ALL && window.recomputeProfileDerived && document.querySelector('.cardHead[data-id]'), null, { timeout: 60000 });
      const t0 = Date.now();
      const m = await measure(page);
      failed = verdicts(m).some(v => !v.ok);
      console.log(process.argv.includes('--json') ? JSON.stringify(m, null, 2) : report(m) + '\n\n(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    } finally {
      await browser.close();
    }
    process.exit(failed ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}
