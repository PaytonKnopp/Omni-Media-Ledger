#!/usr/bin/env node
/*
 * Corpus health metrics: the measurements the quality pass is steering by.
 *
 * scripts/validate-corpus.js answers "is any single record wrong?". This answers a different and,
 * for recommendation quality, more important question: "is the corpus internally consistent with
 * itself?" A corpus can pass every per-record check and still rank badly, because the defects that
 * matter most are relational -- a field that means one thing in the first 200 records and something
 * else in the last 200 is wrong in a way no per-record rule can see.
 *
 * The three metrics here, and what each is for:
 *
 *   1. batch drift    Mean of each index by ID decile. Records were added in large batches, and a
 *                     batch that scored a field generously is permanently advantaged, because the
 *                     scoring engine keys three of its boosts on bare thresholds (myst>70, tech>85,
 *                     dread>80). Measured today: movies' dread ranges from 82.3 to 28.3 across
 *                     deciles, TV's from 82.1 to 13.9.
 *
 *   2. cohort separation
 *                     Inside each decile, does the field still separate works that obviously differ
 *                     (horror vs comedy on dread)? This is the metric that decides how a field gets
 *                     fixed. Strong separation everywhere means the ordering inside each batch is
 *                     real judgement and only the scale drifted -- calibration preserves the signal.
 *                     Weak separation means the field is closer to noise and needs re-scoring
 *                     against the rubric. Guessing wrong here either destroys hand-curated signal
 *                     or leaves a broken field in place, so it is measured, not assumed.
 *
 *   3. recency bias   corr(gm, id number). Near zero would mean "when a work was added has nothing
 *                     to do with how it scores" -- but the corpus was built canon-first, so real
 *                     quality falls with id too (IMDb: -0.56 films, -0.45 TV). Raw, it is reported;
 *                     the gated reading compares gm against that sourced reference instead.
 *
 *   4. batch offsets  The gated form of drift: runs of consecutive ids whose value sits off what
 *                     genre, era and acclaim predict, beyond the smooth canon-first slope. Every
 *                     run found has to be reviewed in scripts/composition.js REVIEWED_RUNS --
 *                     corrected (scripts/calibrate-batch-offsets.js) or explained -- or the gate fails.
 *
 *   node scripts/corpus-metrics.js                    all metrics from data/ alone
 *   node scripts/corpus-metrics.js --snapshot s.json  ...plus the gm metrics, from a real snapshot
 *   node scripts/corpus-metrics.js --json             machine-readable, for tests and CI
 *
 * gm is only reported when a snapshot is supplied, because computing it here would mean keeping a
 * second copy of the scoring engine -- and a second copy silently disagrees with the shipped one
 * exactly when it matters. scripts/score-snapshot.js reads the real thing.
 */
const fs = require('fs');
const C = require('./composition.js');
const { SECTIONS, JUDGED_FIELDS, HAS_IMDB, dig, mean, idNum, loadSections, imdbOf, controlDesign, residuals } = C;

const ARGV = process.argv.slice(2);
const AS_JSON = ARGV.includes('--json');
const ASSERT = ARGV.includes('--assert');
const SNAP_AT = ARGV.indexOf('--snapshot');
const SNAP_FILE = SNAP_AT >= 0 ? ARGV[SNAP_AT + 1] : null;

/* ===================== corpus ===================== */

// The indices whose drift actually reaches a score, per medium, plus reception. Reported by decile,
// raw and composition-adjusted; the gate reads batchOffsets() instead (see its comment).
const DRIFT_FIELDS = {
  movies: ['atmosphericDreadIndex', 'ontologicalComplexity', 'physicalMediaFidelity.transferFidelity',
    'physicalMediaFidelity.audioSoundscape', 'physicalMediaFidelity.cinematographyScore',
    'metrics.criticalScore', 'metrics.audienceScore'],
  tvShows: ['atmosphericDreadIndex', 'ontologicalComplexity', 'physicalMediaFidelity.transferFidelity',
    'physicalMediaFidelity.audioSoundscape', 'physicalMediaFidelity.cinematographyScore',
    'metrics.criticalScore', 'metrics.audienceScore'],
  videoGames: ['immersionTensionIndex', 'systemsComplexity',
    'engineeringFidelity.engineGraphicsPerformance', 'engineeringFidelity.artDirection',
    'metrics.criticalScore', 'metrics.audienceScore'],
  books: ['atmosphericDreadIndex', 'ontologicalComplexity', 'craft.proseCraft', 'craft.ideaDensity',
    'metrics.criticalScore', 'metrics.audienceScore'],
};

