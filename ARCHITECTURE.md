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

**Adding titles** — edit the relevant `data/*.js`, then `npm run validate-corpus`.

**Adding a screen** — add a `<section data-sec="...">` in `index.html`, a nav button, and a render
function in `app/ledger-app.js` wired into `switchView()`.

**Adding a synced setting** — add the key to `TRACKED` in `index.html` *and* to the `allowed` list
in `supabase/schema.sql`, then re-run the schema. Keys the schema does not recognise are stripped.

**Changing the database** — `supabase/schema.sql` is idempotent; re-run the whole file. The
Supabase SQL Editor runs it as one transaction, so a single failing statement rolls back
everything — statement order matters (a column must exist before it is granted).

## Testing

`npm test` runs the corpus validator and the full Playwright suite. The suite covers onboarding,
every screen, filters, tiering, and the whole cloud-account flow against a mocked Supabase, so no
real project is needed.

The convention worth keeping: when fixing a bug, add a check, then **disable the fix and confirm
the check fails**. Several tests in here originally passed with the fix removed and proved nothing
until they were rewritten.

## Known limits

- `app/ledger-app.js` is one large file. Splitting it further is straightforward now that it is
  real JavaScript: move functions into `app/<area>.js`, load before it, keep profile-dependent
  initialisation inside `initApp()`.
- The corpus is static JS. Fine at this size; if titles ever need to be user-editable it belongs
  in Postgres.
- Handles are names, not verified identities. There is no auth — anyone can sign in as any handle.
  This is an intentional trust model for a small friend group, not an oversight, but it is the
  thing to revisit before opening it up more widely.
