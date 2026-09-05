# Corpus & engine quality pass — working state

The live state of a multi-session effort to audit and improve both the corpus data and the
scoring engine that reads it. `NOTES.md` is the historical log of finished work; this file is the
current one, and it is deliberately written so a session that has never seen the others can pick
it up cold. Update it at the end of every phase.

**Owner:** Payton. **Branch:** `claude/omni-media-ledger-audit-mrsljq`.
**Status:** Phases 0-2 complete. **Plan restructured (decision 12):** corpus-wide scoring moved into Phase 5 to run alongside fact-gathering; Phase 3 reduced to the new fields on the owned set. Phase 1 delivered `RUBRIC.md` v1 with **seven** constructs (four
original, plus `emotionalWarmth`, `comicIntent`, `aestheticBeauty`); no open interpretations.
Phase 2 landed E2, E5, E6, E7 and closed; its last two items are deferred on measurement (see
below). **Phase 3 is next and is now the bulk of the work.** PR #32 is open on this branch.

---

## Why this exists

The app's whole value is that it matches a library to a person's taste. That output is only as
good as the data behind it and the engine that reads it, and neither had ever been audited. A
measured investigation (Phase 0, below) found that the single strongest predictor of a work's
match score is **when it was added to the file** — which means the recommendations were largely
reflecting the corpus's import history rather than anybody's taste.

---

## Hard rules this pass runs under

These are the owner's, and they are not negotiable. A future session must follow them.

1. **Never state a fact about a work from memory as if it were verified.** Recalled years,
   runtimes, page counts and credits are frequently wrong and always confident. Every factual
   change records how it is known. Where uncertain, **flag rather than edit** — 200 flagged
   records beat 2,000 quietly "corrected" ones. `NOTES.md` Phase 10 documents three real cases
   where confident recall was wrong (*Ozark*, *Deadwood* conflated with the film, *Inglourious
   Basterds*). Model recall is evidence grade C and is **never** written to the corpus.
2. **The current index values are not a trustworthy baseline.** Nobody ever checked them against
   a rubric. Do not anchor on them or assume they need only nudging.
3. **Do not touch `PERSONAL_PROFILE`** (`declaredGoatIds`, `silverTierIds`, `creatorBoost`,
   `genreBoost`, `vibeBoost`, `bookAffinity`, `ownedMedia`…). That is the owner's taste, not data
   quality. Tuning it to improve the numbers is fitting the answer to the test. Raise concerns
   about a weight; let the owner decide.
4. **No unrequested scope bundled into a working change.** Added scope has broken this repo twice.
5. **Small, reversible, reviewable batches**, each its own commit. No wholesale regeneration of a
   field — that destroys hand-curated judgement.
6. **Measure, don't assume.** Snapshot derived values before and after every batch and show the
   diff. Applies to engine changes exactly as much as data changes.
7. **Checkpoint with the owner.** Surface judgement calls in batches as they arise.
8. **`npm test` stays green, with zero validator warnings**, or the new warning is justified out
   loud.
9. **Beware substring matching.** Creator boosts use `String.includes`; genre boosts matched
   substrings of the joined genre string. Two past bugs came from this. Prefer exact matches.
10. Never put a genre-family name in a `genres` array. Keep the hot path linear in corpus size.

---

## Decisions made (owner-approved — do not relitigate)