// Probes for the separation test: a field, and two genre groups that should sit far apart on it if
// the field means anything at all. Deliberately obvious pairs -- the test is "does this field still
// carry its own definition inside every batch", not "is every value right".
const SEPARATION_PROBES = [
  { section: 'movies', field: 'atmosphericDreadIndex', high: /horror|slasher|giallo/i, low: /comedy|romance|musical/i, label: 'horror vs comedy' },
  { section: 'movies', field: 'ontologicalComplexity', high: /surreal|philosophical|metafiction|psychological/i, low: /action|comedy|sports|heist/i, label: 'surreal/philosophical vs action/comedy' },
  { section: 'tvShows', field: 'atmosphericDreadIndex', high: /horror|thriller|crime/i, low: /comedy|sitcom|romance/i, label: 'horror/thriller vs comedy' },
  { section: 'books', field: 'ontologicalComplexity', high: /philosophy|physics|metafiction|postmodern|cosmology/i, low: /romance|thriller|mystery|memoir/i, label: 'philosophy/physics vs romance/thriller' },
  { section: 'books', field: 'atmosphericDreadIndex', high: /horror|gothic|weird fiction/i, low: /romance|comedy|children/i, label: 'horror/gothic vs romance/comedy' },
  { section: 'videoGames', field: 'immersionTensionIndex', high: /horror|survival/i, low: /platformer|puzzle|party|racing/i, label: 'horror/survival vs platformer/puzzle' },
];

const DECILES = 10;

// Records in ID order, split into equal cohorts. ID order is import order, which is what makes the
// cohorts stand in for the batches the corpus was actually built in.
function cohortsOf(records) {
  const sorted = records.slice().sort((a, b) => parseInt(a.id.slice(1)) - parseInt(b.id.slice(1)));
  const size = Math.ceil(sorted.length / DECILES);
  const out = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

function pearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  if (!da || !db) return null;
  return num / Math.sqrt(da * db);
}

/* ===================== metrics ===================== */

function driftMetrics(loaded) {
  const out = {};
  for (const sec of SECTIONS) {
    const cohorts = cohortsOf(loaded[sec.key]);
    const design = controlDesign(sec.key, loaded[sec.key]);
    const spreadOf = a => { const p = a.filter(v => v != null); return p.length ? Math.round((Math.max(...p) - Math.min(...p)) * 10) / 10 : null; };
    const r1 = v => v == null ? null : Math.round(v * 10) / 10;
    out[sec.key] = {};
    for (const field of DRIFT_FIELDS[sec.key]) {
      const means = cohorts.map(c => {
        const vals = c.map(r => dig(r, field)).filter(v => typeof v === 'number');
        return vals.length ? mean(vals) : null;
      });
      // The same cohorts, read through the residual of the composition model above.
      const rows = [];
      cohorts.forEach((c, ci) => c.forEach(r => { const v = dig(r, field); if (typeof v === 'number') rows.push({ ci, r, v }); }));
      const e = residuals(rows.map(o => design(o.r, field)), rows.map(o => o.v));
      const adj = cohorts.map((_, ci) => { const es = e.filter((_, k) => rows[k].ci === ci); return es.length ? mean(es) : null; });
      out[sec.key][field] = {
        cohortMeans: means.map(r1),
        spread: spreadOf(means),
        adjustedCohortMeans: adj.map(r1),
        adjustedSpread: spreadOf(adj),
        ranges: cohorts.map(c => c[0].id + '-' + c[c.length - 1].id),
      };
    }
  }
  return out;
}

function separationMetrics(loaded) {
  return SEPARATION_PROBES.map(p => {
    const cohorts = cohortsOf(loaded[p.section]);
    const perCohort = cohorts.map(c => {
      const hi = c.filter(r => p.high.test(r.genres.join(' '))).map(r => dig(r, p.field));
      const lo = c.filter(r => p.low.test(r.genres.join(' '))).map(r => dig(r, p.field));
      if (!hi.length || !lo.length) return { n: [hi.length, lo.length], separation: null };
      return { n: [hi.length, lo.length], separation: Math.round((mean(hi) - mean(lo)) * 10) / 10 };
    });
    const seps = perCohort.map(c => c.separation).filter(v => v != null);
    return {
      section: p.section, field: p.field, label: p.label,
      perCohort,
      // The weakest cohort is what matters, not the average: one batch where the field stopped
      // meaning anything is enough to make calibration the wrong fix for that batch.
      minSeparation: seps.length ? Math.min(...seps) : null,
      medianSeparation: seps.length ? seps.slice().sort((a, b) => a - b)[Math.floor(seps.length / 2)] : null,
      cohortsMeasured: seps.length,
    };
  });
}

