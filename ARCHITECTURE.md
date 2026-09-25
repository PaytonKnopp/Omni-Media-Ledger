# Architecture

How the pieces fit together, for anyone changing the code. `NOTES.md` is the historical
engineering log (why things ended up this way, phase by phase); this file is the current map.

## Layout

```
index.html          Page layout + styling, and the account sign-in / cloud-sync code
app/sync-merge.js    Pure title-by-title merge of two copies of the synced keys, plus the per-edit
                      timestamps it merges by (see "Saving") -- used by the account-sync block
app/ledger-app.js   The application: initApp() -- every screen and all account/state-dependent logic
                      that is still too closure-tangled to pull out (see "Known limits")
app/format.js       Pure provenance/edition-format helpers (provStampOf, normPhysFormat)
app/cards.js        Pure HTML-string/widget builders (esc, ring, microBar, frontBars, matrixRow, ...)
app/scoring.js       Pure deep-index scoring tables + certify()/lerpScore() (the hand-tuned overrides
                      and content-rating logic), plus the personal taste model -- buildTasteModel()
                      turns ratings/tiers/ownership into genre, vibe, creator and per-axis weights,
                      normalizeObjectiveByKind()/normalizeReceptionByKind() put the four mediums on
                      one scale, buildScoreCurve() calibrates the 40-99 GOAT Match band
app/match.js         The live "Match" scoring pass (activeDims/computeMatch/bespokeScore) -- reads
                      only `state`, passed in explicitly by initApp()
app/matrices.js      VIEW 4 · Reference Matrices (matrixBlock/renderMatrixNav/renderMatrices) --
                      takes ALL/$/$$ as parameters; MATRIX_TITLES/matrixOwnedOnly/matrixNavQ live
                      here too now (see "Known limits")
app/creators.js      VIEW 5 · Pan-Creator Archives (worksFor/creatorCard/sortCreatorPairs/
                      renderCreators) -- takes state/ALL/$/$$ as parameters
app/search.js        Pure search: folding (accents, case, punctuation), per-word matching with typo
                      tolerance, and the relevance buckets results are ordered by (see "Search")
data/*.js            Reference data (corpus, creator pantheons, contenders)
supabase/schema.sql  The database: tables, row-level security, grants
sw.js                Offline support for the hosted copy (service worker) -- see "Offline"
tailwind.config.js   Dev-only: what the stylesheet compiled into index.html is generated from
test/regression.js   Playwright suite, ~400 checks
test/*.js            The fast tier: schema, fact/substance/score harnesses, search, merge, evidence
scripts/             Corpus integrity checker, the stylesheet build (build-css.js), the
                      recommendation-quality measurement (rec-quality.js), data tooling
```

`app/format.js`, `app/cards.js` and `app/scoring.js` load before `app/ledger-app.js`, the same way
`data/*.js` does: they only declare closure-independent functions and constant data (no
`state`/`PERSONAL_PROFILE`/DOM access), so `initApp()` calls them like it calls a `data/*.js`
global. `app/match.js`, `app/matrices.js` and `app/creators.js` load next, after those and before
`app/ledger-app.js`: their functions do read `state`/`ALL`/`$`/`$$`, but only as parameters
`initApp()` passes in at each call site, not as a closure over `initApp()`'s locals -- see "Known
limits" for which candidates were extracted this way and which weren't. See "Boot sequence" below
for why `app/ledger-app.js` itself stays one big `initApp()`.

There is no build step. `index.html` loads everything directly, so edit-and-refresh is the whole
development loop, and deploying is copying the folder.

The one generated thing is the stylesheet: the Tailwind utilities the markup uses are compiled into
the `<style id="tailwind-css">` block in `index.html` and committed, so the page still opens from a
double-click. After using a utility class that is new to the page, run `npm run build-css` (it
rewrites that block); `npm run test-fast` fails with the missing class names if you forget. The
block used to be generated once and then patched by hand, and ~60 classes the markup used simply
did not exist — nothing errors when that happens, the class just does nothing.