| # | Question | Decision |
|---|---|---|
| 1 | Plan and phase order | **Approved** as written below. |
| 2 | Are `atmosphericDreadIndex` and `immersionTensionIndex` one construct? | **No — two separate constructs.** |
| 3 | Are `ontologicalComplexity` and `systemsComplexity` one construct? | **No — two separate constructs.** |
| 4 | What does `physicalMediaFidelity` mean? | Delegated. **Decided:** `transferFidelity` + `audioSoundscape` = *quality of the best available release* (legitimately era-dependent; corr with year 0.43 / 0.60). `cinematographyScore` = *the photography as artistic achievement* (era-neutral; corr with year 0.01). Consequence: `gm`'s craft term must use the **era-neutral** component, or the match score penalises old films for lacking a 4K master. `tech` stays as-is for the Technical Craft filter and `ref`/`snd`, where the blend is correct. |
| 5 | Compound genres: one boost or several? | Delegated. **Decided: exact tag matching, one boost per matching tag.** Today `Historical Epic` collects +7 while `Sci-Fi Horror` collects +5, purely because of which keywords appear as substrings of the tag's *name*. **Sequencing:** this must ship in the same commit as the Phase 4 vocabulary split, or it silently drops boosts from 247 compound-tagged works. |
| 6 | Should Bronze do anything? | Delegated. **Decided: Gold 100 > Silver 88 > Bronze 84 > Owned 80**, tier applied after ownership, taking the max. Today Owned (82) beats Bronze (80) below gm 86.7, so Bronze is a no-op on owned works. Ownership is the weakest signal — you own things you haven't decided about. |
| 7 | Is the owned list real? | **Confirmed by the owner: every work marked owned in the Payton account is physically owned.** 179 works (84 film, 9 TV, 1 game, 85 book). |
| 8 | Owned works are priority | **Yes.** The Payton account is also the shared sample others start from, so its 179 works are first in line for both fact verification and calibration. |
| 9 | Blank profiles must be unbiased | **Requirement.** A new user's results must mould to their own picks, not inherit Payton's taste. See the blank-profile finding below — this is a *corpus* problem, not a profile problem. |
| 12 | Where does corpus-wide scoring happen — Phase 3, or with the facts in Phase 5? | **Phase 5, merged with fact-gathering.** Owner: *"scoring it is a part of that… I don't wanna score all 2,508 without getting cumulative scores from the internet."* Two reasons, and the second is decisive. (a) Evidence improves judgement: Letterboxd/TMDB keyword tags, IMDb Parents Guide severity, cinematography and comedy award categories, and critic-consensus text are all real evidence for the rubric constructs, and none of it is available offline. (b) **Recalibration must be all-or-nothing.** Today's drift is roughly uniform — every batch is internally consistent and wrong by a different offset. Recalibrating a 179-work subset to rubric-v1 while 2,329 works keep their old scales creates a *mixed-scale* corpus, which is worse than uniform drift, because cross-comparisons between the two halves become meaningless in a new way. **Phase 3 therefore reduces to: the three NEW fields on the owned set only** (safe to do partially — unscored is honestly unscored, not mixed-scale). |
| 13 | What must be finished before Phase 5 can start? | Owner: *"I want to make sure all of the phases up until the point of needing the internet are done completely and as good as they can be."* So: new fields on the 179 owned works; Phase 4 in full (vocabulary + exact genre matching + the E1 `certify()` fix that ends *Outer Wilds* being rated `M`); Phase 6a (the provenance mechanism, stamped later as facts land); Phase 7a (structural invariant tests); and **the Phase 5 harness itself** — fetchers, reconciliation, evidence format, review queue — written offline against documented API shapes so that going local is push-button rather than a build project, and so no API quota is spent debugging. |
| 11 | Also promote humour and beauty? | **Yes — do it once, properly.** Owner: *"we should do it right the first time and ensure that it will be the absolute best for anyone who decides to use it."* `comicIntent` and `aestheticBeauty` join `emotionalWarmth` as scored fields (RUBRIC.md constructs 6 and 7). Both were derived-only and structurally blind: `funny` is *genre contains comedy* plus audience score, so a witty drama scores as humourless; `awe` blends craft with a genre bonus, so it measures spectacle, not beauty, and says nothing about books. **Three new fields x 2,508 records** — scored together per work in Phase 3, since the judgements interact and making them side by side is what keeps them independent. |
| 10 | All four core constructs were "dark" axes — add a warmth construct, or just re-score the derived light indices? | **Decided: add the real thing.** `emotionalWarmth`, a new raw scored field across all four media (RUBRIC.md construct 5). Owner: *"this originally started as an app just for me so it is skewed in favor of the things I was looking for… if I want it to be available to everyone and work for everyone best there should be everything in the system… mine should still be reflected properly because if it works for everybody it will and should still work for me."* Re-scoring `cozy`/`funny`/`emo` was rejected as the cheap option: they are computed *from* the dark axes and inherit the same blind spot. **Schema change on 2,508 records** — scored in Phase 3, wired into validator/adapter/`gm`/sliders in one commit once complete. Half-populating it would be worse than not having it. |

