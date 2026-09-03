# Notes

Working state, known limits, non-obvious decisions, and ideas. Read the first section before making the repo public.

---

## ⚠️ Sensitive content — read before publishing

### Credentials: clean by default, one exception if you turn cloud accounts on

Audited the whole file with pattern scans for `api_key`, `apikey`, `secret`, `token`, `password`, `bearer`, `authorization`, `client_secret`, `private_key`, `BEGIN RSA`, `sk-…`, `ghp_`/`gho_`, and AWS `AKIA…` key format.

- **No email addresses, passwords, or server-side secrets of any kind.**
- Every match for the word "secret" was a plot description of a film or novel (*The Secret History*, *Never Let Me Go*, etc.), not a credential.
- As shipped (`FIREBASE_CONFIG` left at its placeholder values), the page makes **zero network calls** — it never talks to a server, so nothing can be exfiltrated.
- **If you fill in `FIREBASE_CONFIG`** (see "Cloud accounts" below), the file then contains your Firebase **project's client API key**. This is not a secret the way a server API key is — Firebase's own docs are explicit that this key is meant to ship in client bundles and identifies your project, not a user; it authorizes nothing on its own without matching Firestore security rules. Still, don't commit it to a *public* repo without knowing what you're doing: the real access control lives in the Firestore rules (see below), not in hiding the key. If this repo is or becomes public, either keep `FIREBASE_CONFIG` local (gitignored) and paste it in only on your own machine, or accept that the key is visible and lean entirely on the security rules to keep the data honest.

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

**Superseded by Phase 11's account system.** `share.html` — a generated blank-defaults copy, safe to publish separately from Payton's own `index.html` — is retired (see "One file, not two" in Phase 11 below): cloud accounts make a second file unnecessary, since anyone opening `index.html` and picking their own name gets an account fully isolated from Payton's data. That does mean `index.html` — the one file now, hosted on public GitHub Pages — carries Payton's hardcoded collection/taste defaults in its public source, readable by anyone who views source, not just people sent the link. **This is a deliberate, informed choice, not an oversight:** raised explicitly when `share.html` was retired, and the call was to leave it — Payton's own data is treated as a fine public example (media library, not sensitive), not something that needs hiding. If that ever changes, the fix is straightforward: blank `PERSONAL_PROFILE`'s hardcoded defaults in the public file (the same transformation `share.html` used to do) once cloud accounts hold Payton's real data privately instead.

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

2. ~~**Tailwind CDN is a single point of failure.**~~ Fixed — see "Made genuinely offline" below. Tailwind is now a compiled stylesheet committed to `index.html`, not a runtime CDN dependency. Chart.js's CDN is still a soft dependency, but it already degrades gracefully by design.

3. **About half the data is curated estimate, not sourced measurement.** The app is honest about this per-card via a provenance flag: **658 verified / 642 estimated**. Scores like `atmosphericDreadIndex` and `ontologicalComplexity` are editorial judgements, not measured values. Recommendations are taste-aligned, not empirically grounded.

4. **The Contenders Ledger has a shelf life.** Release windows drift constantly. Two entries currently carry windows at or near the present date. This tab needs periodic manual review in a way the rest of the app does not. Contender data was web-verified at time of writing.

5. **The Dollars trilogy appears four times in the owned collection** — the box-set entry plus all three films — because the source ledger treats it as one object while the app tracks films individually. Intentional, but it reads as duplication in the collection view.

6. **One book's metrics are invented.** *The Beginning of Infinity* was added to complete the shelf reconciliation; its scores are editorial judgement.

7. **Ancient works use negative years.** Homer's *Odyssey* is `year: -700`. The timeline handles this (pre-1900 bucket, "700 BC" span label), but any new date logic must not assume `year > 0`.

---

## Non-obvious decisions

**The corpus dataset was split out in Phase 8** (superseding this section's original "kept as a single file" decision, once editing a 1.5MB+ file per corpus edit actually became painful at 2,502 records). `data/movies.js`, `data/tv.js`, `data/games.js`, `data/books.js` each hold one `const <name>=[...]` array, loaded via plain classic `<script src>` tags — deliberately **not** `fetch()` and **not** ES modules, since both are blocked by CORS under `file://` (the exact trap this section originally warned about). Classic script tags aren't subject to that restriction, so the file-double-click-to-open workflow is unchanged; only the "it's literally one file" property is gone — the app is now a folder (`index.html`/`share.html` + `data/`), and the folder has to travel together. The engine, UI, `PERSONAL_PROFILE`, contenders ledger, and Creator Archives all stayed in `index.html`/`share.html` — only the four media-type arrays moved, since those were the actual editing pain point and the actual size (both HTML files dropped from ~1.58MB to ~330KB apiece once their private copy of the corpus was removed). A pleasant side effect: `index.html` and `share.html` now reference the *same* `data/*.js` files, so a corpus edit shows up in both immediately with no `make-share-copy.js` regeneration needed — only changes to the engine/UI/personal-defaults still require that step. `scripts/validate-corpus.js` (Phase 7) was updated to read the new file locations and also asserts both HTML files reference all four data files and carry no leftover inline copy, so this split can't silently regress.

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

**Distribution mechanism: hand over a file, not a hosted link.** Weighed against the plan's three options:
- *Downloadable file* (chosen): give someone a copy of the app directly — email, shared drive, USB, whatever. They open it, the onboarding gate greets them, they pick blank or import a profile someone sent them. Zero hosting, zero ongoing cost or maintenance for Payton, and it matches every other design decision already made here (single file, no build, no framework, "still opens in ten years" per the decision log above). This is the one that needs nothing further built — it works today.
- *Static personal-artifact link* (viable, but secondary): publishing the same file to a URL (e.g. a Claude Artifact, or any static host) works too — each visitor's browser gets its own isolated `localStorage`, so one shared link serves many people without their data mixing. The tradeoff is that it depends on whoever hosts that URL keeping it up; it's a fine quick-preview or convenience channel, but the *file itself* — not a link to it — should be treated as the durable, portable copy of this app.
- *Lightweight shared hosting with per-user save* (deferred): not pursued. It would add a real backend/persistence layer for a use case (a few friends, personal copies) that doesn't need one — direct contradiction of the "personal copies via link, not shared multi-tenant backend" direction chosen at the start of this plan.

**Which file to hand over, though, needed a second look.** Handing out `index.html` literally means handing out Payton's own data — it's baked into the file as the onboarding gate's "sample profile" option, but it's still sitting in the file's source whether or not a recipient clicks that option (same caveat the privacy section above already makes about a public repo). That's fine for someone you're comfortable seeing your collection and taste weights; it's not really a *blank template* to hand out generally. See "Two distributable files" below for the fix.

---

## Two distributable files: `index.html` and `share.html`

**Superseded by Phase 11** — cloud accounts made a second file unnecessary; `share.html` is retired. Kept below as a historical record of the reasoning at the time, not current guidance — see "One file, not two" in Phase 11.

There are now two copies of the app in the repo, generated from one source of truth:

- **`index.html`** — Payton's personal copy. Every `PERSONAL_PROFILE` default (owned collection, declared canon, taste weights, watchlist) is filled in with Payton's real data, exactly as before. This is the file to actually develop against.
- **`share.html`** — a byte-for-byte identical engine and 1,300-work corpus, generated *from* `index.html` by `scripts/make-share-copy.js`, with every one of those defaults emptied out (`{}`/`[]`/`0`) and `goatProfile.declared` cleared. This is the one to actually hand to someone else — nothing of Payton's personal data (owned collection, taste weights, declared canon) is sitting in its source, unlike handing out `index.html` directly.

**What the script does, mechanically:** it regex-matches every `if(!PROFILE_FROM_STORAGE)PERSONAL_PROFILE.<field>=<value>;` line (14 of them today) and replaces `<value>` with the empty equivalent of its own type — no hardcoded field list to maintain, so it keeps working as fields are added or renamed. It also blanks `goatProfile.declared` (anchored specifically to `const goatProfile={\n declared:[...`, not a bare `declared:[` match, because that exact phrase also appears earlier as an unrelated object key inside the score-badge rendering code — the first version of this script matched *that* occurrence instead and silently deleted ~470 lines of unrelated code between the two, which is exactly the kind of bug a naive regex invites in a 900KB single-line-heavy file. Worth remembering if this script ever needs touching again: anchor on more context than feels necessary, and always diff line counts, not just "did it throw," after regenerating.

**What it deliberately leaves alone:** `goatProfile.recs`'s six sample-only categories (Directors, Actors, Composers, Cinematographers, Music Artists, YouTube) stay as Payton's hand-written picks in `share.html` too, same as they do in `index.html` — they're already labeled "◈ sample data, not personalized" in the UI (see Phase 4), so leaving them gives a new person something to look at before they've declared anything, without misrepresenting it as computed for them.

**The onboarding gate differs slightly between the two files** — `share.html`'s gate drops the "Use the built-in sample profile" button entirely (there's nothing to sample), leaving just Start Blank and Import. `index.html` keeps all three, since a browser that's never touched it (a new device of Payton's, say) can reasonably want the real defaults.

