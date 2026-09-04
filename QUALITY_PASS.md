# Corpus & engine quality pass — working state

The live state of a multi-session effort to audit and improve both the corpus data and the
scoring engine that reads it. `NOTES.md` is the historical log of finished work; this file is the
current one, and it is deliberately written so a session that has never seen the others can pick
it up cold. Update it at the end of every phase.

**Owner:** Payton. **Branch:** `claude/omni-media-ledger-audit-mrsljq`.
**Status:** Phase 0 complete. Phase 1 drafted (`RUBRIC.md`) — **blocked on the owner's sign-off**
on the anchors and five open questions. Phase 2 onward not started.

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
- **Phase 2 — Cheap engine fixes.** E2, E5, E7, E6, plus decision 4's craft-term change. One commit
  each; repo convention — add the check, revert the fix, confirm the check fails. E1 and E4 wait
  for the rubric. E3 defers to Phase 4 (see decision 5).
- **Phase 3 — Index calibration / re-score**, per the separation table. The bulk of the work;
  realistically 8–15 sessions. Rubric-implied values computed from each record's own evidence
  **without reference to the current value** (the current value only orders the review queue).
- **Phase 4 — Genre and vibe vocabulary.** 269 genre strings, 109 used once, 162 used ≤3; 763 works
  carry only one genre. 30 vibes, of which `Notebook-and-Theories Night` covers 270 works and
  carries the profile's largest single weight (+8). Ships with decision 5's exact matching.
- **Phase 5 — Facts.** Tier A (machine-checkable, no network, 100% coverage) → Tier B
  (source-verified, prioritised) → Tier C (documented as unverifiable). **Owned 179 first.**
- **Phase 6 — Real provenance.** Per-record stamp: `{facts: sourced|estimated|edition-dependent,
  checked: date, src: …, indices: rubric-v1|unscored}`, validator-enforced, badge reads the record
  not the ID. Also converts `ownedBookIdCeiling` to an explicit list.
- **Phase 7 — Harden the recommendation test** and wire the machine-checkable half of the
  definition of done into `scripts/validate-corpus.js`.

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

## Test baseline

`npm test` is green: validator 0 failures / **0 warnings**, schema static checks pass (live DB
checks skip without `OMNI_TEST_DATABASE_URL`), full Playwright suite passes. Keep it that way.

Local setup needed in a fresh container: `npm install -D playwright-core` (Chromium is already at
`/opt/pw-browsers`). Live DB checks need a throwaway Postgres; `psql` 16 is present.