function recencyBias(snapshot) {
  if (!snapshot) return null;
  const out = {};
  for (const sec of SECTIONS) {
    const works = snapshot.works.filter(w => w.kind === sec.kind);
    if (works.length < 2) continue;
    const r = pearson(works.map(w => w.gm), works.map(w => parseInt(w.id.slice(1))));
    out[sec.kind] = r == null ? null : Math.round(r * 1000) / 1000;
  }
  return out;
}

/* The gated reading. gm and id order are both residualised on genre and era (not on reception:
   reception is part of what gm is), and their partial correlation is compared with the same
   partial correlation for IMDb's rating -- how much real, sourced quality falls with id order among
   works of the same genre and decade. gm may be no more order-dependent than that plus a margin.
   Games and books have no sourced reference; they are held to the larger of the film and TV
   figures, a proxy that rests on every medium having been built the same canon-first way. */
function recencyVsReference(snapshot, loaded) {
  if (!snapshot) return null;
  const out = {};
  for (const sec of SECTIONS) {
    const byId = new Map(loaded[sec.key].map(r => [r.id, r]));
    const works = snapshot.works.filter(w => w.kind === sec.kind && byId.has(w.id) && typeof w.gm === 'number');
    if (works.length < 50) continue;
    const design = controlDesign(sec.key, loaded[sec.key], { reception: false });
    const X = works.map(w => design(byId.get(w.id)));
    const gm = pearson(residuals(X, works.map(w => w.gm)), residuals(X, works.map(idNum)));
    let reference = null;
    if (HAS_IMDB[sec.key]) {
      const wi = works.filter(w => imdbOf(byId.get(w.id)) != null);
      const Xi = wi.map(w => design(byId.get(w.id)));
      reference = pearson(residuals(Xi, wi.map(w => imdbOf(byId.get(w.id)))), residuals(Xi, wi.map(idNum)));
    }
    out[sec.kind] = { gm: Math.round(gm * 1000) / 1000, imdb: reference == null ? null : Math.round(reference * 1000) / 1000 };
  }
  const refs = Object.values(out).map(v => v.imdb).filter(v => v != null);
  const proxy = refs.length ? Math.max(...refs.map(Math.abs)) : null;
  for (const v of Object.values(out)) { v.reference = v.imdb != null ? Math.abs(v.imdb) : proxy; v.referenceIsProxy = v.imdb == null; }
  return out;
}

/* Every run of consecutive ids the detector in scripts/composition.js finds off its expected level,
   with its review status. Data only -- needs no snapshot. */
function batchOffsets(loaded) {
  const out = [];
  for (const sec of SECTIONS) {
    for (const field of JUDGED_FIELDS[sec.key]) {
      for (const run of C.flaggedRuns(sec.key, loaded[sec.key], field)) {
        const review = C.reviewFor(run);
        out.push({ section: sec.key, field, from: run.from, to: run.to, n: run.n, offset: run.offset,
          median: run.median, sameDirection: run.sameDirection,
          status: review ? review.verdict : 'unreviewed' });
      }
    }
  }
  return out;
}

