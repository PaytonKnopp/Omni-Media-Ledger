# Calibration worksheets — 120 works, stratified

Generated for Phase C's calibration set (DATA_RUNBOOK C1). 30 works per medium (movies, TV,
games, books), 3 per medium **per ID decile** (deciles computed by each medium's own ID-number
order, i.e. corpus insertion order — the same axis `corr(gm, id)` measures batch drift on). Every
decile is represented equally: 3/3/3/3/3/3/3/3/3/3 in each medium, not concentrated in deciles 1–2
the way the owned shelf is.

**Anchor works are excluded.** Every id RUBRIC.md cites as an anchor for any construct was pulled
from the sample before stratifying, in both this set and the separate 40-work self-consistency
set — an anchor's score is given verbatim in the rubric text, so scoring one "blind" is not
actually blind.

**No overlap with the 40-work self-consistency test set.** Different works entirely, so scoring
these doesn't double as re-scoring something already used to validate the rubric.

**Every work here has real substance evidence** (tags gathered from OpenLibrary/Google
Books/Wikidata for books, TMDB for movies/TV, Wikidata for games) — none of these needed to fall
back to a tagless pick within its decile-medium cell.

## Files

- `worksheet-movies.md`, `worksheet-tv.md`, `worksheet-games.md`, `worksheet-books.md` — one
  per medium, 30 works each. Current index values are deliberately absent (RUBRIC.md step 4: seeing
  the existing value first anchors the answer).

## How to score

Follow RUBRIC.md's own procedure, in order, per work per field:
1. Read the construct's definition and "this is NOT" list first.
2. Find the two anchor works (in RUBRIC.md's own anchor tables) this work sits between.
3. Interpolate, round to nearest 5 (nearest 1 above 90).
4. **Do not look at the current corpus value until after you've chosen one.**
5. If genuinely stuck between two anchors, or the construct doesn't apply, flag it rather than
   guess — leave that field blank and come back to it, or note it for a second look.

Fields to score are listed at the top of each file's medium section (movies/TV/books share one
set of 5; games have a different set of 6 — see the "Fields to score" line).

## Applying your decisions afterward

Once scored, turn your values into a JSON decisions file — a plain array, one entry per
(work, field) you scored:

```json
[
  { "id": "b02", "field": "atmosphericDreadIndex", "value": 35, "note": "between Endurance (40) and Greenlights (15) -- genuine peril in places but the register is wonder, not dread" },
  { "id": "m207", "field": "ontologicalComplexity", "value": 25, "note": "..." }
]
```

`note` is required on every entry — the rubric justification, naming which anchors the work sits
between. Then:

```bash
node scripts/score-batch.js --apply your-decisions.json --dry-run   # preview
node scripts/score-batch.js --apply your-decisions.json             # write
```

`--apply` refuses any decision missing a `note`, an out-of-range value, or a field/medium mismatch.
It writes by exact-match replacement and refuses anything it can't match uniquely — nothing is
guessed at on your behalf.