### Still open

- **Canonical score source per medium.** Evidence says the corpus already mixes scales: films
  track **RT Tomatometer %** (14 films at exactly 100; *Rain Man* is 86 against RT 88 / Metacritic
  65), games track **Metacritic** (max 97, no 100s). `gm` adds them together as if identical, so a
  film at 95 and a game at 95 are not comparable. Recommendation put to the owner: RT for film/TV,
  Metacritic for games, and **stop presenting books' `criticalScore` as sourced** (most books have
  no critical aggregator at all). `gm` should normalise per medium before combining. **Not yet
  answered.**
- **Convert `ownedBookIdCeiling: 51` into an explicit list.** 51 of the 85 owned books are owned by
  a *positional rule* (`id <= b51`), so inserting any book below b51 silently marks it owned — the
  same ID-derived fragility as `prov`. Owner confirmed the 51 are genuinely owned; the conversion
  itself is still to do (Phase 6).

---

## Phase 0 findings (measured, reproducible, confirmed against the real app)

Reproduce with `node scripts/corpus-metrics.js --snapshot <snap.json>`.

### The headline

- **`corr(gm, id number)` is about −0.6 on every medium** (movies −0.591, TV −0.578, games −0.627,
  books −0.594). When a work was added to the file is the strongest predictor of its match score.
- The original hand-scored ledger (`id <= PROV_CEIL`) is **26.3% of the corpus but holds 94 of the
  top 100** by `gm`, and 334 of the top 500.

### Why the drift reaches the score

- `gmBase` (craft + reception) has **sd 2.82**; the boost stack has **sd 6.52**. So **84% of
  pre-override score variance is the boost stack**, and three of those boosts are bare thresholds
  (`myst>70`, `tech>85`, `dread>80`) on exactly the fields that drifted.
- **545 works (22%) collect no boost at all** and are locked to gm 45–61 permanently.
- Creator boosts reach only 165 works; author boosts 106.

### Batch drift, mean by ID decile

| field | spread |
|---|---|
| `tvShows.atmosphericDreadIndex` | **68.2** (82.1 → 13.9) |
| `movies.atmosphericDreadIndex` | **54.0** (82.3 → 28.3) |
| `tvShows.ontologicalComplexity` | 53.8 |
| `videoGames.immersionTensionIndex` | 44.6 |
| `movies.ontologicalComplexity` | 40.6 |
| critic / audience scores | only 5.7–15.1 — consistent with being real sourced values |

### Blank profile — the unbiased-start requirement is currently not met

On a profile that has declared nothing:

- `gm` collapses to **29 distinct values across 2,508 works** (318 tie at 57, 317 at 56).
- Recency bias gets **worse**: TV −0.736, games −0.724.
- **95 of the top 100 still come from the original 26% block.** The blank top-10 films are Blade
  Runner 2049, 2001, Stalker, Inception, Arrival, Dune: Part Two — Payton's taste, served to
  someone who declared nothing.
- **Not fixable from `PERSONAL_PROFILE`.** With no profile the only thing that varies is three
  thresholds on drifted fields. It is corpus-level bias; Phase 3 is the only thing that touches it.