function scoreShape(snapshot) {
  if (!snapshot) return null;
  const gms = snapshot.works.map(w => w.gm).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const bases = snapshot.works.map(w => w.gmBase).filter(v => typeof v === 'number');
  const boosts = snapshot.works.map(w => w.gmBoostTotal).filter(v => typeof v === 'number');
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
  const q = p => gms[Math.floor(gms.length * p)];
  const varBase = sd(bases) ** 2, varBoost = sd(boosts) ** 2;
  return {
    profile: snapshot.profile,
    p5: q(0.05), p50: q(0.5), p95: q(0.95), min: gms[0], max: gms[gms.length - 1],
    distinctValues: new Set(gms).size,
    // gm is shown as a whole number from 40 to 99, so ~60 distinct values is the most it can ever
    // take. Resolution is therefore read as how much of its own integer span it actually uses, and
    // how big the largest tie is (the list order breaks ties by critic score).
    integerCoverage: Math.round(1000 * new Set(gms).size / (gms[gms.length - 1] - gms[0] + 1)) / 1000,
    largestTiePct: Math.round(1000 * Math.max(...Object.values(gms.reduce((c, v) => { c[v] = (c[v] || 0) + 1; return c; }, {}))) / gms.length) / 10,
    sd: Math.round(sd(gms) * 100) / 100,
    gmBaseSd: Math.round(sd(bases) * 100) / 100,
    boostSd: Math.round(sd(boosts) * 100) / 100,
    // How much of the pre-override score is craft and reception, and how much is the boost stack.
    pctVarianceFromBoosts: varBase + varBoost ? Math.round(100 * varBoost / (varBase + varBoost)) : null,
  };
}

function topConcentration(snapshot, loaded) {
  if (!snapshot) return null;
  // The original hand-scored ledger, by ID ceiling per medium. These ceilings used to double as
  // the app's provenance rule until that was replaced by a per-record stamp; they survive here
  // because the block is still a real thing to measure -- it is the cohort that batch drift
  // advantaged, and "how much of the top 100 does it hold?" is the clearest reading of the damage.
  const CEIL = { movie: 221, tv: 144, game: 158, book: 171 };
  const inBlock = w => parseInt(w.id.slice(1)) <= (CEIL[w.kind] || 0);
  const sorted = snapshot.works.slice().sort((a, b) => b.gm - a.gm);
  const blockShare = snapshot.works.filter(inBlock).length / snapshot.works.length;
  // The block is the canon, so it SHOULD hold more than its share of the top. The gated reading
  // compares against a sourced reference: among films and TV, how many of the top 100 by gm come
  // from the block, against how many of the top 100 by IMDb rating do.
  const imdb = new Map();
  for (const sec of SECTIONS.filter(s => HAS_IMDB[s.key])) loaded[sec.key].forEach(r => { const a = imdbOf(r); if (a != null) imdb.set(r.id, a); });
  const av = snapshot.works.filter(w => (w.kind === 'movie' || w.kind === 'tv') && imdb.has(w.id));
  const byGm = av.slice().sort((a, b) => b.gm - a.gm).slice(0, 100).filter(inBlock).length;
  const byImdb = av.slice().sort((a, b) => imdb.get(b.id) - imdb.get(a.id)).slice(0, 100).filter(inBlock).length;
  return {
    blockShareOfCorpus: Math.round(1000 * blockShare) / 10,
    top100FromBlock: sorted.slice(0, 100).filter(inBlock).length,
    top500FromBlock: sorted.slice(0, 500).filter(inBlock).length,
    filmTvTop100FromBlockByGm: byGm,
    filmTvTop100FromBlockByImdb: byImdb,
  };
}

/* ===================== report ===================== */

const loaded = loadSections();
const snapshot = SNAP_FILE ? JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')) : null;

const metrics = {
  drift: driftMetrics(loaded),
  separation: separationMetrics(loaded),
  recencyBias: recencyBias(snapshot),
  scoreShape: scoreShape(snapshot),
  recencyVsReference: recencyVsReference(snapshot, loaded),
  batchOffsets: batchOffsets(loaded),
  topConcentration: topConcentration(snapshot, loaded),
};

/* ===================== Phase 5 acceptance gate ===================== */

/* --assert is the executable definition of "the corpus is consistent with itself". Every
   threshold is set against something real rather than an ideal: the recency row against how much
   sourced IMDb quality itself falls with id order, the concentration row against which works IMDb
   ranks highest, the batch row against a detector that finds nothing in IMDb's own numbers.

   The first version of this gate (2026-09) demanded |corr(gm, id)| <= 0.15, at most 40/100 of the
   top from the original block, decile means within 25 points, and 200 distinct gm values. None of
   those could be met honestly: real quality falls with id order (the canon went in first), the
   original block IS the canon, a decile of musicals should differ from a decile of horror, and gm
   is a whole number from 40 to 99 -- sixty values at most. Chasing them would have meant making
   the data less true, so they were replaced (NOTES.md Phase 51) by the rows below.

   Without --snapshot, only the data rows run (batch offsets), which need no browser: that is the
   form `npm run test-fast` runs. With a snapshot the gm rows run too; CI runs both profiles. */
