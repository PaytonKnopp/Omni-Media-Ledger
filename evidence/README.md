# evidence/

Output of `scripts/fetch-facts.js`. Nothing here is generated yet — Phase 5 has not run.

Each run writes a pair of files per medium and date:

- `<medium>-<date>.json` — every field the catalogues answered for, with its evidence grade and
  the sources behind it. This is the input to `scripts/apply-facts.js`, which applies grade A and
  nothing else.
- `<medium>-<date>.md` — the review queue: the fields the harness refuses to decide, each with the
  corpus's current value and what each source said, so a human can settle it in a few seconds.

**These files are committed.** They are the answer to "how do you know?" for every factual value in
the corpus. A `prov: {facts: "sourced", checked: …}` stamp on a record is a claim; the evidence
file from that date is the receipt. Deleting them turns every stamp back into an assertion.

Recorded raw responses (`--record raw.json`) are also worth committing when a run is large: they
make that run replayable with `--offline`, so a disagreement about what a source said in March can
be settled by re-running rather than re-fetching a catalogue that has since changed.

## IMDb audience scores (film and TV)

- `imdb-audience-gap-<date>.{json,md}` — `scripts/measure-imdb-gap.js`: every movie and TV work
  matched to its IMDb id through TMDB, and how far the corpus's audience score sat from IMDb's.
- `imdb-id-overrides.json` — the hand-resolved IMDb ids for the works TMDB could not match, each with
  IMDb's own title, type and year beside it for review, and the works IMDb has no title for.
- `imdb-audience-applied-<date>.json` — `scripts/apply-imdb-audience.js`'s receipt: old and new
  value, IMDb id, rating and vote count for every movie and TV work.

See DATA_RUNBOOK.md "Phase R".