## Boot sequence

Order matters here, and it is the one genuinely non-obvious thing in the codebase.

1. `data/*.js` load as ordinary scripts. They declare the corpus and reference tables.
2. `app/ledger-app.js` loads and **defines `initApp()` without running it.**
3. The `account-sync` block in `index.html` resolves who is signed in — reads the remembered
   handle, fetches that profile from Supabase, writes it into `localStorage`.
4. Only then does it call `bootApp()` → `initApp()`.

Step 2 is deliberate. The app reads the signed-in person's profile from `localStorage` as it
initialises, so **it must not run before step 3 finishes** — otherwise every account boots against
whatever profile happened to be in storage first. This used to be enforced by storing the app as a
`<script type="text/plain">` and injecting it at runtime; wrapping it in `initApp()` achieves the
same timing without costing syntax highlighting, breakpoints and stack traces.

If you add another app file, load it the same way (define, don't execute) and call into it from
`initApp()`.

Boot builds only what the opening view shows. The GOAT Profile, Creators, Contenders and Matrix
tabs (`DEFERRED_PROFILE_VIEWS`) and the Collection and Watchlist tabs are built the first time they
are opened, and a profile change marks the unopened ones stale (`profileDirtyViews`) instead of
rebuilding them; `switchView` builds a stale tab on the way in. The page went from ~72,000 elements
after boot to ~6,000. The generated recommendations are built once, after the series table they
read exists — they used to be built twice, the first time with nothing to read.

## State and where it lives

The app has one source of truth per person, and three places it is stored.

| Where | What | Notes |
|---|---|---|
| `localStorage` | The live profile | Authoritative while you are using the app |
| `profiles.data` (jsonb) | Full snapshot | Convenience copy of the same seven keys |
| `media_status` (rows) | Gold/Silver/Bronze/Owned/Rating | Normalized, one row per person per title |

Seven `localStorage` keys are synced (`TRACKED` in `index.html`): profile, watchlist, theme,
density, onboarded, tips-dismissed, and `omniLedgerEdits` — when each title (and each setting) was
last changed on any device, which is what lets two copies be merged instead of one replacing the
other (see "Saving"). Everything else the app shows — match scores, recommendations, taste DNA — is
**derived at runtime** from those plus the static corpus. Nothing computed is ever persisted, which
is why changing the scoring engine needs no migration.

`media_status` is the durable, scalable copy: plain rows, queryable per person and per title. If
the jsonb blob is ever empty or damaged, `rebuildProfileFromMediaStatus()` reconstructs the account
from those rows rather than treating it as new.

### The watchlist, and what you have completed

`omniLedgerWatchlist` holds both halves of the Watchlist tab, one entry per title:

```
{ watched: false, added: <ms> }                                 Up Next (saved with the ♡)
{ watched: true,  added: <ms>, doneAt: <ms> }                   Completed, after being in Up Next
{ watched: true,  added: <ms>, doneAt: <ms>, logOnly: true }    Completed straight from a card
```

`logOnly` is what makes undo behave: undoing a completion that was never queued deletes the entry,
while undoing one that was queued puts it back in Up Next. `doneAt` is editable from the Watchlist
tab and absent on entries completed before it existed. `wlSetDone()` is the one writer.

Completion is deliberately **not** part of `PERSONAL_PROFILE`: it is a record of what you did, not a
taste signal, so it never re-runs the scoring pass — a ✓ click redraws only that title's corner and
tier-row button (`refreshDoneUI`) plus whatever list is filtered by it. It still shapes what the app
*suggests*: generated recommendations, blind spots, Surprise Me's Discover pool, Best Untried
Matches and the Watchlist's own "Recommended next" all skip completed titles. It is not mirrored
into `media_status`, so `rebuildProfileFromMediaStatus()` cannot restore it; the jsonb snapshot and
Export both carry it.

## How GOAT Match is computed

One re-runnable pass, `recomputeTasteScores()`, rebuilt from scratch every time the profile changes
(a tier click, a rating, an ownership toggle). In order:

1. **Learn.** `buildTasteModel(ALL, {ratings, gold, silver, bronze, taxonomy})` reads every work the
   person has rated, tiered or shelved and turns it into one signed affinity in `[-1,+1]` — a rating
   read both against that person's own centre (shrunk toward a neutral prior while their sample is
   small) and against a fixed midpoint, blended with the tier if the work carries one. From those it
   derives four tables: **genre** (credited up the taxonomy, so a Cosmic Horror favorite also teaches
   Horror, weaker), **vibe**, **creator**, and a per-**axis** multiplier for each of the six quality
   constructs. Every weight is measured against the person's own baseline *and* against how common
   the feature is in the corpus, then shrunk by `n/(n+3)` — so weights get stronger and sharper as
   the profile fills, never noisier, and a genre only scores for being characteristic rather than
   for being common.
   Last, a signed **tone** affinity (warmth, comedy, dread), each work placed within its own
   medium: the one taste signal that reaches a medium the person has not tiered in, and the only
   axis signal that can count *against* a work.
