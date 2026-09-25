/*
 * The composition model shared by scripts/corpus-metrics.js (which measures batch drift) and
 * scripts/calibrate-batch-offsets.js (which removes it). One copy, so the gate and the fix cannot
 * disagree about what counts as drift.
 *
 * Why a model at all
 * ------------------
 * The corpus was not built in random order. Each medium's first batches are its canon; later ones
 * reach into sitcoms, children's books and less-acclaimed films. Those later works SHOULD score
 * lower on dread, cinematography and reception, so raw "mean by id decile" cannot tell a scoring
 * problem from a selection effect, and a gate that demands flat deciles can only be passed by
 * making the data less true. Measured 2026-09-25 on sourced data: IMDb's own user ratings correlate
 * -0.56 (films) and -0.45 (TV) with id order, and still -0.52 / -0.47 with genre and era held fixed.
 *
 * So a field is first regressed on what a work IS -- its genres (taxonomy-expanded, so Slasher
 * counts as Horror), its era, and a reception reference -- and only the residual is read by id.
 * The reception reference is IMDb's rating for film and TV, the one sourced quality signal the
 * corpus has. Games and books have none, so their criticalScore estimate stands in: that removes
 * the canon-first effect, but cannot vouch for criticalScore itself.
 *
 * Even then a smooth slope remains in real data (canon-first selection within a genre and decade),
 * so what is treated as a scoring defect is not the slope but a BATCH OFFSET: a run of consecutive
 * ids whose residual sits well off that slope. Selection changes gradually as a list is worked
 * down; a scale change starts on one id and stops on another. See findBatchOffsets().
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SECTIONS = [
  { key: 'movies', file: 'data/movies.js', varName: 'movies', kind: 'movie' },
  { key: 'tvShows', file: 'data/tv.js', varName: 'tvShows', kind: 'tv' },
  { key: 'videoGames', file: 'data/games.js', varName: 'videoGames', kind: 'game' },
  { key: 'books', file: 'data/books.js', varName: 'books', kind: 'book' },
];

// Rubric-judged fields per medium: the ones a batch offset can be corrected in. Reception
// (criticalScore, audienceScore) is deliberately absent -- RUBRIC.md "Reception fields -- sourced,
// never judged": those values are facts with a source or labelled estimates awaiting one, and a
// statistical adjustment would be neither.
const JUDGED_FIELDS = {
  movies: ['atmosphericDreadIndex', 'ontologicalComplexity', 'physicalMediaFidelity.transferFidelity',
    'physicalMediaFidelity.audioSoundscape', 'physicalMediaFidelity.cinematographyScore',
    'emotionalWarmth', 'comicIntent', 'aestheticBeauty'],
  tvShows: ['atmosphericDreadIndex', 'ontologicalComplexity', 'physicalMediaFidelity.transferFidelity',
    'physicalMediaFidelity.audioSoundscape', 'physicalMediaFidelity.cinematographyScore',
    'emotionalWarmth', 'comicIntent', 'aestheticBeauty'],
  videoGames: ['immersionTensionIndex', 'systemsComplexity', 'engineeringFidelity.engineGraphicsPerformance',
    'engineeringFidelity.artDirection', 'emotionalWarmth', 'comicIntent', 'aestheticBeauty'],
  books: ['atmosphericDreadIndex', 'ontologicalComplexity', 'craft.proseCraft', 'craft.ideaDensity',
    'emotionalWarmth', 'comicIntent', 'aestheticBeauty'],
};

const HAS_IMDB = { movies: true, tvShows: true, videoGames: false, books: false };
const ERA_STEPS = [1940, 1960, 1980, 1990, 2000, 2010, 2020];
const MIN_TAG_COUNT = 15;  // a genre carried by fewer works than this is noise as a control

const dig = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const idNum = r => parseInt(r.id.slice(1));

function loadSections() {
  const out = {};
  for (const sec of SECTIONS) {
    const src = fs.readFileSync(path.join(ROOT, sec.file), 'utf8');
    out[sec.key] = new Function(src + '\nreturn ' + sec.varName + ';')();
  }
  return out;
}

const GENRE_TAXONOMY = new Function(fs.readFileSync(path.join(ROOT, 'data/genre-taxonomy.js'), 'utf8') +
  '\nreturn GENRE_TAXONOMY;')();

function tagsOf(r) {
  const s = new Set();
  (r.genres || []).forEach(g => (GENRE_TAXONOMY[g] || [g]).forEach(t => s.add(t)));
  return s;
}
const imdbOf = r => (r.metrics && r.metrics.audienceSrc && r.metrics.audienceSrc.src === 'IMDb') ? r.metrics.audienceScore : null;

// One design per section, so every field (and gm) is adjusted by the same controls. `field` only
// matters when it is the reception reference itself, which cannot be a control for its own value.
function controlDesign(sectionKey, records, opts) {
  const withReception = !(opts && opts.reception === false);
  const counts = {};
  records.forEach(r => tagsOf(r).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const tags = Object.keys(counts).filter(t => counts[t] >= MIN_TAG_COUNT).sort();
  return (r, field) => {
    const s = tagsOf(r), yr = r.year || 2000;
    const x = [1];
    tags.forEach(t => x.push(s.has(t) ? 1 : 0));
    ERA_STEPS.forEach(d => x.push(yr >= d ? 1 : 0));
    if (!withReception) return x;
    if (HAS_IMDB[sectionKey]) {
      if (field !== 'metrics.audienceScore') { const a = imdbOf(r); x.push(a == null ? 0 : a - 70, a == null ? 1 : 0); }
    } else if (field !== 'metrics.criticalScore') {
      const c = r.metrics && r.metrics.criticalScore; x.push(typeof c === 'number' ? c - 80 : 0);
    }
    return x;
  };
}

// Least squares with a whisper of ridge on everything but the intercept, so a genre dummy that is
// collinear with another (every Slasher is also Horror) cannot make the solve blow up.
function residuals(X, y) {
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const r = X[i];
    for (let j = 0; j < p; j++) { b[j] += r[j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += r[j] * r[k]; }
  }
  for (let j = 1; j < p; j++) A[j][j] += 1e-3 * X.length;
  for (let c = 0; c < p; c++) {
    let m = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
    [A[c], A[m]] = [A[m], A[c]]; [b[c], b[m]] = [b[m], b[c]];
    for (let r = 0; r < p; r++) {
      if (r === c || !A[r][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < p; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const beta = b.map((v, i) => v / A[i][i]);
  return y.map((v, i) => v - X[i].reduce((s, x, j) => s + x * beta[j], 0));
}

/* ===================== batch offsets ===================== */