**Keeping both current:** develop only against `index.html`. Whenever it changes — new works, engine tweaks, new features, updated taste weights — run `node scripts/make-share-copy.js` to regenerate `share.html`. That's the entire workflow; there's no manual dual-editing, and it takes under a second. Verified: `share.html` shows 0 owned works, 0 declared favorites, honest craft-driven fallback recommendations (no references to Payton's canon), and the sample categories intact — checked in both jsdom and a real headless Chromium screenshot, with `index.html` byte-for-byte unmodified by running the script.

---

## Phase 4 — recommendation engine: what's now generic, and what still isn't

**Current scoring approach, documented.** Every work's `gm` ("GOAT match") score is `base*0.5 + boosts*1.2 + 14`, clamped to 40–99, where `base = 0.5·critical + 0.2·audience + 0.3·technical` and `boosts` accumulates from `PERSONAL_PROFILE`: `creatorBoost`/`bookCreatorBoost` (creator/author name match), `genreBoost` (genre keyword match), `vibeBoost` (context-tag match), plus three fixed non-personal bonuses for high ontological complexity, high technical craft, and moderate-high atmospheric dread. On top of that: declared items (`declaredGoatIds`) are pinned to `gm=100`; silver-tier items (`silverTierIds`) get pulled toward a 88-anchored floor; owned items get pulled toward an 82-anchored floor; declared books (`bookAffinity`) get a direct floor per id. Every boost is recorded on `x.gmBoosts` as `[type, matchedValue, weight]` — this reasons array already existed for the score-breakdown UI on each card, and turned out to be exactly the substrate needed to generalize recommendations (see below).

**Gap found and fixed:** the four corpus-backed categories under GOAT Profile → Recommendations (Movies, Books, TV Series, Video Games) were a fixed hand-picked list of titles with hand-written "why" prose, entirely disconnected from `gm` — a friend loading a different declared canon would still see Payton's picks and Payton's reasoning, unchanged. There was also a legacy mechanism that nudged specific titles' `gm` *up* to match that fixed list's displayed score, which would have kept leaking Payton-specific bumps into the general engine even after everything else was generalized.

**What changed:** those four categories are now generated live, every load, from `ALL` sorted by `gm` (excluding owned and already-declared works), with "why" text built mechanically from each item's top two `gmBoosts` entries (e.g. *"Shares creator Denis Villeneuve with your declared canon and matches your weighted 'sci-fi' genre."*). The category's basis line names whatever the loaded profile declared for that category, or says plainly that nothing's declared yet and ranking fell back to overall match. The legacy gm-nudge mechanism was deleted outright — it's not needed once recommendations are generated *from* `gm` rather than the reverse, and removing it also un-fudges `gm` itself back to each title's honest computed score (verified: Payton's own top pick per category is unchanged, since the generated ranking reproduces the same order the old hack was designed to force by hand).

Verified in jsdom: default profile still puts *Dune: Part Two* on top of Movies at the same score as before, with real (not fixed) reasoning text; a blank profile falls back to craft/reception-driven picks with honest "no declared X yet" framing and zero references to Payton's canon; no owned or declared item ever appears in the generated lists, matching the app's existing invariant.

**What's still not generic, and why.** The other six categories (Directors, Actors, Composers, Cinematographers, Music Artists, YouTube) are unchanged — still Payton's original hand-written picks, now labeled `sample:true` and shown with a "◈ sample data, not personalized" badge in the UI so nobody mistakes them for computed. The reason is structural, not effort: `movies`/`tvShows`/`videoGames`/`books` are corpus arrays with genre tags, creators, and scores to rank against — a *director* is just a string that appears in some works' `creator` field, with no independent record of their own style, genre range, or era to compute a similarity against. Generalizing these six would mean building an actual creator/composer/cinematographer/artist dataset (something like the existing 80-entry Creator Archives, but with the taxonomy `gm` scoring needs) — a real modeling project, not a data-layer or engine change. That's the next thing to scope if this matters enough to pursue.

**Taste drift (declared canon changes over time):** already handled, as a side effect of the engine being fully re-derived from `PERSONAL_PROFILE` on every load rather than cached — add a title to `declaredGoatIds`, adjust a `creatorBoost` weight, or re-Export/re-Import a changed profile, and every score, ranking, and now every generated recommendation recomputes from scratch next load. There's no stale cache to invalidate.

---

## Made genuinely offline: Tailwind compiled and committed

Per the top item on the Ideas list below, the Tailwind Play CDN (`<script src="https://cdn.tailwindcss.com">`) is gone. In its place is a compiled, minified stylesheet (~22KB) inlined directly in `<head>`, generated with the actual Tailwind CLI:

```
npx tailwindcss -i input.css -o output.css --minify
```
against a config with `content:["index.html"]` and `theme.extend.colors` matching the old inline `tailwind.config` (`{obsidian:'#0B0F19', panel:'#0F1626', ink:'#1E293B'}`) — that exact recipe is left as a comment right above the compiled `<style>` block in `index.html` for whoever needs to regenerate it after adding new utility classes.

**Why this matters:** the Play CDN compiles Tailwind *in the browser, on every load*, and if `cdn.tailwindcss.com` is unreachable the page rendered completely unstyled — the single hard dependency NOTES used to call out. Neither is true anymore: styling is baked into the file, so it renders identically with or without a network connection, and there's no more per-load compile cost.

**Verification:** static-scanned every literal class token used across the HTML and inline JS against the compiled output — the only "missing" classes were JS-only marker classes with no CSS rule (`.wlDone`, `.cardTitle`, etc., queried by JS but never styled) and Tailwind's own zero-CSS marker classes (`group`), confirming full coverage. jsdom's CSS engine doesn't parse Tailwind's modern `rgb(r g b/a)` color syntax, so final visual verification used a real headless Chromium (already available in this environment) instead: screenshotted the first-run onboarding gate, the Global Controller card grid, and the GOAT Profile recommendations tab (including the new sample-data badges from Phase 4) — full styling, blur backdrops, gradients, and layout all render correctly, matching the Play CDN's appearance. Chart.js's separate CDN dependency is untouched — it already degrades gracefully per the existing design, and generalizing it wasn't in scope here.

---

## Bug fix (v1.3.1): platform/network/studio dropdown stuck open

User-reported: the platform/network/studio combobox in Global Controller could get stuck open and not close on click. Root cause was structural, not a typo: it ran its own separate `initPlatCombo()` implementation with its own `document.addEventListener('click', ...)` "close if clicked outside" listener, deliberately excluded from the shared `closeRadarCombos()`/outside-click system the other searchable comboboxes (radar slot pickers) use (`.radarCombo:not(#platCombo)` appeared twice). Two independent hand-rolled open/close systems for visually-identical components, with different exclusion logic, is exactly the shape of bug that's easy to half-trigger intermittently and hard to pin down from one report — confirmed the toggle logic itself worked in dozens of scripted click sequences (including cross-browser-quirk-shaped ones), but the design was fragile regardless of whether that exact repro was ever isolated.

Fixed by removing the duplicate system entirely: renamed `closeRadarCombos` to `closeAllCombos` and dropped the `:not(#platCombo)` exclusion so it's the single close-registry for every dropdown; `initPlatCombo`'s own outside-click listener is gone, and its `open()` now calls the shared `closeAllCombos()` too (a real secondary bug this exposed: opening the platform combo never closed an already-open radar combo, so both could stay open at once). Added `e.stopPropagation()` on every field click so opening/closing can't be double-processed by the same click bubbling to the document listener, and a document-level Escape-key handler as a guaranteed close path independent of click behavior entirely. Verified: open/close via field click, Escape, and outside-click all work for both combo types; opening one now reliably closes any other that was open.

---

## Phase 5 — working through the enhancement backlog

A single pass through everything the "keep going" idea list had accumulated. All of it lives in `index.html`; `share.html` was regenerated afterward and picked up every change automatically (none of it is personal data, so `scripts/make-share-copy.js` needed no changes).

**In-app profile editor.** Every expanded card now has three buttons: **Declare favorite** (toggles the work's id in `declaredGoatIds`), **Mark owned** (toggles it in `ownedMedia`/`ownedBooksExtra`/`ownedGameIds` depending on kind), and **Boost `<creator>`** (adds or strengthens a `creatorBoost`/`bookCreatorBoost` entry for that work's creator). All three go through one `mutateProfileAndReload()` helper: clone the *live* `PERSONAL_PROFILE` (which already holds the fully resolved profile whether it came from defaults or storage — no need to special-case `PROFILE_FROM_STORAGE`), apply the change, save, reload. Same write-then-reload pattern as Export/Import/Reset, for the same reason: it's the only way to guarantee the whole scoring pipeline recomputes correctly rather than patching already-derived scores in place. This is what makes "personalize your copy" no longer mean "hand-edit a JSON file" — that's still there as the power-user path (`PROFILE_TEMPLATE.md`), but it's no longer the *only* path.

**Guided seed-picker.** A new "Quick-rate a few titles" option on the onboarding gate (`pickSeedCandidates()`) surfaces 10 works — 3 movies, 2 TV, 2 games, 3 books, picked at runtime by pre-personalization quality (critical+audience average) with a creator-diversity constraint so it isn't three Kubrick films — for a one-tap love/skip pass. Loved items become `declaredGoatIds` plus a "My Favorites" `declaredCanon` group; skipping falls through to the same blank profile as clicking Start Blank directly. This is the "rate these N items to seed taste" idea from the very first planning doc, finally built.

**"Tonight" picker.** A mood + time-budget + media-type form that returns one specific pick (plus two runners-up), randomized among the top 5 matches so repeat use doesn't always show the same thing. Mood options are built at runtime from the corpus's actual `vibeTime` tag frequencies (29 distinct tags, not a hardcoded list). The time filter only applies to movies — the only kind with a real single-sitting runtime in the data (TV tracks season count, games track total playtime, books track pages) — and the UI says so rather than pretending to filter kinds it can't honestly filter. Unlike the Recommendations panel, this deliberately does *not* exclude owned/declared works: "what do I watch tonight" is a legitimate answer even if it's a rewatch.

**Directors is now genuinely computed, not approximated.** Checked whether each of the 10 hand-picked director names actually directs anything in the 1,300-work corpus — all 10 do — so their score became the average `gm` of their top 3 corpus films/TV, which is real, already-personalized signal borrowed from a mechanism the app trusts everywhere else. Directors is flagged `generated:true` and lost its "sample data" badge entirely. The other five people categories (Actors, Composers, Cinematographers, Music Artists, YouTube) have no equivalent corpus to borrow from, so each of their 50 hand-picked entries got a small `tags` array (genre keywords matching the vocabulary `genreBoost` already uses) and their score comes from how many of those tags a loaded profile weights — real signal, coarser than a corpus lookup, kept honestly labeled `approx:true` → "◈ approximate — by genre overlap" rather than passed off as fully computed. Verified with a synthetic western-loving profile: Colter Wall / Tyler Childers / Marty Robbins correctly rose to the top of Music Artists. A real creator dataset (item 10 below) is still what would close this gap properly.

