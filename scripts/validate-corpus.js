#!/usr/bin/env node
/*
 * Data-quality gate for the corpus files in data/.
 *
 * This started as a structural check (no duplicate IDs, no duplicate titles, required fields
 * present) and that layer is still here, unchanged, at the top. Everything below it exists
 * because "the field is present" turned out to be a very weak definition of "the data is good":
 * a field can be present and still hold a placeholder, a value from the wrong vocabulary, a
 * number outside its scale, or a creator's name spelled a second way -- and every one of those
 * degrades match scores and recommendations silently, with no error anywhere.
 *
 * The rule of thumb for what belongs here: if getting it wrong would quietly make the taste
 * engine worse rather than visibly break something, it needs a check, because nothing else is
 * going to catch it.
 *
 *   node scripts/validate-corpus.js            check; exit 1 on any failure
 *   node scripts/validate-corpus.js --report    check, then print a corpus health report
 *                                               (vocabularies, ranges, next free IDs)
 *
 * Failures are things that are wrong: out-of-range scores, unknown vocabulary values, a work no
 * genre family can see, two spellings of one creator. Warnings are things worth a human's eye but
 * legitimately a judgement call -- they never fail the build.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT = process.argv.includes('--report');

/* ===================== what each medium is required to look like ===================== */

// 0-100 index fields. Every one of these feeds the scoring engine directly, so a value outside
// the scale doesn't error -- it just silently distorts every match score derived from it.
const SCALE_FIELDS = {
  movies: ['metrics.criticalScore', 'metrics.audienceScore', 'physicalMediaFidelity.transferFidelity',
    'physicalMediaFidelity.audioSoundscape', 'physicalMediaFidelity.cinematographyScore',
    'atmosphericDreadIndex', 'ontologicalComplexity'],
  tvShows: ['metrics.criticalScore', 'metrics.audienceScore', 'physicalMediaFidelity.transferFidelity',
    'physicalMediaFidelity.audioSoundscape', 'physicalMediaFidelity.cinematographyScore',
    'atmosphericDreadIndex', 'ontologicalComplexity'],
  videoGames: ['metrics.criticalScore', 'metrics.audienceScore',
    'engineeringFidelity.engineGraphicsPerformance', 'engineeringFidelity.artDirection',
    'immersionTensionIndex', 'systemsComplexity'],
  books: ['metrics.criticalScore', 'metrics.audienceScore', 'craft.proseCraft', 'craft.ideaDensity',
    'atmosphericDreadIndex', 'ontologicalComplexity'],
};

// Magnitude fields: not 0-100, but each has a range outside which the value is certainly a typo
// (a 12-minute feature film, a 90,000-page book) rather than an unusual work.
const RANGE_FIELDS = {
  movies: { year: [1880, 2035], runtime: [20, 600] },
  tvShows: { year: [1930, 2035], totalSeasons: [1, 60] },
  videoGames: { year: [1958, 2035], averagePlaytime: [1, 500] },
  books: { year: [-800, 2035], pages: [10, 5000] },
};

// Closed vocabularies. A value outside these is a data-entry slip, and the cost is invisibility:
// the Global Controller's TV structure filter only understands the two structuralType values, so
// a third spelling makes those series unreachable by it rather than raising anything.
const VOCAB = {
  tvShows: { 'formats.structuralType': ['Limited/Mini-Series', 'Multi-Season Epic'] },
  movies: { 'contextTags.formatType': ['Feature Film'] },
  books: {
    // The physical binding -- drives "Edition Quality" and the Collection tab's shelf grouping.
    format: ['Hardcover', 'Paperback', 'Deluxe', 'Boxed Set'],
    // The book's FORM (what kind of object it is), the counterpart of a film's "Feature Film".
    'contextTags.formatType': ['Novel', 'Non-Fiction', 'Poetry', 'Short Stories', 'Graphic Novel',
      'Memoir', 'Essays'],
  },
};

