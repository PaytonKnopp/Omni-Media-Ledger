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