**Export/Import now bundles the whole person, not just their taste weights.** The snapshot shape is now `{version, exported, profile, watchlist, theme, density}`; Import auto-detects this shape versus a bare profile object (what `PROFILE_TEMPLATE.md` documents and what every export before this feature produced) by checking for a `profile` key, so old exports and hand-built template files both still work unchanged. Reset was also quietly fixed to actually clear the watchlist — its own confirmation dialog had claimed it did this since Phase 2, but the code never touched `omniLedgerWatchlist` until now.

**Contenders Ledger refreshed against real-world release news**, not just internal date math. Spot-checked the highest-signal entries with web search rather than exhaustively re-verifying all 83 (that's a bigger, ongoing job — see item 6 below): *The Blood of Dawnwalker* and *007: First Light* had already released, *Metroid Prime 4: Beyond* released back in December 2025, *Fable* slipped to February 2027, *Judas* has no real date and may be years out, and the *Perfect Dark* reboot was cancelled outright in July 2025 (Microsoft closed developer The Initiative). Each entry's `window` and `pedigree` were updated to say so plainly rather than silently deleted — deleting would erase the historical record; the honest move is marking status. *Grand Theft Auto VI*'s November 19, 2026 window was checked too and confirmed accurate, no change needed. None of these were migrated into the scored corpus proper (that would mean fabricating critical/technical/audience metrics for entries not yet in the ledger's verified-or-estimated provenance system) — they stay in Contenders Ledger with corrected status, flagged for a future proper reconciliation pass.

**Version marker.** `APP_VERSION` plus a `CHANGELOG` array, shown as a small clickable version number next to "Last updated" in the header. This is deliberately not a live update check — there's no server for it to check against, this is still a hand-a-file app — just a "here's what changed" readout so a friend comparing their `share.html` to yours can tell whether they're behind and should ask for a newer copy.

**Full regression, both files.** All of the above verified in jsdom (default profile: still 1,300/179/12/7 unchanged; blank profile: still 0 across the board) and in a real headless Chromium (onboarding gate with the new Quick-rate option, the profile-editor buttons on an expanded card, the Tonight picker end to end, the regenerated Directors/Actors panels, the version changelog modal) — for both `index.html` and the regenerated `share.html`.

---

## Phase 6 — GOAT Picker, mobile fixes, cross-medium pairings, profile comparison, test suite

**"Pick Your GOATs."** A dedicated search-select-finalize screen (`#goatPickerGate`), reachable from a persistent header button or from a new onboarding-gate option ("Search & pick your GOATs"). This is the direct answer to "how do others actually build taste" — search the full corpus, tap results to stage them, Finalize writes `declaredGoatIds`/`declaredCanon`. The onboarding path builds a genuinely blank `{declaredGoatIds, declaredCanon}` object rather than cloning the live `PERSONAL_PROFILE` — on `index.html` that object still holds Payton's hardcoded defaults at onboarding time, so cloning it would have bled Payton's `creatorBoost`/`ownedMedia`/etc. into a stranger's fresh profile. Reopening from the header afterward correctly merges into whatever profile already exists via the usual `mutateProfileAndReload`.

**Two latent CSS bugs found and fixed.** `max-h-[85vh]` (used by every modal — GOAT Picker, seed wizard, Tonight picker) and `max-h-64` (GOAT Picker's results/staged lists) were referenced in markup but never compiled into the precompiled Tailwind stylesheet (Phase 4's "made genuinely offline" pass generated the stylesheet before these classes existed in the HTML). Both silently no-opped, so affected containers could grow past the viewport with footer buttons unreachable. Added both rules by hand next to the existing `.max-h-[460px]` entry.

**Mobile viewport pass.** Found and fixed real horizontal-overflow bugs: the header's theme/profile-controls row and the controller's action-button row (Rabbit Hole / Surprise Me / Compact / Show-limit) didn't wrap on narrow viewports, and `#creatorSeg`'s three long-label buttons overflowed with nowhere to go. Added `flex-wrap` to all three plus a base `.seg{flex-wrap:wrap;max-width:100%}` rule so every segmented control benefits. Verified zero horizontal overflow across all 10 views at 390×844 in both files.

**Cross-Medium Pairings.** Every card detail now computes up to 3 works of a *different* medium sharing genres or the same vibe tag (`crossMediumPairings()`), ranked by shared-genre count then GOAT match, clickable to jump straight to that work in the Global Controller.

**Profile Comparison.** A header **⇄ Compare** control loads a second exported profile file and computes overlap against the current one — shared declared favorites, what's unique to each person, shared boosted creators/genres, an overlap percentage — entirely client-side and read-only; the loaded file is never saved or applied.

**Committed regression suite.** `test/smoke.js` (see Testing below) replaces the old "run it externally" workflow with something anyone can run after `npm install`.

Full details on each item, and the two CSS-bug root causes, are in the corresponding commits on `claude/omnimedia-ledger-planning-xez6lm`.

---

## Phase 7 — corpus nearly doubled, creator dataset, full profile parity, contenders reconciliation

**Corpus: 1,300 → 2,502 works.** Movies 500→999, TV 150→250, games 150→253, books 500→1,000. Generated via six parallel research passes (each given the exact schema, the existing title list to avoid duplicates, and a genre/era lane to reduce cross-batch collision), then hand-validated before insertion: every batch was checked for valid JSON, correct sequential IDs, and zero duplicate titles (case-insensitive) against both the existing corpus and every other batch, before being spliced into the relevant array. One real cross-batch collision surfaced this way (*West Side Story* (1961), independently added by two batches) and was dropped from the loser before merge — which is why movies landed at 999 rather than exactly 1,000. New entries fall above `PROV_CEIL` automatically, so they're honestly flagged "◯ Curated estimate" rather than "◉ Verified" — no change needed to that mechanism, it already does the right thing.

**Creator dataset, started.** Added `personCorpusScore()`, the same idea as `directorCorpusScore()` (Phase 5) but keyed to an explicit `works: [...]` list per person instead of the `creator` field. Actors, Composers, and Cinematographers entries that name a real, verifiable corpus work (26 of 30 across the three categories) now score from a real average of that work's GOAT match, marked "◆ linked" per item and "◆ partly ledger-linked" at the category level. Music Artists and YouTube stay honestly labeled "approximate — by genre overlap" since the corpus has no music-album or video-essay entries to link to — a full fix (idea #10, still open) would need a proper cast/discography dataset, not just spot-linking well-known crossover credits.

**Full `PERSONAL_PROFILE` click-editor parity.** Genre chips and the vibe chip on any expanded card now toggle `genreBoost`/`vibeBoost` directly; a new **Silver tier** button toggles `silverTierIds`; book cards get a **Boost affinity** button for `bookAffinity`. Combined with Phase 5's Declare/Own/Boost-creator buttons, every taste-weight field except `cosmicHorrorCanon` is click-editable with no JSON required.

**Reconciled 3 released Contenders into the scored corpus**, with real data instead of a placeholder: *Metroid Prime 4: Beyond* (Metacritic 79 critic / 78 user), *007: First Light* (88/83), *The Blood of Dawnwalker* (84/80) — all verified via web search rather than estimated. Their Contenders Ledger entries keep their history (`migratedTo` field) and now render a green "✓ IN LEDGER — VIEW SCORE" badge that jumps straight to the real corpus entry instead of just saying "due for reconciliation" and stopping there.

**Full regression across all of it.** `test/smoke.js`'s baseline check was changed from a hardcoded `=== 1300` to verifying the total equals the sum of per-kind counts, so it stays correct as the corpus keeps growing rather than needing a manual bump every time. All 24 checks pass on both files at the full 2,502-work corpus.

---

## Phase 8 — corpus split out, Music Artists/YouTube scoring improved, Contenders staleness tracking

**Corpus split into `data/`.** See "The corpus dataset was split out in Phase 8" under Non-obvious decisions above for the full writeup. Short version: `data/{movies,tv,games,books}.js`, loaded via classic `<script src>` (not `fetch`, not ES modules — both break under `file://`), referenced identically by both `index.html` and `share.html`. Both HTML files dropped from ~1.58MB to ~330KB. `scripts/validate-corpus.js` was updated to read the new locations and now also asserts neither HTML file has a leftover inline copy of the corpus, so a future edit can't accidentally reintroduce the duplication this phase removed.

**Music Artists / YouTube scoring, improved as far as honestly possible.** These two Creator Archives categories have no equivalent corpus category to link to the way Phase 7 linked Actors/Composers/Cinematographers (confirmed by searching the corpus for biopics/documentaries about each of the 20 hand-picked people — none exist). Rather than claim they're "finished" when a real fix needs a corpus category this app doesn't have, `tagOverlapScore()` was extended to also blend in `vibeBoost` matches (previously genre-only), and all 20 entries got a `vibes` field alongside their existing `tags`. This is a genuine improvement — verified with a synthetic profile that heavily boosted "Midnight Ritual": Nick Cave and Leonard Cohen (the two tagged with it) correctly jumped to the top of Music Artists — but it's still fundamentally hand-curated ranking, not corpus-computed, and the UI label says so plainly ("◈ approximate — by genre + vibe overlap"). A real fix is still open idea #10 below.

**Contenders Ledger: staleness made visible instead of invisible.** True scheduled automation isn't possible in a static file with no server or cron — so instead, every contender entry that's had a real spot-check against live sources gets a `"verified":"YYYY-MM-DD"` field, and the Contenders Ledger view now shows a per-card "◉ Spot-checked <date>" or "◯ Not yet spot-checked" line plus a header count ("◉ 7/50 spot-checked"). Currently 7 of 50 are verified: the 6 from Phase 5's spot-check (*Fable*, *Judas*, *Perfect Dark*, plus the 3 later reconciled into the corpus) and *Grand Theft Auto VI* (confirmed accurate in the same pass). This doesn't refresh anything by itself, but it makes the gap honest and trackable instead of silently pretending every entry is current — a real prerequisite for anyone (Payton or a future session) actually running the refresh below.

