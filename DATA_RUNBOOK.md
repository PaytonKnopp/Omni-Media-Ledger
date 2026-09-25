# DATA_RUNBOOK.md — how the corpus gets its facts and its scores

This is the operating manual for Phase 5. It exists so the process is **repeatable**: the same
steps that verify the current 2,508 works are the steps that verify the next 2,000, and someone
reading this a year from now can tell what was done and why without reconstructing it from commit
messages.

Read `QUALITY_PASS.md` for *why* each rule exists and what was measured to justify it. This file is
the *how*.

---

## The four rules everything here obeys

1. **Never state a fact from memory as though it were verified.** Model recall is evidence grade C
   and is never written to `data/`. If a value cannot be sourced, it stays flagged for a human.
2. **`scripts/apply-facts.js` is the only script that changes a factual value** — and
   `scripts/apply-imdb-audience.js` the only one that changes a reception value (Phase R). Both
   edit by exact-match replacement scoped to a record's own line, refuse if they cannot find what
   they mean to replace exactly once, and are dry runs unless given `--write`.
3. **Facts and judgements are different, and never share a pipeline.** A fact has one right answer
   two sources can settle. A judgement (`atmosphericDreadIndex`, `emotionalWarmth`) is scored
   against `RUBRIC.md` from gathered evidence and stamped separately.
4. **Measure every batch.** Snapshot before, snapshot after, diff, and explain every line that
   moved. Anything that moved outside the batch is a bug, not an improvement.

---

## Before you start: keys

Environment variables only. Never in the repo, never in a commit, never in a recorded URL (the
harness redacts them at one chokepoint, tested).

| Variable | Source | Notes |
|---|---|---|
| `TMDB_API_KEY` | themoviedb.org → Settings → API, v3 key | Free, instant. Film + TV facts *and* keywords |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | dev.twitch.tv → register an application | Free. Games |
| `OMDB_API_KEY` | omdbapi.com | Optional. Free tier 1,000/day. A second opinion for film/TV |
| *(none needed)* | openlibrary.org, googleapis.com/books | Books |

A missing key is not an error. That source is skipped, every field it would have carried drops a
grade, and the output says so per work.

### What is deliberately NOT used, and why

| Source | Why not |
|---|---|
| Rotten Tomatoes | No public API; partner-only. Scraping breaches their terms |
| Metacritic | Same |
| Letterboxd | API is approval-gated; do not scrape |

Also: **do not average scores across catalogues.** RT's percentage is "share of critics who were
positive", Metacritic's is a weighted mean, IMDb's is a user mean. They are different measurements,
and any mapping between them is a judgement that will be applied inconsistently across thousands of
records — which is precisely the batch drift this whole pass exists to remove, reintroduced under a
new name. **One source, uniformly applied, beats three averaged.**

If a second reception axis is wanted, IMDb publishes `title.ratings.tsv.gz` at
`datasets.imdbws.com` for personal and non-commercial use. Bulk download, no API, no scraping.

### Licensing, in one paragraph

Facts are not copyrightable (*Feist v. Rural Telephone*) — a runtime, a year, a director's name can
be committed freely. A synopsis is expressive text and is protected. **This repository is public**,
so committing thousands of verbatim synopses is redistribution rather than personal use. That is
why `fetch-substance.js` keeps short factual tags by default and puts prose behind
`--include-prose`, writing it to a `.prose.json` that `.gitignore` excludes. The same goes for the
raw `--record` files: TMDB, OMDb and Google Books responses carry overviews, plots and blurbs, so a
recording is committed only with those fields stripped, and `npm run test-fast` fails on any
committed evidence file that still has them. TMDB's terms require
this line wherever its data is used, and the harness writes it into every pack:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

---

## Order of work, and why it is this order

**Owned works first**, then tiered, then the rest. Errors on works you own are the ones you will
actually notice, and the owned set doubles as the calibration set for everything after it.

**Facts before substance before scores.** A fact correction can change which catalogue entry a work
matches; gathering substance first means gathering it twice.

**Recalibration is all-or-nothing, per field.** A partly recalibrated field is two scales wearing
one name — worse than a uniform error, because it looks fine and cannot be detected by inspection.

---

## Phase A — Facts

### A1. Size the run before spending any quota

```bash
node scripts/fetch-substance.js --medium movie --plan-only
```

Fetches nothing; reports the HTTP call count. Do it per medium.

### A2. First batch, small, owned-first