### Cohort separation — decides calibrate vs re-score, per field

Does the field still separate works that obviously differ (horror vs comedy on dread) *inside*
each import batch? Strong everywhere ⇒ the ordering is real judgement and only the scale drifted,
so **calibrate** and preserve the signal. Weak ⇒ closer to noise, so **re-score**.

| field | min separation | verdict |
|---|---|---|
| `movies.atmosphericDreadIndex` | 21.4 (all 10 cohorts) | **Calibrate** |
| `movies.ontologicalComplexity` | 22.2 | **Calibrate** |
| `books.atmosphericDreadIndex` | 14.0 | **Calibrate** |
| `tvShows.atmosphericDreadIndex` | **1.7** | **Re-score** weak cohorts |
| `books.ontologicalComplexity` | **1.6** | **Re-score** cohorts 2–5 |
| `videoGames.immersionTensionIndex` | **1.3** | **Re-score** weak cohorts |

TV is the worst medium overall (dread spread 68.2, complexity 53.8, fidelity fields 31–41).

### Engine defects found

| # | Defect | Evidence |
|---|---|---|
| E1 | Games' `immersionTensionIndex` flattened into the `dread` slot and `systemsComplexity` into `myst`; **8 consumers** read them as dread/ontological — `certify()`, `ch`, `scary`, `shock`, `cozy`, `reality`, the `dread>80` boost, and the filter sliders | **Outer Wilds, Return of the Obra Dinn and Subnautica are all rated `M`**; 134 of 258 games are `M`. Decision 2/3 makes this a real defect |
| E2 | `dread>80 && dread<=95` band cliff | The 16 highest-dread works get **zero** dread boost (The Shining 97, Hereditary 99, The Thing 98, Come and See 99); a dread-95 work gets +1.8 |
| E3 | Compound genre strings collect two boosts | 247 works stack 2–3. See decision 5 |
| E4 | Books double-count idea density | `ideaDensity` ↔ `ontologicalComplexity` **r = 0.85**; one feeds `tech`, the other `myst` |
| E5 | `computeMatch` weights filter dimensions by their hardcoded order in `activeDims()` | `★ GOAT` outranks everything only because it is listed first |
| E6 | Bronze is a no-op on owned works | See decision 6 |
| E7 | `certify()`'s "heavy" film test is a hardcoded title regex | `/^(the thing\|hereditary\|come and see\|possession\|oldboy\|se7en)/` |
| E8 | `prov` is decorative | 661 "verified", of which **3** owe it to ownership; the rest is `id <= ceiling`. Confounded with score (corr −0.6). `NOTES.md` Phase 10 records *Casablanca* and *Rififi* as both `verified` **and** wrong |
| E9 | Book recommendations are not generated | All 10 are `bookAffinity` floor overrides — the top of a hand-typed dictionary read back |
| E10 | `buildGeneratedRec` excludes owned and Gold but **not** Silver/Bronze | Latent: re-recommending declared favourites |
| E11 | Cross-medium score scales are incompatible | See "Still open" above |

---

## The plan

Phase 0 is done. The rest in order. The **golden set is captured continuously from Phase 1
onward**, while the owner is making the calls — not reconstructed at the end.

- **Phase 0 — Instrumentation. DONE.** `scripts/score-snapshot.js` (derived-value snapshot + diff,
  read from the real app via `window.ALL`, `--profile pk|blank`) and `scripts/corpus-metrics.js`
  (drift, separation, recency bias). Commit `ba147b6`.
