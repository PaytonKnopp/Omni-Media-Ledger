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
 *   3. recency bias   corr(gm, id number). The single number this whole pass is trying to move. It
 *                     should be near zero: when a work was added to the file has nothing to do with
 *                     how well it matches anybody. Measured today: about -0.6 on every medium, and
 *                     WORSE on a blank profile (-0.74 on TV) than on the owner's own -- which is
 *                     the precise sense in which the corpus, not the profile, is biased.
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
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARGV = process.argv.slice(2);
const AS_JSON = ARGV.includes('--json');
const SNAP_AT = ARGV.indexOf('--snapshot');
const SNAP_FILE = SNAP_AT >= 0 ? ARGV[SNAP_AT + 1] : null;

/* ===================== corpus ===================== */

const SECTIONS = [
  { key: 'movies', file: 'data/movies.js', varName: 'movies', kind: 'movie' },
  { key: 'tvShows', file: 'data/tv.js', varName: 'tvShows', kind: 'tv' },
  { key: 'videoGames', file: 'data/games.js', varName: 'videoGames', kind: 'game' },
  { key: 'books', file: 'data/books.js', varName: 'books', kind: 'book' },
];

// The indices whose drift actually reaches a score, per medium. These are the fields the engine
// reads: three of them through bare thresholds, the rest through the gm base term.
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
const dig = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

function loadSections() {
  const out = {};
  for (const sec of SECTIONS) {
    const src = fs.readFileSync(path.join(ROOT, sec.file), 'utf8');
    out[sec.key] = new Function(src + '\nreturn ' + sec.varName + ';')();
  }
  return out;
}

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
    out[sec.key] = {};
    for (const field of DRIFT_FIELDS[sec.key]) {
      const means = cohorts.map(c => {
        const vals = c.map(r => dig(r, field)).filter(v => typeof v === 'number');
        return vals.length ? mean(vals) : null;
      });
      const present = means.filter(v => v != null);
      out[sec.key][field] = {
        cohortMeans: means.map(v => v == null ? null : Math.round(v * 10) / 10),
        spread: present.length ? Math.round((Math.max(...present) - Math.min(...present)) * 10) / 10 : null,
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
    sd: Math.round(sd(gms) * 100) / 100,
    gmBaseSd: Math.round(sd(bases) * 100) / 100,
    boostSd: Math.round(sd(boosts) * 100) / 100,
    // How much of the pre-override score is craft and reception, and how much is the boost stack.
    pctVarianceFromBoosts: varBase + varBoost ? Math.round(100 * varBoost / (varBase + varBoost)) : null,
  };
}

function topConcentration(snapshot) {
  if (!snapshot) return null;
  // The original hand-scored ledger, by ID ceiling per medium (PROV_CEIL in app/ledger-app.js).
  const CEIL = { movie: 221, tv: 144, game: 158, book: 171 };
  const inBlock = w => parseInt(w.id.slice(1)) <= (CEIL[w.kind] || 0);
  const sorted = snapshot.works.slice().sort((a, b) => b.gm - a.gm);
  const blockShare = snapshot.works.filter(inBlock).length / snapshot.works.length;
  return {
    blockShareOfCorpus: Math.round(1000 * blockShare) / 10,
    top100FromBlock: sorted.slice(0, 100).filter(inBlock).length,
    top500FromBlock: sorted.slice(0, 500).filter(inBlock).length,
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
  topConcentration: topConcentration(snapshot),
};

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
    }
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
    console.log('  (should be near zero -- when a work was added has nothing to do with how well it matches)');
    for (const [kind, r] of Object.entries(metrics.recencyBias)) {
      console.log('    ' + kind.padEnd(8) + String(r).padStart(7));
    }
    const s = metrics.scoreShape;
    console.log('\n=== score shape ===');
    console.log('    gm p5/p50/p95 ' + s.p5 + ' / ' + s.p50 + ' / ' + s.p95 + '   range ' + s.min + '-' + s.max);
    console.log('    distinct gm values across the whole corpus: ' + s.distinctValues);
    console.log('    gmBase sd ' + s.gmBaseSd + '   boost sd ' + s.boostSd +
      '   -> ' + s.pctVarianceFromBoosts + '% of pre-override variance is the boost stack');
    const t = metrics.topConcentration;
    console.log('\n=== concentration in the original hand-scored ledger ===');
    console.log('    that block is ' + t.blockShareOfCorpus + '% of the corpus');
    console.log('    but holds ' + t.top100FromBlock + '/100 and ' + t.top500FromBlock + '/500 of the top by gm');
  } else {
    console.log('\n  (pass --snapshot <file> from scripts/score-snapshot.js for gm-based metrics)');
  }
  console.log('');
}