```bash
node scripts/fetch-facts.js --medium movie --owned-first --limit 25 \
     --record evidence/raw-movie-facts.json
```

Writes `evidence/movie-<date>.json` (proposals + grades) and `evidence/movie-<date>.md` (the
review queue). `--record` saves the raw responses so this exact run can be replayed later with
`--offline`, which is how a disagreement about what a source said in March gets settled without
re-fetching a catalogue that has since changed.

### A3. Read the review queue before widening the batch

Open the `.md`. If the grade-B items are mostly noise, the reconciliation needs tuning — find that
at 25 works, not at 1,000.

### A4. Apply, dry run first

```bash
node scripts/apply-facts.js evidence/movie-<date>.json            # shows, writes nothing
node scripts/apply-facts.js evidence/movie-<date>.json --write
npm run test-fast        # corpus + harnesses, ~15s; the browser suite runs on the PR
```

Grade A applies. Everything else waits for you. Records whose hard facts all came back grade A get
stamped `prov: {facts:"sourced", checked:…, src:…, indices:"unscored"}`.

`indices` is carried over from the record's existing stamp (`rubric-v1` on every record today), or
`unscored` if it had none: sourcing a runtime says nothing about whether the work was scored against
the rubric, so a fact-check can neither certify that judgement nor revoke it.

**From a cloud session:** Node's `fetch` ignores the proxy unless run with `NODE_USE_ENV_PROXY=1`
(every call otherwise fails 403). TMDB is reachable there and OMDb is not, so film and TV facts come
back single-source: grade B, all of it in the review queue, none applyable. Grade A needs the second
source — a free `OMDB_API_KEY`, run locally or added to the environment.

### A5. Widen

Repeat A2–A4 without `--limit`, per medium. Commit the evidence files — they are the receipts for
every `sourced` stamp, and deleting them turns each stamp back into an assertion.

---

## Phase B — Substance

### B1. Gather

```bash
node scripts/fetch-substance.js --medium movie --owned-first --limit 25 \
     --record evidence/raw-movie-substance.json
```

Sources: TMDB keywords (film/TV), IGDB themes (games), OpenLibrary subjects + Google Books
categories (books).

### B2. Watch the "NO tags at all" count

Those works cannot be rubric-scored from evidence. They must be **flagged, not guessed**. Options,
in order of preference: fix the title match, add a second source, or score them by hand.

Why substance rather than more scores: measured on this corpus, `gmBase` has sd 2.82 against the
boost stack's 6.52, so **~84% of pre-override score variance is the boost stack** — which keys on
genres, vibes, creators and the rubric indices, not on critic scores. A 12-point critic correction
moves the match score by about 3. Aggregate scores are the least leveraged data this project can
gather; what a work is *about* is the most.

---

## Phase R — Reception: film and TV audience scores from IMDb

`metrics.audienceScore` for every movie and TV record is IMDb's user rating ×10, from the bulk
`title.ratings.tsv.gz` at `datasets.imdbws.com` (personal, non-commercial use; no API, no scraping).
First applied 2026-09-25 (NOTES.md Phase 49). One source, replaced outright, never averaged with the
old estimate; each value stamped with where and when:

```
"metrics":{"criticalScore":90,"audienceScore":83,"audienceSrc":{"src":"IMDb","id":"tt0062622","checked":"2026-09-25"}}
"metrics":{"criticalScore":88,"audienceScore":85,"audienceSrc":{"src":"estimated","why":"IMDb has no title for …"}}
```

`validate-corpus.js` fails any movie/TV record without a stamp, an `estimated` stamp without a
`why`, and any stamp on a game or book. Critic scores (every medium) and games' and books' audience
scores are still best estimates: they carry no stamp, and the cards mark them "est." / "~".

### R1. Match every work to its IMDb title

```bash
node scripts/measure-imdb-gap.js          # TMDB search -> TMDB id -> IMDb id, plus the gap report
```

Writes `evidence/imdb-audience-gap-<date>.{json,md}`. Needs TMDB access (`TMDB_API_KEY`, or a proxy
that injects a read-access token). `--reuse <previous gap.json>` skips TMDB for works already matched.

### R2. Resolve what TMDB could not match — by hand, reviewably

Every unmatched work goes in `evidence/imdb-id-overrides.json` with its IMDb id **and IMDb's own
title, type and year copied from `title.basics.tsv.gz`**, so a reviewer can check the pairing
without looking anything up. A work IMDb genuinely has no title for gets `"imdbId": null` and a
`why`; it keeps its estimate. Never pick an id from memory: look it up in `title.basics`.

