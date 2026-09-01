# Notes

Working state, known limits, non-obvious decisions, and ideas. Read the first section before making the repo public.

---

## ⚠️ Sensitive content — read before publishing

### Credentials: clean

Audited the whole file with pattern scans for `api_key`, `apikey`, `secret`, `token`, `password`, `bearer`, `authorization`, `client_secret`, `private_key`, `BEGIN RSA`, `sk-…`, `ghp_`/`gho_`, and AWS `AKIA…` key format.

- **No API keys, tokens, credentials, or passwords of any kind.**
- **No email addresses.**
- **Zero `fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon` calls** — the page never talks to a server, so nothing can be exfiltrated and there is no key to leak.
- Every match for the word "secret" was a plot description of a film or novel (*The Secret History*, *Never Let Me Go*, etc.), not a credential.

### Personal data: present, and it is the whole point of the app

This is the part to think about. The file is not anonymous — the personal data is *baked into the source*, not entered at runtime. Anyone who opens `index.html`, views source, or browses the repo can read all of it:

| What's embedded | Where | What it reveals |
| --- | --- | --- |
| **Owned physical collection** — 179 items (83 film/TV entries + 34 book entries, expanding to 179 works once series volumes resolve) | `OWNED_MEDIA` and `OWNED_BOOKS_EXTRA` constants | Your actual home library: which films, discs, editions, and books you own, and in what format (4K, Blu-ray, Deluxe, Hardcover, Paperback) |
| **Declared personal canon** | `goatProfile.declared` | Your stated favourite films, books, TV, games, director, actors, composers, cinematographer, musician, and YouTuber |
| **Personal watchlist with ranked anticipation** | `watchRank` fields on 7 contenders | Seven upcoming films you're waiting for, in your own order of excitement |
| **Taste-engine weightings** | `GOAT_CREATOR_BOOST`, `GOAT_GENRE_BOOST`, `GOAT_VIBE_BOOST`, `BOOK_AFFINITY` | An explicit, quantified map of your preferences — arguably the most revealing part, since it's your taste written as numbers |
| **Upgrade audit** | derived at runtime from the above | Which items in your collection you consider worth spending money to upgrade |

There is no name, address, photo, employer, phone number, email, or financial detail anywhere in the file. What's exposed is **taste and property**: a detailed inventory of what media you own and what you love.

**Removed already:** a code comment referencing the source ledger by personal initials was genericised before packaging.

**Decide accordingly:**