const SECTIONS = [
  { key: 'movies', file: 'data/movies.js', varName: 'movies', idPrefix: 'm',
    required: ['id', 'title', 'year', 'creator', 'studio', 'runtime', 'genres', 'metrics',
      'physicalMediaFidelity', 'atmosphericDreadIndex', 'ontologicalComplexity', 'contextTags'] },
  { key: 'tvShows', file: 'data/tv.js', varName: 'tvShows', idPrefix: 't',
    required: ['id', 'title', 'year', 'creator', 'networkStreamer', 'totalSeasons', 'genres', 'metrics',
      'physicalMediaFidelity', 'atmosphericDreadIndex', 'ontologicalComplexity', 'formats', 'contextTags'] },
  { key: 'videoGames', file: 'data/games.js', varName: 'videoGames', idPrefix: 'g',
    required: ['id', 'title', 'year', 'creator', 'platformAvailability', 'averagePlaytime', 'genres',
      'metrics', 'engineeringFidelity', 'immersionTensionIndex', 'systemsComplexity', 'contextTags'] },
  { key: 'books', file: 'data/books.js', varName: 'books', idPrefix: 'b',
    required: ['id', 'title', 'year', 'creator', 'publisher', 'pages', 'genres', 'metrics', 'craft',
      'atmosphericDreadIndex', 'ontologicalComplexity', 'format', 'contextTags'] },
];

let failures = 0, warnings = 0;
function check(label, cond) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); failures++; }
}
function warn(label, lines) {
  console.log('  warn - ' + label);
  (lines || []).slice(0, 8).forEach(l => console.log('     ' + l));
  if ((lines || []).length > 8) console.log('     ...and ' + (lines.length - 8) + ' more');
  warnings++;
}
function detail(lines, cap) {
  (lines || []).slice(0, cap || 10).forEach(l => console.log('     ' + l));
  if ((lines || []).length > (cap || 10)) console.log('     ...and ' + (lines.length - (cap || 10)) + ' more');
}
const dig = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

/* ===================== load ===================== */

const loaded = {};
console.log('\n=== data/ corpus files ===');
let total = 0;
for (const sec of SECTIONS) {
  const filePath = path.join(ROOT, sec.file);
  let records;
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    // Each data file is a classic script declaring `const <varName>=[...]` in global
    // scope (loaded via <script src> so it works under file:// -- see NOTES.md). Running
    // it in a fresh Function scope and returning the variable is the simplest way to
    // parse it without adding a JSON-with-comments dependency.
    records = new Function(src + '\nreturn ' + sec.varName + ';')();
  } catch (e) {
    check(sec.key + ' (' + sec.file + ') parses as valid JS', false);
    console.log('     ' + e.message);
    continue;
  }
  check(sec.key + ' (' + sec.file + ') parses as valid JS (' + records.length + ' records)', true);
  loaded[sec.key] = records;

  const ids = new Set();
  const dupIds = [];
  const titles = new Set();
  const dupTitles = [];
  const missingFields = [];
  for (const r of records) {
    if (ids.has(r.id)) dupIds.push(r.id); else ids.add(r.id);
    const t = (r.title || '').toLowerCase();
    if (titles.has(t)) dupTitles.push(r.title); else titles.add(t);
    const missing = sec.required.filter(f => !(f in r));
    if (missing.length) missingFields.push(r.id + ': ' + missing.join(','));
    if (r.id && !new RegExp('^' + sec.idPrefix + '\\d+$').test(r.id)) {
      missingFields.push(r.id + ': id does not match expected prefix "' + sec.idPrefix + '"');
    }
  }
  check(sec.key + ' has no duplicate IDs', dupIds.length === 0);
  if (dupIds.length) console.log('     duplicates: ' + dupIds.join(', '));
  check(sec.key + ' has no duplicate titles (case-insensitive)', dupTitles.length === 0);
  if (dupTitles.length) console.log('     duplicates: ' + dupTitles.join(', '));
  check(sec.key + ' records all have required fields', missingFields.length === 0);
  detail(missingFields);
  total += records.length;
}
console.log('  total records: ' + total);

/* ===================== value quality ===================== */

console.log('\n=== field values ===');
const PLACEHOLDER = /^(—|-|--|n\/?a|tbd|tba|todo|unknown|\?+|null|undefined)$/i;