// A run shorter than this is too few works to call a batch (and a mean over fewer is mostly noise).
const MIN_RUN = 30;
// A boundary is accepted only when the two sides differ this decisively (a two-sample t on the
// detrended residual). Chosen against sourced data: IMDb's ratings for film and TV, run through the
// same test, produce no run at 5 or even 4.5, while TV's 107-show fidelity batch (t157-t263) only
// clears 5, not 6 -- TV has 500 works, so its runs are short. test/composition.js holds both ends.
const MIN_SPLIT_T = 5;

function detrend(e) {
  const n = e.length, mx = (n - 1) / 2, my = mean(e);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (e[i] - my); den += (i - mx) * (i - mx); }
  const slope = den ? num / den : 0;
  return e.map((v, i) => v - (my + slope * (i - mx)));
}

// Binary segmentation: split the series where the mean shift is most decisive, keep going on each
// side while a split stays decisive. Returns [start, end) index runs.
function segment(d) {
  const runs = [];
  (function split(lo, hi) {
    const n = hi - lo;
    if (n < 2 * MIN_RUN) { runs.push([lo, hi]); return; }
    const pre = [0];
    for (let i = lo; i < hi; i++) pre.push(pre[pre.length - 1] + d[i]);
    const tot = pre[n];
    let sd = 0;
    const m0 = tot / n;
    for (let i = lo; i < hi; i++) sd += (d[i] - m0) * (d[i] - m0);
    sd = Math.sqrt(sd / n) || 1;
    let best = 0, at = -1;
    for (let k = MIN_RUN; k <= n - MIN_RUN; k++) {
      const m1 = pre[k] / k, m2 = (tot - pre[k]) / (n - k);
      const t = Math.abs(m1 - m2) / (sd * Math.sqrt(1 / k + 1 / (n - k)));
      if (t > best) { best = t; at = k; }
    }
    if (best < MIN_SPLIT_T) { runs.push([lo, hi]); return; }
    split(lo, lo + at);
    split(lo + at, hi);
  })(0, d.length);
  return runs.sort((a, b) => a[0] - b[0]);
}

/* For one field of one medium: the runs of consecutive ids whose composition-adjusted residual sits
   off the smooth trend, and by how much. The trend is re-fitted after each pass with the runs
   already removed, so one badly offset batch cannot tilt the line it is measured against.
   Returns records in id order alongside, so a caller can apply the offsets. */
