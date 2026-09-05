#!/usr/bin/env node
/*
 * Phase 3 tooling: score a batch of works against RUBRIC.md, blind, then apply the result.
 *
 * Why this is a script and not a careful habit
 * -------------------------------------------
 * The rubric says to choose a value BEFORE looking at the existing one, because the existing
 * values were never checked against anything and seeing them first anchors the answer -- which
 * reproduces the batch drift this whole pass exists to repair. A habit cannot enforce that. A
 * worksheet that does not contain the current values can.
 *
 * So `--worksheet` emits only what the rubric says to reason from -- title, year, creator, genres,
 * vibe, justification -- and deliberately omits every index. The scorer fills in values, and
 * `--apply` writes them with an exact-match replacement and refuses anything it cannot match
 * uniquely.
 *
 *   node scripts/score-batch.js --worksheet --medium movies --ids m01,m02   blind worksheet
 *   node scripts/score-batch.js --worksheet --medium books --owned          ...the owned shelf
 *   node scripts/score-batch.js --apply decisions.json                      write them
 *   node scripts/score-batch.js --apply decisions.json --dry-run            show, write nothing
 *
 * A decisions file is a list of {id, field, value, note}. `note` is required and is the rubric
 * justification -- which anchors the work sits between, and why. It is not decoration: a score
 * with no stated reason cannot be reviewed, and cannot be re-derived when the rubric changes.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARGV = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = ARGV.indexOf('--' + name);
  return i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--') ? ARGV[i + 1] : dflt;
};
const has = name => ARGV.includes('--' + name);

const SECTIONS = {
  movies: { file: 'data/movies.js', varName: 'movies' },
  tvShows: { file: 'data/tv.js', varName: 'tvShows' },
  videoGames: { file: 'data/games.js', varName: 'videoGames' },
  books: { file: 'data/books.js', varName: 'books' },
};
// Accept the friendlier names too, since the ID prefixes are what anyone actually has to hand.
const ALIASES = { movies: 'movies', movie: 'movies', m: 'movies', tv: 'tvShows', tvshows: 'tvShows', t: 'tvShows',
  games: 'videoGames', game: 'videoGames', videogames: 'videoGames', g: 'videoGames', books: 'books', book: 'books', b: 'books' };

// Every field the rubric governs, and which media it applies to. The three marked `new` do not
// exist in the corpus yet -- Phase 3 is what creates them, so `--apply` writes them for the first
// time rather than replacing a value.
const RUBRIC_FIELDS = {
  atmosphericDreadIndex: { media: ['movies', 'tvShows', 'books'], path: 'atmosphericDreadIndex' },
  ontologicalComplexity: { media: ['movies', 'tvShows', 'books'], path: 'ontologicalComplexity' },
  immersionTensionIndex: { media: ['videoGames'], path: 'immersionTensionIndex' },
  systemsComplexity: { media: ['videoGames'], path: 'systemsComplexity' },
  conceptualDepth: { media: ['videoGames'], path: 'conceptualDepth', isNew: true },
  emotionalWarmth: { media: ['movies', 'tvShows', 'videoGames', 'books'], path: 'emotionalWarmth', isNew: true },
  comicIntent: { media: ['movies', 'tvShows', 'videoGames', 'books'], path: 'comicIntent', isNew: true },
  aestheticBeauty: { media: ['movies', 'tvShows', 'videoGames', 'books'], path: 'aestheticBeauty', isNew: true },
};

function load(key) {
  const src = fs.readFileSync(path.join(ROOT, SECTIONS[key].file), 'utf8');
  return new Function(src + '\nreturn ' + SECTIONS[key].varName + ';')();
}

/* ===================== worksheet ===================== */