for (const sec of SECTIONS) {
  const records = loaded[sec.key];
  if (!records) continue;

  // Every index the scoring engine reads must actually be a number on the 0-100 scale it assumes.
  const offScale = [];
  for (const f of SCALE_FIELDS[sec.key] || []) {
    for (const r of records) {
      const v = dig(r, f);
      if (typeof v !== 'number' || !isFinite(v)) offScale.push(r.id + ' ' + f + ' = ' + JSON.stringify(v) + ' (not a number)');
      else if (v < 0 || v > 100) offScale.push(r.id + ' ' + f + ' = ' + v + ' (outside 0-100)');
    }
  }
  check(sec.key + ': all scoring indices are numbers on the 0-100 scale', offScale.length === 0);
  detail(offScale);

  // Magnitude fields inside a range where a wrong value means a typo, not an unusual work.
  const offRange = [];
  for (const [f, [lo, hi]] of Object.entries(RANGE_FIELDS[sec.key] || {})) {
    for (const r of records) {
      const v = dig(r, f);
      if (typeof v !== 'number' || !isFinite(v)) offRange.push(r.id + ' ' + f + ' = ' + JSON.stringify(v) + ' (not a number)');
      else if (v < lo || v > hi) offRange.push(r.id + ' "' + r.title + '" ' + f + ' = ' + v + ' (expected ' + lo + '..' + hi + ')');
    }
  }
  check(sec.key + ': year/runtime/pages/seasons within plausible ranges', offRange.length === 0);
  detail(offRange);

  // Closed vocabularies -- an unknown value here doesn't error, it makes the record unreachable
  // by whichever filter reads the field.
  const offVocab = [];
  for (const [f, allowed] of Object.entries(VOCAB[sec.key] || {})) {
    for (const r of records) {
      const v = dig(r, f);
      if (!allowed.includes(v)) offVocab.push(r.id + ' "' + r.title + '" ' + f + ' = ' + JSON.stringify(v) + ' (expected one of: ' + allowed.join(', ') + ')');
    }
  }
  if (Object.keys(VOCAB[sec.key] || {}).length) {
    check(sec.key + ': closed-vocabulary fields only hold known values', offVocab.length === 0);
    detail(offVocab);
  }

  // Text fields that must carry real content. A placeholder here is worse than a missing field,
  // because the required-fields check above passes and the placeholder renders straight onto a card.
  const badText = [];
  for (const r of records) {
    for (const f of ['title', 'creator']) {
      const v = r[f];
      if (typeof v !== 'string' || !v.trim()) badText.push(r.id + ': ' + f + ' is empty');
      else if (PLACEHOLDER.test(v.trim())) badText.push(r.id + ': ' + f + ' is a placeholder (' + v + ')');
    }
    const j = ((r.contextTags || {}).justification || '').trim();
    if (!j) badText.push(r.id + ' "' + r.title + '": contextTags.justification is empty');
    else if (PLACEHOLDER.test(j)) badText.push(r.id + ' "' + r.title + '": justification is a placeholder (' + j + ')');
    const vibe = ((r.contextTags || {}).vibeTime || '').trim();
    if (!vibe) badText.push(r.id + ' "' + r.title + '": contextTags.vibeTime is empty');
    else if (PLACEHOLDER.test(vibe)) badText.push(r.id + ' "' + r.title + '": vibeTime is a placeholder (' + vibe + ')');
  }
  check(sec.key + ': title / creator / vibe / justification are real text, not placeholders', badText.length === 0);
  detail(badText);

  // Genres drive families, boosts, certification and half the discovery surfaces. An empty or
  // duplicated list is not a judgement call, it is a broken record.
  const badGenres = [];
  for (const r of records) {
    const g = r.genres;
    if (!Array.isArray(g) || !g.length) { badGenres.push(r.id + ' "' + r.title + '": genres is empty'); continue; }
    if (g.some(x => typeof x !== 'string' || !x.trim())) badGenres.push(r.id + ': genres contains an empty entry');
    const seen = new Set(), dup = [];
    g.forEach(x => { const k = String(x).toLowerCase(); if (seen.has(k)) dup.push(x); else seen.add(k); });
    if (dup.length) badGenres.push(r.id + ' "' + r.title + '": duplicate genre ' + dup.join(', '));
  }
  check(sec.key + ': every record has a non-empty, duplicate-free genre list', badGenres.length === 0);
  detail(badGenres);

  // Placeholder flooding: the classic bulk-import failure is a whole batch sharing one filler
  // value. Any single value holding more than half a field is worth a look -- it is legitimate
  // for e.g. movies.contextTags.formatType, which is why this warns rather than fails.
  const flooded = [];
  for (const f of (SCALE_FIELDS[sec.key] || []).concat(Object.keys(RANGE_FIELDS[sec.key] || {}))) {
    const freq = {};
    records.forEach(r => { const v = dig(r, f); freq[v] = (freq[v] || 0) + 1; });
    const [val, count] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [];
    if (count && count / records.length > 0.5) {
      flooded.push(f + ': ' + Math.round(100 * count / records.length) + '% of records share the value ' + val);
    }
  }
  if (flooded.length) warn(sec.key + ': a single value dominates a numeric field (possible placeholder fill)', flooded);
}