2. **Score.** Per work: an objective half (`0.5·crit + 0.2·aud + 0.3·tech` plus the six quality
   boosts, each scaled by that person's axis multiplier) and a personal half (creator + genre + vibe
   weights plus the signed tone fit, saturated through `tanh` so stacked matches taper instead of
   piling into the ceiling).
   The objective half is put on one cross-medium scale first, so which medium tops a shared list is
   decided by taste rather than by which aggregator a medium's numbers came from.
3. **Calibrate.** `buildScoreCurve()` maps the raw score through a monotone quantile curve: median
   near 68, top decile past 85, the nineties reserved for the top ~3%. Order is preserved exactly.
   The band above the median is compressed while the profile is thin and relaxes as evidence
   accumulates, so a profile that has told the app nothing tops out in the low nineties instead of
   claiming a 99% match to someone it knows nothing about.
4. **Override.** A rating blends the score 65/35 toward the number typed (the only signal that can
   pull a score *down*); then the Silver/Bronze/owned floors lift it (parallel rungs, never
   crossing — see `tierTarget`); then Gold pins to 100.

The number on a card's ring is this score, labelled "Match" once the profile holds any rating, tier,
ownership or hand-set boost and "Score" before that — with nothing personal to go on it is only the calibrated
critical/audience/craft consensus, and nothing on the page calls it a match for anyone's taste.
`tasteBasis()` is what every explanation reads to say what a match rests on ("based on 3 ratings
and 2 favorites"); `matchTitle()` is the ring's own description.

**How good it is, measured.** `npm run rec-quality` (and the "recommendation quality" flow in the
browser suite, on every pull request) hides favorites and checks whether the engine finds them
again among everything untried: the PK Sample's 53 favorites five folds at a time, and each of four
cold-start personas' six to eight favorites one at a time. Today the engine puts 53% of the PK
Sample's hidden favorites in its top 100 of ~4,800 (acclaim alone: 13%) and 54% of the personas'
(acclaim alone: 21%). The checks fail if that drops below floors set a little under those numbers.
When tuning, change one constant and re-run it: a sweep of every constant in `buildTasteModel` and
the taste/objective balance found no change that improved every profile at once, so the current
values sit on a plateau rather than on one profile's peak.

Nothing here is persisted, and every field is reset at the top of the pass, so running it twice
produces the same result as a fresh boot.

## What keeps a click fast

A tier, owned or rating click re-runs the whole scoring pass in place (`mutateProfile` →
`recomputeProfileDerived`), then redraws only what it has to. Three things keep that at ~140ms on a
5,000-title corpus:

- **Only the cards that can have changed are rebuilt** (`patchControllerGrid`, with
  `expandChangedIds` widening the set along the two ways one card reads others). The regression
  suite asserts the patched grid is byte-identical to a full redraw.
- **A card's hidden panels are built on first open.** The summary and the full breakdown are ~3/4
  of a card's HTML; `cardHTML` emits empty `[data-lazy]` shells and `fillCardPanels` (called from
  `setCardExpanded`) builds them when the card is opened. Anything that needs a panel's contents
  must open the card first, which is also the only way a person can see them.
