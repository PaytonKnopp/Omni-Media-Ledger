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
2. **`scripts/apply-facts.js` is the only script that changes a factual value.** It applies grade A
   only, by exact-match replacement scoped to a record's own line, and refuses if it cannot find
   what it means to replace exactly once.
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
`--include-prose`, writing it to a `.prose.json` that `.gitignore` excludes. TMDB's terms require
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
npm run validate-corpus && npm test
```

Grade A applies. Everything else waits for you. Records whose hard facts all came back grade A get
stamped `prov: {facts:"sourced", checked:…, src:…, indices:"unscored"}`.

`indices` stays `unscored` deliberately: sourcing a runtime says nothing about whether the work was
scored against the rubric, and conflating the two would certify a judgement nobody made.

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

node scripts/corpus-metrics.js --snapshot after-blank.json --assert
node scripts/corpus-metrics.js --snapshot after-pk.json    --assert
npm test
```

**Both `--assert` runs must pass.** The blank-profile one is the "works for everyone" test, and it
is the strict one — a personal profile's boost stack hides problems that a new user meets head-on.

The gate checks four properties:

| Row | Threshold | What it means |
|---|---|---|
| recency bias | `\|corr(gm, id)\| ≤ 0.15` | When a work was added must not predict how well it scores |
| concentration | ≤ 40 of the top 100 from the hand-scored block | That block is 26% of the corpus |
| batch drift | index decile means span ≤ 25 | One field, one scale, everywhere |
| score resolution | ≥ 200 distinct `gm` values | A score with no resolution cannot express an opinion |

For reference, the state before Phase 5, on a blank profile: correlation −0.54 to −0.74, **98 of
the top 100** from the hand-scored block, ten fields drifting more than 25 points, and **29 distinct
score values** across 2,508 works in a 40–70 band.

Once it passes, wire `--assert` into `npm test` so the property cannot silently regress.

---

## Phase E — Finish the application

Only after D passes.

1. **Decide the score range.** If resolution is still short, widen `gm`'s dynamic range. This is a
   formula property, independent of the data, so it is deliberately decided *here* — with the real
   distribution visible — rather than guessed against drifted values.
2. **Wire `emotionalWarmth`, `comicIntent` and `aestheticBeauty` into the UI** — sliders, filters,
   boosts. They are populated but connected to nothing, which was correct while most records
   lacked a value and is no longer correct once every record has one.
3. **Revisit the two deferred engine items** and re-measure both against the recalibrated corpus:
   the era-neutral craft term (helped movies, *hurt* books when measured against drifted data) and
   cross-medium normalisation.
4. **Fix the games content rating** (`certify()` reading immersion, which the rubric settled as
   absorption rather than maturity) now that the games genre vocabulary is stable.

---

## Phase F — Expanding later

Identical pipeline, no exceptions. New works enter with `prov` absent — which reads as "unverified
estimate" — and earn a stamp only by going through Phase A.

Re-run `--assert` after every expansion batch. Adding a hundred works scored on a different day is
how batch drift starts, and the gate is what catches it before it becomes another 54-point spread.

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
| A catalogue matched the wrong work | Title collision | Check `matchedTitle` in the pack, then constrain by year |
| Validator fails on a `prov` stamp | A stamp claims `sourced` without a `src` and `checked` date | It is not sourced. Fix the claim, not the validator |
