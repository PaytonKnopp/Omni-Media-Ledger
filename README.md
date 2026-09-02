# Omni-Media Ledger

A single-file, offline-first personal media database and taste engine covering **2,508 works** — 1,000 films, 250 TV series, 258 video games, and 1,000 books — with a scoring model tuned to one person's taste, a reconciled physical-collection inventory, and a set of analysis views.

There is no build step and no framework. It's a small folder — `index.html` plus a `data/` directory — you open in a browser; no server, no install. Optional cloud accounts (Firebase Firestore, see below) let anyone pick a name and get their own personalized, cross-device copy from the same file/link, with zero bias from anyone else's data — but the app works exactly the same, fully offline, without ever setting that up.

---

## What it does

The ledger scores every work on a shared set of indices (critical, audience, technical fidelity, atmospheric dread, ontological complexity, plus 15 secondary indices such as soundtrack, iconicness, historical accuracy, and comedy), then layers a **personal taste engine** on top that boosts works matching declared favourite creators, genres, and moods. The result is a "GOAT match" score per work, used to rank, filter, and recommend.

### Feature overview

| Tab | What it's for |
| --- | --- |
| **Global Controller** | The main browser. Omni-search across title/creator/studio/genre/vibe/year, media-type filter, searchable platform-network-studio combobox, 15 index sliders, genre families, ratings, year range, owned/unowned, and eight sort modes including a weighted **Blend** sort with adjustable Tech / Dread / Mind sliders and four presets. |
| **GOAT Profile** | Declared personal canon (films, books, TV, games, directors, actors, composers, cinematographers, music, YouTube) plus recommendations per category. Movies/Books/TV Series/Video Games and Directors are computed live from your actual profile; the other five people categories (Actors, Composers, Cinematographers, Music Artists, YouTube) are curated picks scored by genre overlap and labeled "approximate" — see `NOTES.md` Phase 4 for why. Recommendations are guaranteed never to suggest something already owned. |
| **★ Pick Your GOATs** | A dedicated search-select-finalize screen (header button, or the first-run gate's "Search & pick your GOATs" option) — search the full 2,508-work corpus, stage picks, finalize them as declared favorites. This is how a new person actually builds taste in the app: search and tap, no JSON required. Reopening it later adds to what's already declared, it never starts over. |
| **Taste Portrait** | Aggregate profile of what the collection says about its owner, including a **family lens** of 27 clickable genre-family tiles showing count, ownership share, and top match. |
| **Collection** | The owned physical library by format, plus an **Upgrade Audit** (which discs/editions are worth upgrading and why) and **Collection Intelligence** (creator and franchise gaps — acclaimed unowned works by creators already collected). |
| **Watchlist** | Works flagged for later, persisted in `localStorage`. |
| **Contenders Ledger** | 50 tracked upcoming releases with dual scoring: an **editorial** GOAT-probability and a personal **For You** anticipation score. Seven entries are flagged as a personal watchlist and rank first by design. |
| **Creator Archives** | 80 master creators (30 directors, 30 authors, 20 gaming auteurs) with cross-pantheon name search. |
| **Reference Matrices** | 19 ranked brackets — 4K reference tier, soundtrack hall, peak personal matches, cosmic dread, eldritch horror, cosmic awe, mind-benders, reality-benders, hard science, Westerns, war, horror, twists, iconic works, historical weight, performances, tearjerkers, comfort, and comedy. |
| **Visualization Suite** | Chart.js bubble field (critic × audience × fidelity), a three-slot searchable radar comparison of any works or creators, a decade histogram, and a hand-built SVG **relationship graph** with hover explanations of why two nodes connect and a clickable breadcrumb trail. |
| **Timeline** | Every work placed by release year, spanning 700 BC to 2027, with expandable eras and clickable chips. |

### Other behaviour

- **Nine themes** (Default plus eight named after works in the canon), each visually distinct, persisted in `localStorage`.
- **Density toggle** — comfortable/compact card layout, persisted.
- **Rabbit Hole** — a guided chain of related works with mood, era, and end-on-owned steering.
- **Surprise Me** — scoped random pick.
- **🌙 Tonight** — pick a mood and how much time you have, get one specific recommendation (time budget applies to films, the only kind with a reliable single-sitting runtime).
- **Score breakdown** on each card explaining exactly how a match score was reached, with a provenance flag (verified vs. curated estimate).
- **Declare favorite / Mark owned / Boost creator / Silver tier / boost a genre or vibe / boost a book's affinity** — buttons and clickable chips on every expanded card that personalize your profile directly, no JSON editing required (see `PROFILE_TEMPLATE.md` for the one remaining field, `cosmicHorrorCanon`, that still needs hand-editing).
- **Cross-Medium Pairings** — every expanded card also shows up to 3 works of a *different* medium (a film paired with a book, a game paired with a show) that share genres or vibe, ranked by overlap and match score. Click one to jump straight to it.
- **Profile Comparison** — the header's **⇄ Compare** control loads someone else's exported profile file and shows shared declared favorites, what's unique to each of you, shared boosted creators/genres, and an overlap percentage. Read-only: nothing is saved or applied, it's just a look.

---

## How to open and run it

This is a **static project with no build step**. There is nothing to install, compile, or serve.

1. Download or clone the repository, **keeping the folder structure intact** — `index.html` and the `data/` directory need to stay together in the same folder (the HTML file loads the corpus from `data/*.js` via relative paths).
2. Double-click `index.html`, or right-click → Open With → your browser.

That's it. It also works from a USB stick, an email attachment (zip the folder first), or a phone's Downloads folder — as long as the whole folder travels together, not just the one HTML file. It's also the file this repo's GitHub Pages deployment serves directly, so a hosted link works identically to a local copy.

> **In Visual Studio:** use **File → Open → Folder**, *not* "Open Project/Solution". There is no startup project and no Run button for a static file — preview it by opening `index.html` in a browser.

### File layout

```
index.html       The whole app: engine + UI + personal-default fallback + optional cloud-account layer
data/
  movies.js      const movies=[...]   1,000 films
  tv.js          const tvShows=[...]  250 TV series
  games.js       const videoGames=[...] 258 video games
  books.js       const books=[...]    1,000 books
scripts/
  validate-corpus.js     checks data/ for duplicate IDs/titles and required fields
test/
  smoke.js       Playwright regression suite
```

`data/*.js` are loaded as plain classic `<script src>` tags (not ES modules, not `fetch`) specifically so they still work when the file is opened directly via `file://` — no server.

### One file, everyone's own account

There used to be a second, blank-defaults copy of this app (`share.html`) for handing to other people, so nobody else's browser inherited Payton's personal taste. That's no longer needed: **cloud accounts** (see below) mean anyone opening `index.html` — a local copy, or the same hosted link — types a name once and gets their own account, fully isolated from everyone else's, that follows them across devices from then on. `index.html` still carries Payton's own collection/canon/taste-weights as its **fallback defaults for a browser that's never saved anything**, but that only ever matters before someone picks a name; once they do, their own (empty, until they build it) account takes over. The onboarding gate's **Use the built-in sample profile** option is Payton's data too, clearly labeled, offered as a look-around demo — not something anyone else is stuck with.

If cloud accounts aren't set up (see below), `index.html` behaves exactly like the old two-file model always did for a fresh browser: a one-time prompt offers **Quick-rate a few titles**, **Search & pick your GOATs**, **Start blank**, **Use the built-in sample profile**, or **Import a profile file** — and from there, the **Declare favorite** / **Mark owned** / **Boost creator** buttons on any card, or the **★ Pick Your GOATs** header button, build a profile with no JSON editing. It's just saved to that one browser's `localStorage` only, same as before, rather than synced anywhere.

Export/Import/Reset controls in the header let anyone move a profile between browsers manually, cloud accounts or not.

### Cloud accounts (optional)

See `NOTES.md` → "Cloud accounts" for the full write-up: how it works, the 5-minute Firebase setup, and a Firestore security-rules starting point. Short version: fill in the `FIREBASE_CONFIG` object near the top of the `acct-boot` script block in `index.html`, and every visitor gets a **Whose ledger?** name prompt before the app loads, hydrating their own saved profile from the cloud (or starting a fresh one under that name). A dropdown in the header's top-right **Account** control shows who's currently signed in and lets anyone switch to a different name. Left unconfigured, none of this activates — zero network calls, identical to the pre-accounts behavior.

### Running the regression suite

There are two committed checks. `scripts/validate-corpus.js` needs no browser and no dependencies — it checks all four corpus arrays (movies/TV/games/books) for duplicate IDs, duplicate titles, and required fields; run it any time with `node scripts/validate-corpus.js`. `test/smoke.js` is a Playwright suite covering onboarding, all 10 views, filters, the combo-dropdown fixes, the GOAT Picker, and the cloud-account flow (against a mocked Firestore, so it needs no real Firebase project). Both are optional — the app itself needs nothing installed — but useful after making changes:

```
npm install -D playwright-core
npx playwright install chromium   # once, if you don't already have a Chromium build
npm test
```

### Requirements

- Any modern browser (Chrome, Edge, Firefox, Safari, mobile included).
- No internet connection needed — everything works fully offline except the three Chart.js canvases in the Visualization Suite, which need a network connection and otherwise show a clear fallback message. See below.

---

## API keys

**None.** The project requires no API keys, tokens, accounts, or credentials of any kind. It makes zero `fetch`, `XMLHttpRequest`, or WebSocket calls (the `data/*.js` corpus files load as plain `<script src>` tags, not fetched). All 2,508 records are embedded in the `data/` folder shipped alongside the HTML.

If you ever add an external API later, do **not** hardcode the key in `index.html` — anyone who opens the page or views source can read it. Client-side static pages cannot keep a secret.

---

## External dependencies (CDNs)

One, loaded from a public CDN at page load — Tailwind CSS is no longer one of them (see below):

| Dependency | URL | Used for | If it fails to load |
| --- | --- | --- | --- |
| **Chart.js 4.4.1** | `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js` | The three canvas charts in the Visualization Suite | Degrades gracefully: the app retries for ~2s, then shows a clear message on the three charts. Every other tab, including the SVG relationship graph, keeps working. |

**Tailwind CSS is compiled and committed inside `index.html`** — no CDN, no runtime compile step. Regenerating it (only needed if utility classes are added or removed) is documented in a comment right above the compiled `<style>` block, and in `NOTES.md`.

**Practical implication:** the file is genuinely offline-first now, for both data and appearance. With no network at all, everything works and looks correct except the three Chart.js canvases, which show a clear fallback message instead.

---

## Data storage

All persistence uses browser **`localStorage`** under four keys:

| Key | Stores |
| --- | --- |
| `omniLedgerWatchlist` | Watchlist item IDs |
| `omniLedgerTheme` | Selected theme |
| `omniLedgerDensity` | Comfortable vs. compact layout |
| `omniLedgerProfile` | Your personal profile — owned collection, declared canon, taste-engine weightings, and contender watchlist order (see `PERSONAL_PROFILE` in `NOTES.md`) |

**What this means:**

- Data is stored **per browser, per device, per profile**. It does **not** sync.
- Opening the file on your phone will not show the watchlist (or profile) you built on your desktop.
- Chrome and Firefox on the same machine keep separate copies.
- Clearing site data or browsing history can erase it.
- Private/Incognito windows discard it on close.
- It is **not** backed up by the repository. Committing and pushing does not save your watchlist or profile.

The 2,508-work corpus and the contenders ledger are **not** in `localStorage` — the corpus is hardcoded in `data/*.js` and the contenders ledger in `index.html` itself, and both are identical for everyone who opens the file. Ownership flags, declared canon, and taste weightings *are* personal and now live in `omniLedgerProfile`: a fresh browser with nothing saved there falls back to the defaults baked into this copy of the file (Payton's own profile), until you use the header's **Export**, **Import**, or **Reset** controls to take a copy elsewhere or start blank — or, with cloud accounts configured (see above), until you sign into your own account.

---

## Privacy notice

This file contains a real person's media collection and taste profile. Read the "Sensitive content" section of `NOTES.md` before making the repository public or sharing the file.
