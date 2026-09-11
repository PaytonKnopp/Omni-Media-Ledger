# Rubric self-consistency test

**Method.** 40 works stratified across all 10 ID deciles and all 4 media (1 per decile per
medium), excluding every id RUBRIC.md cites as an anchor for any construct (an anchor's score is
given verbatim in the rubric text, so scoring it isn't blind), and excluding every id already used
in the separate 120-work calibration set. Every work has real substance evidence attached. Full
worksheet: `evidence/calibration/self-consistency-worksheet.md`.

Scored **twice**, by two genuinely independent agents with no shared context and no knowledge of
each other's existence, each given only RUBRIC.md and the blind worksheet (title, year, creator,
genres, vibe, justification, catalogue tags — no index values, same evidence a real scoring pass
would see). Neither pass could see the other's answers; this is not two readings of the same
transcript, it's two separate cold starts.

**Result: OVERALL MAD = 5.04 points across 209 comparable (work, construct) judgments.**
**Within the ~6-point bar. The rubric is reproducible enough to trust for Phase C, with one
named exception below.**

## Per-construct breakdown

| Construct | n | MAD | Max diff | Diffs >15pt |
|---|---|---|---|---|
| `atmosphericDreadIndex` | 30 | **7.07** | 20 | 4 |
| `ontologicalComplexity` | 29 | 4.31 | 15 | 0 |
| `immersionTensionIndex` | 10 | 5.00 | 15 | 0 |
| `systemsComplexity` | 10 | 4.50 | 10 | 0 |
| `conceptualDepth` | 10 | 4.50 | 10 | 0 |
| `emotionalWarmth` | 40 | 5.00 | 30 | 1 |
| `comicIntent` | 40 | 4.05 | 20 | 2 |
| `aestheticBeauty` | 40 | 5.38 | 30 | 1 |

**Seven of eight constructs are comfortably under the 6-point bar**, several well under (4.05–4.50).
One is not.

## The one real finding: `atmosphericDreadIndex` needs a sharper mid-band anchor

At 7.07 MAD, this construct alone is over the line — and the distribution explains exactly why.
It is not uniformly noisy: **10 of 30 works landed on the identical score in both passes** (mostly
the clear extremes — no pressure at all, or pressure that's obviously sustained), but **7 of 30**
disagreed by 15–20 points, all clustered in the 20–85 mid-band:

| Work | Pass A | Pass B | Diff |
|---|---|---|---|
| The Cove (m660) | 55 | 35 | 20 |
| The Fall of the House of Usher (t26) | 65 | 85 | 20 |
| True Detective (t190) | 40 | 60 | 20 |
| Père Goriot (b609) | 45 | 25 | 20 |
| Skyfall (m859) | 35 | 20 | 15 |
| Red River (m560) | 40 | 25 | 15 |
| The Grapes of Wrath (b208) | 50 | 35 | 15 |

Reading both passes' notes side by side, this is one real, specific ambiguity, not random noise:
**both scorers are applying the rubric's own decision procedure ("if I paused this at a random
quiet moment, would the air still feel heavy?") correctly — they just disagree on how much
weight a work's *structure* (episodic set-pieces vs. continuous atmosphere) should cost it once
real pressure is already present.** t26 is the clearest case: Pass A explicitly discounted it for
being "structured around discrete death-of-the-episode set-pieces" (65); Pass B read the same
evidence as "sustained... throughout the family's collapse" (85) and didn't weigh the episodic
structure at all. Both are legitimate readings of the current text — the rubric says episodic
suspense scores mid-band, but doesn't say how much a work should be marked down once it's
*mostly* sustained with some episodic structure layered on top.

**Recommendation, not yet acted on:** add one more anchor in the 55–70 band specifically
illustrating "real sustained pressure that is nonetheless organized around discrete high points"
vs. "pressure that genuinely never lifts," since the current five anchors (97/80/70/55/20 for
film/TV) jump from *No Country* (80, "breathes between pressures") straight to *Jaws* (70) without
an anchor that names the episodic-vs-sustained tradeoff explicitly the way the decision procedure
implies one exists. This is a rubric-sharpening question for the owner, not something resolved by
picking a number.

## A positive reliability signal, found by accident

One work in the sample (`b710`, Rousseau's *The Social Contract*) was independently **flagged
(not guessed at) by both passes on `ontologicalComplexity`**, with near-identical reasoning in
both: the construct's anchor works are all narrative works, and a direct political-philosophical
argument doesn't map onto either pole of "reality/truth/knowability via unreliable narration or
structure." Neither agent was told flagging was expected or desirable — this happened because
both independently applied RUBRIC.md's own instruction ("if the construct feels inapplicable,
flag it") to a genuinely edge-case work. That's the flagging mechanism working exactly as
intended, found under the harshest test available (two cold-start agents, zero coordination).

The same work also produced the single largest `emotionalWarmth` disagreement (15 vs 45) —
whether a philosophical treatise's passionate advocacy FOR humanity counts as the rubric's
"extends care" even with no individual characters to be tender toward. Worth the owner's read
alongside the dread finding, though it's an isolated case rather than a pattern (n=1, not 7).

## What this means for Phase C

- **Proceed with Phase C for 7 of 8 constructs.** Their self-consistency is good — `comicIntent`
  and `ontologicalComplexity` in particular (MAD 4.05, 4.31) are strong enough that a single
  scorer's judgment on them should be trusted without much second-guessing.
- **Do not fully trust `atmosphericDreadIndex` scores yet without a second look at the mid-band.**
  Either: sharpen the anchor set first (recommended — cheap, and this is exactly the kind of
  finding a calibration pass is supposed to surface before, not after, 2,500 works get scored), or
  score it knowing that anything landing in the 40–70 band deserves the owner's own spot-check
  rather than being taken as settled on a single automated pass.
- Raw scoring data for both passes: `evidence/calibration/pass-a.json`,
  `evidence/calibration/pass-b.json`. The worksheet both passes scored from:
  `evidence/calibration/self-consistency-worksheet.md`.