function findBatchOffsets(sectionKey, records, field) {
  const sorted = records.slice().sort((a, b) => idNum(a) - idNum(b)).filter(r => typeof dig(r, field) === 'number');
  const design = controlDesign(sectionKey, records);
  const e = residuals(sorted.map(r => design(r, field)), sorted.map(r => dig(r, field)));
  let offsets = new Array(e.length).fill(0), runs = [];
  for (let pass = 0; pass < 3; pass++) {
    const d = detrend(e.map((v, i) => v - offsets[i]));
    const trendOnly = e.map((v, i) => v - offsets[i] - d[i]);
    runs = segment(e.map((v, i) => v - trendOnly[i])).map(([lo, hi]) => {
      const seg = e.slice(lo, hi).map((v, k) => v - trendOnly[lo + k]);
      return { lo, hi, from: sorted[lo].id, to: sorted[hi - 1].id, n: hi - lo, offset: mean(seg) };
    });
    // The corpus-wide level is the reference, so offsets are relative to the size-weighted mean.
    const level = runs.reduce((s, r) => s + r.offset * r.n, 0) / e.length;
    runs.forEach(r => { r.offset -= level; });
    offsets = new Array(e.length).fill(0);
    runs.forEach(r => { for (let i = r.lo; i < r.hi; i++) offsets[i] = r.offset; });
  }
  runs.forEach(r => { r.offset = Math.round(r.offset * 10) / 10; });
  return { sorted, runs };
}

/* ===================== what counts as a defect, and what was decided ===================== */

// A run is a defect candidate only when all three hold. The median guards against one outlier
// carrying the mean (Avatar: The Way of Water at dread 1 was enough to flag a 114-film run), and
// the direction share against a run that is really two groups pulling opposite ways.
const FLAG_MIN_OFFSET = 5;
const FLAG_MIN_SAME_DIRECTION = 0.8;

function flaggedRuns(sectionKey, records, field) {
  const { sorted, runs } = findBatchOffsets(sectionKey, records, field);
  const design = controlDesign(sectionKey, records);
  const e = residuals(sorted.map(r => design(r, field)), sorted.map(r => dig(r, field)));
  return runs.filter(r => Math.abs(r.offset) >= FLAG_MIN_OFFSET).map(r => {
    const s = e.slice(r.lo, r.hi).sort((a, b) => a - b);
    const median = s[Math.floor(s.length / 2)];
    const sameDirection = s.filter(v => Math.sign(v) === Math.sign(r.offset)).length / s.length;
    return Object.assign({ section: sectionKey, field, median: Math.round(median * 10) / 10,
      sameDirection: Math.round(sameDirection * 100) / 100 }, r);
  }).filter(r => Math.abs(r.median) >= FLAG_MIN_OFFSET && r.sameDirection >= FLAG_MIN_SAME_DIRECTION);
}

/* Every run the detector flags has to be accounted for here, one way or the other, or the gate in
   scripts/corpus-metrics.js fails. Reviewed 2026-09-25 by reading each run's titles against the
   value the rest of the corpus predicts for the same genre, era and acclaim.

   verdict 'corrected': a batch scored on its own scale. scripts/calibrate-batch-offsets.js shifts
   the run by its measured offset, which keeps every judgement inside it (order, gaps, genre
   differences) and only moves where the batch sits. Once applied the run is no longer detected,
   so an entry here that is detected again means the data regressed.

   verdict 'real': the residual has an explanation the controls cannot see, almost always genre
   tags looser than the works (classic musicals tagged Comedy, children's books tagged only Drama,
   Roth and Bellow tagged Comedy/Drama). The values were read and are right; left alone. */