// The owned set lives in the profile defaults inside app/ledger-app.js rather than in the corpus,
// because ownership is personal data. Read it from there rather than duplicating the list.
function ownedIds() {
  const app = fs.readFileSync(path.join(ROOT, 'app/ledger-app.js'), 'utf8');
  const lit = key => {
    const m = app.match(new RegExp('PERSONAL_PROFILE\\.' + key + '=([\\s\\S]*?);\\n'));
    return m ? new Function('return ' + m[1] + ';')() : null;
  };
  const ids = new Set(Object.keys(lit('ownedMedia') || {}));
  Object.keys(lit('ownedBooksExtra') || {}).forEach(id => ids.add(id));
  (lit('ownedGameIds') || []).forEach(id => ids.add(id));
  const ceiling = 51; // books b01-b51, owned by the corpus's original numbering convention
  for (let i = 1; i <= ceiling; i++) ids.add('b' + String(i).padStart(2, '0'));
  return ids;
}

function worksheet() {
  const mediumArg = (arg('medium') || '').toLowerCase();
  const key = ALIASES[mediumArg];
  if (!key) { console.error('--medium must be one of: movies, tv, games, books'); process.exit(2); }

  let records = load(key);
  const idList = arg('ids');
  if (idList) {
    const want = new Set(idList.split(',').map(s => s.trim()));
    records = records.filter(r => want.has(r.id));
  } else if (has('owned')) {
    const owned = ownedIds();
    records = records.filter(r => owned.has(r.id));
  }
  const limit = parseInt(arg('n', '0'), 10);
  if (limit > 0) records = records.slice(0, limit);

  const fields = Object.entries(RUBRIC_FIELDS).filter(([, d]) => d.media.includes(key)).map(([f]) => f);

  console.log('# Blind scoring worksheet — ' + key + ' (' + records.length + ' works)');
  console.log('#');
  console.log('# Current index values are deliberately ABSENT. Score from RUBRIC.md and the evidence');
  console.log('# below, then compare. Seeing the old value first anchors the answer and reproduces');
  console.log('# the drift this pass exists to repair.');
  console.log('#');
  console.log('# Fields to score: ' + fields.join(', '));
  console.log('');
  records.forEach((r, i) => {
    const span = r.runtime ? r.runtime + ' min'
      : r.totalSeasons ? r.totalSeasons + ' season(s)'
      : r.pages ? r.pages + ' pages'
      : r.averagePlaytime ? '~' + r.averagePlaytime + ' hrs' : '';
    console.log((i + 1) + '. ' + r.id + '  ' + r.title + '  (' + r.year + ')');
    console.log('   by ' + r.creator + (span ? '  ·  ' + span : ''));
    console.log('   genres: ' + (r.genres || []).join(', '));
    console.log('   vibe:   ' + ((r.contextTags || {}).vibeTime || ''));
    console.log('   "' + ((r.contextTags || {}).justification || '') + '"');
    console.log('');
  });
}

/* ===================== apply ===================== */

