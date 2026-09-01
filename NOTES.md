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
| **Owned physical collection** — 179 items (83 film/TV entries + 34 book entries, expanding to 179 works once series volumes resolve) | `PERSONAL_PROFILE.ownedMedia`, `.ownedBooksExtra`, `.ownedBookIdCeiling`, `.ownedGameIds` | Your actual home library: which films, discs, editions, and books you own, and in what format (4K, Blu-ray, Deluxe, Hardcover, Paperback) |
| **Declared personal canon** | `PERSONAL_PROFILE.declaredCanon`, `.declaredGoatIds` | Your stated favourite films, books, TV, games, director, actors, composers, cinematographer, musician, and YouTuber |
| **Personal watchlist with ranked anticipation** | `PERSONAL_PROFILE.watchlist` | Seven upcoming films you're waiting for, in your own order of excitement |
| **Taste-engine weightings** | `PERSONAL_PROFILE.creatorBoost`, `.genreBoost`, `.vibeBoost`, `.bookAffinity` | An explicit, quantified map of your preferences — arguably the most revealing part, since it's your taste written as numbers |
| **Upgrade audit** | derived at runtime from the above | Which items in your collection you consider worth spending money to upgrade |

There is no name, address, photo, employer, phone number, email, or financial detail anywhere in the file. What's exposed is **taste and property**: a detailed inventory of what media you own and what you love.

**As of Phase 2, this same data is also exportable.** The header's Export button downloads the live `PERSONAL_PROFILE` object — everything in the table above — as `omni-ledger-profile.json`. That file deserves the same care as the source: don't post it somewhere public without thinking about it first, for the same reasons the table above exists.

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

**Personal data is gathered onto one `PERSONAL_PROFILE` object.** All of one person's inputs — owned collection (`ownedMedia`, `ownedBooksExtra`, `ownedBookIdCeiling`, `ownedGameIds`), declared canon (`declaredCanon`, `declaredGoatIds`), contender watchlist order (`watchlist`), and every taste-weighting the scoring engine reads (`creatorBoost`, `bookCreatorBoost`, `genreBoost`, `vibeBoost`, `silverTierIds`, `bookAffinity`, `cosmicHorrorDeclaredIds`, `cosmicHorrorCanon`) — is assigned onto `PERSONAL_PROFILE` right where the engine already needed it, immediately after `/*DATA-END*/`. The original constant names (`OWNED_MEDIA`, `GOAT_CREATOR_BOOST`, etc.) still exist as `const X = PERSONAL_PROFILE.x` aliases, so almost none of the scoring/render code that reads them had to change.

While wiring up blank-profile testing, one more leak turned up and was fixed: 43 movie records in the 1,300-work corpus carried `"owned":true,"physFormat":"..."` directly on the record (redundant with `OWNED_MEDIA` for 42 of them; the 43rd, `m120`, had no `OWNED_MEDIA` entry at all and was owned *only* via that inline field), and one video game's ownership was a bare `g.id==='g45'` check in the adapter. Both are now profile-driven (`ownedMedia` covers `m120` too; `ownedGameIds` replaces the `g45` literal) — so ownership is never baked into a work record or into adapter logic, only ever looked up from `PERSONAL_PROFILE`. Verified: a fully blank profile now shows exactly 0 owned works, where before this fix it still showed 44.

**`PERSONAL_PROFILE` now loads from `localStorage` first, falling back to Payton's hardcoded defaults only when nothing has been saved yet.** On first load in any browser (nothing in `localStorage.omniLedgerProfile`), `PROFILE_FROM_STORAGE` is `false` and every `if(!PROFILE_FROM_STORAGE) PERSONAL_PROFILE.x = {...defaults}` line fires — this reproduces the exact original behavior for Payton's own browser. The moment *anything* has been saved under that key (even `{}`), `PROFILE_FROM_STORAGE` is `true`, none of the defaults re-apply, and any field the saved profile doesn't set is simply empty. That's what makes "start blank" actually blank rather than silently falling back to Payton's canon.

Three controls next to the theme selector in the header drive this:
- **Export** downloads the live `PERSONAL_PROFILE` object as `omni-ledger-profile.json` — the entire personal layer in one file, hand-editable.
- **Import** loads a JSON file, writes it to `localStorage`, and reloads. This is the "simple form/import UI" seeding path from the plan (`Phase 2` decision: import a file rather than a guided in-app rating flow, which is a bigger feature left for later).
- **Reset** writes `{}` to `localStorage` and reloads — a genuinely blank profile, confirmed by the fix above.

Storage decision made: **browser `localStorage`**, matching the watchlist/theme/density keys already there. It doesn't sync across devices (same limitation already documented for the watchlist), but it's zero-infrastructure and consistent with the file's "no backend" design goal — a friend can Export their filled-in profile to move it between browsers/devices by hand.