- **Phase 1 — `RUBRIC.md`. DRAFTED, AWAITING SIGN-OFF.** Commit `f4cfa5d`. All four constructs
  defined separately with "this is NOT" lists; five proposed anchor works per index; the derived
  indices' hand-tuned override tables brought under the same rubric.
  **Blind self-test, pass 1 done** (20 films, stratified across all ten ID deciles, current values
  withheld until after scoring): mean absolute difference from the current corpus **9.9 points**,
  13/20 within 10, 4/20 moved 20+. The important result is the direction — early deciles scored
  **lower** under the rubric (−8 to −15.5) and late deciles **higher** (+5 to +12.5), i.e. applied
  blind, the rubric moves scores the way that *reduces* batch drift. n=2 per decile, so suggestive
  rather than conclusive.
  **Still outstanding:** (a) the owner's ruling on the anchors and the five open questions in
  RUBRIC.md; (b) reproducibility pass 2 — must run in a **fresh session**, since the session that
  did pass 1 remembers its answers and cannot re-score blind. Target ±5 on 26+/30.
- **Phase 2 — Cheap engine fixes. IN PROGRESS.** One commit each, repo convention followed (add
  the check, revert the fix, confirm the check fails, restore).
  - **E2 done** (`e31780b`) — the dread boost was a band (`>80 && <=95`), so it rose to +1.5 at 95
    and fell to **zero** at 96: the sixteen most dread-soaked works were the only ones earning
    nothing for it. Now monotonic. 16 works moved, +1/+2 each, nothing else.
  - **E6 done** (`6b03d8d`) — the four tier rungs blended with different weights, so they were lines
    of different slopes and crossed: owned (82) beat Bronze (80) below gm 86.7, making Bronze a
    no-op on anything owned. All rungs now share one weight (parallel, cannot cross) with floors
    carrying the semantics: Gold 100 > Silver 88 > Bronze 84 > owned 80. 99 works moved, all tiered
    or owned.
  - **E5 done** (`3d302d0`) — Match weighted each active filter by its position in `activeDims()`,
    i.e. by source order, so ★ GOAT beat everything by being written first. Now weighted by slider
    value. No stored value moves; the check tests symmetry.
  - **E7 done** (`fe4fe4b`) — `certify()` prefix-matched six hardcoded film titles. Redundant today,
    a trap for tomorrow. **Note the process failure worth remembering:** the first check (rename the
    corpus, re-certify) *passed with the bug restored*, because the corpus contains no case that can
    expose a currently-redundant clause. The working check builds the adversarial case instead.
  - **Both remaining items DEFERRED, on measurement, not preference.** Phase 2 is closed at four
    fixes.

**Why decision 4's era-neutral craft term cannot land yet.** The ruling was sound but was reasoned
from *movie* correlations and I generalised it without checking the other three media. Measured,
`corr(field, year)` moving from the blended `tech` to the era-neutral component:

| medium | blended | era-neutral | verdict |
|---|---|---|---|
| movies | 0.460 | **0.015** | works exactly as intended |
| TV | 0.689 | **0.660** | barely moves |
| games | 0.501 | 0.287 | partial |
| books | −0.018 | **0.170** | *worse* — proseCraft alone is more year-linked than the blend |

TV is the instructive one. Its `cinematographyScore` looks era-linked, but the decile table shows
two cohorts with the *same* mean year (2014) scored **93.0 and 75.8** — 17 points apart. That is
batch drift wearing era's clothes. Switching `gm` to read that field today would bake the drift
into the score under the banner of removing an era bias. The change is right and stays planned; it
must run **after** Phase 3 recalibrates the fields, then be re-measured.

**Why cross-medium normalisation is deferred to after Phase 5.** The RT-vs-Metacritic theory
predicted a large distortion; measured, the reception distributions are far closer than that:

| medium | mean | p50 | p90 | max |
|---|---|---|---|---|
| movies | 87.9 | 90 | 96 | 100 |
| TV | 87.8 | 88 | 96 | 100 |
| games | 87.9 | 88 | 94 | 97 |
| books | 84.7 | 85 | 91 | 98 |

Means agree within 0.1 across the first three. The real difference is in the top decile (movies
reach 100, games cap at 97), so the distortion is modest and concentrated exactly where Phase 5
will re-source the numbers anyway. Normalising now means correcting values already scheduled for
replacement, and would have to be redone against the real ones.