/* ===================== genre families ===================== */

// GENRE_FAMILIES is the map every family-based surface reads: the Controller's genre filter, the
// Taste Portrait's family lens, cross-medium pairings, the rabbit hole, the relationship graph.
// A genre string no family regex matches is invisible to all of them, and a work whose *every*
// genre is like that drops out of them entirely. Reading the live map out of the app (rather than
// keeping a second copy here) is what stops this check from drifting away from what ships.
console.log('\n=== genre families ===');
{
  const appSrc = fs.readFileSync(path.join(ROOT, 'app/ledger-app.js'), 'utf8');
  const m = appSrc.match(/const GENRE_FAMILIES=\[[\s\S]*?\n\];/);
  if (!m) {
    check('GENRE_FAMILIES can be read out of app/ledger-app.js', false);
  } else {
    const FAMILIES = new Function(m[0] + '\nreturn GENRE_FAMILIES;')();
    check('GENRE_FAMILIES read from app/ledger-app.js (' + FAMILIES.length + ' families)', true);
    const orphanWorks = [], orphanGenres = {};
    for (const sec of SECTIONS) {
      for (const r of loaded[sec.key] || []) {
        const joined = (r.genres || []).join(' ');
        if (!FAMILIES.some(f => f[1].test(joined))) {
          orphanWorks.push(sec.key + ' ' + r.id + ' "' + r.title + '" genres=' + JSON.stringify(r.genres));
        }
        for (const g of (r.genres || [])) {
          if (!FAMILIES.some(f => f[1].test(g))) orphanGenres[g] = (orphanGenres[g] || 0) + 1;
        }
      }
    }
    check('every work maps to at least one genre family', orphanWorks.length === 0);
    detail(orphanWorks);
    if (Object.keys(orphanGenres).length) {
      warn('genre strings that match no family (invisible to the family lens and family filters)',
        Object.entries(orphanGenres).sort((a, b) => b[1] - a[1]).map(e => e[0] + ' (' + e[1] + ' works)'));
    } else {
      check('every genre string maps to at least one family', true);
    }

    // A COMPOUND family label used as a raw genre ("Literary & Poetry" on a prose novel) is
    // redundant at best, and at worst it feeds substring matches meant for real genres -- which is
    // exactly how 200 prose novels once got certified as "Verse" off the "Poetry" half of that
    // label. Only compound names (the ones carrying a & or /) are flagged: a family like "Drama"
    // or "Horror" shares its name with a perfectly real genre, so flagging those would bury the
    // signal under 400 false positives. Advisory either way -- which of these to split into real
    // genres is a curation call, not something the build should reject.
    const asGenre = {};
    const compoundFamilies = FAMILIES.map(f => f[0]).filter(n => /[&/]/.test(n));
    for (const sec of SECTIONS) {
      for (const r of loaded[sec.key] || []) {
        for (const g of (r.genres || [])) if (compoundFamilies.includes(g)) asGenre[g] = (asGenre[g] || 0) + 1;
      }
    }
    if (Object.keys(asGenre).length) {
      warn('compound genre-family labels used as raw genre values (redundant; can skew substring matching)',
        Object.entries(asGenre).sort((a, b) => b[1] - a[1]).map(e => '"' + e[0] + '" on ' + e[1] + ' works'));
    }
  }
}