**Not folded into `PERSONAL_PROFILE`: `goatProfile.recs`.** The curated recommendation write-ups (the multi-paragraph "why" text under GOAT Profile) are hand-authored prose keyed to Payton's specific declared canon — they don't regenerate from a data value the way the scoring weights do. Making them personalize automatically is recommendation-engine work (Phase 4), not a data-layer move, so they were deliberately left where they are rather than being relocated without being made swappable. A friend importing a blank/custom profile today will still see Payton's recommendation text under GOAT Profile until that phase happens.

---

## Phase 3 — distribution: onboarding gate, and how to actually hand this to someone

**A first-run gate now asks, instead of assuming.** Any browser where `localStorage.omniLedgerOnboarded` has never been set gets a blocking modal on load — "Use the built-in sample profile" / "Start blank" / "Import a profile file" — before it can touch the app. This closes the gap Phase 2 flagged: previously a brand-new browser (Payton's own new device, or a friend's) silently inherited Payton's hardcoded defaults with no indication that had happened. Now:
- **Sample** just sets the onboarded flag and dismisses the modal — the already-computed default profile (Payton's) stays as-is, no reload needed.
- **Blank** and **Import** write to `omniLedgerProfile` (and the onboarded flag) and reload, same pattern as the header's Reset/Import controls.
- Once onboarded, the gate never reappears in that browser, regardless of what's later done via Export/Import/Reset.

Verified in jsdom: a fresh profile shows the gate; clicking Sample hides it without touching `omniLedgerProfile`; clicking Blank writes `{}` and reloads; a browser with the onboarded flag already set never shows the gate. The full default-path smoke check (1,300 works, 179 owned, 12 declared, 7-item watchlist) is unchanged with the gate in place.

**Distribution mechanism: hand over the file, not a hosted link.** Weighed against the plan's three options:
- *Downloadable file* (chosen): give someone this repo's `index.html` directly — email, shared drive, USB, whatever. They open it, the onboarding gate greets them, they pick blank or import a profile someone sent them. Zero hosting, zero ongoing cost or maintenance for Payton, and it matches every other design decision already made here (single file, no build, no framework, "still opens in ten years" per the decision log above). This is the one that needs nothing further built — it works today.
- *Static personal-artifact link* (viable, but secondary): publishing the same file to a URL (e.g. a Claude Artifact, or any static host) works too — each visitor's browser gets its own isolated `localStorage`, so one shared link serves many people without their data mixing. The tradeoff is that it depends on whoever hosts that URL keeping it up; it's a fine quick-preview or convenience channel, but the *file itself* — not a link to it — should be treated as the durable, portable copy of this app.
- *Lightweight shared hosting with per-user save* (deferred): not pursued. It would add a real backend/persistence layer for a use case (a few friends, personal copies) that doesn't need one — direct contradiction of the "personal copies via link, not shared multi-tenant backend" direction chosen at the start of this plan.

---

## Phase 4 — recommendation engine: what's now generic, and what still isn't

**Current scoring approach, documented.** Every work's `gm` ("GOAT match") score is `base*0.5 + boosts*1.2 + 14`, clamped to 40–99, where `base = 0.5·critical + 0.2·audience + 0.3·technical` and `boosts` accumulates from `PERSONAL_PROFILE`: `creatorBoost`/`bookCreatorBoost` (creator/author name match), `genreBoost` (genre keyword match), `vibeBoost` (context-tag match), plus three fixed non-personal bonuses for high ontological complexity, high technical craft, and moderate-high atmospheric dread. On top of that: declared items (`declaredGoatIds`) are pinned to `gm=100`; silver-tier items (`silverTierIds`) get pulled toward a 88-anchored floor; owned items get pulled toward an 82-anchored floor; declared books (`bookAffinity`) get a direct floor per id. Every boost is recorded on `x.gmBoosts` as `[type, matchedValue, weight]` — this reasons array already existed for the score-breakdown UI on each card, and turned out to be exactly the substrate needed to generalize recommendations (see below).

**Gap found and fixed:** the four corpus-backed categories under GOAT Profile → Recommendations (Movies, Books, TV Series, Video Games) were a fixed hand-picked list of titles with hand-written "why" prose, entirely disconnected from `gm` — a friend loading a different declared canon would still see Payton's picks and Payton's reasoning, unchanged. There was also a legacy mechanism that nudged specific titles' `gm` *up* to match that fixed list's displayed score, which would have kept leaking Payton-specific bumps into the general engine even after everything else was generalized.

**What changed:** those four categories are now generated live, every load, from `ALL` sorted by `gm` (excluding owned and already-declared works), with "why" text built mechanically from each item's top two `gmBoosts` entries (e.g. *"Shares creator Denis Villeneuve with your declared canon and matches your weighted 'sci-fi' genre."*). The category's basis line names whatever the loaded profile declared for that category, or says plainly that nothing's declared yet and ranking fell back to overall match. The legacy gm-nudge mechanism was deleted outright — it's not needed once recommendations are generated *from* `gm` rather than the reverse, and removing it also un-fudges `gm` itself back to each title's honest computed score (verified: Payton's own top pick per category is unchanged, since the generated ranking reproduces the same order the old hack was designed to force by hand).