- **Per-card corpus lookups are memoized per scoring pass.** `whyRecommended`, `crossThread` and
  `crossMediumPairings` used to filter and sort the whole corpus for every card drawn.
  `derivedLookups()` builds the shared pools and sort orders once, keyed on `_derivEpoch`, which
  `applyOwnershipFromProfile` and `recomputeTasteScores` bump. Anything new that changes
  owned/tier flags or `gm` must go through one of those two, or bump the epoch itself. The results
  are identical to the old full scans (stable sort commutes with filter), and the suite checks that
  against the original implementations for every title.

## Search

`app/search.js` is pure and runs everywhere a list is searched: the Global Controller, the GOAT
Picker and GOAT Profile search, the Watchlist and the Collection. `buildSearchIndex` folds every
work's title, creator and other fields once per corpus (NFKD with the combining marks stripped, a
short map for letters that are not marks — ł, ø, æ, ß —, lowercase, `&` → and, apostrophes dropped,
every other run of punctuation a space) and keeps its vocabulary. A query is folded the same way
and split into words, and every word must match somewhere — as a whole word or a word start, inside
a word for four letters or more, and only if a word matches nothing at all, within one typo (4–7
letters) or two (8+). Hyphenated words are phrases ("sci-fi" is the genre, not "sci" and "fi"
anywhere). Each hit carries a relevance bucket — exact title, title prefix, all words in the title,
creator, other fields — and lists sort by bucket first, then by whatever sort the person chose, so
"dune" puts Dune first while "kubrick" (all creator matches) still follows the chosen sort.
`test/search.js` holds the queries that used to find nothing.

## Offline

Two layers, independent of each other.

**The app files** (`sw.js`, registered from `index.html` for http(s) pages only — a `file://` copy
never runs a service worker and needs none). Same-origin requests are network-first: online you
always get the current deploy and the offline copy is refreshed from it, so there is no cache
version to bump and no way to run new HTML against old scripts. If the network fails, or has not
answered in 4s, the saved copy is served. The two CDN scripts are pinned to exact versions and
served cache-first. Supabase API calls are never intercepted. Everything is precached at install,
so one online visit is enough.

**Your data** (`account-sync` in `index.html`). Offline, `runScheduledSync` does not try: the edit
is already in `localStorage` and marked pending, which is what stops any later boot from pulling
the cloud copy over it, and the account menu reads "Offline" rather than reporting a failure. An
`online` listener sends it the moment the connection returns. Booting offline with a remembered
handle skips the profile fetch (and its retry) and opens from this device's copy directly.

## Saving, and why it is defensive

Saving is the part of this codebase with the most hard-won logic. The short version:

- **A write is not trusted until it is verified.** `pushSnapshot()` upserts, asks PostgREST for the
  rows it actually wrote, then reads the row back and compares. Silence is not success — Postgres
  applies an RLS `UPDATE` policy to `INSERT ... ON CONFLICT DO UPDATE` as a *filter*, so a refused
  write returns 2xx with zero rows and no error.
- **Unsaved changes are never pulled over.** A pending marker is set on every edit and cleared only
  by a verified write. While it is set, no page load may overwrite local data.