### R3. Apply, dry run first

```bash
node scripts/apply-imdb-audience.js --matches evidence/imdb-audience-gap-<date>.json \
     --ratings title.ratings.tsv.gz --basics title.basics.tsv.gz        # dry run + id cross-check
node scripts/apply-imdb-audience.js --matches evidence/imdb-audience-gap-<date>.json \
     --ratings title.ratings.tsv.gz --write
```

It refuses if any movie/TV record has no route to an IMDb id (all-or-nothing per field), if a match
table row is stale (title or year changed since), or if an id has no rating row. `--basics` lists
every id whose IMDb type, title or year doesn't line up, for review — alternate titles and "Episode
IV"-style names are expected there; a different work is not. The retrieval date stamped on each value
is the ratings file's download date (`--checked` overrides). `--write` also writes
`evidence/imdb-audience-applied-<date>.json`, the receipt.

Then Phase D: snapshot before and after on both profiles, diff, `corpus-metrics.js`, `npm run
rec-quality`, and explain what moved. Film/TV audience changes also move games' and books'
normalised audience uniformly (`normalizeReceptionByKind` targets the whole corpus) — expected, and
their order within each medium must not change.

**Refreshing.** IMDb ratings drift. Re-run R3 with a newer ratings file (and R1 for works added
since); the stamps' `checked` dates move with it. New movie/TV works enter without a stamp and fail
validation until they are routed — that is the point.

---

## Phase C — Scores (the judgements)

### C1. Build the calibration set — this is the step that makes everything after it defensible

Roughly 150 works, **stratified across all ten ID deciles** (not just the ones you know well —
sampling only the early corpus reproduces the drift instead of detecting it).

```bash
node scripts/score-batch.js --worksheet --medium movies --owned \
     --substance evidence/substance-movie-<date>.json > sheet.txt
```

The worksheet is **blind**: it carries title, year, creator, genres, vibe, justification and the
gathered tags, and deliberately **no index values**. Seeing the old number first anchors the answer.
A work with no evidence prints `NO EVIDENCE GATHERED — do not score from memory` — leave it blank.

Score these yourself against `RUBRIC.md`. Two or three sittings.

### C2. Score the remainder from evidence, and check it against C1

~2,500 works × 7 constructs is ~17,500 judgements; hand-scoring all of them is not realistic. The
remainder is scored against `RUBRIC.md` from the gathered substance, with the anchors in context,
and **every score cites the evidence it saw**.

This is not the banned "model recall": an unsourced fact assertion is a fabrication, while a
classification made from fetched evidence against a written rubric is a judgement with its evidence
attached. That distinction is exactly what the two halves of the `prov` stamp record.

**Gate on agreement.** Compare against your 150. Target mean absolute difference **under ~8
points**. If it is worse, the rubric needs sharper anchors — do not proceed by scoring harder.

### C3. Apply

```bash
node scripts/score-snapshot.js --profile pk    before-pk.json
node scripts/score-snapshot.js --profile blank before-blank.json

node scripts/score-batch.js --apply decisions.json --dry-run
node scripts/score-batch.js --apply decisions.json
```

Every decision needs a `note` — the rubric justification, naming which anchors the work sits
between. A score with no stated reason cannot be reviewed and cannot be re-derived when the rubric
changes. `--apply` refuses decisions without one.

All-or-nothing per field.

---

## Phase D — Verify

```bash
node scripts/score-snapshot.js --profile pk    after-pk.json
node scripts/score-snapshot.js --profile blank after-blank.json

node scripts/score-snapshot.js --diff before-pk.json    after-pk.json
node scripts/score-snapshot.js --diff before-blank.json after-blank.json

npm run test-fast     # includes corpus-metrics.js --assert on the data (batch offsets)
npm run test-gate     # snapshots both profiles and runs --assert on each
npm run rec-quality
```

**The gate must pass on both profiles.** It has four rows, each set against something real rather
than an ideal (rewritten 2026-09-25, NOTES.md Phase 51 has the measurements):