Verified in jsdom: default profile still puts *Dune: Part Two* on top of Movies at the same score as before, with real (not fixed) reasoning text; a blank profile falls back to craft/reception-driven picks with honest "no declared X yet" framing and zero references to Payton's canon; no owned or declared item ever appears in the generated lists, matching the app's existing invariant.

**What's still not generic, and why.** The other six categories (Directors, Actors, Composers, Cinematographers, Music Artists, YouTube) are unchanged — still Payton's original hand-written picks, now labeled `sample:true` and shown with a "◈ sample data, not personalized" badge in the UI so nobody mistakes them for computed. The reason is structural, not effort: `movies`/`tvShows`/`videoGames`/`books` are corpus arrays with genre tags, creators, and scores to rank against — a *director* is just a string that appears in some works' `creator` field, with no independent record of their own style, genre range, or era to compute a similarity against. Generalizing these six would mean building an actual creator/composer/cinematographer/artist dataset (something like the existing 80-entry Creator Archives, but with the taxonomy `gm` scoring needs) — a real modeling project, not a data-layer or engine change. That's the next thing to scope if this matters enough to pursue.

**Taste drift (declared canon changes over time):** already handled, as a side effect of the engine being fully re-derived from `PERSONAL_PROFILE` on every load rather than cached — add a title to `declaredGoatIds`, adjust a `creatorBoost` weight, or re-Export/re-Import a changed profile, and every score, ranking, and now every generated recommendation recomputes from scratch next load. There's no stale cache to invalidate.

---

## Ideas / next steps

Roughly in order of value:

1. **Make it genuinely offline.** Replace the Tailwind Play CDN with a compiled stylesheet committed to the repo. Removes the single point of failure and the per-load compile cost. Biggest robustness win available.
2. **A "tonight" picker.** Mood + time available → one specific pick that fits the runtime budget. Runtime is displayed everywhere but never acted upon. Low effort, high use.
3. **Refresh the contenders ledger** on a schedule — windows drift, and two entries are already at the current date.
4. **Cross-medium pairings.** The rabbit-hole engine already computes cross-medium links; surfacing them as deliberate "watch this, then read this" double-features fits the taste model well.
5. **Split the dataset out of `index.html`** if editing becomes painful — see the decision note above for how.
6. **Raise data provenance.** Replace estimated scores with sourced ones where possible; the provenance flag already tracks which are which.
7. ~~**Export/import of `localStorage`.**~~ Done for the personal profile (owned collection, canon, taste weights, watchlist order) via the header's Export/Import/Reset controls — see the `PERSONAL_PROFILE` section above. The separate `omniLedgerWatchlist`/`omniLedgerTheme`/`omniLedgerDensity` keys aren't included in that export yet, so watched/unwatched status and UI preferences still don't move between devices.
8. ~~**A real "blank first run" for a friend's copy.**~~ Done — see Phase 3 above. First load in any browser now asks (sample / blank / import) via a blocking gate rather than silently inheriting Payton's defaults.
9. ~~**Genericize `goatProfile.recs`.**~~ Done for the four corpus-backed categories (Movies, Books, TV Series, Video Games) — see Phase 4 above. Directors/Actors/Composers/Cinematographers/Music Artists/YouTube remain sample data pending a creator-level dataset (next item).
10. **Build a creator/composer/cinematographer/artist dataset.** The blocker on genericizing the last six recommendation categories — there's no structured record of a director's or composer's own style/genre range to rank against, only their name inside works' `creator` fields. Something in the shape of the existing 80-entry Creator Archives, extended with the tags `gm`-style scoring needs, would unblock this.
11. **Bundle the watchlist/theme/density keys into Export/Import too.** Right now Export/Import/Reset only covers `omniLedgerProfile`; `omniLedgerWatchlist`, `omniLedgerTheme`, and `omniLedgerDensity` are separate keys that don't travel with a profile file. Folding them in would make a single exported file a complete "this is me" snapshot.

---

## Testing

There is no test file in the repo — the suite was run externally against the built file using Node and jsdom. If you want it in-repo, the approach was:

- Load `index.html` in jsdom with `runScripts: 'dangerously'`.
- Stub `Chart`, `requestAnimationFrame`, and `URL.createObjectURL`.
- Filter expected console noise (`tailwind`, `scrollIntoView`, `canvas`, `getContext`).
- Assert on data integrity, tab rendering, filter behaviour, and DOM state after simulated clicks.

Worth adding as `test/smoke.js` with a `package.json` dev-dependency on `jsdom` if this grows.