/* ===================== genre taxonomy ===================== */

// data/genre-taxonomy.js declares what every genre tag inherits from, and it is what replaces
// substring matching on genres. That only holds if it stays complete: a tag missing from it
// inherits nothing, so it silently stops matching any boost or filter above its own exact name --
// a new "Folk Horror" would quietly become invisible to a Horror boost. Nothing would error.
//
// So a genre entering the corpus without declaring its parents is a build failure, not a warning.
console.log('\n=== genre taxonomy ===');
{
  const taxPath = path.join(ROOT, 'data/genre-taxonomy.js');
  if (!fs.existsSync(taxPath)) {
    check('data/genre-taxonomy.js exists', false);
  } else {
    let TAX, VIRTUAL = [];
    try {
      const taxSrc = fs.readFileSync(taxPath, 'utf8');
      TAX = new Function(taxSrc + '\nreturn GENRE_TAXONOMY;')();
      VIRTUAL = new Function(taxSrc + '\nreturn typeof GENRE_VIRTUAL_ROOTS!=="undefined"?GENRE_VIRTUAL_ROOTS:[];')();
      check('genre taxonomy parses (' + Object.keys(TAX).length + ' tags)', true);
    } catch (e) {
      check('genre taxonomy parses', false);
      console.log('     ' + e.message);
      TAX = null;
    }
    if (TAX) {
      const used = new Set();
      for (const sec of SECTIONS) for (const r of loaded[sec.key] || []) (r.genres || []).forEach(g => used.add(g));
      const missing = [...used].filter(g => !TAX[g]);
      check('every genre in the corpus is declared in the taxonomy', missing.length === 0);
      detail(missing.map(g => '"' + g + '" is used by works but has no taxonomy entry'));

      // A parent nothing carries is a boost target that can never match. Catching it here is the
      // difference between "that filter returns nothing" and "that filter is broken".
      // A parent may be a real tag OR a declared virtual root (a concept nothing is tagged with
      // directly, like "Time"). Anything else is a boost target that can never match.
      const known = new Set(Object.keys(TAX).concat(VIRTUAL));
      const danglingParents = [];
      for (const [tag, parents] of Object.entries(TAX)) {
        if (!Array.isArray(parents) || !parents.length) { danglingParents.push('"' + tag + '" has no entries (must at least contain itself)'); continue; }
        if (!parents.includes(tag)) danglingParents.push('"' + tag + '" does not include itself');
        parents.filter(p => !known.has(p)).forEach(p => danglingParents.push('"' + tag + '" inherits from "' + p + '", which is neither a tag nor a declared virtual root'));
      }
      check('every taxonomy entry includes itself and inherits only from real tags', danglingParents.length === 0);
      detail(danglingParents);

      // Unused entries are not an error -- keeping a tag's declaration after its last work is
      // retagged is harmless, and deleting it would only make the next use re-derive it.
      const orphans = Object.keys(TAX).filter(t => !used.has(t) && !VIRTUAL.includes(t));
      if (orphans.length) {
        warn('taxonomy declares tags no work currently uses (harmless; they are ready if reused)',
          orphans.map(t => '"' + t + '"'));
      }
    }
  }
}

/* ===================== creator identity ===================== */

