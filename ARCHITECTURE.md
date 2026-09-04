# Architecture

How the pieces fit together, for anyone changing the code. `NOTES.md` is the historical
engineering log (why things ended up this way, phase by phase); this file is the current map.

## Layout

```
index.html          Page layout + styling, and the account sign-in / cloud-sync code
app/ledger-app.js   The application: every screen, the scoring engine, all interactions
data/*.js           Reference data (corpus, creator pantheons, contenders)
supabase/schema.sql The database: tables, row-level security, grants
test/regression.js  Playwright suite, ~130 checks
scripts/            Corpus integrity checker
```

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
| `media_status` (rows) | Gold/Silver/Bronze/Owned | Normalized, one row per person per title |

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
used as raw genres, and a same-surname duo that also appears credited solo.

**The trap this is guarding against.** Every rule above exists because the corresponding defect was
actually found in this corpus, not because it seemed prudent. The worst of them: 200 prose novels —
*The Great Gatsby*, *Anna Karenina*, *Middlemarch* — were certified as poetry, because `certify()`
searched their genre strings for "poetry" and they carry the compound family label
"Literary & Poetry". Nothing errored. The chip on the card said Verse, the content-rating filter
returned them under Verse, and the only way to notice was to look at a card and know it was wrong.
When adding a field or a derived label, prefer matching a value exactly over searching a string for
a substring, and add the vocabulary to the validator so the next person cannot drift off it.

## Testing

`npm test` runs the corpus validator and the full Playwright suite. The suite covers onboarding,
every screen, filters, tiering, and the whole cloud-account flow against a mocked Supabase, so no
real project is needed.

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

- `app/ledger-app.js` is one large file. Splitting it further is straightforward now that it is
  real JavaScript: move functions into `app/<area>.js`, load before it, keep profile-dependent
  initialisation inside `initApp()`.
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