// Values are written by exact-match replacement on the record's own JSON text, and anything that
// cannot be matched exactly once is refused rather than guessed at. A regex loose enough to always
// match is loose enough to rewrite the wrong record, and in a 1,000-record file on one line that
// mistake is invisible in review.
function applyDecisions() {
  const file = arg('apply');
  if (!file) { console.error('--apply needs a decisions file'); process.exit(2); }
  const decisions = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dry = has('dry-run');

  const errors = [];
  decisions.forEach((d, i) => {
    const where = 'decision ' + (i + 1) + ' (' + (d.id || '?') + '/' + (d.field || '?') + ')';
    if (!d.id || !d.field) errors.push(where + ': needs id and field');
    if (!RUBRIC_FIELDS[d.field]) errors.push(where + ': "' + d.field + '" is not a rubric field');
    if (typeof d.value !== 'number' || !isFinite(d.value) || d.value < 0 || d.value > 100) {
      errors.push(where + ': value must be a number 0-100, got ' + JSON.stringify(d.value));
    }
    if (!d.note || !String(d.note).trim()) {
      errors.push(where + ': needs a note saying which anchors it sits between and why');
    }
  });
  if (errors.length) { console.error('Refusing to apply:\n  ' + errors.join('\n  ')); process.exit(1); }

  const byMedium = {};
  decisions.forEach(d => {
    const key = { m: 'movies', t: 'tvShows', g: 'videoGames', b: 'books' }[d.id[0]];
    if (!key) { console.error('cannot tell the medium from id ' + d.id); process.exit(1); }
    (byMedium[key] = byMedium[key] || []).push(d);
  });

  let applied = 0;
  for (const [key, list] of Object.entries(byMedium)) {
    const filePath = path.join(ROOT, SECTIONS[key].file);
    let src = fs.readFileSync(filePath, 'utf8');
    const records = load(key);

    for (const d of list) {
      const rec = records.find(r => r.id === d.id);
      if (!rec) { console.error('no record ' + d.id + ' in ' + SECTIONS[key].file); process.exit(1); }
      if (!RUBRIC_FIELDS[d.field].media.includes(key)) {
        console.error(d.field + ' does not apply to ' + key + ' (' + d.id + ')'); process.exit(1);
      }

      const isNew = rec[d.field] === undefined;
      let needle, replacement;
      if (isNew) {
        // Insert next to contextTags, which every medium has, so the field lands in a predictable
        // place instead of wherever a regex happened to match.
        needle = '"id":"' + rec.id + '"';
        replacement = '"id":"' + rec.id + '"';
        const anchor = ',"contextTags":';
        const recStart = src.indexOf(needle);
        if (recStart < 0) { console.error('could not locate ' + d.id); process.exit(1); }
        // Bound the anchor search to this record's own line. Unbounded, a record somehow missing
        // contextTags would silently take the NEXT record's, writing the score onto the wrong work
        // -- and in a 1,000-record single-line file that is invisible in a diff.
        const recLineEnd = src.indexOf('\n', recStart);
        const anchorAt = src.indexOf(anchor, recStart);
        if (anchorAt < 0 || (recLineEnd >= 0 && anchorAt > recLineEnd)) {
          console.error('no contextTags anchor inside record ' + d.id); process.exit(1);
        }
        const insert = ',"' + d.field + '":' + d.value;
        src = src.slice(0, anchorAt) + insert + src.slice(anchorAt);
      } else {
        needle = '"' + d.field + '":' + JSON.stringify(rec[d.field]);
        // Scope the search to this record so an identical value elsewhere cannot be hit.
        const recStart = src.indexOf('"id":"' + rec.id + '"');
        const recEnd = src.indexOf('\n', recStart);
        const slice = src.slice(recStart, recEnd);
        const hits = slice.split(needle).length - 1;
        if (hits !== 1) {
          console.error('refusing ' + d.id + '/' + d.field + ': matched ' + hits + ' times inside the record, expected exactly 1');
          process.exit(1);
        }
        replacement = '"' + d.field + '":' + d.value;
        src = src.slice(0, recStart) + slice.replace(needle, replacement) + src.slice(recEnd);
      }
      applied++;
    }

    if (dry) {
      console.log('[dry run] ' + SECTIONS[key].file + ': ' + list.length + ' change(s), not written');
    } else {
      // Parse the result before trusting it. A string replacement that produces invalid JS would
      // otherwise be discovered by the next person to open the app.
      try { new Function(src + '\nreturn ' + SECTIONS[key].varName + ';')(); }
      catch (e) { console.error('edit produced invalid JS in ' + SECTIONS[key].file + ': ' + e.message); process.exit(1); }
      fs.writeFileSync(filePath, src);
      console.log('wrote ' + SECTIONS[key].file + ': ' + list.length + ' change(s)');
    }
  }
  console.log((dry ? '[dry run] ' : '') + applied + ' decision(s) ' + (dry ? 'validated' : 'applied'));
  if (!dry) console.log('Next: node scripts/validate-corpus.js && snapshot + diff, then npm test.');
}

/* ===================== cli ===================== */

if (has('worksheet')) worksheet();
else if (has('apply')) applyDecisions();
else {
  console.log('usage:');
  console.log('  --worksheet --medium <movies|tv|games|books> [--ids a,b,c] [--owned] [--n N]');
  console.log('  --apply <decisions.json> [--dry-run]');
  process.exit(2);
}