// Two spellings of one person split their filmography in half everywhere it matters: a creator
// boost (matched with String.includes) only lifts one of them, Creator Archives shows two entries,
// "% of their work you own" is computed against the wrong denominator, and the relationship graph
// draws two unconnected nodes. Nothing errors -- the recommendations are just quietly worse.
console.log('\n=== creator identity ===');
{
  const all = [];
  for (const sec of SECTIONS) for (const r of loaded[sec.key] || []) all.push(r);
  const counts = {};
  all.forEach(r => { counts[r.creator] = (counts[r.creator] || 0) + 1; });

  const strip = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Two keys, because the same collision hides in two different shapes:
  //   tight  -- catches diacritics and punctuation ("T. S. Eliot" vs "T.S. Eliot")
  //   people -- catches separator and abbreviation variants of a duo, including the shared-surname
  //             form ("Joel & Ethan Coen" is the same pair as "Joel Coen, Ethan Coen")
  const tight = s => strip(s).replace(/[^a-z0-9]/g, '');
  const people = s => {
    const parts = strip(s).split(/\s*(?:&|,|\band\b)\s*/).map(x => x.trim()).filter(Boolean);
    const surname = (parts[parts.length - 1] || '').split(/\s+/).pop();
    // "joel" + "ethan coen" -> "joel coen" + "ethan coen", so the two spellings converge.
    return parts.map(p => (p.split(/\s+/).length === 1 && surname && p !== surname ? p + ' ' + surname : p)).sort().join('|');
  };

  const collisions = [];
  for (const keyFn of [tight, people]) {
    const buckets = {};
    Object.keys(counts).forEach(n => { (buckets[keyFn(n)] = buckets[keyFn(n)] || new Set()).add(n); });
    Object.values(buckets).filter(v => v.size > 1).forEach(v => {
      const line = [...v].map(n => '"' + n + '" (' + counts[n] + ' works)').join('  vs  ');
      if (!collisions.includes(line)) collisions.push(line);
    });
  }
  check('no creator is spelled two different ways (' + Object.keys(counts).length + ' distinct creators)', collisions.length === 0);
  detail(collisions);

  // Softer signal: one person's work split across two credit strings, where NO single creator
  // boost can cover both.
  //
  // The test that matters is substring containment, because that is literally how a boost is
  // applied (`x.creator.includes(boostName)` in ledger-app.js). If the shorter credit is a
  // substring of the longer one, a boost on the shorter name already lifts both and there is
  // nothing to report:
  //     "Jeff VanderMeer"   ⊂ "Ann & Jeff VanderMeer"    -> covered, silent
  //     "Peter Farrelly"    ⊂ "Bobby & Peter Farrelly"   -> covered, silent
  //     "Joel & Ethan Coen" ⊄ "Joel Coen"                -> nothing covers both, warn
  // An earlier version flagged every same-surname pair and reported all three of those, which
  // meant two thirds of it was noise about credits that already work. Same-surname is still
  // required, so an ordinary co-credit ("Steven Spielberg" ⊂ "Steven Spielberg & Tom Hanks")
  // stays out of it. A human decides whether to merge; this only points.
  const surnameOf = n => n.trim().split(/\s+/).pop();
  const related = [];
  const names = Object.keys(counts);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = new Set(people(names[i]).split('|')), b = new Set(people(names[j]).split('|'));
      if (a.size === b.size) continue;
      const [small, big] = a.size < b.size ? [a, b] : [b, a];
      if (!small.size || ![...small].every(p => big.has(p))) continue;
      const surnames = new Set([...big].map(surnameOf));
      if (surnames.size !== 1) continue; // not a family/sibling unit -- an ordinary co-credit
      // Whichever string is shorter: if it appears inside the longer one, one boost covers both.
      const [shortName, longName] = names[i].length <= names[j].length
        ? [names[i], names[j]] : [names[j], names[i]];
      if (longName.includes(shortName)) continue;
      related.push('"' + names[i] + '" (' + counts[names[i]] + ' works)  vs  "' + names[j] + '" (' + counts[names[j]] + ' works)');
    }
  }
  if (related.length) {
    warn('one creator split across two credits that no single boost can cover ' +
      '(a boost is matched with String.includes, and neither name contains the other)', related);
  }
}

/* ===================== vocabulary drift ===================== */