**The refresh runbook**, for whenever someone (or a future Claude session) does a pass:
1. Open Contenders Ledger, sort by "◯ Not yet spot-checked" (visually — there's no dedicated filter for it yet, see idea #17 below) and pick a batch.
2. For each entry, web-search `"<title>" release date review score 2026` (or the current year) — confirm the `window` field is still accurate (delayed / shipped / cancelled) and, if it's shipped, get a real critic/audience score.
3. Update `window`, `pedigree` (note what changed and why, don't just silently overwrite), and set `"verified"` to today's date.
4. If it's shipped: this is also the trigger for reconciliation (see Phase 7) — add it to the real corpus (`data/movies.js` etc.) with sourced scores, and add a `"migratedTo"` field pointing at it, same pattern as the three done in Phase 7.
5. Run `npm test` before committing — the corpus validator and smoke suite both check the ledger renders correctly either way.

---

## Phase 9 — the refresh runbook run for real, movies to exactly 1,000, deeper Actors linking

**The Phase 8 runbook, actually run.** 13 more Contenders entries spot-checked against live web search (20/50 total, up from 7/50). Five had already shipped and are now reconciled into the scored corpus with real Metacritic data: Saros (88 critic/85 audience — Housemarque's highest-rated game ever), Resident Evil Requiem (90/95, best-reviewed mainline entry since RE4, record user score), Crimson Desert (77/88), Nioh 3 (86/78), Forza Horizon 6 (91/88, 2026's best-reviewed game at launch). Two whole-series TV entries needed their corpus record updated rather than a fresh entry: House of the Dragon (totalSeasons 2→3, critic 81→84, audience 80→76, reflecting Season 3's stronger critical reception but more divisive audience reaction) and Fallout (already correctly at 2 seasons — Season 2 aired December 2025–February 2026, earlier than the ledger's tracked window said). One status correction rather than reconciliation: The Penguin Season 2 is not happening — HBO/DC aren't moving forward with it, kept in the ledger for the record like Perfect Dark. Six more entries got real confirmed dates replacing vague ones (Blade Runner 2099, Marvel's Wolverine, Klara and the Sun, Gears of War: E-Day, a status note for The Duskbloods).

**Movies to exactly 1,000.** Added *Do the Right Thing* (1989) — a real, previously-missing, canonical film, chosen specifically to replace the gap Phase 7 left when two parallel research batches both independently picked *West Side Story* and the duplicate was dropped rather than kept.

**Games landed at 258, not 250 — deliberately.** Between this phase and Phase 7, 8 real Contenders reconciliations added real, sourced games to the corpus. Trimming or skipping them to hit the original 250 target would have meant either deleting accurate data or refusing to reconcile a shipped game with real review scores — both are quality regressions, not improvements. The count is a side effect of doing the reconciliation work honestly, not a target to be hit.

**Auto-flagging passed release windows.** `parseWindowDate()`/`isPastWindow()` (added this phase) recognize an unambiguous "Month DD, YYYY" window and flag it if it's in the past but the entry hasn't been migrated or marked Released/Cancelled — shown as a "WINDOW PASSED" badge. Deliberately conservative: a bare year, "TBA", or "shoots 2027" can't be reliably compared to today, so those are left alone rather than risk a false flag on a fuzzy window.

**Actors: all 10 of 10 now genuinely linked**, up from 9/10 in Phase 7 — and most now average across 2-5 real corpus films instead of just one (e.g. Philip Seymour Hoffman: The Master, Capote, Doubt, Magnolia, Boogie Nights). This is the bounded version of "a real cast/crew schema": a full per-actor filmography field across all 2,508 works isn't tractable without a much larger schema change and regression surface, so this raises fidelity using only titles already verified to exist in the corpus. Composers, Cinematographers, Music Artists, and YouTube weren't touched this phase — same opportunity exists for the first two, and the corpus-category gap for the latter two is unchanged (see idea #10 below).

Full regression: 52 checks (26 × 2 files) pass, including the corpus validator, after every change in this phase.

---

## Phase 10 — Composers/Cinematographers linked; a real data-quality verification campaign

**Composers and Cinematographers reached parity with Actors.** Same treatment as Phase 9 gave Actors: checked which real corpus films each of the 10 Composers and 10 Cinematographers picks is actually credited on, added them to `works`. Both categories now 10/10 linked (up from 7/10 and 9/10), several now averaging 2-5 real films instead of one (John Williams: Jaws, E.T., Schindler's List, Jurassic Park, Close Encounters). Actors deliberately left as-is per explicit direction — Phase 9's treatment was judged sufficient, and further expansion there would mean inventing cast data the corpus doesn't have, a different and larger kind of work.

**A real, ongoing data-quality verification campaign**, in response to explicit direction to prioritize accuracy of what's already in the corpus over expanding it further. Methodology, in two steps:

1. **Programmatic structural audit** (no browser, no web search) — checked all 2,508 entries for missing/empty fields, out-of-bounds scores, duplicate or suspiciously short justification text, and score-pair repetition. Found zero real structural bugs; the only flagged items (67 books dated before 1850) are correctly-dated ancient/classical texts (The Odyssey, Meditations, Tao Te Ching), not errors — a useful reminder that an automated check needs a human read before its output means anything.

2. **Prioritized real-world spot-checks** — full re-verification of ~2,500 scores against real sources isn't achievable in any single pass (confirmed, not just assumed: at the pace of one web search per title, it would take many hundreds of searches). Instead, sampled across corpus ranges and media types in small batches, checked each against Rotten Tomatoes / Metacritic / Goodreads / Steam / IMDb as appropriate, corrected what was actually wrong, left alone what held up.

**Results across six batches, ~46 entries checked, 11 real corrections applied** (Titanic, Days of Being Wild, CODA, Noita, Marriage Story, Kingdom, Rififi, Hell or High Water, Ringu, Casablanca, Shōgun). A ~24% overall correction rate, concentrated almost entirely in less-famous or older titles — the most-visible, most-iconic entries (the ones "Best Overall" sorts actually surface) checked out accurate essentially every time, which makes sense: those are near-universal-consensus works where any reasonable estimate lands close.

Two findings worth keeping in mind for future passes:
- **Corrections weren't confined to this session's own additions.** Rififi and Casablanca are both from the pre-session original ledger (`PROV_CEIL`-flagged "verified"), not Phase 7-9 additions. The provenance flag correctly describes *where a score came from*, but "from the original ledger" isn't the same guarantee as "checked against a real source" — worth not conflating the two.
- **Not every "real" number is the right number to use.** Diablo IV's Metacritic user score (2.7/10) is a well-documented review-bombing artifact from a launch monetization controversy — using it verbatim would have been a worse "correction" than leaving the estimate alone. Steam's more representative 74% positive matched the existing estimate well. When sources disagree sharply, that's a signal to look for *why*, not to average blindly.

This is explicitly an ongoing process, not a finished one — 46 of ~2,500 entries is a real but small fraction. The methodology (sample script + WebSearch spot-check + commit-per-batch) is proven and repeatable; continuing it in further batches is pure schedule, not a design question.

**Scaling the campaign with parallel background agents.** Manually verifying ~2,500 entries one title at a time was projected to take hundreds more rounds — not reasonable. Switched to parallel background agents: the full corpus was split into 14 batches (5 movie batches of 200, 5 book batches of 200, 2 TV batches of 125, 2 game batches of ~129), each handed to an independent agent with the same sourcing rules as the manual passes (RT/Metacritic for movies/TV, Metacritic+Steam for games with an explicit anti-review-bombing rule, Goodreads for books with the compressed-scale caveat) plus a >=6-point correction threshold. Corrections were written as JSONL, spot-checked against live sources before merging, applied via a small script matching exact old-value JSON substrings, then validated (`scripts/validate-corpus.js`, `test/smoke.js`) and committed per wave.

Two real problems surfaced and were corrected for:
- **A pilot wave of 4 agents (movies/TV/games/books) caught its own errors.** The TV agent's "confident prior knowledge" corrections (used when it ran low on search budget) included two wrong guesses — Ozark's real score was within the no-correction threshold of the original, and Deadwood's 98 was the *Deadwood: The Movie* score conflated with the TV series (whose real value was close to the original). The movies agent's single lowest-confidence "recalled" correction (Inglourious Basterds, 89 -> 77) was also wrong; the original 89 was correct. All three were caught by manual WebSearch spot-checks and discarded before merging, and this became a hard rule for all subsequent batches: **every reported correction must trace to an actual search in that run, never to model recall**, even when confident.
- **The session's WebSearch budget (200 calls) is shared across every agent running in parallel, not per-agent.** Running all 10 remaining batches at once meant most agents exhausted their share of the budget partway through (some after fewer than 10 searches) and had to stop, correctly leaving the rest of their batch unflagged rather than guessing. This is why the two full waves below cover a verified subset of the corpus, not every entry — the agents' own honesty about their search-budget limits is what made the results trustworthy, but it means full coverage needs more waves with smaller concurrency (so budget isn't fragmented 10 ways) or a raised per-session cap.

**Results across two full parallel waves: 242 corrections applied, cutting across all four media types and roughly the first third to half of most batches' entries** (movies m01-m1008 spanning all 5 batches at varying depth, TV t01-t264, games g01-g263 lightly touched, books b01-b1008 spanning 7 of 10 batches). Wave 1 (pilot, 4 agents): 137 corrections (72 movies, 51 TV, 12 games, 2 books). Wave 2 (remaining 10 batches): 105 corrections (82 movies, 6 TV, 15 books, 1 game) — each batch report explicitly lists which titles it search-verified vs. left untouched for lack of budget, so the untouched portion of the corpus is known, not silently assumed clean.

This remains an ongoing process. A full-coverage pass on the ~2,200 still-unverified entries (mostly the tail ends of large batches, plus games and TV which got comparatively little search-budget share) would need either several more waves run at lower concurrency, or a raised WebSearch budget per session.

---

## Phase 11 — Optional cloud accounts (Firebase)

**The problem this solves.** Everything up to this phase lives in `localStorage` — one browser, one device. That's fine for Payton's own use, but doesn't work for "send this to friends and everyone gets their own saved account that follows them across devices." A real account system needs somewhere to put data that isn't the visitor's own browser (a database), a way to tell visitors apart (even a light one), and a URL/file people actually load the app from.

**Why not a full hosted backend.** The natural-seeming option — publish this as a Claude Artifact with the `db` capability — turns out not to fit: Artifacts with `db` declared are **organization-internal only**, meaning every viewer (not just writers) must be a signed-in member of the *same* Claude.ai organization as the owner. A personal Claude account has no "organization" to add friends to the way a Team/Enterprise plan does, so a friend on their own personal account would be blocked before ever seeing the page. That rules out the otherwise-appealing zero-server option for this specific use case.

**Why Firebase over a self-hosted SQL Server + API.** A real always-on server plus a SQL Server instance is genuine, ongoing infrastructure — hosting cost, uptime, security patching, a live API layer since browsers can't speak SQL Server's wire protocol directly. Discussed and explicitly deferred in favor of the zero-server option: Firebase's client SDK talks to Firestore directly from the browser, no server to run, a free tier that comfortably covers a friend-group app, and setup is one Firebase-console click-through, not infrastructure to maintain.

**What "account" means here.** Deliberately the lightest possible scheme: a visitor types a name (a "handle"), which becomes their permanent identity going forward. No password, no email, no real auth. This is a friend-group convenience, not a security boundary — anyone who knows or guesses a handle can load (and overwrite) that account. That tradeoff was discussed explicitly and accepted; see "Firestore security rules" below for how far rules alone can (and can't) mitigate it.

### How it works

Everything lives in `index.html` (and is carried into `share.html` by the existing regen script, untouched): a new `<script id="acct-boot">` block runs *before* the main app script, which is now marked `type="text/plain"` so it doesn't auto-execute — `acct-boot` reads its text content and injects it as a real `<script>` element once account resolution is done. This is the standard "gate a big synchronous script behind an async step" trick: no changes needed anywhere in the ~2,700-line app script itself.

1. **Unconfigured (as shipped):** `FIREBASE_CONFIG.apiKey` is a `PASTE_YOUR_...` placeholder. `acct-boot` detects this and immediately boots the app exactly as before — zero behavior change, zero network calls, single-device `localStorage` only.
2. **Configured:** on load, `acct-boot` checks for a remembered handle (`localStorage.omniLedgerHandle`). If present, it fetches `profiles/<handle>` from Firestore and hydrates the 5 tracked `localStorage` keys (`omniLedgerProfile`, `omniLedgerWatchlist`, `omniLedgerTheme`, `omniLedgerDensity`, `omniLedgerOnboarded`) from the cloud doc before booting — so a returning visitor on any device gets their data back. If no handle is remembered, a blocking "Whose ledger?" gate asks for one; a brand-new handle gets a cleared local profile (so the app's existing onboarding flow — sample/quick-rate/GOAT-picker/blank/import — runs exactly as it does today for a first-time visitor).
3. **Sync back to the cloud:** `Storage.prototype.setItem` is patched once, globally, so every write the app already makes to those 5 keys (no code changes elsewhere) schedules a debounced (1.5s) push of the full snapshot to `profiles/<handle>` via Firestore's `.set()`. Last-writer-wins, same as `localStorage` always was.
4. **Switching accounts:** a "Switch" button in the header (next to the new Account badge) clears the remembered handle and local profile, then reloads — showing the handle gate again.
5. **Offline/misconfigured resilience:** every Firestore call has an 8s timeout and falls back to booting from whatever's in local cache (or a guest "continue on this device only" path from the gate) rather than hanging or breaking the app. A failed cloud read never blocks usage.

**No bias between accounts, by construction.** The recommendation engine has always read from `PERSONAL_PROFILE`, itself built from `localStorage.omniLedgerProfile` at script-parse time (`PROFILE_FROM_STORAGE` — see the top of the script). Since each handle hydrates its *own* cloud doc into that same key before the app boots, a friend's account computes recommendations purely from their own declared favorites/collection — never Payton's — with no engine changes required. This was true before cloud accounts existed too (it's why `share.html` works at all); cloud accounts just add cross-device persistence on top of a scoring model that was already per-profile.

### Setup (5 minutes, one person needs to do this once)

1. https://console.firebase.google.com → create a free project.
2. Add a **Web app** (the `</>` icon) — Hosting/Analytics not needed.
3. **Build → Firestore Database → Create database** (test mode is fine to start; tighten with the rules below before sending the link around).
4. Copy the `firebaseConfig` object shown and paste its values into `FIREBASE_CONFIG` near the top of the `acct-boot` script in `index.html`, replacing the `PASTE_YOUR_...` placeholders. That's the only file — see "One file, not two" below.

### Firestore security rules

Test mode (open read/write to anyone with the project's API key) is fine for initial setup but should be tightened before wide distribution. Since there's no real per-user auth here (handles are just names, not verified identities), rules can't distinguish "the real Alice" from "someone who typed alice" — that limitation is inherent to the handle-only design, not something rules can fix. What rules *can* do is confine reads/writes to the shape this app actually uses, so a compromised or leaked API key can't be used to read/write arbitrary unrelated data:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /profiles/{handle} {
      allow read, write: if request.resource == null || (
        request.resource.data.keys().hasOnly(['omniLedgerProfile','omniLedgerWatchlist','omniLedgerTheme','omniLedgerDensity','omniLedgerOnboarded','updatedAt']) &&
        request.resource.data.size() < 20
      );
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

This is still not real access control (anyone can still write to any handle's document — the app has no way to prove who's typing) — it just stops the database from being usable for anything beyond this app's own `profiles/*` documents. A genuine per-person security boundary would need real auth (see the "Real accounts (email-based)" option that was considered and deliberately not chosen for this phase, in favor of lower friction for a casual friend-group app).

### Testing

`test/smoke.js` exercises the real `acct-boot` code path (not a re-implementation of it) against an in-memory mock of the Firebase compat SDK's `collection().doc().get()/.set()` surface — a temp copy of the file with `FIREBASE_CONFIG` patched to a dummy "configured" value, gstatic SDK URLs intercepted and replaced with the mock. Covers: gate appears when configured, closes on submit, a brand-new handle gets normal onboarding, a profile change syncs to the cloud store, a second "device" with the same handle hydrates and skips onboarding, and Switch Account clears state and re-shows the gate. Runs automatically as part of `npm test` / `node test/smoke.js`, no real Firebase project needed to run the suite.

### What's still open

- **The deeper GOAT/favorites curation page** the account system was requested alongside — a more in-depth dedicated tab for building out favorites — wasn't built this phase. The existing GOAT Profile view, GOAT Picker (search-and-select), and in-app profile editor already cover a good amount of this; whether they're "in-depth" enough once real friends are using their own accounts is worth revisiting after some real usage.
- **SQL Server** was the user's first instinct and remains on the table for later — nothing here blocks moving to it if Firebase's free tier or NoSQL shape becomes limiting. That would mean standing up the API server layer discussed and deferred above.
- Firestore's 256 KiB per-document cap comfortably fits a full profile snapshot today; worth a sanity check if `PERSONAL_PROFILE` grows dramatically (declared canon, owned collection, taste weights) in the future.

### One file, not two: `share.html` retired

Once cloud accounts existed, `share.html`'s entire reason for existing — a blank-defaults copy to hand to other people so nobody else's browser inherited Payton's personal taste — was obsolete: anyone opening `index.html` and picking their own name gets an account fully isolated from Payton's data by construction (their own cloud doc, or their own browser's `localStorage` if cloud accounts aren't configured), the same way `share.html` always was. Deleted `share.html` and `scripts/make-share-copy.js`; `index.html` (and, once hosted, its GitHub Pages link) is now the one thing to send anyone. `index.html`'s hardcoded `PERSONAL_PROFILE` defaults still exist, but only ever matter as the fallback for a browser/account that's never saved anything — see `PROFILE_FROM_STORAGE` at the top of the script — and the onboarding gate's "Use the built-in sample profile" option makes clear that data is Payton's, offered as a look-around demo, not a default anyone else is stuck with.

**Account menu, same phase.** The plain "Switch" button next to a static account badge became a real dropdown (`#acctMenu`, styled and behaved like the app's other `.radarCombo` search-comboboxes, minus the search box — excluded from the generic combobox initializer and given its own lightweight open/close toggle in `acct-boot`) — click the account name top-right to see who's signed in and a "Switch account…" action, rather than a button that's always sitting there. Reuses the same shared `closeAllCombos`/outside-click/Escape/scroll-close machinery as every other dropdown in the app, for free, since it just needs to carry the `.radarCombo` class.

---

## Phase 12 — Three-tier favorites (Gold/Silver/Bronze), first installment of a larger UX pass

The user came back with a substantial list of UX improvements after using cloud accounts for real: a proper 3-tier favorites system, per-work-relevant card stats instead of the same 3 bars on everything, main-view-vs-advanced filter reorganization (possibly user-customizable), better use of layout space, an in-app suggestion box, folding the GOAT Picker into the GOAT Profile tab, tier-aware recommendation weighting, a simplified changelog, and a rewritten README. Given the size, agreed with the user up front to sequence it: **foundational first** (the tier data model + engine reweighting, this phase), with the rest (card-stat relevance, filter reorg, GOAT Picker merge, suggestion box, changelog/README rewrites) as later, separate passes once this lands and gets used.

**Tier semantics, decided explicitly before writing code:** Gold = the existing `declaredGoatIds` ("Declare favorite"), Silver = the existing `silverTierIds` ("Silver tier") — both unchanged, zero migration needed, nobody's existing data moves or needs re-declaring. Bronze is genuinely new: `PERSONAL_PROFILE.bronzeTierIds`, defaulting to `[]` for everyone (there's nothing to migrate into a tier that didn't exist before).

**Scoring hierarchy.** Silver already existed as a blend toward a floor (`gm*0.45 + 88*0.55`, applied only if it raises the score). Bronze was added as a *weaker* version of the same mechanism (`gm*0.65 + 80*0.35`) so the three tiers form a clean, strictly-ordered hierarchy: Gold pins to a flat 100 (unchanged, applied last so it always wins), Silver pulls hard toward 88, Bronze nudges more gently toward 80 — none of them can ever pull a score *down*, only up, and a higher tier always outranks a lower one (`tierRank()`: Gold=3, Silver=2, Bronze=1, none=0). Because every recommendation list in the app (the GOAT Profile's generated per-category recs, every sort mode, the results grid itself) is already driven by `gm`, adding Bronze into that same pipeline means tier-aware recommendations came essentially for free — no changes needed to `buildGeneratedRec()` or the sort/filter machinery beyond adding Bronze as an input.

**"Why this was recommended" also got tier-aware.** `whyRecommended()` previously only ever cited something you *own* as the reason a discovery was suggested ("Because you own X — same director"). It now builds a candidate pool of everything owned OR tiered (Gold/Silver/Bronze) and picks the highest-tier match first (`bestAnchor()`), falling back to plain ownership only when nothing tiered matches — so the stated reasoning reflects your strongest taste signal, per the user's explicit ask that "suggestions should be based off gold, then silver, then bronze, then collection."

**Visible without expanding — the actual UX complaint that started this.** The Declare/Own/Silver toggle buttons previously lived only inside a card's collapsed `.detail` panel, requiring a click just to see they existed. They're now a compact always-visible row (`tierRowHTML()`) rendered as a sibling of the card's clickable head — not nested inside it, which matters (see the bug below) — with Gold/Silver/Bronze/Owned all one click away on every card, plus a colored 🥇/🥈/🥉 badge in the card's header chips when a tier applies. The fuller labeled buttons remain inside the expanded detail panel only for the boost-creator and boost-book-affinity actions, which are lower-frequency and fine to require a click to reach.

**A real bug, caught building this, then a second one caught fixing the first.**
- First pass added `onclick="event.stopPropagation()"` to the new row's wrapper div, reasoning (wrongly) that it was needed to stop clicks from also toggling the card open/closed. It broke every tier button silently — clicking Gold/Silver/Bronze/Owned did nothing at all. Root cause: the actual click handling lives in a *delegated* listener on `#grid` (`on('#grid','click',...)`), which checks `.profEditBtn` *before* `.cardHead`'s toggle logic — so it was already safe without any `stopPropagation()`, and adding it stopped the click from ever bubbling up to `#grid` in the first place. Caught by an actual Playwright run (not just eyeballing the diff): toggling Bronze produced no change in `localStorage`. Removed the unneeded `stopPropagation()`; verified the toggle, badge, and the fact that clicking a tier button does *not* also expand the card.
- Fixing that surfaced a second, unrelated, pre-existing bug: after the fix, a smoke-test click on `#resetBtn` right after exercising the GOAT Picker started timing out with "element is not visible." Root cause: `#tonightBtn` and `#goatPickerBtn` share the `.navBtn` class purely for visual consistency with the real view tabs (Global Controller, GOAT Profile, etc.), but neither carries a `data-view` attribute. Clicking either bubbles into `#nav`'s delegated view-switcher, which calls `switchView(undefined)` — and since no section has `data-sec="undefined"`, *every* section on the page gets hidden. Invisible in normal use because both buttons open a full-screen modal on top of the now-broken page; only closing the modal would reveal a blank main content area, at which point picking any real view tab "fixes" it again by calling `switchView` with a real value — easy to miss, easy to blame on something else. Fixed by adding `e.stopPropagation()` to both buttons' own click handlers, and added two explicit regression checks (`test/smoke.js`) asserting the controller section stays visible after opening and closing each.

**Testing.** `test/smoke.js` covers: toggling Bronze from the compact row saves to the profile and shows a badge, doing so doesn't also expand the card, the Bronze-only filter narrows correctly, the tier sort ranks Gold above Bronze, and the two nav-corruption regressions above.

**What's still open**, per the sequencing agreed with the user — later passes, not this one:
- Per-work-relevant card stats: `frontBars()` currently shows a fixed set of 3 bars per *medium* (all movies show Image/Dread/Mind, all books show Prose/Ideas/Depth, etc.), not the 3 indices most relevant to that *specific* work. Needs a real "pick the highest/most distinctive indices for this item" function, plus a way to see the rest by expanding.
- Filter reorganization: deciding which of the many filters deserve default (non-Advanced) visibility, versus a user-customizable "pick which sliders show in main view" preference — a real design + persistence question, not touched here. The new tier filter checkboxes were added inside the existing Advanced Filters section for now, deliberately not resolving this larger question yet.
- Folding "★ Pick Your GOATs" into the GOAT Profile tab as a real search/filter section instead of a separate modal.
- An in-app suggestion box, writing to a shared Firestore collection once cloud accounts are configured (decided: Firestore over a mailto: link, for a real shared inbox across everyone using the app).
- A simpler, more summarized changelog display for non-technical users (the current one is written at the same detail level as these NOTES.md entries).
- A full README rewrite aimed at being genuinely readable by a non-technical friend, not just accurate.
- Onboarding/UI hints showing where to click for more detail, for people who don't already know the app.

---

## Phase 13 — Per-work relevant stats, and the real reason the detail layout felt cramped

Continuing the sequenced UX pass from Phase 12. Two of the deferred items from that phase's "what's still open" list, done together since fixing one made fixing the other trivial to verify visually.

**`frontBars()` now picks per-work, not per-medium.** Previously every movie's card showed the identical Image/Dread/Mind trio, every book the identical Prose/Ideas/Depth trio, every game the identical Art/Tension/Systems trio — regardless of what was actually distinctive about that specific work. Rewrote it to build a medium-appropriate candidate pool (the craft dimension plus all ~15 specialized indices relevant to that kind) and take the top 3 by raw value for *that item*. A soundtrack-driven blockbuster now leads with Soundtrack; a quiet character piece can lead with Emotional. All ~19 indices are still visible in full when the card is expanded — nothing was removed, just what's chosen to lead changed. Added a `title` tooltip on the front-bar row explaining what it's showing, since the behavior is less obvious than a fixed set would have been.

**The Cosmic Horror layout complaint turned out to be a structural bug, not a styling one.** Looking at the actual markup: the ~15-index `idxGrid` was nested *inside* `fidGrid` as a single child element, rather than being a sibling. CSS grid doesn't let a nested grid "break out" and span its parent's tracks — the entire index block was being squeezed into whatever width one column of the *outer* grid allotted it, while GOAT Match and Cosmic Horror (plain flex rows, not grid items) sat in their own oddly-sized slots in that same outer grid. That's what actually produced the "Cosmic Horror alone, everything else crammed to one side" look the user described — not that Cosmic Horror was special-cased, but that the whole layout beneath it was mis-nested. Fixed by making `fidGrid` (the base craft metrics + audience/critical score) and `idxGrid` (everything else, GOAT Match and Cosmic Horror now included as regular entries) proper siblings, each getting its own full-width responsive grid. Confirmed visually via a real Playwright screenshot before and after, not just by reading the diff.

**Testing.** Two new `test/smoke.js` checks: front-bar label sets differ across different cards (catching a regression back to the old fixed-per-medium behavior), and a structural check that `idxGrid` is not nested inside `fidGrid` and that GOAT Match/Cosmic Horror both appear inside it.

---

## Phase 14 — Filter reorganization: main view vs. Advanced, with user-pinnable sliders

Third installment of the sequenced UX pass. The user's ask: whichever filters are most relevant to most people should be visible without opening Advanced Filters, with everything else staying there — and, as an explicit "would be good" option, letting each person choose which of the specialized sliders they personally want pinned to the main view.

**What moved out of Advanced, unconditionally, for everyone:** Genre/Type chips, the Owned/Not-owned toggles, and the Gold/Silver/Bronze tier checkboxes (added in Phase 12). These are the filters almost any user reaches for regardless of taste — genre and ownership are universal, and tier filtering is the direct payoff of the favorites system just built. **What stayed in Advanced:** TV Structure, Content Rating, the 15 specialized index sliders (Soundtrack, Scariest, Iconicness, etc. — genuinely more niche/power-user), Year range, and the strict-AND checkbox.

**Pinning, the customizable half of the ask.** Rather than duplicate a slider in two places (real risk of the two copies drifting out of sync, extra event-wiring complexity), pinning **moves** a specialized-index slider from the Advanced list to a new always-visible row above it — there is only ever one live DOM element per index, so `state.idx[k]` never needs reconciling between two inputs. Implementation: `PERSONAL_PROFILE.pinnedIdx` (an array of index keys) drives which of `INDEX_DEFS` render in `#pinnedMainSliders` (new container, hidden when empty) versus `#indexSliders` (the existing Advanced list, now filtered to exclude whatever's pinned). A 📌 button on every slider's label toggles membership via `togglePinIdx()`, which persists straight to `localStorage.omniLedgerProfile` (syncing through the existing cloud-account layer for free) **without a full page reload** — unlike the tier toggles or other profile edits, which reload deliberately, a UI preference like "which slider is pinned" doesn't need that, so it got its own lighter `mutateProfileNoReload`-style path that just re-renders the two slider containers and keeps the live `state.idx` values intact across the move.

**Advanced's filter-count badge (`syncAdvCount`) was updated** to stop counting genre/owned/tier, since a filter no longer living inside the collapsed panel has no business being counted as "how many things are active in there."

**Testing.** New checks: genre/owned/tier are actually visible without a click on Advanced Filters; pinning a slider moves it (not duplicates it) and preserves its current value; the pinned choice is saved to the profile; unpinning moves it back and hides the now-empty pinned row.

**Not done here, deliberately:** no attempt to guess or auto-suggest "smart" pins based on usage — the user asked for a way to choose, not an algorithm that chooses for them. If a majority of people end up pinning the same 2-3 sliders in practice, promoting those to always-on-by-default would be a reasonable future tweak, but that's a decision to make from real usage data, not upfront guessing.

---

## Phase 15 — "Pick Your GOATs" folded into the GOAT Profile tab

Fourth installment of the sequenced UX pass, and the one that removes the last piece of "a separate weird tab" the user called out: a full-screen modal reachable from its own header button, disconnected from the GOAT Profile view it was building data for.

**What changed.** The header's "★ Pick Your GOATs" button is gone. In its place, the top of the GOAT Profile tab now has a real search box (`#goatSearchInput`) with live inline results (`#goatSearchResults`) — search, see matches, tier or mark-owned right there. Each result row reuses `tierRowHTML()` verbatim, the exact same compact Gold/Silver/Bronze/Owned control every card in the results grid already has, wired through a new delegated click handler scoped to `#goatSearchResults` (mirroring the one `#grid` already had) rather than inventing a second tiering UI to maintain. The rest of the GOAT Profile tab — declared canon, Taste DNA, generated recommendations — sits right below it and updates the moment a tier changes, since they're all driven by the same profile-reload cycle.

**The old modal wasn't deleted outright.** `#goatPickerGate` (search → stage several → finalize once) still exists and still powers the first-run onboarding gate's "Search & pick your GOATs" option, where batching several picks before any profile exists is a better fit than tiering one at a time. Only the header button that reopened the *same* modal for ongoing, day-to-day use is gone — that's the specific thing the user meant by "its own tab and weird," since it was disconnected from the GOAT Profile view it fed into. Left the onboarding path alone rather than touching a delicate first-run flow while chasing an unrelated ask.

**A real UX bug surfaced by moving tiering somewhere new.** Every tier/own toggle calls `mutateProfileAndReload()`, a genuine full `location.reload()` (the scoring pipeline needs a full recompute, not a patch). That was invisible before because the only place to tier something was the results grid on Global Controller — the default view anyway, so reloading back to it was unnoticeable. The instant tiering became reachable from the GOAT Profile tab too, that same reload would silently dump the user back on Global Controller, losing their place. Fixed by having `mutateProfileAndReload` stash `state.view` in `sessionStorage` right before reloading, and having the boot sequence's final `switchView` call check for and consume that flag instead of always defaulting to `'controller'`. General fix, not special-cased to the GOAT tab — anywhere tiering becomes reachable from in the future gets this for free.

**Testing.** Replaced the old header-button-driven GOAT Picker test (its target no longer exists) with one exercising the real replacement: search returns results inline, declaring Gold from a result toggles the profile (checked as a toggle, not an assumed false→true transition, since the search result might already be a default Gold favorite), and — the regression that matters most here — tiering from the GOAT Profile tab returns to the GOAT Profile tab after the reload, not Global Controller.

---

## Phase 16 — Shared suggestion box (Firestore-backed)

Fifth installment of the sequenced UX pass: "a place on the main page to submit suggestions to make the application better." The user's explicit choice (asked directly, since it changes the shape of the feature): a shared Firestore collection, once cloud accounts are on — not a private per-user note, not a mailto link.

**What it is.** A "💡 Suggest a feature" header button (next to 🌙 Tonight) opens a modal: a textarea, a Submit button, and a live list of everyone's prior suggestions underneath, newest first. Every visitor with cloud accounts configured sees the same shared list — it's explicitly a feed, not private feedback to whoever set up the app.

**Where it lives.** A new top-level `suggestions` Firestore collection, separate from `profiles/<handle>`. Suggestions aren't personal taste data nested under one account; they're a shared feed anyone contributes to and everyone reads, so a flat collection with `.add()` (auto-generated doc IDs) is the natural fit — no need to read-modify-write a single array under contention from multiple people submitting at once, which a nested-under-profile design would have required. Each document: `{text, handle, createdAt}` (server timestamp when available, so ordering doesn't depend on local clocks).

**Reused the existing cloud plumbing instead of duplicating it.** `acct-boot` already owns the one Firebase connection (`fsdb`) and the resolved handle; rather than have the suggestion-box code (which lives in the separate `ledger-app` script) reinitialize Firebase or track its own connection state, `acct-boot` now exposes `window.__omniAcct()` — a getter (not a snapshot) returning `{fsdb, handle, configured}` fresh on every call, since `handle` only resolves after the async account-gate flow completes. Any future feature needing the same Firestore connection can reuse this instead of wiring its own.

**Graceful when cloud isn't configured.** The button still opens the modal — it doesn't just silently do nothing, which would look broken — but the list area explains that cloud accounts aren't set up on this copy yet and points at this section of NOTES.md, and Submit shows the same explanation instead of a confusing Firestore error. This matters because `index.html` ships with cloud accounts unconfigured by default (see "Cloud accounts" below); most people opening a fresh copy will hit this path first.

**The now-familiar bug class, checked before it could happen.** `#suggestBtn` has the exact same shape as `#tonightBtn` and the old `#goatPickerBtn` before it — a `.navBtn` for visual consistency with the real view tabs, but no `data-view`, meaning a naive click handler would bubble into `#nav`'s delegated `switchView(undefined)` and hide the whole page underneath the modal (see Phase 11's account-menu note and Phase 15's writeup for the first two times this exact bug was found). Added `e.stopPropagation()` in the button's own handler from the start this time, and wrote the regression test *before* treating the feature as done, on both the no-cloud run (view intact after open/close) and the mocked-cloud run (view intact, submission round-trips through the list).

**Testing.** Extended `test/smoke.js`'s `MOCK_FIRESTORE_SDK` — it previously only mocked `collection(name).doc(id).get()/.set()` (enough for the per-handle profile doc) — to also support collection-level `.add()`, `.orderBy()`, `.limit()`, and `.get()` with a `forEach` callback, matching the real Firestore query surface `loadSuggestions()` actually calls. New checks: the box opens without cloud configured and explains why rather than failing silently; opening/closing it (both with and without cloud) never corrupts the underlying view; with mocked cloud, submitting writes to the mock collection, the new entry appears back in the rendered list, and it's attributed to the signed-in handle.

**Not done here, deliberately:** no moderation, upvoting, or status tracking (planned/done/declined) on suggestions — the ask was "a place to submit suggestions," not a full feature-request tracker. No de-duplication of near-identical suggestions. Both are reasonable follow-ups once there's an actual backlog of real submissions to see what's needed.

---

## Phase 17 — Version history, summarized for actual users

Sixth installment of the sequenced UX pass: "I like the version history too, just make it easy to understand for users and simple and summarized." The existing changelog was accurate but written for a developer reading a diff — dense, technical bullet lists (CSS specificity, cascade order, `console.assert`, corpus counts) that most people opening the app would bounce off of.

**What changed.** Every `CHANGELOG` entry now carries a `summary` field — one short, plain sentence describing what a normal user would notice, e.g. "Added Gold/Silver/Bronze favorite tiers, visible and toggleable right on every card." That's what renders by default. The original detailed bullet notes (kept verbatim — they're real project history and still useful) sit behind a per-entry "Show full details" toggle, so nothing was deleted or dumbed down, just given a better default view. All 18 existing entries got a written summary, back to 0.8.0.

**Deliberately not touched:** the underlying `notes` arrays and their technical voice. This is documentation of real engineering decisions (bugs found, why a fix works the way it does) that's valuable for exactly the audience it was already written for — future me, or anyone reading NOTES.md-adjacent history. The summary is an additional, friendlier front door, not a replacement.

**Testing.** New checks confirm the version log opens, the latest entry shows a non-empty summary, and — the important one, given the exact "class toggled but nothing changes on screen" bug the v1.9.1 combo-dropdown fix was about — that clicking "Show full details" actually changes the details element's rendered height, not just its class list.

---

## Phase 18 — "New here?" quick tips banner

Seventh installment of the sequenced UX pass: "indicators on how to use the app would be good like so people know where to click to get more info." A handful of `title` tooltips already existed on individual elements (the card's micro-stats, its title), but tooltips only help someone who's already hovering — they don't tell a first-time visitor that clicking the card body itself does anything, or that the row underneath it is interactive.

**What it is.** A dismissible banner (`#quickTips`) at the top of Global Controller, shown by default, with four short lines: cards expand on click, the compact row under each card tiers/owns without expanding first, sliders can be pinned from Advanced Filters onto the main screen, and where to find "Suggest a feature." One ✕ dismisses it permanently — the dismissal is stored in `localStorage.omniLedgerTipsDismissed` and added to the same `TRACKED` list that theme/density/watchlist already sync through the cloud-account layer, so dismissing it on one device keeps it dismissed everywhere that account signs in.

**Why a banner instead of a guided tour or per-element callouts.** A step-by-step tour needs maintaining every time a feature's location changes (it would already be stale after Phases 12-17 moved half the filter panel around); a banner naming the actual current affordances in plain language doesn't have that failure mode, and it's one dismiss action instead of clicking through several tour steps. It's also honest about being skippable — someone who already knows the app closes it once and never sees it again.

**Testing.** Confirms the banner is visible on a fresh profile, that dismissing it actually hides it (checked via rendered height, not just class presence — see the v1.9.1 note on why that distinction matters here) and persists the dismissal, and that the dismissal survives a page reload.

**Not done here, deliberately:** no re-showing logic tied to new feature releases ("look, something new!") — that's a reasonable idea for later but a different feature (more like a changelog spotlight) than "explain the basics once."

---

## Phase 19 — README rewrite for a general audience

Eighth and final installment of the sequenced UX pass: "the readme should be sure to explain everything there is to know but also be very readable and digestible for anyone." The old README was accurate and thorough but written the way a developer documents a project — a dense feature table up top, technical asides (Tailwind compilation, `console.assert`, CDN dependency tables) interleaved with things a first-time user actually needs, and no clear "start here" path for someone who just wants to open the thing and use it.

**What changed.** Full rewrite, same underlying facts, different shape and voice:
- Opens with what the app actually does in one plain paragraph, no jargon, before any structure or tables.
- A "The short version" section right up front — four sentences that are genuinely all most people need.
- The feature tour is still a table (it's the clearest format for that content) but every entry is reworded in plain language, and it now includes recent additions (the suggestion box, Gold/Silver/Bronze tiers with their own explanatory section, the "why this was recommended" note).
- Cloud accounts, privacy, and "getting it running" are each explained in terms of what a non-technical reader needs to decide or do, not how the mechanism works internally.
- All genuinely technical content (API keys, CDN dependency, `localStorage` mechanics, the test suite) is consolidated into one clearly-labeled section at the very end, so a casual reader can stop before it and a technical reader can jump straight to it.
- The privacy section was reworded to make the actually-important point clearer: this specific copy has one real person's real data baked in as a knowing, consented-to example, but a fresh copy of the repo before anyone signs in carries only that example — nobody's own data goes into the source file.

**Also fixed in passing:** `PROFILE_TEMPLATE.md`'s field reference table was missing `bronzeTierIds` (Phase 12) and `pinnedIdx` (Phase 14) — both real, working profile fields that had simply never been added to that document when they shipped. Added both with the same field-by-field format as everything else there.

**Deliberately not rewritten:** `NOTES.md` itself keeps its existing developer-log voice — it's written for whoever maintains this next (possibly future me), not for a first-time user, and rewriting it in "anyone" language would make it worse at its actual job. The README is the front door; this file is the engineering record behind it.

---

## Phase 20 — Redesigned the default 5 quick filters

Part of a second, broader UI-cleanup round the user asked for after using the app for a while: the GOAT page felt cluttered, the always-visible slider row wasn't the most useful default set, the Tonight tab was redundant with Surprise Me, the sample profile needed clearer labeling, and several tabs needed a general polish pass for both desktop and mobile.

**This phase: the 5 quick filters.** The user asked directly whether Technical Fidelity and 4K Reference were the same thing (they're not — Fidelity is overall craft execution, 4K Reference is specifically how good something looks as a reference-quality disc) and proposed a better default 5: Technical Fidelity/Engine, GOAT Match, 4K Reference, Soundtrack/Audio, and Cosmic Horror. Atmospheric Dread/Immersion and Ontological/Systems Complexity — 2 of the previous default 5 — move into Advanced Filters under a new "More Craft Thresholds" heading; they're unchanged in every other way, just not pre-selected as the top 5 anymore.

**Implementation note:** 4K Reference and Soundtrack are 2 of the 15 already-pinnable specialized indices (Phase 14), not separate hardcoded sliders like Technical Fidelity/GOAT Match/Cosmic Horror are. Rather than build a second mechanism, a `DEFAULT_PINNED_IDX=['ref','snd']` constant now seeds `pinnedIdx` for any profile that's never touched pinning itself — so the always-visible row is 3 hardcoded sliders plus whatever's pinned, and a fresh profile's default pin selection happens to be exactly the 2 the user wanted. Anyone who's already pinned or unpinned anything keeps their own exact choice; this only changes what a profile starts with. The main-row markup for the pinned sliders now renders with `display:contents` inside the same grid as the 3 hardcoded ones, so they visually read as one unified 5-column row instead of two separate boxes.

**Testing.** Updated the existing pin/unpin regression test, which had hardcoded "snd" as its pin/unpin target — now default-pinned, so pinning it wouldn't have exercised the toggle at all. Switched the test to a still-not-default-pinned index ("icon"), and added a new check that Soundtrack and 4K Reference actually are pinned by default on a fresh profile.

---

## Ideas / next steps

Roughly in order of value:

1. ~~**Make it genuinely offline.**~~ Done — see "Made genuinely offline: Tailwind compiled and committed" above.
2. ~~**A "tonight" picker.**~~ Done — see Phase 5 above.
3. ~~**Refresh the contenders ledger on an actual schedule.**~~ The tracking infrastructure (Phase 8) plus a real run of it (Phase 9: 20/50 now verified, up from 7) are both done. Still no true automation (impossible in a static file) and 30 entries remain unverified — always will be to some degree — but it's trackable and the runbook works, proven by actually using it.
4. ~~**Cross-medium pairings.**~~ Done — see Phase 6 above.
5. ~~**Split the dataset out of `index.html`.**~~ Done — see Phase 8 above and the decision note above for the `file://`/CORS reasoning.
6. **Raise data provenance.** Replace estimated scores with sourced ones where possible; the provenance flag already tracks which are which. Still open — the `PROV_CEIL` mechanism correctly flags anything past the original hand-scored ledger as "curated estimate," which is honest, but doesn't replace any of those estimates with real sourced figures.
7. ~~**Export/import of `localStorage`.**~~ Done, fully — see Phase 5 above. Export/Import now bundle `omniLedgerWatchlist`, `omniLedgerTheme`, and `omniLedgerDensity` alongside the profile; a single exported file is a complete snapshot of a person.
8. ~~**A real "blank first run" for a friend's copy.**~~ Done — see Phase 3 above. First load in any browser now asks (quick-rate / search & pick / sample / blank / import) via a blocking gate rather than silently inheriting Payton's defaults.
9. ~~**Genericize `goatProfile.recs`.**~~ Done for Movies/Books/TV Series/Video Games (Phase 4) and for Directors (Phase 5, genuinely computed from corpus filmography). Actors/Composers/Cinematographers are corpus-linked where possible (Phase 7); Music Artists/YouTube use genre+vibe overlap (Phase 5, refined Phase 8) since no corpus category exists to link them to.
10. **Finish the creator/composer/cinematographer/artist dataset.** Actors are now 10/10 corpus-linked (Phase 9, most averaging multiple real films). Composers and Cinematographers are still at Phase 7's level (7/10 and 9/10, single work each) — the same multi-work deepening Phase 9 did for Actors hasn't been done for them yet, and would be similarly tractable. Music Artists and YouTube still can't be corpus-linked at all — the corpus has no music-album or video-essay category. A full fix for those two needs either a new corpus category (a real scope increase) or a structured per-person discography/filmography record in the shape of the existing 80-entry Creator Archives.
11. ~~**Bundle the watchlist/theme/density keys into Export/Import too.**~~ Done — see item 7 above.
12. ~~**In-app profile editor: reach parity with the full `PERSONAL_PROFILE` schema.**~~ Done — see Phase 7 above. Every field except `cosmicHorrorCanon` is now click-editable.
13. ~~**Reconcile released/cancelled contenders into the scored corpus.**~~ Done for the 3 that had released — see Phase 7 above. The Phase 8 refresh runbook (item 3 above) is now the documented trigger for doing this again the next time something ships.
14. ~~**Committed test suite.**~~ Done — see Phase 6 above and Testing below.
15. **Expand the corpus further.** Phase 7 took it from 1,300 to 2,502 works; Phase 9 to 2,508 (1,000 movies, 250 TV, 258 games, 1,000 books). There's no natural ceiling here — more real, well-researched entries always raise recommendation quality, especially for niche genres/eras still thin in the corpus. Now cheap to do incrementally since Phase 8 split the corpus into `data/*.js` — no more regenerating `share.html` for a data-only change.
16. ~~**Automate the duplicate/schema check Phase 7 did by hand.**~~ Done — `scripts/validate-corpus.js` (no browser needed) checks all four corpus arrays for duplicate IDs, duplicate titles (case-insensitive), and required fields; `npm test` runs it before the Playwright suite.
17. ~~**Add a "◯ Not yet spot-checked" filter to the Contenders Ledger.**~~ Done — see Phase 9 above (`#contUnverifiedOnly` checkbox next to the sort controls); used it during the Phase 9 refresh pass itself.
18. **A real cast/crew schema** (actors per film, not just directors) — Phase 9's multi-work linking raised Actors fidelity within the existing schema, but a true fix (real filmography data, not spot-verified well-known credits) would still unlock richer Cross-Medium Pairings and extend the same treatment to Composers/Cinematographers.
19. **Auto-flag passed release windows on unambiguous dates only** — done this phase (`parseWindowDate`/`isPastWindow`), but the majority of ledger entries use vague windows (a bare year, "TBA") that can't be auto-checked. Encouraging more precise windows as they firm up (which the refresh runbook naturally does) widens what the auto-flag can catch over time.

---

## Testing

`test/smoke.js` (Phase 6) is now committed and real — a Playwright suite run against `index.html` (`share.html` retired, see "One file, not two" above): syntax check, onboarding gate paths, all 10 views render, filter/search/slider narrowing, reset, combo-dropdown open/close/select/scroll regressions (checking actual rendered visibility, not just the `hidden` class — see Phase 11's dropdown-fix writeup for why that distinction matters), the GOAT Picker's search-stage-cancel round trip, the cloud-account flow against a mocked Firestore, and a mobile-viewport horizontal-overflow check. Run with `npm test` (needs `playwright-core` and a local Chromium — see README's "Running the regression suite"). It auto-detects a Chromium build via `PLAYWRIGHT_CHROMIUM_PATH` or common install locations, so it isn't hardwired to any one machine.

Ad hoc jsdom checks (data integrity, filter behavior, DOM state after simulated clicks) are still useful for quick iteration and don't need a browser — the old approach (jsdom with `runScripts: 'dangerously'`, stub `Chart`/`requestAnimationFrame`/`URL.createObjectURL`) still works and was used throughout Phase 6 development, just never committed since it's redundant with what `test/smoke.js` now covers end to end.