- **Private repo** — nothing above is exposed. Recommended default.
- **Public repo** — treat the whole collection and taste profile as published. That may be completely fine (it's a media library, not a bank statement), but it should be a deliberate choice, not a surprise. A public repo also means the *inventory of what you own* is searchable, which some people prefer not to advertise.

If you want a shareable public version later, the clean approach is a fork with `OWNED_MEDIA`, `OWNED_BOOKS_EXTRA`, `goatProfile.declared`, and the `watchRank` flags emptied out — the engine works fine with an empty collection, it just stops personalising.

---

## Working state

### Fully working and verified

Everything currently in the app is functional. Verified by an automated suite of **70 assertions** run in a simulated DOM (jsdom), passing with zero console errors:

- All 10 tabs render and switch cleanly.
- Data integrity: 1,300 works (500/150/150/500), no duplicate IDs, no duplicate titles within a medium, all scores in valid 0–100 range, every work assigned at least one of 27 genre families.
- Ownership reconciles exactly against the source shelf ledger: **90/90 screen works and 69/69 books**, all flagged owned. Owned total is 179 because the app counts individual volumes of series owned as sets.
- 50 contenders, no duplicate IDs or titles, no missing fields, watchlist ranks 1–7 present and leading the For-You ordering.
- No recommendation anywhere suggests a work already owned (checked for GOAT recs and Collection Intelligence gaps).
- All nine themes apply; all filters, sorts, toggles, comboboxes, and the blend engine behave.
- Card interaction: description and stats panels toggle independently, description always above stats.
- Graceful degradation when Chart.js is unavailable.

### Known limitations (nothing is broken, but be aware)

1. **Visual verification is untested.** The test suite runs in jsdom, which simulates the DOM but **does not lay out or render pixels**. Logic and structure are well covered; anything visual — spacing, overlap, theme appearance, emoji rendering — is reasoned about but not machine-verified. Historically this gap has mattered: a text-overlap bug and a modal that wouldn't close both passed automated tests while failing on a real phone. **Spot-check visual changes yourself on desktop and mobile.**

2. **Tailwind CDN is a single point of failure.** If `cdn.tailwindcss.com` is unreachable, the app renders unstyled. Chart.js failing is handled gracefully; Tailwind failing is not. The Play CDN also compiles CSS in the browser on every load, which is explicitly not intended for production.

3. **About half the data is curated estimate, not sourced measurement.** The app is honest about this per-card via a provenance flag: **658 verified / 642 estimated**. Scores like `atmosphericDreadIndex` and `ontologicalComplexity` are editorial judgements, not measured values. Recommendations are taste-aligned, not empirically grounded.

4. **The Contenders Ledger has a shelf life.** Release windows drift constantly. Two entries currently carry windows at or near the present date. This tab needs periodic manual review in a way the rest of the app does not. Contender data was web-verified at time of writing.

5. **The Dollars trilogy appears four times in the owned collection** — the box-set entry plus all three films — because the source ledger treats it as one object while the app tracks films individually. Intentional, but it reads as duplication in the collection view.

6. **One book's metrics are invented.** *The Beginning of Infinity* was added to complete the shelf reconciliation; its scores are editorial judgement.

7. **Ancient works use negative years.** Homer's *Odyssey* is `year: -700`. The timeline handles this (pre-1900 bucket, "700 BC" span label), but any new date logic must not assume `year > 0`.

---

## Non-obvious decisions

**Kept as a single file.** The obvious refactor is splitting the 1,300-record dataset and the app logic into `/data` and `/assets`. Deliberately not done:
- The single-file property is *used* — the file gets downloaded and opened directly on a phone, from Downloads, with no server.
- Classic `<script src>` splits would work over `file://`, but ES modules would **not** (CORS blocks module loading from `file://`), which is a trap for later.
- Splitting a verified-working 900 KB file carries real regression risk for an aesthetic gain.

If it later becomes unwieldy to edit, split `data` (the four corpus arrays) into a separate classic script first, and leave the engine in `index.html`.

**No framework, no build.** Vanilla ES6 plus two CDNs. Keeps the artifact portable and permanent — it will still open in ten years.

**A command palette was built and deliberately removed.** A ⌘K/Ctrl+K quick-jump overlay was implemented, tested, and worked in jsdom, but on a real phone the close button repeatedly failed to dismiss it. After three fix attempts it was removed entirely rather than shipped broken. The Omni-Search in the Global Controller covers the same need better. All traces were stripped — don't be surprised by the absence.

**The personal watchlist deliberately overrides the model.** In `anticipationScore()`, any contender with a `watchRank` gets a score floor of `99 - (rank-1) * 1.5`, which puts the seven watchlist films above every modelled score. This is intentional: a stated preference is better evidence than an inferred one. The reason line shows "#N on your personal watchlist" so the override is visible rather than hidden.

**In-card grids use container-aware sizing, not viewport breakpoints.** Card-internal stat grids use `repeat(auto-fit, minmax(…))` rather than Tailwind's `sm:`/`md:` classes. Tailwind breakpoints measure the *viewport*, so on a wide screen they forced two columns inside narrow 3-up cards and the labels collided with the values. Don't reintroduce `sm:grid-cols-2` inside a card.

**Emoji are written as literal characters, never `\U…` escapes.** JavaScript has no `\U` (capital-U) escape; `'\U0001F3AD'` silently renders as the literal text `U0001F3AD`. This bug shipped once. Paste the actual emoji character.

**Ownership lives in lookup constants, not on the records.** `OWNED_MEDIA` maps screen IDs to physical format; books are owned if their numeric ID is ≤ 51 or they appear in `OWNED_BOOKS_EXTRA`. Adding a work does not make it owned — you must add it to the relevant constant.

---

## Ideas / next steps

Roughly in order of value:

1. **Make it genuinely offline.** Replace the Tailwind Play CDN with a compiled stylesheet committed to the repo. Removes the single point of failure and the per-load compile cost. Biggest robustness win available.
2. **A "tonight" picker.** Mood + time available → one specific pick that fits the runtime budget. Runtime is displayed everywhere but never acted upon. Low effort, high use.
3. **Refresh the contenders ledger** on a schedule — windows drift, and two entries are already at the current date.
4. **Cross-medium pairings.** The rabbit-hole engine already computes cross-medium links; surfacing them as deliberate "watch this, then read this" double-features fits the taste model well.
5. **Split the dataset out of `index.html`** if editing becomes painful — see the decision note above for how.
6. **Raise data provenance.** Replace estimated scores with sourced ones where possible; the provenance flag already tracks which are which.
7. **Export/import of `localStorage`.** A JSON download/upload would let the watchlist move between devices, which it currently cannot.

---

## Testing

There is no test file in the repo — the suite was run externally against the built file using Node and jsdom. If you want it in-repo, the approach was:

- Load `index.html` in jsdom with `runScripts: 'dangerously'`.
- Stub `Chart`, `requestAnimationFrame`, and `URL.createObjectURL`.
- Filter expected console noise (`tailwind`, `scrollIntoView`, `canvas`, `getContext`).
- Assert on data integrity, tab rendering, filter behaviour, and DOM state after simulated clicks.

Worth adding as `test/smoke.js` with a `package.json` dev-dependency on `jsdom` if this grows.
