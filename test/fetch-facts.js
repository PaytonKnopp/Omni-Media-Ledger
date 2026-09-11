#!/usr/bin/env node
/*
 * Fixture test for the Phase 5 fact harness.
 *
 * The point of testing this offline is not that the network is inconvenient -- it is that the
 * decisions that matter here are made AFTER the network. Whether two catalogues corroborate each
 * other, whether a disagreement is a correction or a question for a human, and whether an edit is
 * allowed to touch data/ are all pure functions of the responses. So the responses are recorded
 * fixtures and the decisions are asserted directly. A live run replays through exactly this path.
 *
 * The fixture is built from real corpus records and plausible catalogue answers, one per case:
 *   m01  both sources agree with the corpus                    -> confirmed, grade A
 *   m02  both agree with each other, corpus runtime is wrong   -> proposed-change, grade A
 *        ...and the studio differs only by naming convention   -> soft field, grade B, not applied
 *   m03  the two sources disagree with each other on runtime   -> sources-disagree, never applied
 *   m04  one source errored; the survivor is uncorroborated    -> grade B, review queue
 *   m05  no key, so no source at all                           -> no-source, nothing claimed
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const { reconcile, valuesAgree, redactKeys, ADAPTERS, pickTmdbHit, reparseObservation, writeReviewQueue, callSource, canonicalizePeople, peopleKey, getJSON } = require(path.join(ROOT, 'scripts/fetch-facts.js'));

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log('  ok   - ' + label);
  else { console.log('  FAIL - ' + label); if (detail) console.log('     ' + detail); failures++; }
}

async function main() {

console.log('\n=== fact harness: value comparison ===');
check('text comparison ignores case and punctuation',
  valuesAgree({ text: true }, 'Stanley Kubrick', 'stanley  kubrick!'));
check('text comparison does NOT match on a substring',
  !valuesAgree({ text: true }, 'Stanley Kubrick', 'Kubrick'));
check('numeric comparison is exact -- no quiet tolerance band deciding what does not matter',
  valuesAgree({}, 149, 149) && !valuesAgree({}, 149, 150));
check('list comparison needs real overlap, not one shared entry in twenty',
  valuesAgree({ list: true }, ['PC', 'PS5'], ['PS5', 'PC']) &&
  !valuesAgree({ list: true }, ['PC', 'PS5', 'Xbox', 'Switch'], ['PS5']));
check('a missing value never agrees with anything',
  !valuesAgree({ text: true }, undefined, 'Stanley Kubrick') && !valuesAgree({}, 149, null));

// Found reviewing the queue: the corpus has "Yoshifumi Kondō" (macron), OMDb answers "Kondô"
// (circumflex), TMDB answers "Kondo" (no diacritic) -- three spellings of the one real name that
// used to compare as three DIFFERENT ones, because an accented letter fell through the old
// [^a-z0-9] filter as if it were punctuation, splitting the word instead of just dropping the
// accent ("kond o" vs "kondo" -- never mind matching each other, they didn't even agree on word
// count).
check('diacritics are stripped before words are split, not treated as word-breaking punctuation',
  valuesAgree({ text: true }, 'Yoshifumi Kondō', 'Yoshifumi Kondô') &&
  valuesAgree({ text: true }, 'Yoshifumi Kondô', 'Yoshifumi Kondo') &&
  valuesAgree({ text: true }, 'Yoshifumi Kondō', 'Yoshifumi Kondo'));
check('a real difference is still a real difference once accents are equal',
  !valuesAgree({ text: true }, 'Yoshifumi Kondo', 'Hayao Miyazaki'));

// A recorded run is meant to be committed, so the one place a key could reach disk is the URL
// stored beside each observation. OMDb spells the parameter `apikey` and TMDB `api_key`; both, and
// the IGDB secrets, have to be gone.
check('API keys are redacted out of every recorded URL, whichever way the parameter is spelled',
  !/SECRET/.test([
    redactKeys('https://www.omdbapi.com/?apikey=SECRET&t=Alien'),
    redactKeys('https://api.themoviedb.org/3/movie/1?api_key=SECRET'),
    redactKeys('https://id.twitch.tv/oauth2/token?client_secret=SECRET&grant_type=x'),
    redactKeys('https://x/?access_token=SECRET'),
  ].join(' ')));

// OMDb's Production field returns the literal string "N/A" for nearly every title (the field has
// been dead on OMDb's end for years). Discovered running the real harness on the owned movie set:
// 26 of 32 review-queue items in a 25-film batch were this, not a real disagreement.
check('OMDb literal "N/A" is treated as no data, not as a value that can disagree with the corpus',
  ADAPTERS.omdb.parse({ Response: 'True', Year: '1980', Production: 'N/A', Director: 'Stanley Kubrick' }, 'movie').studio === undefined);
check('a real OMDb studio value still comes through',
  ADAPTERS.omdb.parse({ Response: 'True', Year: '1980', Production: 'Warner Bros.', Director: 'Stanley Kubrick' }, 'movie').studio === 'Warner Bros.');

// Reproduces a real live-run failure: searching "WALL-E" ranked the same-year Pixar short
// "WALL·E's Treasures & Trinkets" above the actual film in TMDB's own results, and OMDb's "exact
// title" endpoint answered with the same wrong film -- both catalogues corroborating a 5-minute
// runtime that would have overwritten the real 98 minutes at grade A.
const wallE = { id: 'm144', title: 'WALL-E' };
check('OMDb answering with a different title (a same-year doppelganger) is not evidence about the work asked for',
  ADAPTERS.omdb.parse({ Response: 'True', Title: "WALL-E: Treasures and Trinkets", Year: '2008', Runtime: '5 min', Director: 'Andrew Stanton' }, 'movie', wallE) === null);
check('OMDb answering with the actual title (allowing for punctuation) still counts',
  ADAPTERS.omdb.parse({ Response: 'True', Title: 'WALL·E', Year: '2008', Runtime: '98 min', Director: 'Andrew Stanton' }, 'movie', wallE).runtime === 98);

// Found re-verifying the owned batches offline: OMDb disambiguates same-titled entries by
// appending " (YYYY)" to its own Title field (e.g. answering "1917 (2019)" for a query of "1917"),
// which the guard above was rejecting as a title mismatch even though it is the right film.
check('OMDb\'s own "(YYYY)" disambiguation suffix does not look like a title mismatch',
  ADAPTERS.omdb.parse({ Response: 'True', Title: '1917 (2019)', Year: '2019', Runtime: '119 min', Director: 'Sam Mendes' }, 'movie', { id: 'm66', title: '1917' }).runtime === 119);
// And the guard still catches a REAL mismatch that merely happens to end the same way.
check('a genuinely different title is still rejected even if it also ends in "(YYYY)"',
  ADAPTERS.omdb.parse({ Response: 'True', Title: 'The Making of Good Will Hunting (1997)', Year: '1997', Runtime: '7 min' }, 'movie', { id: 'm101', title: 'Good Will Hunting' }) === null);
// Found running the full-corpus movie substance batch: the corpus does the identical thing on ITS
// OWN side for the same reason -- "Scream (2022)" exists to distinguish itself from the 1996 film
// also in the corpus. Live-confirmed both ways: TMDB's search for the literal string "Scream (2022)"
// returns an unrelated Chinese awards special, while a search for "Scream" alone (year param 2022)
// finds the right film first. The suffix must be stripped from the corpus title before it is ever
// sent as a query, not just before the returned title is compared against it.
check('the corpus\'s own disambiguating "(YYYY)" is stripped from the OUTGOING query, not just the comparison',
  ADAPTERS.omdb.request({ id: 'm960', title: 'Scream (2022)', year: 2022 }, 'movie', 'k').includes('t=Scream&'));
check('the corpus\'s own disambiguating "(YYYY)" does not itself look like a mismatch once stripped on both sides',
  ADAPTERS.omdb.parse({ Response: 'True', Title: 'Scream', Year: '2022', Runtime: '113 min' }, 'movie', { id: 'm960', title: 'Scream (2022)' }).runtime === 113);
check('a TMDB search does not blindly trust result 0 when a later result is the actual title match',
  pickTmdbHit([
    { id: 877268, title: "WALL·E's Treasures & Trinkets", release_date: '2008-11-18' },
    { id: 10681, title: 'WALL·E', release_date: '2008-06-26' },
  ], 'movie', wallE).id === 10681);
check('a TMDB search with no real title match returns nothing, rather than guessing result 0',
  pickTmdbHit([{ id: 1, title: 'Completely Unrelated Movie', release_date: '2008-01-01' }], 'movie', wallE) === null);

// A recording made before `raw`/`rawDetail` existed has nothing to re-parse and must keep trusting
// its stored fields -- this is what makes every already-recorded evidence file in evidence/ still
// replay identically rather than silently going blank.
check('a legacy observation with no raw JSON is trusted as recorded, not discarded',
  reparseObservation({ src: 'OMDb', fields: { year: 1980 } }, 'movie', { title: 'The Shining' }).fields.year === 1980);

// The actual point of this: replaying a recorded run re-derives fields from the raw JSON through
// TODAY's parse(), so a parse()-level fix made after the recording still applies to it. Without
// this, --offline could only ever re-argue reconcile()-level questions.
check('replaying a raw OMDb response re-applies the CURRENT title guard, not whatever parse() did at record time',
  reparseObservation({ src: 'OMDb', raw: { Response: 'True', Title: 'WALL-E: Treasures and Trinkets', Year: '2008', Runtime: '5 min' } }, 'movie', { title: 'WALL-E' }).fields === null);
check('replaying a raw OMDb response for the right title still comes through',
  reparseObservation({ src: 'OMDb', raw: { Response: 'True', Title: 'WALL·E', Year: '2008', Runtime: '98 min' } }, 'movie', { title: 'WALL-E' }).fields.runtime === 98);
check('replaying a raw TMDB search response re-applies the CURRENT hit-picking logic to `raw`, and merges rawDetail for the SAME hit',
  reparseObservation({ src: 'TMDB',
    raw: { results: [{ id: 877268, title: "WALL·E's Treasures & Trinkets", release_date: '2008-11-18' }, { id: 10681, title: 'WALL·E', release_date: '2008-06-26' }] },
    rawDetail: { release_date: '2008-06-26', runtime: 98, credits: { crew: [{ job: 'Director', name: 'Andrew Stanton' }] } },
  }, 'movie', { title: 'WALL-E' }).fields.runtime === 98);

console.log('\n=== fact harness: OMDb retries without a year constraint, safely ===');
{
  const realFetch = global.fetch;
  const origKey = process.env.OMDB_API_KEY;
  process.env.OMDB_API_KEY = 'test-key';
  const withYear = j => ({ ok: true, json: async () => j });

  // Case 1: the corpus year is one off from OMDb's own (real live case: The Good, the Bad and the
  // Ugly is 1966 in the corpus, 1967 on OMDb). The year-constrained request finds nothing; the
  // retry without a year finds the same, correctly-titled film.
  let calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return String(url).includes('y=1966')
    ? withYear({ Response: 'False', Error: 'Movie not found!' })
    : withYear({ Response: 'True', Title: 'The Good, the Bad and the Ugly', Year: '1967', Runtime: '178 min' }); };
  const got1 = await callSource('omdb', { id: 'm106', title: 'The Good, the Bad and the Ugly', year: 1966 }, 'movie');
  check('a year-mismatch retry recovers a real corroborating value instead of staying single-source forever',
    got1.fields && got1.fields.runtime === 178 && calls.length === 2, JSON.stringify({ fields: got1.fields, calls }));

  // Case 2: the SAME safety net that catches this at record time -- a retry that lands on a
  // wrong-title collision (the live Star Wars case: dropping the year returns a 2025 stage-reading
  // production) must still be rejected, not accepted just because it's the only thing that answered.
  calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return String(url).includes('y=1977')
    ? withYear({ Response: 'False', Error: 'Movie not found!' })
    : withYear({ Response: 'True', Title: "Maclunkey Treasure Island: A Live Staged Reading of Star Wars - A New Hope", Year: '2025', Runtime: '123 min' }); };
  const got2 = await callSource('omdb', { id: 'm122', title: 'Star Wars: A New Hope', year: 1977 }, 'movie');
  check('a retry that lands on a title collision is rejected exactly like a primary one would be',
    got2.fields === null && calls.length === 2, JSON.stringify({ fields: got2.fields, calls }));

  // No retry fires when there's nothing to retry around.
  calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return withYear({ Response: 'True', Title: 'Alien', Year: '1979', Runtime: '117 min' }); };
  await callSource('omdb', { id: 'm40', title: 'Alien', year: 1979 }, 'movie');
  check('no retry when the primary request already succeeds', calls.length === 1, JSON.stringify(calls));

  calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return withYear({ Response: 'False', Error: 'Movie not found!' }); };
  await callSource('omdb', { id: 'm999', title: 'Totally Fictional Title' }, 'movie');
  check('no retry when there was no year to drop in the first place', calls.length === 1, JSON.stringify(calls));

  global.fetch = realFetch;
  process.env.OMDB_API_KEY = origKey;
}

console.log('\n=== fact harness: getJSON tells a transient 429 from an exhausted DAILY quota ===');
{
  const realFetch = global.fetch;
  const mkRes = (status, bodyText, headers) => ({
    ok: status < 300, status,
    headers: { get: h => (headers && headers[h.toLowerCase()]) || null },
    clone() { return this; },
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
  });

  // A burst 429 (no "per day"/"daily" in the body) is transient -- back off and retry, and a
  // subsequent success comes through.
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return calls === 1
      ? mkRes(429, JSON.stringify({ error: { message: 'Too many requests, slow down' } }))
      : mkRes(200, JSON.stringify({ ok: true }));
  };
  const burstResult = await getJSON('https://example.test/burst');
  check('a burst 429 (no daily-quota language) retries and recovers',
    calls === 2 && burstResult.ok === true, 'calls=' + calls);

  // A DAILY quota's 429 body says so -- found live against Google Books' real error text -- and
  // must fail on the FIRST attempt, not spend up to ~31s of backoff on something that cannot
  // possibly resolve within this run.
  calls = 0;
  global.fetch = async () => {
    calls++;
    return mkRes(429, JSON.stringify({ error: {
      message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'books.googleapis.com'.",
    } }));
  };
  let dailyThrew = false;
  try { await getJSON('https://example.test/daily'); } catch (e) { dailyThrew = /daily quota/i.test(e.message); }
  check('a daily-quota 429 fails immediately, with exactly one call, instead of retrying',
    dailyThrew && calls === 1, 'calls=' + calls + ' threw=' + dailyThrew);

  global.fetch = realFetch;
}

console.log('\n=== fact harness: Wikidata adapter (search -> entity claims -> label resolution) ===');
{
  const realFetch = global.fetch;
  const mkJSON = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });

  // Realistic shapes, trimmed to what the adapter reads, modeled on live Wikidata responses
  // captured building this adapter (Q190192 = Dune the novel, Q7934 = Frank Herbert).
  const duneSearch = { search: [
    { id: 'Q60834962', label: 'Dune', description: '2021 film directed by Denis Villeneuve' },
    { id: 'Q25391', label: 'dune', description: 'landform, hill of sand' },
    { id: 'Q190192', label: 'Dune', description: '1965 science fiction novel by Frank Herbert' },
  ] };
  const duneEntity = { entities: { Q190192: { claims: {
    P577: [{ mainsnak: { datavalue: { value: { time: '+1965-00-00T00:00:00Z' } } } }],
    P50: [{ mainsnak: { datavalue: { value: { id: 'Q7934' } } } }],
    P123: [{ mainsnak: { datavalue: { value: { id: 'Q5099225' } } } }],
    P1104: [{ mainsnak: { datavalue: { value: { amount: '+412' } } } }],
  } } } };
  const duneLabels = { entities: {
    Q7934: { labels: { en: { language: 'en', value: 'Frank Herbert' }, mul: { language: 'mul', value: 'Frank Herbert' } } },
    Q5099225: { labels: { en: { language: 'en', value: 'Chilton Company' } } },
  } };

  function mockRoute(search, entity, labels) {
    return async (url) => {
      const u = new URL(String(url));
      const action = u.searchParams.get('action');
      if (action === 'wbsearchentities') return mkJSON(search);
      const props = u.searchParams.get('props') || '';
      return mkJSON(props.includes('claims') ? entity : labels);
    };
  }

  global.fetch = mockRoute(duneSearch, duneEntity, duneLabels);
  const r1 = await callSource('wikidata', { id: 'b01', title: 'Dune', creator: 'Frank Herbert' }, 'book');
  check('picks the type-matching candidate over higher-relevance non-book hits, and resolves author/publisher/pages/year',
    r1.fields && r1.fields.year === 1965 && r1.fields.pages === 412 &&
    r1.fields.creator === 'Frank Herbert' && r1.fields.publisher === 'Chilton Company',
    JSON.stringify(r1.fields));

  // Label resolution must fall back mul -> first-available when a Q-id (e.g. a corporate entity)
  // carries no "en" label -- found live: Valve Corporation's Wikidata item has no English label at
  // all, only "mul" (Wikidata's language-neutral label for names that don't vary by language).
  const noEnLabels = { entities: { Q7934: { labels: { mul: { language: 'mul', value: 'Frank Herbert (mul only)' } } } } };
  global.fetch = mockRoute(duneSearch, duneEntity, { entities: { ...noEnLabels.entities } });
  const r2 = await callSource('wikidata', { id: 'b01', title: 'Dune', creator: 'Frank Herbert' }, 'book');
  check('label resolution falls back to "mul" when a Q-id has no "en" label',
    r2.fields && r2.fields.creator === 'Frank Herbert (mul only)', JSON.stringify(r2.fields));

  // Same title-collision risk as OpenLibrary/Google Books (search is title-only) -- a candidate
  // whose description matches the type hint but whose resolved author shares no words with the
  // corpus creator must be rejected as a whole, not partially trusted.
  const wrongAuthorEntity = { entities: { Q190192: { claims: {
    P577: [{ mainsnak: { datavalue: { value: { time: '+2018-00-00T00:00:00Z' } } } }],
    P50: [{ mainsnak: { datavalue: { value: { id: 'Q999' } } } }],
  } } } };
  const wrongAuthorLabels = { entities: { Q999: { labels: { en: { language: 'en', value: 'Someone Unrelated' } } } } };
  global.fetch = mockRoute(duneSearch, wrongAuthorEntity, wrongAuthorLabels);
  const r3 = await callSource('wikidata', { id: 'b603', title: 'No Exit', creator: 'Jean-Paul Sartre' }, 'book');
  check('a resolved author sharing no words with the corpus creator is rejected, not trusted',
    r3.fields === null, JSON.stringify(r3.fields));

  // No candidate matches the medium's type hint at all (e.g. every search result is a landform, a
  // person's family name, an unrelated film) -- a genuine miss, not an error.
  global.fetch = mockRoute({ search: [{ id: 'Q25391', label: 'dune', description: 'landform, hill of sand' }] }, null, null);
  const r4 = await callSource('wikidata', { id: 'b537', title: 'Grass', creator: 'Sheri S. Tepper' }, 'book');
  check('no type-matching candidate is a clean miss, not a crash', r4.fields === null && !r4.error, JSON.stringify(r4));

  // Games: developer (P178) and platforms (P400) instead of author/publisher, and a game with
  // re-release dates on P577 takes the EARLIEST year, not an arbitrary one.
  const gameSearch = { search: [{ id: 'Q279744', label: 'Half-Life', description: '1998 first-person shooter video game' }] };
  const gameEntity = { entities: { Q279744: { claims: {
    P577: [
      { mainsnak: { datavalue: { value: { time: '+2001-11-11T00:00:00Z' } } } },
      { mainsnak: { datavalue: { value: { time: '+1998-11-19T00:00:00Z' } } } },
    ],
    P178: [{ mainsnak: { datavalue: { value: { id: 'Q193559' } } } }],
    P400: [{ mainsnak: { datavalue: { value: { id: 'Q1406' } } } }],
  } } } };
  const gameLabels = { entities: {
    Q193559: { labels: { mul: { language: 'mul', value: 'Valve Corporation' } } },
    Q1406: { labels: { en: { language: 'en', value: 'Microsoft Windows' } } },
  } };
  global.fetch = mockRoute(gameSearch, gameEntity, gameLabels);
  const r5 = await callSource('wikidata', { id: 'g01', title: 'Half-Life', creator: 'Valve' }, 'game');
  check('games resolve developer + platforms, and take the EARLIEST of multiple release dates',
    r5.fields && r5.fields.year === 1998 && r5.fields.creator === 'Valve Corporation' &&
    JSON.stringify(r5.fields.platforms) === JSON.stringify(['Microsoft Windows']),
    JSON.stringify(r5.fields));

  // A duplicated P50 claim (same Q-id, two separate statements with different references -- a real
  // Wikidata data quirk, found live on The Three-Body Problem) must not double up the credited person.
  const dupAuthorEntity = { entities: { Q190192: { claims: {
    P50: [
      { mainsnak: { datavalue: { value: { id: 'Q607588' } } } },
      { mainsnak: { datavalue: { value: { id: 'Q607588' } } } },
    ],
  } } } };
  const dupAuthorLabels = { entities: { Q607588: { labels: { en: { language: 'en', value: 'Liu Cixin' } } } } };
  global.fetch = mockRoute(duneSearch, dupAuthorEntity, dupAuthorLabels);
  const r6 = await callSource('wikidata', { id: 'b58', title: 'The Three-Body Problem', creator: 'Liu Cixin' }, 'book');
  check('a duplicated claim for the SAME person does not double their name in the credit',
    r6.fields && r6.fields.creator === 'Liu Cixin', JSON.stringify(r6.fields));

  global.fetch = realFetch;
}

console.log('\n=== fact harness: multi-person credits compare and canonicalize by set, not word order ===');
// Reproduces two real full-corpus-batch findings: OMDb and TMDB corroborate the Coen brothers on
// the same film in opposite orders, and the Russo brothers' own two films disagree with EACH OTHER
// on order between sources -- so comparing the raw string treats agreement as a conflict.
check('order alone does not make two sources "disagree" on a duo',
  valuesAgree({ people: true }, 'Ethan Coen, Joel Coen', 'Joel Coen, Ethan Coen'));
check('the corpus shorthand ("X & Y Surname") is recognised as the same duo, not a third option',
  peopleKey('Joel & Ethan Coen') === peopleKey('Ethan Coen, Joel Coen') &&
  peopleKey('Joel & Ethan Coen') === peopleKey('Joel Coen, Ethan Coen'));
check('a genuinely different set of people still disagrees -- this is not "anything with multiple names agrees"',
  !valuesAgree({ people: true }, 'Anthony Russo, Joe Russo', 'Anthony Russo, Christopher Nolan'));
check('canonicalization expands corpus shorthand to full names before sorting, not just re-sorting the pieces as typed',
  canonicalizePeople('Joel & Ethan Coen') === 'Ethan Coen, Joel Coen');
check('canonicalization is deterministic regardless of which order it was handed',
  canonicalizePeople('Joel Coen, Ethan Coen') === canonicalizePeople('Ethan Coen, Joel Coen'));
check('a solo credit is left alone', canonicalizePeople('Stanley Kubrick') === 'Stanley Kubrick');

// The point of all this: reconcile() must recognize a merely-reordered corpus value as CONFIRMED,
// not propose a rewrite to the canonical string. Comparison is normalized (peopleKey, order- and
// shorthand-independent); the corpus's own display spelling is not. Found live: rewriting "Joel &
// Ethan Coen" to "Ethan Coen, Joel Coen" on only the films a fetch happened to touch split one
// duo's identity into two literal strings across sibling films (caught by validate-corpus.js's
// creator-identity check) AND silently zeroed PERSONAL_PROFILE.creatorBoost's `.includes()` match
// against the old spelling on every film it touched. Convergence must never be an active rewrite.
{
  const russoWork = { id: 'm999', creator: 'Anthony & Joe Russo' };
  const russoObs = [
    { src: 'OMDb', fields: { creator: 'Anthony Russo, Joe Russo' } },
    { src: 'TMDB', fields: { creator: 'Joe Russo, Anthony Russo' } },
  ];
  const p = reconcile('movie', russoWork, russoObs).find(x => x.field === 'creator');
  check('two sources disagreeing only on order still corroborate at grade A, WITHOUT rewriting the corpus spelling',
    p.status === 'confirmed' && p.grade === 'A' && p.current === 'Anthony & Joe Russo',
    JSON.stringify(p));
}
// A genuinely different SET of people (a source naming someone the corpus doesn't credit) is real
// information and is still proposed as a rewrite, in the deterministic canonical form.
{
  const soloWork = { id: 'm998', creator: 'Anthony Russo' };
  const trioObs = [
    { src: 'OMDb', fields: { creator: 'Anthony Russo, Joe Russo' } },
    { src: 'TMDB', fields: { creator: 'Joe Russo, Anthony Russo' } },
  ];
  const p = reconcile('movie', soloWork, trioObs).find(x => x.field === 'creator');
  check('a genuinely different set of people is still proposed as a grade-A rewrite',
    p.status === 'proposed-change' && p.grade === 'A' && p.proposed === 'Anthony Russo, Joe Russo',
    JSON.stringify(p));
}

console.log('\n=== fact harness: reconciliation ===');
const movies = new Function(fs.readFileSync(path.join(ROOT, 'data/movies.js'), 'utf8') + '\nreturn movies;')();
const byId = Object.fromEntries(movies.map(m => [m.id, m]));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/fetch-facts-movies.json'), 'utf8'));
const got = {};
for (const id of Object.keys(fixture)) {
  const usable = fixture[id].filter(o => o.fields);
  got[id] = Object.fromEntries(reconcile('movie', byId[id], usable).map(p => [p.field, p]));
}

check('two sources agreeing with the corpus confirm it at grade A',
  got.m01.runtime.status === 'confirmed' && got.m01.runtime.grade === 'A',
  JSON.stringify(got.m01.runtime));
check('two sources agreeing against the corpus propose a grade-A correction',
  got.m02.runtime.status === 'proposed-change' && got.m02.runtime.grade === 'A' && got.m02.runtime.proposed === 144,
  JSON.stringify(got.m02.runtime));
check('a naming-convention field is never grade A, even fully corroborated',
  got.m02.studio.grade === 'B',
  JSON.stringify(got.m02.studio));

// A classical text's "first publication year" predates print entirely -- two catalogues
// corroborating a modern reprint/translation year is not the same evidence quality as two
// catalogues corroborating an actual typo fix, and must not be auto-applied. Found live:
// Epictetus's "Discourses" (corpus 108 CE) had OpenLibrary + Google Books both report 2008 (a
// real Penguin Classics printing).
{
  const epictetus = { id: 'b302', title: 'Discourses and Selected Writings', year: 108 };
  const modernEditionObs = [
    { src: 'OpenLibrary', fields: { year: 2008 } },
    { src: 'Google Books', fields: { year: 2008 } },
  ];
  const p = reconcile('book', epictetus, modernEditionObs).find(x => x.field === 'year');
  check('two sources corroborating a MODERN year for an ancient (pre-1500) corpus year is downgraded to B, not auto-applied',
    p.status === 'proposed-change' && p.grade === 'B' && /print era/.test(p.note || ''),
    JSON.stringify(p));

  // The same guard must not fire on an ordinary modern book just because two sources correct a
  // typo -- only pre-1500 corpus years asking to jump to a plausible print-era year are affected.
  const modernBook = { id: 'b999', title: 'Some Modern Novel', year: 2017 };
  const p2 = reconcile('book', modernBook, [
    { src: 'OpenLibrary', fields: { year: 2018 } },
    { src: 'Google Books', fields: { year: 2018 } },
  ]).find(x => x.field === 'year');
  check('an ordinary modern-book year correction is unaffected by the ancient-text guard',
    p2.status === 'proposed-change' && p2.grade === 'A',
    JSON.stringify(p2));
}
check('sources that disagree with each other, and neither matches the corpus, are a real edition question',
  got.m03.runtime.status === 'edition-dependent' && got.m03.runtime.grade === 'B' &&
  Array.isArray(got.m03.runtime.alternatives) && got.m03.runtime.alternatives.length === 1 &&
  /does not match either source/.test(got.m03.runtime.note || ''),
  JSON.stringify(got.m03.runtime));
check('a non-edition-dependent field with a genuine 3-way mismatch is still a plain disagreement',
  reconcile('movie', { id: 'm999', title: 'X', year: 1975 },
    [{ src: 'OMDb', fields: { year: 1980 } }, { src: 'TMDB', fields: { year: 1990 } }])
    .find(p => p.field === 'year').status === 'sources-disagree');
check('a lone surviving source is grade B however confident it sounds',
  got.m04.runtime.status === 'proposed-change' && got.m04.runtime.grade === 'B',
  JSON.stringify(got.m04.runtime));
check('no sources means no claim at all',
  got.m05.runtime.status === 'no-source' && got.m05.runtime.grade === null,
  JSON.stringify(got.m05.runtime));
check('nothing in the fixture is ever graded C',
  !Object.values(got).some(w => Object.values(w).some(p => p.grade === 'C')));

// Measured on the real corpus: 91% of "sources disagree with each other" cases are this -- the
// corpus already matches one of the two disagreeing sources exactly, so there is nothing to decide.
console.log('\n=== fact harness: sources disagreeing with each other, resolved because the corpus matches one ===');
{
  const p = reconcile('movie', { id: 'm998', title: 'X', year: 1975, runtime: 185 },
    [{ src: 'OMDb', fields: { runtime: 185 } }, { src: 'TMDB', fields: { runtime: 184 } }])
    .find(x => x.field === 'runtime');
  check('the corpus value is kept, not overwritten by either disagreeing source',
    p.status === 'corroborated-by-one' && p.proposed === 185, JSON.stringify(p));
  check('it says which source backs the kept value and which one disagrees',
    /matches OMDb/.test(p.note) && /TMDB/.test(p.note) && /184/.test(p.note), p.note);
  check('it is graded B, not A -- only one source actually verified this value',
    p.grade === 'B');
}
check('this also resolves a genuine year disagreement, not just runtime',
  reconcile('movie', { id: 'm997', title: 'X', year: 1966, runtime: 100 },
    [{ src: 'OMDb', fields: { year: 1966 } }, { src: 'TMDB', fields: { year: 1967 } }])
    .find(p => p.field === 'year').status === 'corroborated-by-one');
check('a genuinely different SET of people, matching neither source, is still a real disagreement',
  reconcile('movie', { id: 'm996', title: 'X', creator: 'Stanley Kubrick' },
    [{ src: 'OMDb', fields: { creator: 'Arthur C. Clarke' } }, { src: 'TMDB', fields: { creator: 'Terry Southern' } }])
    .find(p => p.field === 'creator').status === 'sources-disagree');

console.log('\n=== fact harness: the review queue collapses naming-only noise, keeps genuine conflicts ===');
{
  const namingTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-queue-'));
  const qfile = path.join(namingTmp, 'queue.md');
  const results = [
    { id: 'm01', title: 'Naming Only Film', proposals: [
      { field: 'studio', label: 'studio', soft: true, current: 'Warner Bros.', proposed: 'Warner Bros. Pictures', status: 'proposed-change', grade: 'B', sources: [{ src: 'TMDB', value: 'Warner Bros. Pictures' }] },
    ] },
    { id: 'm02', title: 'Genuine Conflict Film', proposals: [
      { field: 'runtime', label: 'runtime (min)', soft: false, current: 146, status: 'sources-disagree', grade: 'B', sources: [{ src: 'OMDb', value: 146 }, { src: 'TMDB', value: 144 }] },
    ] },
    { id: 'm03', title: 'Mixed Film', proposals: [
      { field: 'runtime', label: 'runtime (min)', soft: false, current: 100, status: 'sources-disagree', grade: 'B', sources: [{ src: 'OMDb', value: 100 }, { src: 'TMDB', value: 101 }] },
      { field: 'studio', label: 'studio', soft: true, current: 'A24', proposed: 'RT Features', status: 'proposed-change', grade: 'B', sources: [{ src: 'TMDB', value: 'RT Features' }] },
    ] },
  ];
  const n = writeReviewQueue(qfile, 'movie', results);
  const content = fs.readFileSync(qfile, 'utf8');
  check('the returned/reported count is genuine questions only, not naming variance',
    n === 2, 'n=' + n);
  check('a work with ONLY naming-only variance gets no heading at all',
    !content.includes('Naming Only Film'), content);
  check('a genuine sources-disagree conflict is still listed individually',
    content.includes('Genuine Conflict Film') && content.includes('sources disagree'), content);
  check('a work with both keeps the genuine conflict AND notes its omitted naming variant',
    content.includes('Mixed Film') && /runtime.*sources disagree/.test(content) && /\+1 naming-only field/.test(content),
    content);
  check('the file-level summary states the total naming-only count omitted (1 + 1 = 2)',
    /2 additional naming-only fields omitted/.test(content), content);
  fs.rmSync(namingTmp, { recursive: true, force: true });
}

console.log('\n=== fact harness: apply is narrow, and refuses when it cannot be sure ===');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-facts-'));
execFileSync(process.execPath, [path.join(ROOT, 'scripts/fetch-facts.js'),
  '--medium', 'movie', '--ids', 'm01,m02,m03,m04,m05',
  '--offline', path.join(__dirname, 'fixtures/fetch-facts-movies.json'),
  '--out-dir', tmp], { cwd: ROOT, stdio: 'pipe' });
const outJson = fs.readdirSync(tmp).find(f => f.endsWith('.json'));
const outMd = fs.readdirSync(tmp).find(f => f.endsWith('.md'));
check('fetch-facts writes an evidence file and a review queue offline', !!outJson && !!outMd);

const queue = fs.readFileSync(path.join(tmp, outMd), 'utf8');
check('the review queue names the genuine edition question, not a runtime it is about to correct',
  queue.includes('Barry Lyndon') && queue.includes('edition-dependent'), queue.slice(0, 400));
// The Shining's studio ("Warner Bros." in the corpus, "Warner Bros." from OMDb, "Warner Bros.
// Pictures" from TMDB) used to get its own line here just like Barry Lyndon's runtime -- but the
// corpus's own value exactly matches one of the two disagreeing sources, so it is now resolved
// without a human (see the corroborated-by-one tests above) and correctly has no block at all.
check('a soft field resolved because the corpus matches one disagreeing source gets no block of its own',
  !queue.includes('## The Shining'), queue);
check('the file-level summary reports it as a resolved count instead of just hiding it silently',
  /already resolved, no review needed/.test(queue), queue);

const dry = execFileSync(process.execPath, [path.join(ROOT, 'scripts/apply-facts.js'),
  path.join(tmp, outJson)], { cwd: ROOT, encoding: 'utf8' });
check('a dry run applies exactly the one grade-A correction',
  /1 grade-A corrections/.test(dry) && /m02\.runtime: 146 -> 144/.test(dry), dry);
check('a dry run stamps the records whose hard facts are fully sourced, and only those',
  /3 records stamped/.test(dry), dry);
// Barry Lyndon (m03) is the third: its runtime is a genuine edition-dependent disagreement (see
// above), but year and creator are both fully corroborated, so the record as a whole earns
// "edition-dependent" rather than sitting unstamped just because ONE field has no single answer.
check('the genuinely edition-dependent record is stamped as such, not silently folded into "sourced"',
  /m03 \(edition-dependent\)/.test(dry), dry);
check('a dry run writes nothing',
  fs.readFileSync(path.join(ROOT, 'data/movies.js'), 'utf8').includes('"runtime":146'));

// A record every one of whose fields resolved -- some grade-A confirmed, the rest
// corroborated-by-one (corpus already matches one source; the disagreeing source is simply wrong)
// -- must earn its OWN stamp, not sit unstamped just because nothing in it was literally an edition
// question. Found live running the real corpus: 394 of 407 unstamped movies and 70 of 96 unstamped
// TV shows were exactly this shape.
{
  const moviesPath = path.join(ROOT, 'data/movies.js');
  const backup = fs.readFileSync(moviesPath, 'utf8');
  try {
    const corroboratedEv = {
      medium: 'movie', generated: new Date().toISOString(), works: [{
        id: 'm01', title: '2001: A Space Odyssey',
        sourcesReached: ['OMDb', 'TMDB'],
        proposals: [
          { field: 'year', label: 'release year', current: 1968, proposed: 1968, status: 'confirmed', grade: 'A', sources: [{ src: 'OMDb', value: 1968 }, { src: 'TMDB', value: 1968 }] },
          { field: 'creator', label: 'director', current: 'Stanley Kubrick', proposed: 'Stanley Kubrick', status: 'confirmed', grade: 'A', sources: [{ src: 'OMDb', value: 'Stanley Kubrick' }, { src: 'TMDB', value: 'Stanley Kubrick' }] },
          // Genuinely contested, but the corpus already matches OMDb -- corroborated-by-one, not
          // edition-dependent, because this is "one source is wrong," not "the value varies by cut".
          { field: 'runtime', label: 'runtime (min)', current: 149, proposed: 149, status: 'corroborated-by-one', grade: 'B', sources: [{ src: 'OMDb', value: 149 }, { src: 'TMDB', value: 141 }] },
        ],
      }],
    };
    fs.writeFileSync(path.join(tmp, 'corroborated.json'), JSON.stringify(corroboratedEv));
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/apply-facts.js'),
      path.join(tmp, 'corroborated.json'), '--write'], { cwd: ROOT, encoding: 'utf8' });
    check('a record resolved only via confirmed + corroborated-by-one (no edition-dependent field) earns a "corroborated" stamp',
      /m01 \(corroborated\)/.test(out), out);
    const m01Line = fs.readFileSync(moviesPath, 'utf8').match(/^.*"id"\s*:\s*"m01".*$/m)[0];
    check('the written stamp itself says facts:"corroborated"',
      /"prov":\{"facts":"corroborated"/.test(m01Line), m01Line);
  } finally {
    fs.writeFileSync(moviesPath, backup);
  }
}

// The refusal path: an evidence file whose "current" value is not what the corpus actually says
// (a stale evidence file, or a corpus edited underneath it) must be refused, not force-fitted.
const stale = JSON.parse(fs.readFileSync(path.join(tmp, outJson), 'utf8'));
stale.works.find(w => w.id === 'm02').proposals.find(p => p.field === 'runtime').current = 999;
fs.writeFileSync(path.join(tmp, 'stale.json'), JSON.stringify(stale));
const refusal = execFileSync(process.execPath, [path.join(ROOT, 'scripts/apply-facts.js'),
  path.join(tmp, 'stale.json')], { cwd: ROOT, encoding: 'utf8' });
check('stale evidence is refused rather than applied to whatever is on the line now',
  /REFUSED/.test(refusal) && /m02\.runtime: expected/.test(refusal), refusal);

// A manually `_held` field (an operator deferring a genuinely grade-A proposal for a reason
// reconcile() can't see, like a cross-record consistency conflict) must block the record from
// EITHER stamp, not just from being written -- found while doing exactly this on the real corpus:
// downgrading a held field's grade to B stopped it reaching "sourced" but did nothing to stop
// "edition-dependent", which checks status, not grade.
const heldEv = JSON.parse(fs.readFileSync(path.join(tmp, outJson), 'utf8'));
heldEv.works.find(w => w.id === 'm03').proposals.find(p => p.field === 'creator')._held = 'operator deferred for testing';
fs.writeFileSync(path.join(tmp, 'held.json'), JSON.stringify(heldEv));
const heldRun = execFileSync(process.execPath, [path.join(ROOT, 'scripts/apply-facts.js'),
  path.join(tmp, 'held.json')], { cwd: ROOT, encoding: 'utf8' });
check('a held field blocks the edition-dependent stamp too, not just grade-A application',
  !heldRun.split(/\d+ records stamped/)[1].split('\n\n')[0].includes('m03'), heldRun);

// The stamp-blocking test above only ever ran a DRY RUN (every other apply-facts test in this file
// does too) -- which prints what it WOULD change, but never actually proves `_held` stops the
// REWRITE itself when --write is passed. It didn't: found live doing exactly this on the real
// corpus (holding back two risky book creator corrections) -- apply-facts.js's `changes` filter
// checked grade and status but never `_held`, so a held field's dry-run print looked identical to
// an unheld one, and only the stamp was actually suppressed. Real --write against a backed-up-and-
// restored copy of the real corpus file, since apply-facts.js's data path isn't parameterizable.
{
  const moviesPath = path.join(ROOT, 'data/movies.js');
  const backup = fs.readFileSync(moviesPath, 'utf8');
  try {
    const writeHeldEv = JSON.parse(fs.readFileSync(path.join(tmp, outJson), 'utf8'));
    writeHeldEv.works.find(w => w.id === 'm02').proposals.find(p => p.field === 'runtime')._held = 'operator deferred for testing';
    fs.writeFileSync(path.join(tmp, 'write-held.json'), JSON.stringify(writeHeldEv));
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/apply-facts.js'),
      path.join(tmp, 'write-held.json'), '--write'], { cwd: ROOT, stdio: 'pipe' });
    const after = fs.readFileSync(moviesPath, 'utf8');
    const m02Line = after.match(/^.*"id"\s*:\s*"m02".*$/m)[0];
    check('--write actually leaves a held field\'s value untouched, not just its stamp',
      m02Line.includes('"runtime":146'), m02Line);
  } finally {
    fs.writeFileSync(moviesPath, backup);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

}

main().then(() => {
  console.log(failures ? '\n' + failures + ' fact-harness check(s) failed.\n' : '\nFact harness passed all checks.\n');
  process.exit(failures ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