const REVIEWED_RUNS = [
  { section: 'books', field: 'craft.ideaDensity', from: 'b1009', to: 'b1232', verdict: 'corrected',
    why: 'First Phase 45 wave, scored 15-38 points under the rest of the file genre for genre (Literary Fiction 33 vs 71, Sci-Fi 38 vs 70; The Grapes of Wrath at 40). A scale, not the books.' },
  { section: 'books', field: 'craft.ideaDensity', from: 'b01', to: 'b170', verdict: 'corrected',
    why: 'The original hand-scored block, inflated: Mexican Gothic 80, The Doors of Stone 86 against ~55 expected. 86% of the run sits high.' },
  { section: 'books', field: 'aestheticBeauty', from: 'b1007', to: 'b1111', verdict: 'corrected',
    why: 'Same first expansion wave; 99% of it under expectation (Reaper Man 55, Abaddon\'s Gate 55).' },
  { section: 'books', field: 'aestheticBeauty', from: 'b1206', to: 'b1252', verdict: 'corrected',
    why: 'Tail of the same wave; 91% under (The Last Olympian 52, The Path of Daggers 48).' },
  { section: 'tvShows', field: 'physicalMediaFidelity.transferFidelity', from: 't157', to: 't263', verdict: 'corrected',
    why: 'The TV 150->250 batch; 83% under expectation across dramas, sitcoms and anime alike.' },
  { section: 'tvShows', field: 'physicalMediaFidelity.audioSoundscape', from: 't168', to: 't263', verdict: 'corrected',
    why: 'Same batch; 91% under (Oz 52, Doctor Who 50, Black Books 50 against 62-67 expected).' },
  { section: 'movies', field: 'physicalMediaFidelity.audioSoundscape', from: 'm554', to: 'm758', verdict: 'corrected',
    why: 'One lane of the 500->999 expansion; 85% under with era already held fixed (The Little Mermaid 74, A Fish Called Wanda 64).' },

  { section: 'movies', field: 'physicalMediaFidelity.audioSoundscape', from: 'm1907', to: 'm1977', verdict: 'corrected',
    why: 'Surfaced once m554-m758 was corrected and the trend refitted; 97% under with genres the controls cover (The Hate U Give 64, The Ides of March 68 against ~80 expected).' },

  { section: 'movies', field: 'comicIntent', from: 'm1986', to: 'm2027', verdict: 'real',
    why: 'Classic musicals tagged Comedy (Oklahoma!, Easter Parade); light, not primarily comic. 32-42 is right.' },
  { section: 'books', field: 'craft.proseCraft', from: 'b1433', to: 'b1465', verdict: 'real',
    why: 'Mass-market bestsellers (Clancy, Patterson, Sparks); lower prose craft than their genre\'s literary end is the point of the field.' },
  { section: 'books', field: 'craft.proseCraft', from: 'b1545', to: 'b1613', verdict: 'real',
    why: 'Acclaimed stylists shelved under genre tags (The Long Goodbye, Alias Grace, Dandelion Wine).' },
  { section: 'books', field: 'craft.proseCraft', from: 'b1715', to: 'b1747', verdict: 'real',
    why: 'Children\'s books tagged only Drama/Comedy (Judy Blume, Beverly Cleary); the controls expect adult fiction.' },
  { section: 'books', field: 'craft.proseCraft', from: 'b1911', to: 'b2016', verdict: 'real',
    why: 'Literary comedy tagged Comedy/Drama (Bellow, Roth, Nabokov, Pynchon, DeLillo); the controls expect Wodehouse.' },
  { section: 'books', field: 'ontologicalComplexity', from: 'b1934', to: 'b2016', verdict: 'real',
    why: 'Same literary-comedy batch (Lost in the Funhouse, Brief Interviews with Hideous Men).' },
  { section: 'books', field: 'craft.ideaDensity', from: 'b1705', to: 'b1911', verdict: 'real',
    why: 'Light classics read correctly by the rubric: Leave It to Psmith 20, Cards on the Table 32, Captain Blood 26.' },
  { section: 'books', field: 'craft.ideaDensity', from: 'b1912', to: 'b2016', verdict: 'real',
    why: 'The literary-comedy batch again.' },
  { section: 'books', field: 'emotionalWarmth', from: 'b1913', to: 'b2016', verdict: 'real',
    why: 'The literary-comedy batch: Roth and Bellow are not warm.' },
  { section: 'books', field: 'aestheticBeauty', from: 'b1549', to: 'b1583', verdict: 'real',
    why: 'Noir and literary stylists (Chandler, Highsmith, Bradbury); beauty above genre expectation is right.' },
];

// A reviewed entry covers a detected run when they share a field and most of their ids.
function reviewFor(run) {
  const lo = idNum({ id: run.from }), hi = idNum({ id: run.to });
  return REVIEWED_RUNS.find(v => {
    if (v.section !== run.section || v.field !== run.field) return false;
    const a = idNum({ id: v.from }), b = idNum({ id: v.to });
    const overlap = Math.min(hi, b) - Math.max(lo, a) + 1;
    return overlap > 0.5 * Math.min(hi - lo + 1, b - a + 1);
  }) || null;
}

module.exports = {
  FLAG_MIN_OFFSET, FLAG_MIN_SAME_DIRECTION, flaggedRuns, REVIEWED_RUNS, reviewFor,
  ROOT, SECTIONS, JUDGED_FIELDS, HAS_IMDB, dig, mean, idNum, loadSections, tagsOf, imdbOf,
  controlDesign, residuals, detrend, segment, findBatchOffsets, MIN_RUN, MIN_SPLIT_T,
};