**E1's `certify()` half is also deferred to Phase 3/4**, deliberately. The rubric has settled the
semantics (immersion is absorption, not menace), so reading games' immersion for an `M` rating is
wrong on its face — but what replaces it depends on the games genre vocabulary that Phase 4
cleans. Shipping a half-fix that Phase 3 then redoes is worse than one correct change. *Outer
Wilds* stays mis-rated `M` in the meantime; it is the most visible open defect.
- **Phase 3 — Index calibration / re-score**, per the separation table. The bulk of the work;
  realistically 8–15 sessions. Rubric-implied values computed from each record's own evidence
  **without reference to the current value** (the current value only orders the review queue).
- **Phase 4 — Genre and vibe vocabulary.** 269 genre strings, 109 used once, 162 used ≤3; 763 works
  carry only one genre. 30 vibes, of which `Notebook-and-Theories Night` covers 270 works and
  carries the profile's largest single weight (+8). Ships with decision 5's exact matching.
- **Phase 5 — Facts. THE HARNESS IS BUILT AND TESTED; IT NEEDS KEYS AND NETWORK, NOTHING ELSE.**
  Tier A (machine-checkable, no network, 100% coverage) → Tier B (source-verified, prioritised) →
  Tier C (documented as unverifiable). **Owned 179 first** (`--owned-first`).
  - `scripts/fetch-facts.js` asks OMDb + TMDB (film/TV), OpenLibrary + Google Books (books) and
    IGDB (games) what they hold, reconciles the answers, and writes `evidence/<medium>-<date>.json`
    plus a markdown review queue. **It never writes to `data/`.**
  - `scripts/apply-facts.js` is the only script that edits the corpus, and it applies **grade A
    only** — two independent sources agreeing — by exact-match replacement scoped to the record's
    own line, refusing outright if the value it means to replace is not there exactly once. Dry run
    unless `--write`.
  - Grades: **A** two sources corroborate → applyable. **B** one source, sources disagreeing, or a
    naming-convention field (studio, publisher, network, platform list) → review queue, never
    auto-applied. **C** model recall → *not produced by this harness at all*.
  - Numbers are compared **exactly**; there is no tolerance band. A one-minute runtime difference
    goes to a human, because deciding which small differences don't matter is exactly the judgement
    the harness is not allowed to make.
  - A record earns `prov:{facts:"sourced",…}` when every **hard** fact came back grade A. `indices`
    stays `unscored`: sourcing a runtime says nothing about whether the work was scored against
    RUBRIC.md, and conflating the two would certify a judgement nobody made.
  - `--offline <raw.json>` replays recorded responses through the identical pipeline; `--record`
    captures a live run so it stays replayable. Everything downstream of the network is covered by
    `test/fetch-facts.js` (18 checks, in `npm test`) against a fixture built from real records.
  - **Keys are environment variables only** — `OMDB_API_KEY`, `TMDB_API_KEY`, `IGDB_CLIENT_ID` /
    `IGDB_CLIENT_SECRET`; OpenLibrary and Google Books need none. Every recorded URL passes through
    one redaction chokepoint, tested, because recorded runs are meant to be committed. A missing key
    is not an error: that source is skipped and every field it would have carried drops a grade,
    which the output says out loud.