| Row | Passes when | Why this form |
|---|---|---|
| batch offsets | every run of consecutive ids that sits off what its genre, era and acclaim predict (by 5+ points, median too, 80%+ of it one way) is listed in `scripts/composition.js` `REVIEWED_RUNS` as `corrected` or `real` | Sourced IMDb ratings produce no such run; a batch scored on its own scale does. The slope the canon-first build order leaves is allowed for |
| recency | `gm`'s fall with id order (genre and era held fixed) is no worse than the value pinned in `RECENCY_GUARD` + 0.05 | Real quality falls with id order too (IMDb: −0.52 films, −0.47 TV), so zero is not the target; this row only stops it getting worse |
| concentration (blank) | the original block holds no more of the film/TV top 100 by `gm` than of IMDb's top 100, + 15 | The block *is* the canon; IMDb is the reference for how much of the top it should hold |
| resolution | `gm` uses 90%+ of the whole numbers in its range, and no value holds over 8% of the corpus | `gm` is a whole number from 40 to 99, so "200 distinct values" (the old row) was impossible |

**When the batch row fails** on a new run: read its titles against what the model expects
(`findBatchOffsets` in `scripts/composition.js`; the review in NOTES.md Phase 51 shows how). If the
batch was scored on its own scale, add it to `REVIEWED_RUNS` as `corrected` with the reason and run
`node scripts/calibrate-batch-offsets.js` (one additive shift per run: order inside it is kept,
nothing outside moves). If the titles explain it — almost always genre tags looser than the works —
add it as `real`, with the reason. Never correct a reception field; those are sourced or labelled.

## Phase E — Finish the application

Only after D passes.

1. **Decide the score range.** Settled: `buildScoreCurve()` (app/scoring.js) maps the raw score onto
   40-99 by quantile, and a blank profile uses 52 of the 54 whole numbers it reaches (40-93, capped
   below 99 until there is taste evidence, by design). The gate's resolution row holds it there.
2. **Wire `emotionalWarmth`, `comicIntent` and `aestheticBeauty` into the UI.** Done. They are
   sliders, filters and sorts, and the taste model reads them (axis multipliers, tone fit and
   closeness in app/scoring.js). The last gap, closed 2026-09-25: they were missing from
   `activeDims()`, so the Match number ignored them; a regression check now fails for any slider
   that filters without being a Match dimension. Raising the tone weight to help the comedy-lover
   persona was measured (TASTE_TONE_SCALE 3 to 8) and made it worse at every step; its hidden
   favorites score within 7-10 points of the top and trail hundreds of well-liked comedies, which
   is a limit of an 8-title persona, not a missing signal.
3. **Revisit the two deferred engine items** and re-measure both against the recalibrated corpus:
   the era-neutral craft term (helped movies, *hurt* books when measured against drifted data) and
   cross-medium normalisation.
4. **Fix the games content rating** (`certify()` reading immersion, which the rubric settled as
   absorption rather than maturity) now that the games genre vocabulary is stable.

---

## Phase F — Expanding later

Identical pipeline, no exceptions. New works enter with `prov` absent — which reads as "unverified
estimate" — and earn a stamp only by going through Phase A.

Re-run the gate after every expansion batch (`npm run test-fast` covers the batch row; CI runs the
rest). Adding a hundred works scored on a different day is how batch drift starts, and the batch row
is what catches it: a new batch on its own scale shows up as an unreviewed run the day it lands.

**On size.** Three ceilings bind at different points: the scoring hot path is O(n) and fine past
50,000; the practical limit is boot cost, since every `data/*.js` parses on every page load, and
~10,000 records is where a no-build-step app starts to need chunked loading; and recommendation
quality stops improving well before either, as near-duplicates dilute the top of the list.
**5,000–8,000 total is the sweet spot.** Beyond ~10,000 you are changing the architecture, not the
data.

---

## If something goes wrong

| Symptom | Cause | Do this |
|---|---|---|
| `apply-facts` refuses a record | The evidence file's `current` value is not what is on the line — stale evidence, or the corpus changed underneath it | Re-run the fetch. Never hand-edit to make it match |
| A snapshot diff shows works outside the batch moving | A shared code path changed, not just data | Stop. Find it before committing |
| `--assert` passes on `pk` but fails on `blank` | The boost stack is masking a corpus problem | Fix the corpus. The blank profile is the honest view |
| The gate flags a batch run nobody reviewed | A batch was scored on its own scale, or its genre tags are looser than its works | Read its titles (Phase D), then list it in `REVIEWED_RUNS`: `corrected` and run `calibrate-batch-offsets.js`, or `real` with the reason |
| A catalogue matched the wrong work | Title collision | Check `matchedTitle` in the pack, then constrain by year |
| Validator fails on a `prov` stamp | A stamp claims `sourced` without a `src` and `checked` date | It is not sourced. Fix the claim, not the validator |