const GATE = {
  recencyMargin: 0.05,         // gm may not fall with id order more than this beyond RECENCY_GUARD
  concentrationMargin: 15,     // blank profile: film/TV top 100 from the block, vs IMDb's top 100
  minIntegerCoverage: 0.9,     // gm must use nearly every whole number in its own range
  maxLargestTiePct: 8,         // and no single value may hold more than this share of the corpus
};

/* The recency row is a guard against getting worse, not a claim of being right. gm is compared
   with IMDb's rating above, and on 2026-09-25 (blank profile) sat 0.08 (films) and 0.12 (TV) more
   order-dependent than it. That excess cannot be judged honestly: gm averages several inputs that
   all track how canonical a work is, and an average tracks a shared factor more tightly than any
   one input does, so a composite beats a single measure's correlation even when every input is
   honest. There is no sourced composite to compare with. What CAN be held is that a new batch or an
   engine change does not make it worse, so the measured values are pinned here (|partial r|, genre
   and era held fixed) and the row fails past them + recencyMargin. Lower them when a change
   earns it; raise them only with a stated reason. */
const RECENCY_GUARD = {
  blank: { movie: 0.596, tv: 0.588, game: 0.492, book: 0.590 },
  pk: { movie: 0.474, tv: 0.565, game: 0.474, book: 0.379 },
};

if (ASSERT) {
  const problems = [];
  for (const b of metrics.batchOffsets.filter(b => b.status === 'unreviewed')) {
    problems.push('batch offset: ' + b.section + '.' + b.field + ' ' + b.from + '-' + b.to + ' (' + b.n +
      ' works) sits ' + b.offset + ' off its expected level (median ' + b.median + ', ' +
      Math.round(100 * b.sameDirection) + '% one way) -- review it in scripts/composition.js REVIEWED_RUNS');
  }
  for (const b of metrics.batchOffsets.filter(b => b.status === 'corrected')) {
    problems.push('batch offset: ' + b.section + '.' + b.field + ' ' + b.from + '-' + b.to +
      ' was corrected but is detected again (offset ' + b.offset + ') -- run scripts/calibrate-batch-offsets.js');
  }
  if (snapshot) {
    const guard = RECENCY_GUARD[snapshot.profile] || {};
    for (const [kind, v] of Object.entries(metrics.recencyVsReference)) {
      if (guard[kind] == null) continue;
      if (Math.abs(v.gm) > guard[kind] + GATE.recencyMargin) {
        problems.push('recency bias: ' + kind + ' gm falls with id order at ' + v.gm + ' (genre and era held fixed; ' +
          (v.referenceIsProxy ? 'film/TV IMDb reference ' : 'IMDb\'s own ') + '-' + v.reference.toFixed(3) + '), worse than the ' +
          guard[kind] + ' pinned in RECENCY_GUARD + ' + GATE.recencyMargin);
      }
    }
    const t = metrics.topConcentration;
    if (snapshot.profile === 'blank' && t.filmTvTop100FromBlockByGm > t.filmTvTop100FromBlockByImdb + GATE.concentrationMargin) {
      problems.push('concentration: ' + t.filmTvTop100FromBlockByGm + ' of the film/TV top 100 come from the original block, ' +
        'against ' + t.filmTvTop100FromBlockByImdb + ' of IMDb\'s top 100; want <= ' + (t.filmTvTop100FromBlockByImdb + GATE.concentrationMargin));
    }
    const shape = metrics.scoreShape;
    if (shape.integerCoverage < GATE.minIntegerCoverage || shape.largestTiePct > GATE.maxLargestTiePct) {
      problems.push('score resolution: gm uses ' + Math.round(100 * shape.integerCoverage) + '% of the whole numbers from ' +
        shape.min + ' to ' + shape.max + ' and its largest tie holds ' + shape.largestTiePct + '% of the corpus; want >= ' +
        Math.round(100 * GATE.minIntegerCoverage) + '% and <= ' + GATE.maxLargestTiePct + '%');
    }
  }
  const scope = snapshot ? 'the ' + snapshot.profile + ' profile' : 'the data (no --snapshot: gm rows skipped)';
  if (problems.length) {
    console.error('\nFAIL - ' + scope + ' does not meet the corpus consistency gate:');
    problems.forEach(l => console.error('  - ' + l));
    console.error('');
    process.exit(1);
  }
  console.log('PASS - ' + scope + ' meets the corpus consistency gate (' + metrics.batchOffsets.length +
    ' flagged batch runs, all reviewed' + (snapshot ? '; recency within its guard, concentration and resolution within bounds' : '') + ').');
  process.exit(0);
}