- **Phase 6 — Real provenance. MECHANISM DONE; the stamps themselves are Phase 5 output.**
  Per-record stamp `{facts: sourced|estimated|edition-dependent, checked: YYYY-MM-DD, src: …,
  indices: rubric-v1|unscored}`, resolved by `provStampOf()` in the adapter, enforced in
  `scripts/validate-corpus.js` (a stamp is optional, but a stamp claiming `sourced` must name a
  `src` and a `checked` date), and covered by a regression check that fails if anything reads as
  verified without a sourced stamp.
  `PROV_CEIL` is gone. It called a work "Verified data" if its ID fell under a per-medium ceiling
  (m≤221, t≤144, g≤158, b≤171) **or** if it was owned — 661 works, badged for having been typed in
  early. `NOTES.md` Phase 10 records *Casablanca* and *Rififi* as `prov: verified` **and**
  factually wrong, which is the whole indictment: the badge measured import order, not truth.
  Ownership no longer implies verified facts either — owning a disc verifies that it is owned, not
  the runtime printed on the back. Every work now reads **○ Unverified estimate** until Phase 5
  stamps it, which is a visible downgrade and an honest one.
  `ownedBookIdCeiling` is converted: the 51 books owned by the old `id≤51` convention are now
  listed explicitly alongside the other 34, 85 in all. The ceiling remains readable from a stored
  profile (defaulting to 0) so a profile saved before this change still loads with its books
  owned.
- **Phase 7 — Harden the recommendation test. DONE for everything that can be checked offline.**
  - `scripts/corpus-metrics.js --assert` is the **Phase 5 acceptance gate**: an itemised,
    executable definition of done. It currently fails with 15 named problems (four recency-bias
    correlations around −0.6, 94/100 of the top from the hand-scored block, and ten index fields
    whose decile means span more than 25 points). It is deliberately **not** in `npm test` — a
    suite that is red on every run stops being read — and gets wired in the moment it passes, so
    the property cannot silently regress afterwards.
  - Recommendations now exclude **everything already tiered**, not just Owned and Gold. Silver and
    Bronze were being recommended back to the user, and tiering *raises* a work's `gm` toward the
    rung's floor, so a Silver pick you don't own outranked untiered works of equal quality. Payton's
    Silver list is nearly all also-owned so it never showed locally; it would hit anyone who tiers
    without owning, which is most people. Covered by an adversarial check (tier a work that *is*
    being recommended, confirm it leaves, confirm un-tiering restores it) plus a diversity floor.

### Leverage order — where effort actually pays

Measured, and it is counterintuitive: **critic/audience scores are the most verifiable and among
the least leveraged.** A 12-point critic-score correction moves `gm` by about 3. The previous
verification campaign spent its whole search budget there.

1. `ontologicalComplexity`, the `tech` triple, `atmosphericDreadIndex` — 84% of score variance
2. `vibeTime` — 758 works boosted; one tag carries +8 across 270 works
3. `genres` — 1,456 works boosted; also drives families, certification, pairings, graph
4. `creator` — narrow reach (271 works) but the strongest per-work signal
5. `criticalScore` / `audienceScore` — ~3 gm points per 12-point correction
6. `runtime`, `pages`, `totalSeasons`, `platformAvailability` — filter-only, ~zero score leverage

### Per-batch verification protocol

Snapshot before → edit → `npm run validate-corpus` → snapshot after → `--diff` → `npm test`.
A batch is accepted only when **every line of the diff is explainable**; anything that moved
outside the batch is a bug, not an improvement.

---

## Environment state

**Fact verification needs network access, and as of the last probe it is blocked.**

- The container's egress goes through a local proxy to a policy-enforcing gateway that answers
  **`403 to CONNECT`**. The local proxy holds no allowlist of its own (`selective: false`,
  `toolScoped: false`) — the refusal is upstream.
- **Blocked:** `en.wikipedia.org`, `wikidata.org`, `openlibrary.org`, `api.themoviedb.org`,
  `www.omdbapi.com`, `api.igdb.com`, `howlongtobeat.com`, `rottentomatoes.com`, `metacritic.com`.
- **Allowed:** `registry.npmjs.org`, `pypi.org`, `github.com`, `code.claude.com`, and
  **`www.googleapis.com`** — so the **Google Books API works today** and needs only a free key
  (anonymous quota is 0). That covers all 1,000 books.