- **Two copies are merged, not raced.** Every tracked write records which titles and settings it
  changed, and when, in `omniLedgerEdits` (`syncRecordEdits` in `app/sync-merge.js`; a path names
  one entry — `s|m14` is m14's Silver tier, `r|m14` its rating, `w|m14` its watchlist entry,
  `k|omniLedgerTheme` the theme, `P|pinnedIdx` a profile field kept whole). A push reads the cloud row first, merges it
  with the local copy title by title — the newer stamp wins; on a tie a value beats an absence and
  then local wins — and writes the result *conditionally on the row's `updated_at` still being the
  one it read*, retrying on a miss. So a phone's offline edits and a laptop's edits of the same day
  both survive, a removal on one device is not undone by the other's older copy, and two devices
  saving at once cannot erase each other. Whatever the merge brought in from the cloud is written
  back to `localStorage` and announced (`omni:stored-state-changed`); `app/ledger-app.js` adopts it
  without a reload, the same way it adopts another tab's writes (the `storage` event). Stamps expire
  after 45 days — longer than any device is likely to sit unsynced — so the edits map stays small.
- **Writes are serialised.** All profile saves go through one chain, so two uploads are never in
  flight at once and the newest snapshot always lands last.
- **No-op writes are not edits.** Re-writing a value that has not changed schedules nothing.

Those last two exist because of a real bug: the theme system re-writes the theme on every boot, and
on a new account that produced a near-empty upload that raced and overwrote the real save.

## Changing things

