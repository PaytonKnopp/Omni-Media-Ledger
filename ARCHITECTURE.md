# Architecture

How the pieces fit together, for anyone changing the code. `NOTES.md` is the historical
engineering log (why things ended up this way, phase by phase); this file is the current map.

## Layout

```
index.html          Page layout + styling, and the account sign-in / cloud-sync code
app/ledger-app.js   The application: initApp() -- every screen and all account/state-dependent logic
                      that is still too closure-tangled to pull out (see "Known limits")
app/format.js       Pure provenance/edition-format helpers (provStampOf, normPhysFormat)
app/cards.js        Pure HTML-string/widget builders (esc, ring, microBar, frontBars, matrixRow, ...)
app/scoring.js       Pure deep-index scoring tables + certify()/lerpScore() (the hand-tuned overrides
                      and content-rating logic)
app/match.js         The live "Match" scoring pass (activeDims/computeMatch/bespokeScore) -- reads
                      only `state`, passed in explicitly by initApp()
app/matrices.js      VIEW 4 · Reference Matrices (matrixBlock/renderMatrixNav/renderMatrices) --
                      takes ALL/$/$$ as parameters; MATRIX_TITLES/matrixOwnedOnly/matrixNavQ live
                      here too now (see "Known limits")
app/creators.js      VIEW 5 · Pan-Creator Archives (worksFor/creatorCard/sortCreatorPairs/
                      renderCreators) -- takes state/ALL/$/$$ as parameters
data/*.js            Reference data (corpus, creator pantheons, contenders)
supabase/schema.sql  The database: tables, row-level security, grants
test/regression.js   Playwright suite, ~130 checks
scripts/             Corpus integrity checker
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

## State and where it lives

The app has one source of truth per person, and three places it is stored.

| Where | What | Notes |
|---|---|---|
| `localStorage` | The live profile | Authoritative while you are using the app |
| `profiles.data` (jsonb) | Full snapshot | Convenience copy of the same six keys |
| `media_status` (rows) | Gold/Silver/Bronze/Owned/Rating | Normalized, one row per person per title |

Six `localStorage` keys are synced (`TRACKED` in `index.html`): profile, watchlist, theme,
density, onboarded, tips-dismissed. Everything else the app shows — match scores, recommendations,
taste DNA — is **derived at runtime** from those plus the static corpus. Nothing computed is ever
persisted, which is why changing the scoring engine needs no migration.

`media_status` is the durable, scalable copy: plain rows, queryable per person and per title. If
the jsonb blob is ever empty or damaged, `rebuildProfileFromMediaStatus()` reconstructs the account
from those rows rather than treating it as new.

## Saving, and why it is defensive

Saving is the part of this codebase with the most hard-won logic. The short version:

- **A write is not trusted until it is verified.** `pushSnapshot()` upserts, asks PostgREST for the
  rows it actually wrote, then reads the row back and compares. Silence is not success — Postgres
  applies an RLS `UPDATE` policy to `INSERT ... ON CONFLICT DO UPDATE` as a *filter*, so a refused
  write returns 2xx with zero rows and no error.
- **Unsaved changes always beat the cloud.** A pending marker is set on every edit and cleared only
  by a verified write. While it is set, no page load may overwrite local data.
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

**Adding a synced setting** — add the key to `TRACKED` in `index.html` *and* to the `allowed` list
in `supabase/schema.sql`, then re-run the schema. Keys the schema does not recognise are stripped.

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

`npm test` runs the corpus validator, the schema checks and the full Playwright suite. The suite
covers onboarding, every screen, filters, tiering, and the whole cloud-account flow against a mocked
Supabase, so no real project is needed.

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

**Never sleep a fixed number of milliseconds after a page load.** Use `waitForBoot(page)`. Boot cost
scales with the corpus — every `data/*.js` file is parsed on every load — so a sleep tuned to be
"comfortably enough" at 2,500 works is a coin flip at 5,000 and a reliable failure at 10,000. A
suite that gets less trustworthy as the dataset grows is worse than no suite, because it teaches you
to ignore it exactly when the data is changing fastest.

Related: a check that can't find its element should **fail**, not throw. An uncaught error aborts
the run and takes every later check with it, so one flaky assertion hides the whole suite.

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
  titles), and `media_status` is capped at 50,000 rows per handle. Both are backstops against a
  runaway client, not product limits — raise them before they bind.
- Handles are names, not verified identities. There is no auth — anyone can sign in as any handle.
  This is an intentional trust model for a small friend group, not an oversight, but it is the
  thing to revisit before opening it up more widely.