// vibeTime is an open vocabulary on purpose -- new moods are a normal thing to add. What is not
// normal is a near-duplicate of an existing one ("Rainy Sunday comfort" alongside "Rainy Sunday
// Comfort"), which splits a mood in two and halves the weight of any vibe boost on it.
console.log('\n=== vibe vocabulary ===');
{
  const vibes = {};
  for (const sec of SECTIONS) for (const r of loaded[sec.key] || []) {
    const v = ((r.contextTags || {}).vibeTime || '').trim();
    if (v) vibes[v] = (vibes[v] || 0) + 1;
  }
  const keys = Object.keys(vibes);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const buckets = {};
  keys.forEach(k => { (buckets[norm(k)] = buckets[norm(k)] || []).push(k); });
  const dups = Object.values(buckets).filter(v => v.length > 1);
  check('no two vibeTime values differ only by case or punctuation (' + keys.length + ' distinct vibes)', dups.length === 0);
  detail(dups.map(v => v.map(x => '"' + x + '" (' + vibes[x] + ')').join('  vs  ')));

  // A vibe used once or twice is usually a typo of a real one rather than a genuinely new mood.
  const rare = keys.filter(k => vibes[k] <= 2).sort();
  if (rare.length) warn('vibeTime values used on 2 or fewer works (typo, or genuinely new?)', rare.map(k => '"' + k + '" (' + vibes[k] + ')'));
}

/* ===================== index.html wiring ===================== */

console.log('\n=== index.html wiring ===');
for (const htmlFile of ['index.html']) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const hasScriptTags = SECTIONS.every(s => html.includes('<script src="' + s.file + '">'));
  check(htmlFile + ' references all 4 data/*.js files via <script src>', hasScriptTags);
  // index.html must not carry its own inline copy of the corpus arrays -- that duplication is the
  // whole point of the split (see NOTES.md "Split the dataset out of index.html").
  const hasInlineData = SECTIONS.some(s => new RegExp('\\bconst ' + s.varName + '=\\[').test(html));
  check(htmlFile + ' has no leftover inline copy of the corpus arrays', !hasInlineData);
}

/* ===================== optional health report ===================== */

if (REPORT) {
  console.log('\n=== corpus health report ===');
  for (const sec of SECTIONS) {
    const records = loaded[sec.key] || [];
    if (!records.length) continue;
    const nums = records.map(r => parseInt(String(r.id).slice(1), 10)).filter(n => !isNaN(n));
    console.log('\n  ' + sec.key + '  (' + records.length + ' records)');
    console.log('    next free id: ' + sec.idPrefix + (Math.max(...nums) + 1));
    for (const f of (SCALE_FIELDS[sec.key] || []).concat(Object.keys(RANGE_FIELDS[sec.key] || {}))) {
      const vals = records.map(r => dig(r, f)).filter(v => typeof v === 'number' && isFinite(v));
      if (!vals.length) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      console.log('    ' + f.padEnd(46) + ' min ' + String(Math.min(...vals)).padStart(6) +
        '  max ' + String(Math.max(...vals)).padStart(6) + '  mean ' + mean.toFixed(1).padStart(8));
    }
    for (const f of Object.keys(VOCAB[sec.key] || {})) {
      const freq = {};
      records.forEach(r => { const v = dig(r, f); freq[v] = (freq[v] || 0) + 1; });
      console.log('    ' + f + ': ' + Object.entries(freq).sort((a, b) => b[1] - a[1]).map(e => e[0] + ' (' + e[1] + ')').join(', '));
    }
  }
  const genres = {};
  for (const sec of SECTIONS) for (const r of loaded[sec.key] || []) for (const g of (r.genres || [])) genres[g] = (genres[g] || 0) + 1;
  const sorted = Object.entries(genres).sort((a, b) => b[1] - a[1]);
  console.log('\n  genre vocabulary: ' + sorted.length + ' distinct strings');
  console.log('    most used:  ' + sorted.slice(0, 12).map(e => e[0] + ' (' + e[1] + ')').join(', '));
  console.log('    used once:  ' + sorted.filter(e => e[1] === 1).length + ' strings');
}

console.log('\n' + (failures === 0
  ? 'Corpus passed all ' + (warnings ? 'checks (' + warnings + ' warning' + (warnings === 1 ? '' : 's') + ' above).' : 'checks.')
  : failures + ' check(s) failed.'));
process.exit(failures === 0 ? 0 : 1);