**Adding titles** — edit the relevant `data/*.js`, then `npm run validate-corpus`. See
[Corpus data quality](#corpus-data-quality) below for what that checks and why — it is the thing
standing between a bulk import and quietly worse recommendations.

**Adding a screen** — add a `<section data-sec="...">` in `index.html`, a nav button, and a render
function in `app/ledger-app.js` wired into `switchView()`.

**Updating the PK Sample** — "Start from the PK Sample" copies `data/pk-sample.js`, a committed file,
not the live `payton` account: any name can be signed into, so reading that account let whoever last
signed in as payton decide what every newcomer started from. Regenerate the file with
`node scripts/update-pk-sample.js <file from the Export button>` (or `--from-cloud` to read the
`payton` account directly), add `--dry-run` to preview. It prints what changed by title, refuses a
profile with nothing tiered or owned, and refuses ids missing from the corpus (`--drop-unknown`
leaves them out); `validate-corpus` re-checks the same things on every run.

**Adding a synced setting** — add the key to `TRACKED` in `index.html`. It is merged as one value
(newest edit wins) unless it is JSON worth merging entry by entry, in which case teach
`syncPaths`/`syncBuild` in `app/sync-merge.js` its shape and add a case to `test/sync-merge.js`.
(The schema used to keep an allow-list of keys too; it no longer filters the payload at all — see
the comment in `validate_omni_profile_data` for why.)

**Adding a file the page loads** — add the `<script src>` / `<link href>` to `index.html` *and* the
path to `PRECACHE` in `sw.js`, or the hosted app opens offline without it. The suite fails if the
two lists disagree.

**Changing the database** — `supabase/schema.sql` is idempotent; re-run the whole file. The
Supabase SQL Editor runs it as one transaction, so a single failing statement rolls back
everything — statement order matters (a column must exist before it is granted).

## Corpus data quality

The recommendation engine has no external source of truth. Every match score, every family lens,
every bracket and every "why this was recommended" is derived from `data/*.js` and nothing else. So
a bad field does not produce an error — it produces a slightly worse answer, forever, silently.
That is the whole reason `scripts/validate-corpus.js` is stricter than it looks like it needs to be.

Run it with `npm run validate-corpus`, or `node scripts/validate-corpus.js --report` for the same
checks plus a health report (per-field ranges, the live vocabularies, and **the next free ID for
each medium** — useful when adding a batch).

**What it fails on.** These are the things that are simply wrong:

| Check | Why it matters |
|---|---|
| Scoring indices are numbers in 0–100 | They feed `gm` directly. A 140 doesn't error, it distorts every score derived from it. |
| Year / runtime / pages / seasons in plausible ranges | Catches typos a required-field check cannot see. |
| Closed vocabularies hold known values | An unknown value makes the record *unreachable* by the filter that reads it, not broken. |
| Title / creator / vibe / justification are real text | A placeholder passes "field present" and then renders onto a card. |
| Non-empty, duplicate-free genre lists | Genres drive families, boosts, certification and most discovery surfaces. |
| Every work maps to ≥1 genre family | A family-less work is invisible to the family lens, family filters, cross-medium pairings, the rabbit hole and the graph — all at once, while its own card looks fine. |
| No creator spelled two ways | Splits a filmography: a creator boost (matched with `includes`) lifts only one spelling. |
| No two vibes differ only by case/punctuation | Splits a mood, halving any vibe boost on it. |

**The closed vocabularies:**

- `tv.formats.structuralType` — `Limited/Mini-Series` | `Multi-Season Epic`. Only two, because the
  Global Controller's TV structure filter only understands two. A third value means those series
  match neither option.
- `movies.contextTags.formatType` — `Feature Film`.
- `books.format` — the physical binding: `Hardcover` | `Paperback` | `Deluxe` | `Boxed Set`. Drives
  "Edition Quality" and the Collection tab's shelf grouping.
- `books.contextTags.formatType` — the book's *form*, the counterpart of a film's "Feature Film":
  `Novel` | `Non-Fiction` | `Poetry` | `Short Stories` | `Graphic Novel` | `Memoir` | `Essays`.

**What it warns on** (never fails — these are curation calls, not errors): compound family labels
used as raw genres, and one creator split across two credits that no single boost can cover. Both
warnings are currently silent, and the second is worth understanding before it fires again: a boost
is applied with `x.creator.includes(boostName)`, so two spellings are only a problem when neither
name contains the other. `"Jeff VanderMeer"` sits inside `"Ann & Jeff VanderMeer"` and one boost
covers both; `"Joel & Ethan Coen"` and `"Joel Coen"` share no containment, so nothing could cover
both and three Coen films silently went unboosted until the credits were merged.

**Do not put a genre-family name in a `genres` array.** The corpus used to carry eight compound
labels (`Literary & Poetry`, `Epic / Historical`, …) as if they were genres, and they caused two
distinct classes of damage. One was the Verse mislabelling below. The other was quieter: the genre
boost matches substrings, so the single tag `"Epic / Historical"` collected the `epic` boost *and*
the `historical` boost — one tag drawing two — and it matched the `Biography & History` family
regex, filing *A Storm of Swords* and *A Clash of Kings* under biography. Both are gone now; each
label was replaced with a genre that can never be false of the work (a biography is history,
cosmology is physics), keeping both halves only where both genuinely apply.

**The trap this is guarding against.** Every rule above exists because the corresponding defect was
actually found in this corpus, not because it seemed prudent. The worst of them: 200 prose novels —
*The Great Gatsby*, *Anna Karenina*, *Middlemarch* — were certified as poetry, because `certify()`
searched their genre strings for "poetry" and they carry the compound family label
"Literary & Poetry". Nothing errored. The chip on the card said Verse, the content-rating filter
returned them under Verse, and the only way to notice was to look at a card and know it was wrong.
When adding a field or a derived label, prefer matching a value exactly over searching a string for
a substring, and add the vocabulary to the validator so the next person cannot drift off it.

## Testing

`npm test` runs two tiers: `npm run test-fast` (the corpus validator, the stylesheet check, the
schema checks, the fact/substance/score harnesses, the search and merge harnesses, and
`test/evidence.js`, which fails if any committed evidence file carries synopsis or blurb prose,
~15s) and `npm run test-browser` (the Playwright suite, ~7 min).
The suite covers onboarding, every screen, filters, tiering, and the whole cloud-account flow
against a mocked Supabase, so no real project is needed. CI runs both on every pull request; day to
day, `test-fast` plus lint is the pre-commit check, and `node test/regression.js --only=<flow>`
re-runs a single browser flow in seconds (see CLAUDE.md).

`test/search.js` runs `app/search.js` against the real corpus with no browser; `test/sync-merge.js`
does the same for the merge rules, including the offline-phone-and-laptop case. `npm run
rec-quality` prints the recommendation-quality report described under "How GOAT Match is computed".

### The live database checks

`test/schema.js` has two layers: static checks that read `schema.sql` as text and always run, and
**live checks that apply it to a real Postgres** — those only run when `OMNI_TEST_DATABASE_URL` is
set, and print `SKIPPED` otherwise. CI now sets it (a `postgres:16` service in the workflow), so they
run on every push.

Run them locally against any throwaway database:

```
OMNI_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm test
```

The mocked Supabase in the browser suite cannot see any of what these cover, and neither can reading
the SQL: both bugs this file exists for were behavioural, not syntactic — a BEFORE UPDATE trigger
returning OLD (every established account silently discarded every save) and an RLS policy filtering
an `ON CONFLICT DO UPDATE` (2xx, zero rows written, no error). The live layer now also exercises the
policies **as the `anon` role**, which is what the browser actually connects as; everything running
as the superuser bypasses RLS entirely and so proves nothing about it.

Two roles, `anon` and `authenticated`, are created by the test rather than by `schema.sql`. Supabase
provides them on every project, so a `create role` in the schema would be wrong there — the test
stands in for the platform, which keeps these checks about *your schema* rather than about Supabase.

The convention worth keeping: when fixing a bug, add a check, then **disable the fix and confirm
the check fails**. Several tests in here originally passed with the fix removed and proved nothing
until they were rewritten.

**Never sleep a fixed number of milliseconds — after a page load or after anything else.** Use
`waitForBoot(page)` after a load, `settle(page)` after an interaction, and `readWhen(...)` when the
check is about a specific value arriving. Boot cost scales with the corpus — every `data/*.js` file
is parsed on every load — so a sleep tuned to be "comfortably enough" at 2,500 works is a coin flip
at 5,000 and a reliable failure at 10,000. A suite that gets less trustworthy as the dataset grows
is worse than no suite, because it teaches you to ignore it exactly when the data is changing
fastest.

This rule used to cover page loads only, and the suite still had ~150 "click, sleep 150–900ms,
read once" sites. On a slower CI runner a different handful of them lost the race on each run,
which is why fixing one flaky check only ever surfaced the next one. They are all gone now:

- `settle(page)` waits until the page has no pending short timers (≤ 1s: debounces, the edit-sync
  debounce, read-back retries), no pending animation frames (the chunked grid render) and no
  in-flight fetches, and is not mid-unload. Every page gets the instrumentation that tracks this
  injected by `instrumentBrowser`, so a new page cannot miss it.
- `settle(page, { through: 1500 })` also waits out the 1.5s idle-sync debounce, for checks that
  need "every queued upload has run".
- Inside a single `page.evaluate`, use `await window.__omniSettle.whenIdle()`.
- A deliberate wait for real time (only the combo's 300ms just-opened guard today) keeps its sleep
  and says why on the same line. A sleep is only acceptable where being too short would make a
  check *pass* wrongly, never *fail*.

To find a timing-dependent check before CI does, run with every page's CPU slowed:
`OMNI_THROTTLE=4 node test/regression.js`. It should pass exactly like a normal run, only slower;
if it doesn't, the failing check is waiting on the clock somewhere. Plain host load does not
reproduce CI failures here — the page being slow does. `OMNI_SETTLE_DEBUG=1` logs every settle
that took over two seconds, with its caller.

Related: a check that can't find its element should **fail**, not throw. Each flow now runs inside
`runFlow`, so a throw costs one failure named after its flow instead of aborting the run — but it
still skips the rest of that flow, so one flaky assertion can hide dozens of checks behind it.

## Known limits

- `app/ledger-app.js` is still a large file (most of it is `initApp()`'s body). A first pass
  pulled out the closure-independent pieces -- pure functions and constant data tables that never
  touch `state`/`PERSONAL_PROFILE`/DOM -- into `app/format.js`, `app/cards.js` and `app/scoring.js`.
  A second pass went further: functions that read `state`/`ALL`/`$`/`$$` directly, but don't nest
  inside a ROUTING & BINDINGS event-handler closure, can still be extracted by turning those reads
  into explicit parameters. `app/match.js` (the live Match scoring pass), `app/matrices.js` (VIEW 4
  · Reference Matrices) and `app/creators.js` (VIEW 5 · Pan-Creator Archives) came out this way --
  every call site inside `initApp()` now passes `state`/`ALL`/`$`/`$$` in explicitly, and a few
  module-level `var`s that used to be local to `initApp()` (`MATRIX_TITLES`, `matrixOwnedOnly`,
  `matrixNavQ`) moved out with the functions that read and write them; that's safe only because
  `initApp()` is called exactly once per page load (see "Boot sequence"), so a `var` at a classic
  `<script>`'s top level is exactly as global as one declared inside `initApp()` used to be.
  Candidates evaluated but left in place, and why:
  - `renderContenders`/`anticipationScore` read `state`-like module vars (`contMedium`, `contSort`,
    `contSearchQ`) that are fine to hoist the same way, but `anticipationScore` also reads
    `GOAT_CREATOR_BOOST`/`BOOK_CREATOR_BOOST`, which are `let`s *reassigned* (not mutated in place)
    by `recomputeTasteScores()` whenever the profile changes. Extracting it correctly means passing
    the current value in at every call site rather than assuming a stale closure snapshot -- doable,
    but higher-risk than the pieces above, and deferred to keep this pass conservative.
  - `renderGoat`, the GOAT Profile tiering UI, and the Collection/Watchlist/Timeline/Portrait render
    functions read `PERSONAL_PROFILE` and several derived module-level caches
    (`goatProfile`/`declaredCategoriesToRender`/`COLL_OPEN`/etc.) with deeper cross-references
    between each other than the Matrices/Creators pair had; they're plausible future candidates but
    want their own careful pass rather than being folded into this one.
  - Anything nested inside an `on(...)`/`addEventListener` handler, or otherwise part of the
    ~2,700-line ROUTING & BINDINGS section, closes over locals from its enclosing handler rather
    than just `initApp()`, and hoisting it is a different, riskier problem than this pass takes on.
  Splitting further means finding more such pieces the same way: grep the candidate for free
  variables, confirm they're either true globals, safely-hoistable module vars, or need to become
  explicit parameters, then move it into `app/<area>.js`, load before `app/ledger-app.js`, and keep
  everything still tangled with ROUTING & BINDINGS or reassigned derived state inside `initApp()`.
- The corpus is static JS. Fine at this size; if titles ever need to be user-editable it belongs
  in Postgres. Measured headroom, against a synthetically duplicated corpus: at 2,508 works boot is
  ~1.8s and every tab switch is under 320ms; at 10,032 works boot is ~2.9s and the slowest tab
  (Visualization Suite) is ~880ms. Everything on the hot path is linear in corpus size, not
  quadratic, so growing the library several times over is a size problem, not an architecture
  problem. The first thing to feel it will be the Visualization Suite.
- Two server-side caps sit above the corpus rather than scaling with it: `profiles.data` is limited
  to ~200KB (the sample profile is ~6KB, roughly 46 bytes per tiered or owned title, so ~4,000
  titles; each completed title adds ~70 bytes to the watchlist key in the same row, and each title
  changed in the last 45 days ~22 bytes to `omniLedgerEdits` — starting from the PK Sample stamps
  all 385 of its entries at once, ~8.6KB), and `media_status` is capped at 50,000 rows per handle. Both are backstops against a
  runaway client, not product limits — raise them before they bind.
- Handles are names, not verified identities. There is no auth — anyone can sign in as any handle.
  This is an intentional trust model for a small friend group, not an oversight, but it is the
  thing to revisit before opening it up more widely.
