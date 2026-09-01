# Omni-Media Ledger

A single-file, offline-first personal media database and taste engine covering **1,300 works** — 500 films, 150 TV series, 150 video games, and 500 books — with a scoring model tuned to one person's taste, a reconciled physical-collection inventory, and a set of analysis views.

There is no build step, no framework, no backend, and no account. It is one HTML file you open in a browser.

---

## What it does

The ledger scores every work on a shared set of indices (critical, audience, technical fidelity, atmospheric dread, ontological complexity, plus 15 secondary indices such as soundtrack, iconicness, historical accuracy, and comedy), then layers a **personal taste engine** on top that boosts works matching declared favourite creators, genres, and moods. The result is a "GOAT match" score per work, used to rank, filter, and recommend.

### Feature overview

| Tab | What it's for |
| --- | --- |
| **Global Controller** | The main browser. Omni-search across title/creator/studio/genre/vibe/year, media-type filter, searchable platform-network-studio combobox, 15 index sliders, genre families, ratings, year range, owned/unowned, and eight sort modes including a weighted **Blend** sort with adjustable Tech / Dread / Mind sliders and four presets. |
| **GOAT Profile** | Declared personal canon (films, books, TV, games, directors, actors, composers, cinematographers, music, YouTube) plus curated recommendations per category. Recommendations are guaranteed never to suggest something already owned. |
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
- **Score breakdown** on each card explaining exactly how a match score was reached, with a provenance flag (verified vs. curated estimate).

---

## How to open and run it

This is a **static project with no build step**. There is nothing to install, compile, or serve.

1. Download or clone the repository.
2. Double-click `index.html`, or right-click → Open With → your browser.

That's it. It also works from a USB stick, an email attachment, or a phone's Downloads folder.

> **In Visual Studio:** use **File → Open → Folder**, *not* "Open Project/Solution". There is no startup project and no Run button for a static file — preview it by opening `index.html` in a browser.

### Requirements

- Any modern browser (Chrome, Edge, Firefox, Safari, mobile included).
- **An internet connection on first load** — see below.

---

## API keys

**None.** The project requires no API keys, tokens, accounts, or credentials of any kind. It makes zero `fetch`, `XMLHttpRequest`, or WebSocket calls. All 1,300 records are embedded in the file itself.

If you ever add an external API later, do **not** hardcode the key in `index.html` — anyone who opens the page or views source can read it. Client-side static pages cannot keep a secret.

---

## External dependencies (CDNs)

Two, both loaded from public CDNs at page load:

| Dependency | URL | Used for | If it fails to load |
| --- | --- | --- | --- |
| **Tailwind CSS** (Play CDN) | `https://cdn.tailwindcss.com` | All styling and layout | **The page renders unstyled.** This is the one hard dependency. |
| **Chart.js 4.4.1** | `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js` | The three canvas charts in the Visualization Suite | Degrades gracefully: the app retries for ~2s, then shows a clear message on the three charts. Every other tab, including the SVG relationship graph, keeps working. |

**Practical implication:** the file is "offline-first" for its *data*, but not fully offline for its *appearance*. With no network, the content and logic still work but the layout will look broken until Tailwind loads. See `NOTES.md` for how to make it truly offline.

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

The 1,300-work corpus and the contenders ledger are **not** in `localStorage` — they are hardcoded in `index.html` and are identical for everyone who opens the file. Ownership flags, declared canon, and taste weightings *are* personal and now live in `omniLedgerProfile`: a fresh browser with nothing saved there falls back to the defaults baked into this copy of the file (Payton's own profile), until you use the header's **Export**, **Import**, or **Reset** controls to take a copy elsewhere or start blank.

---

## Privacy notice

This file contains a real person's media collection and taste profile. Read the "Sensitive content" section of `NOTES.md` before making the repository public or sharing the file.