- `WebFetch` rides the same policy and fails everywhere. **`WebSearch` works** — but it returns a
  search engine's *summary* of snippets, not the source page, so it is evidence grade B at best.
- The owner set the environment allowlist to "All domains"; it did **not** take effect in the
  session that was running when the change was made. The policy appears to be bound to a session's
  credentials at creation. **A new session should re-probe first thing.**

**Re-probe on every session start:**

```sh
for h in www.omdbapi.com api.themoviedb.org openlibrary.org api.igdb.com \
         howlongtobeat.com en.wikipedia.org www.wikidata.org; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 12 "https://$h" 2>&1)
  case "$code" in *56*|000|"") echo "  BLOCKED  $h";; *) echo "  ALLOWED  $h ($code)";; esac
done
```

### Evidence grades

- **A — corroborated:** two or more independent results agree. Preferred for any write.
- **B — single-source attribution:** one result attributes a figure to a named aggregator.
- **C — model recall:** **never written to the corpus.** Not under any confidence.

### Sourcing constraints

- **No scraping Rotten Tomatoes or Metacritic** — neither has a public API and scraping breaches
  their terms. OMDb licenses those ratings legitimately; that is the correct door.
- **No API key ever enters the repo.** Keys live in environment variables read by audit scripts
  only. The app itself keeps making zero network requests and needing zero keys.

### Not verifiable even with full network access — for `UNVERIFIABLE.md`

- Every subjective index. No external source exists; the rubric plus the owner's anchors are the
  only ground truth. Consistency is provable, correctness is not.
- Books' `criticalScore` — most books have no critical aggregator.
- `pages`, `runtime`, `averagePlaytime` — edition- and version-dependent. There is no single true
  value (one probe returned both 256 and 224 pages for the same hardcover). The fix is declaring
  which edition the field means, not finding a better number.
- Aggregator scores drift over time, so every one needs a retrieval date.
- The golden set asserts *"Payton's recommendations did not regress"*, not *"recommendations are
  good in general"*. It will not generalise to another profile. Accepted trade for a personal tool.

---

## CI, and a race worth knowing about

CI (`.github/workflows/test.yml`) runs on `pull_request` only, with a `postgres:16` service so
`test/schema.js`'s live layer runs instead of skipping. **To reproduce CI locally**, stand up a
throwaway Postgres and set `OMNI_TEST_DATABASE_URL`; without it the live layer skips and the local
run is strictly weaker than CI:

```sh
mkdir -p /var/lib/postgresql/omnitest && chown postgres:postgres /var/lib/postgresql/omnitest
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/omnitest -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/omnitest -o '-p 5433 -k /tmp' -l /tmp/pg.log start"
OMNI_TEST_DATABASE_URL=postgresql://postgres@localhost:5433/postgres npm test
```

**A CI failure on this branch was traced to a test race, not to any change** (fixed in `a0fc832`).
It is worth recording because it will look like a data or scoring regression if it recurs: signing
in does **not** navigate — `resolveHandle()` fetches, hides the account gate and re-boots in place
— so `clickAndReload`'s marker sees no navigation and `waitForBoot()` returns immediately on the
previous handle's `window.ALL`. The account flow therefore slept `waitForTimeout(500)`, the pattern
ARCHITECTURE.md forbids. Losing that race left the profile uninitialised and surfaced as
**"declaring Gold upserts a row into the media_status table"** — a check three steps downstream, in
code the change had not touched. `signInAndSettle()` now waits on the account gate closing.

## Test baseline

`npm test` is green: validator 0 failures / **0 warnings**, schema static checks pass (live DB
checks skip without `OMNI_TEST_DATABASE_URL`), full Playwright suite passes. Keep it that way.

Local setup needed in a fresh container: `npm install -D playwright-core` (Chromium is already at
`/opt/pw-browsers`). Live DB checks need a throwaway Postgres; `psql` 16 is present.
