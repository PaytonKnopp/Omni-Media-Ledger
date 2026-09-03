# Omni-Media Ledger

A personal movie/TV/game/book tracker that actually knows your taste. You tell it what you love (a few clicks, no spreadsheets), and it scores and ranks a library of **2,508 real works** — 1,000 films, 250 TV series, 258 video games, 1,000 books — based on how well each one matches you specifically. It also tracks what you physically own, keeps a watchlist, and has a bunch of "explore and discover" views for when you don't know what you want yet.

There's nothing to install. It's just a folder — one HTML file plus a `data` folder next to it — that you open in a browser like any web page. No account is required to use it, though you can optionally add one (see [Cloud accounts](#cloud-accounts-follow-you-between-devices) below) so your taste follows you between your phone, laptop, etc.

**Try it, don't just read about it:** open the file (or the hosted link, if you have one) and pick **Look around the PK Sample** on the first screen. That's Payton's (PK) own real, filled-in taste profile, clearly labeled as an example — not something you're editing. Look around, then Export it and Import it back as your own copy any time you want to actually build on it, or just start fresh instead.

---

## The short version

1. Open the app. Pick how you want to start — a quick sample, blank, search-and-pick your favorites, or import a file.
2. Browse the collection. Every card shows a match score for you and can be expanded for full detail.
3. Click things to teach it your taste: 🥇 Gold / 🥈 Silver / 🥉 Bronze favorite, "mark owned," boost (or bury) a genre or a creator. No JSON, no settings screen — it's all buttons on the cards themselves.
4. The more you click, the better its recommendations get.

That's genuinely most of it. Everything past this point is detail for people who want it.

---

## What you can actually do in it

| Where | What it's for |
| --- | --- |
| **Global Controller** (the home screen) | Search and browse everything. Filter by type, genre, ownership, favorite tier, platform/studio/network, and 15 more specific tastes (scariest, funniest, best soundtrack, etc.). Sort by match score, critical/audience score, year, or a custom weighted blend you control with three sliders. |
| **GOAT Profile** | Your declared all-time favorites, and where you build them — search the whole library right there and tier or mark things owned. Also shows computer-generated recommendations based on what you've already told it you love. |
| **Taste Portrait** | A snapshot of what your collection says about you — genre breakdown, ownership stats, a clickable map of 27 genre families. |
| **Collection** | Your actual physical/digital library, organized by format, plus a "worth upgrading?" audit and gap-finder ("you love this director, here's what you don't own yet"). |
| **Watchlist** | Things you've flagged to check out later. |
| **Contenders Ledger** | 50 upcoming releases being tracked, each with a general hype score and a personal "for you" score. |
| **Creator Archives** | 80 notable directors, authors, and game designers, searchable. |
| **Reference Matrices** | 19 curated top-lists — best soundtracks, scariest, funniest, biggest twists, and more. |
| **Visualization Suite** | Charts and an interactive relationship map showing how works connect to each other and why. |
| **Timeline** | Everything placed on a single timeline, 700 BC to 2027. |

A few other things worth knowing about:

- **🎲 Surprise Me** — one weighted pick, scoped by medium, mood, ownership, and (for films) how much time you have.
- **💡 Suggest a feature** — a shared box (visible to everyone using the app, not just you) for writing down "it'd be great if…" ideas.
- **Themes** — nine visual looks, pick one from the header.
- **Rabbit Hole** — a guided chain of related works to fall down, one click at a time.
- **Compare** — load someone else's exported profile to see what taste you share and where you differ. Nothing is saved, it's just a look.
- **"Why this was recommended"** — every match score comes with a plain-English reason, not just a number.

---

## Favorites: Gold, Silver, Bronze

Instead of one flat "favorite" flag, there are three tiers, right on every result:

- 🥇 **Gold** — your actual all-time favorites. Pins the match score at 100 and drives recommendations the most.
- 🥈 **Silver** — a strong favorite, one notch down.
- 🥉 **Bronze** — you really like it, lighter pull than Silver.

Recommendations lean on Gold first, then Silver, then Bronze, then the rest of what you own — so the more precisely you tier things, the sharper the suggestions get. You can filter or sort by tier too, and tiered cards get a little medal badge so they're easy to spot while browsing.

---

## Making it yours (no file-editing required)

Every card has a compact row of icons — Gold/Silver/Bronze/Owned — right under it, and expanding a card gives you more: boost a genre, a `−`/`+` stepper to boost *or bury* a specific creator across your whole match scoring, boost a book's affinity directly. Everything you click updates your recommendations immediately.

If you'd rather build or edit a whole profile at once by hand, `PROFILE_TEMPLATE.md` documents the file format field-by-field with an example — useful for bulk edits, but nobody needs it for day-to-day use.

**Export / Import / Reset**, in the header, let you save your whole setup (taste profile, watchlist, theme, layout preferences) to a file, load it somewhere else, or start over.

---

## Cloud accounts (follow you between devices)

By default, everything lives only in the browser you're using — switch devices and you start fresh. Turning on **cloud accounts** (a one-time, optional setup by whoever's hosting the app — see `NOTES.md` → "Cloud accounts" for the technical how-to) changes that: anyone opening the link types a name once, and from then on their taste, collection, and preferences follow that name to any device. Nobody's data affects anybody else's — it's each person's own private, isolated account.

Once that's on, the header's **Account** menu (top right) shows who's currently signed in and lets you switch to a different name at any time.

If cloud accounts aren't set up, the app still works exactly the same — your data just stays local to that one browser, and Export/Import become the way to move it around manually.

---

## Getting it running

There's no build step, no server, nothing to compile.

1. Download the repository (or unzip it, if you got it as a zip), **keeping the folder structure intact** — `index.html` needs the `data/` folder next to it.
2. Open `index.html` — double-click it, or drag it into a browser tab.

Done. Works the same from a USB stick, an email attachment, or a phone's Downloads folder — as long as the whole folder travels together.

```
index.html       The whole app
data/            The 2,508-work library, split into 4 files by type
scripts/         A data-integrity checker (for anyone editing the library)
test/            An automated regression test suite
```

> **Using Visual Studio?** Use **File → Open → Folder** (not "Open Project"). There's no Run button to look for — just open `index.html` in a browser.

---

## Privacy — read this before making a copy public

**This particular copy of the app has one real person's actual media collection and taste baked into it as example data.** That's intentional and the person it belongs to is fine with it being public — it's meant as a working demo, not a template to publish blind. If you're setting up your *own* copy: your data goes into your own cloud account (or your own browser's local storage) once you start using it, not into the source file — so a fresh copy of this repo, before anyone signs in, contains only the original example profile, nothing of yours.

There's no name, email, address, or financial information anywhere in the app or its data — what's potentially personal is taste and property (what someone owns and loves), not identity. See `NOTES.md` for the full audit if you want the details.

**API keys:** none are required to run the app at all. If you turn on cloud accounts, one config value (a Firebase project identifier — not a secret credential) goes in the file; `NOTES.md` explains exactly what it is and isn't.

---

## For anyone curious about the technical details

- **No API keys needed**, ever, for the app to work. It makes zero network requests by default.
- **One external dependency**: Chart.js (loaded from a public CDN), used only for 3 charts in the Visualization Suite. If it can't load, those 3 charts show a friendly message — everything else, including the interactive relationship map, keeps working.
- **Fully offline-capable**: no internet connection needed for anything except those 3 charts.
- **Data storage**: without cloud accounts, everything is saved in the browser's own `localStorage` — per browser, per device. It's not backed up by this repository; committing code doesn't save anyone's personal data.
- **Automated tests**: `scripts/validate-corpus.js` checks the library data for problems (duplicates, missing fields) with no dependencies. `test/smoke.js` is a full Playwright browser-automation suite covering onboarding, every screen, filters, and the cloud-account flow (against a mocked cloud, so no real account needed to run it). Both are optional for using the app, but useful if you're changing code:

  ```
  npm install -D playwright-core
  npx playwright install chromium   # once
  npm test
  ```

Further engineering detail — every design decision, bug found and fixed, and the reasoning behind each — lives in `NOTES.md`, written as a running project log rather than a reference doc.