if (AS_JSON) {
  console.log(JSON.stringify(metrics, null, 1));
} else {
  console.log('\n=== batch drift: mean by ID decile ===');
  console.log('  (spread = highest cohort mean minus lowest; a big number means one field means');
  console.log('   different things in different parts of the file)');
  for (const sec of SECTIONS) {
    console.log('\n  ' + sec.key);
    for (const [field, d] of Object.entries(metrics.drift[sec.key])) {
      console.log('    ' + field.padEnd(46) + 'spread ' + String(d.spread).padStart(6) +
        '   ' + d.cohortMeans.map(v => String(v).padStart(5)).join(''));
      console.log('    ' + '  ...composition-adjusted'.padEnd(46) + 'spread ' + String(d.adjustedSpread).padStart(6) +
        '   ' + d.adjustedCohortMeans.map(v => String(v).padStart(5)).join(''));
    }
  }

  console.log('\n=== batch offsets: runs of ids off what genre, era and acclaim predict (the gated form) ===');
  if (!metrics.batchOffsets.length) console.log('    none');
  for (const b of metrics.batchOffsets) {
    console.log('    ' + (b.section + '.' + b.field).padEnd(52) + (b.from + '-' + b.to).padEnd(13) + 'offset ' +
      String(b.offset).padStart(6) + '  median ' + String(b.median).padStart(6) + '  ' + b.status);
  }

  console.log('\n=== cohort separation: does the field still mean what it says, inside each batch? ===');
  console.log('  (min = the weakest cohort. High everywhere -> the scale drifted but the ordering is');
  console.log('   real, so calibrate. Low -> the field is closer to noise there, so re-score.)');
  for (const s of metrics.separation) {
    console.log('\n  ' + s.section + '.' + s.field + '  (' + s.label + ')');
    console.log('    min ' + String(s.minSeparation).padStart(6) + '   median ' + String(s.medianSeparation).padStart(6) +
      '   measured in ' + s.cohortsMeasured + '/' + DECILES + ' cohorts');
    console.log('    per cohort: ' + s.perCohort.map(c => c.separation == null ? '    -' : String(c.separation).padStart(5)).join(''));
  }

  if (snapshot) {
    console.log('\n=== recency bias: corr(gm, id number)  [profile: ' + snapshot.profile + '] ===');
    console.log('  (real quality falls with id too -- the canon went in first -- so IMDb is shown alongside)');
    for (const [kind, r] of Object.entries(metrics.recencyBias)) {
      const v = metrics.recencyVsReference[kind];
      console.log('    ' + kind.padEnd(8) + String(r).padStart(7) + '    genre & era held fixed: gm ' + String(v.gm).padStart(7) +
        (v.imdb != null ? '   IMDb ' + String(v.imdb).padStart(7) : '   (no sourced reference)'));
    }
    const s = metrics.scoreShape;
    console.log('\n=== score shape ===');
    console.log('    gm p5/p50/p95 ' + s.p5 + ' / ' + s.p50 + ' / ' + s.p95 + '   range ' + s.min + '-' + s.max);
    console.log('    distinct gm values across the whole corpus: ' + s.distinctValues + ' (' + Math.round(100 * s.integerCoverage) +
      '% of the whole numbers in its range; largest tie ' + s.largestTiePct + '% of the corpus)');
    console.log('    gmBase sd ' + s.gmBaseSd + '   boost sd ' + s.boostSd +
      '   -> ' + s.pctVarianceFromBoosts + '% of pre-override variance is the boost stack');
    const t = metrics.topConcentration;
    console.log('\n=== concentration in the original hand-scored ledger ===');
    console.log('    that block is ' + t.blockShareOfCorpus + '% of the corpus');
    console.log('    but holds ' + t.top100FromBlock + '/100 and ' + t.top500FromBlock + '/500 of the top by gm');
    console.log('    among films and TV: ' + t.filmTvTop100FromBlockByGm + ' of the top 100 by gm, ' + t.filmTvTop100FromBlockByImdb + ' of the top 100 by IMDb rating');
  } else {
    console.log('\n  (pass --snapshot <file> from scripts/score-snapshot.js for gm-based metrics)');
  }
  console.log('');
}
