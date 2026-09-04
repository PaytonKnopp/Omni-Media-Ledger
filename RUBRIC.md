# Scoring rubric

What every subjective index in the corpus **means**, on a scale anyone can apply the same way
twice.

**Status: DRAFT — anchors await the owner's sign-off.** Nothing in Phase 3 may proceed on
unapproved anchors. See "Open questions" at the end.

---

## Why this document exists

Until now there was no written definition of any subjective index. The result was measurable, not
theoretical: the same field means different things in different parts of the corpus. Movies'
`atmosphericDreadIndex` averages 82.3 in the first hundred records and 28.3 by the seventh
hundred. TV's ranges from 82.1 to 13.9. Because the scoring engine keys three of its boosts on
bare thresholds (`myst>70`, `tech>85`, `dread>80`), that drift lands directly on match scores —
`corr(gm, id number)` is about −0.6 on every medium, meaning **when a work was added to the file
predicts its match score better than anything about the work itself**.

A rubric is the fix, and it has to come first. Without one, auditing 2,508 works is re-scoring by
feel, and the scale drifts again between batches — the exact failure being repaired.

**A rubric cannot make a score correct.** There is no external source of truth for "how much dread
does this film carry". What it can do is make scores *consistent*: the same work scored twice, by
different people months apart, lands in the same place. Consistency is what the engine actually
needs, because every threshold and every comparison in it is relative.

---

## How to score a work

In this order. Do not skip to step 3.

1. **Read the construct's definition and its "this is NOT" list.** Most mis-scores are category
   errors, not calibration errors — scoring tension as dread, or difficulty as complexity.
2. **Find the two anchors the work sits between.** Scoring is comparative: "more than *Jaws*, less
   than *The Thing*" is a question with an answer. "How dreadful is this out of 100" is not.
3. **Interpolate, then round to the nearest 5** below 90, and to the nearest 1 above 90 where fine
   distinctions carry real weight.
4. **Do not look at the existing value until after you have chosen one.** The existing values are
   not a baseline — nobody ever checked them against anything. When they are visible first they
   anchor the answer, which reproduces the drift instead of repairing it. The existing value's only
   legitimate use is to *order the review queue*, never to constrain the outcome.
5. **If two anchors seem equally close, or the construct feels inapplicable, flag it.** A flagged
   record the owner rules on is worth more than a confident guess. This is not a fallback, it is
   the expected outcome for a meaningful minority of works.

### What the numbers mean, generically

| Band | Meaning |
|---|---|
| **95–100** | Definitional. The work a person would cite to explain what the construct *is*. Rare — single figures per medium. |
| **80–94** | Strongly present and central to the work's identity. You would name it in a one-line description. |
| **60–79** | Clearly present, but one quality among several rather than the defining one. |
| **40–59** | Present in places, or present in a mild register. Would not appear in a short description. |
| **20–39** | Largely absent. Traces only, or a single scene against the grain. |
| **0–19** | Absent, or actively the opposite. |

**The scale is absolute, not relative to a medium or an era.** A 2024 horror film and a 1931 one
are scored on the same axis. If a whole medium ends up clustered high, that is a real finding
about the corpus's selection, not a reason to re-centre the medium.

---

## The four core constructs

These carry the most weight: they are 84% of pre-override score variance. They are **four separate
constructs**, per the owner's decision — not two constructs with two names each. Each is defined
on its own terms below, and a work in one medium is never scored by analogy to another.

---

### 1. `atmosphericDreadIndex` — film, TV, books

**A pervasive sense that something is wrong with the world of the work, sustained rather than
spiked.** Dread is ambient and anticipatory. It is the feeling that the floor is not solid,
carried by tone, space, sound and pacing rather than by events.

**This is NOT:**
- **Fright.** Jump scares, shocks and gore are the derived `scary` index. A film can be terrifying
  with little dread (most slashers) or dread-soaked and never frightening (*Stalker*).
- **Tension or suspense.** Edge-of-seat plot pressure is a different axis. *Jaws* runs on suspense
  architecture; its dread is real but moderate.
- **Sadness or bleakness.** A devastating drama is not dreadful unless it also feels *wrong*.
- **Subject matter.** A film about a terrible event is not automatically high — dread is in the
  handling, not the topic.

**Decision procedure.** Ask: *if I paused this at a random quiet moment, would the air still feel
poisoned?* If yes, you are above 70. If the unease needs the plot to be moving, you are below 60.

**Proposed anchors** — film/TV:

| Score | Work | Why it sits here |
|---|---|---|
| **97** | *The Shining* (m02) | The dread precedes and outlives every event; the building itself is the source. Definitional. |
| **80** | *No Country for Old Men* (m56) | Sustained moral wrongness and inevitability, but the film breathes between pressures. |
| **65** | *Jaws* (m63) | Genuinely unsettling water, but the engine is suspense — dread recedes whenever the shark is absent. |
| **45** | *Inglourious Basterds* (m112) | Extraordinary tension in set pieces, little ambient wrongness; the film is having fun. |
| **20** | *The Princess Bride* (m145) | Peril exists and is never once unsettling. |

**Proposed anchors** — books:

| Score | Work | Why |
|---|---|---|
| **95** | *House of Leaves* (b77) | The book's form is the dread; the wrongness is structural. |
| **80** | *Blindsight* (b34) | Cosmic wrongness sustained throughout, but the prose is analytic rather than oppressive. |
| **60** | *Frankenstein* (b35) | Gothic unease, punctuated by long stretches of argument and travel. |
| **40** | *Endurance* (b47) | Genuine peril, told with warmth and competence — the register is admiration, not dread. |
| **15** | *Greenlights* (b49) | None. |

> Note the current values disagree with several of these: *Jaws* currently 88, *Inglourious
> Basterds* 78, *Endurance* 70. That disagreement is the point — it is the category error this
> definition exists to fix, and it is why the anchors need the owner's ruling before Phase 3 runs.

---

### 2. `immersionTensionIndex` — games only

**How completely the game takes you in — the pull that makes you lose track of time and forget you
are holding a controller.** It measures absorption: the strength of the game's hold, whatever
feeling it is holding you with.

**This is NOT:**
- **Fear or threat.** This is the single most consequential correction in this document. Immersion
  and menace are currently conflated, and the damage is visible: **71 of 258 games are rated `M`
  purely because their `immersionTensionIndex` is ≥ 70** — among them *Outer Wilds*, *Return of the
  Obra Dinn* and *Subnautica*. Threat belongs to the derived `scary` index, which already exists.
  Under this definition *Outer Wilds* is near-maximal immersion and low fright; *P.T.* is high on
  both. They are no longer forced onto one number.
- **Difficulty.** A punishing game can be absorbing or alienating.
- **Graphical fidelity.** That is `engineeringFidelity`.
- **Length.** A four-hour game can be total; a hundred-hour one can be background noise.

**Decision procedure.** Ask: *does the world keep existing while I am not playing?* Total absorption
with a coherent world is 90+. A game you enjoy but put down cleanly at any moment is 40–60.

**Proposed anchors:**

| Score | Work | Why |
|---|---|---|
| **97** | *Outer Wilds* (g45) | A whole solar system held in your head; the loop only ends when you understand it. Definitional immersion — and, note, barely frightening. |
| **85** | *Bloodborne* (g02) | Yharnam is continuous and consuming, though the moment-to-moment pull is partly mechanical. |
| **65** | *Skyrim* (g105) | A world you inhabit comfortably rather than one that grips you; easy to drift in and out of. |
| **45** | *Two Point Hospital* (g225) | Absorbing in sessions, no persistent world in the mind afterwards. |
| **15** | *Wii Sports* (g255) | Pure activity. No world at all. |

---

### 3. `ontologicalComplexity` — film, TV, books

**How much the work demands you rebuild your model of what is real, true or knowable.** It measures
conceptual and structural load: unreliable reality, nested or non-linear structure, ideas that
require holding several incompatible frames at once.

**This is NOT:**
- **Plot complication.** A thriller with twelve double-crosses is complicated, not ontologically
  complex. The question is whether the *nature of things* is in question, not the arrangement of
  events.
- **Obscurity or difficulty.** A hard-to-follow film may simply be poorly told.
- **Intelligence or quality.** *12 Angry Men* is a superb, near-zero-complexity film.
- **Genre.** Sci-fi is not automatically high; a domestic drama about memory can be.

**Decision procedure.** Ask: *at the end, do I have to revise something I believed at the start
about how the work's world works?* Structural revision is 85+. Thematic ambiguity alone is 50–65.

**Proposed anchors** — film/TV:

| Score | Work | Why |
|---|---|---|
| **99** | *2001: A Space Odyssey* (m01) | The film's subject is the limit of comprehension itself. |
| **85** | *Shutter Island* (m84) | The reconstruction is total, but singular and resolved. |
| **65** | *Interstellar* (m06) | Demanding physics in service of a legible, linear emotional story. |
| **50** | *Catch Me If You Can* (m102) | A clever story, straightforwardly told. |
| **20** | *10 Things I Hate About You* (m139) | None required. |

**Proposed anchors** — books:

| Score | Work | Why |
|---|---|---|
| **99** | *Gödel, Escher, Bach* (b12) | Self-reference as its subject and its method. Definitional. |
| **85** | *The Book of the New Sun* (b71) | Unreliable narration over a world whose nature is withheld. |
| **65** | *A Canticle for Leibowitz* (b126) | Big ideas, cleanly told across a clear structure. |
| **45** | *The Name of the Wind* (b23) | Framed narrative, conventionally legible world. |
| **20** | *Greenlights* (b49) | None. |

---

### 4. `systemsComplexity` — games only

**How many interacting mechanical systems the player must hold and reason about at once.** Depth of
the machine, and how much of it must be understood to play well.

**This is NOT:**
- **Conceptual depth.** *Baba Is You* is profound and mechanically minimal — one rule-rewriting
  system, elegantly. It is a low-to-mid systems score and a high `ontological`-flavoured one, which
  is why these are separate constructs.
- **Difficulty.** Execution challenge is not systemic depth. A brutal platformer is mechanically
  simple.
- **Content volume.** Two hundred hours of similar content is not complexity.
- **UI density.** Menus are not systems.

**Decision procedure.** Count the systems a competent player must actively reason about
simultaneously. One or two: 30–50. Four or five interacting: 70–85. A genuine economy or simulation
whose interactions cannot be enumerated: 95+.

**Proposed anchors:**

| Score | Work | Why |
|---|---|---|
| **100** | *Dwarf Fortress* (g91) | Unbounded interacting simulation. The ceiling by definition. |
| **85** | *Metal Gear Solid V* (g09) | Many deep interlocking systems, but each is separable and learnable. |
| **65** | *Persona 5 Royal* (g108) | Two or three well-defined systems (calendar, social, combat) in clean interaction. |
| **45** | *Baba Is You* (g58) | One system, taken to its limit. Deep to *think about*, shallow to *operate*. |
| **20** | *Gone Home* (g238) | Navigation and reading. |

---

## Craft and fidelity fields

Per the owner's decision, `physicalMediaFidelity` is **not one construct**. Two of its three fields
measure the presentation you can buy; the third measures the work itself. The data already behaves
this way — correlation with release year is 0.43 for transfer, 0.60 for audio, and **0.01** for
cinematography.

| Field | Means | Era-dependent? |
|---|---|---|
| `transferFidelity` | Quality of the **best available release** — restoration, resolution, encode. | **Yes, legitimately.** A 1931 film with no good master scores low and that is correct. |
| `audioSoundscape` | Quality and ambition of the **best available mix**. | **Yes, legitimately.** |
| `cinematographyScore` | The photography as an **artistic achievement**, independent of how well it has been preserved. | **No.** A 1927 film can score 100. |
| `craft.proseCraft` (books) | Sentence-level quality of the writing. | No. |
| `craft.ideaDensity` (books) | Ideas per page the reader must actually process. | No. See caution below. |
| `engineeringFidelity.engineGraphicsPerformance` (games) | Technical accomplishment **relative to its platform and year**. | Normalised by era — a 1998 game can score 95. |
| `engineeringFidelity.artDirection` (games) | Artistic coherence and identity of the visual design. | No. |

**Consequence for the engine, already agreed:** `gm`'s craft term must read the **era-neutral**
component (cinematography for film/TV, art direction for games, prose craft for books), because
`tech` — the average of all three — currently penalises old films for lacking a 4K master. That is
wrong for a *taste* match. `tech` itself stays as it is for the Technical Craft filter and for
`ref`/`snd`, where the blend is the right question. Expect older films to rise; that is the point.

**Caution on `ideaDensity`:** it correlates **r = 0.85** with `ontologicalComplexity`, and the two
feed the engine independently (one into `tech`, one into `myst`), so books currently double-count
the same quality. Scored strictly to the definitions above they should diverge — `ideaDensity` is a
*rate*, `ontologicalComplexity` is a *demand*. A dense textbook is high-rate and low-demand. If
they remain collinear after Phase 3, one of them should be dropped from the engine rather than kept
for symmetry.

---

## Reception fields — sourced, never judged

`metrics.criticalScore` and `metrics.audienceScore` are **not rubric fields**. They are facts with
a source, and the only rule is which source and when.

**Unresolved and blocking Phase 5** — the corpus currently mixes incompatible scales. Films track
the RT Tomatometer (14 films sit at exactly 100; *Rain Man* is 86 against RT 88 / Metacritic 65),
while games track Metacritic (max 97, no 100s). These measure different things: RT is *the
percentage of critics who were positive*, so a film every critic mildly liked scores 100;
Metacritic is *a weighted mean*, and the same film scores 65. `gm` adds them together as if
identical, so **a film at 95 and a game at 95 are not comparable**.

Proposed, pending the owner's ruling: RT Tomatometer for film/TV, Metacritic for games, and books'
`criticalScore` stops presenting as sourced at all — most books have no critical aggregator, so
that number has no source and cannot acquire one. `gm` normalises per medium before combining.

Every reception value carries its source and retrieval date once Phase 6's provenance lands.
Aggregator scores drift, so an undated one is not a fact.

---

## Derived indices

The ~19 specialised indices in `app/ledger-app.js` (`snd`, `ref`, `ch`, `emo`, `awe`, `cozy`,
`perf`, `icon`, `scary`, `real`, `reality`, `shock`, `sci`, `funny`, `hist`, `vibe2`) are computed,
not stored — but most carry a **hand-tuned override table** (`PERF`, `ICON`, `SCARY`, `EMO`,
`REAL`, `REALITY`, `SHOCK`, `SCI`, `FUNNY`, `HIST`, `VIBEIDX`, `CH_CANON`, `SND_BOOST`) whose
values were assigned by feel and have never been checked against anything.

**Rule: an override value is governed by this rubric exactly as a raw index is.** It is a
hand-assigned subjective score; that it lives in JavaScript rather than JSON changes nothing.

Two definitions that must not drift, because they are what the core constructs are *not*:

- **`scary`** — how frightening the work is to experience. Fright, shock, threat. This is where
  games' menace goes now that `immersionTensionIndex` means absorption, and it is the counterpart
  to `atmosphericDreadIndex` for film. *P.T.* is maximal here; *Outer Wilds* is near-zero.
- **`reality`** — how much the work destabilises reality *as an experience*, where
  `ontologicalComplexity` measures the *demand* it makes. High complexity can be lucid; high
  `reality` is disorienting.

Each derived index's formula must also branch on medium wherever it reads `dread` or `myst`,
because those slots now carry four different constructs. That is engine defect E1.

---

## Open questions for the owner

Phase 3 cannot start until these are answered.

1. **Do the proposed anchors above stand?** Accept, swap or override any of them. They are the
   scale; everything else interpolates. The ones most likely to be wrong are the mid-band anchors
   (65 and 45), because that is where judgement is thinnest.
2. **`atmosphericDreadIndex` — is "dread, not tension" the right call?** It reclassifies *Jaws*
   (88 → ~65) and *Inglourious Basterds* (78 → ~45) meaningfully downward. If dread is meant to
   mean "intensity" in this app, say so and the definition changes instead.
3. **`immersionTensionIndex` — is "absorption, not menace" the right call?** This is the one that
   fixes *Outer Wilds* being rated `M`, but it moves a lot of games.
4. **`systemsComplexity` — mechanical depth, or conceptual depth?** The rubric proposes mechanical,
   with conceptual depth living in the ontological axis. *Baba Is You* is the test case: 45 under
   this definition, 99 today.
5. **Reception sources:** RT for film/TV and Metacritic for games — and what to do with books'
   `criticalScore`, which currently has no source at all.

---

## Change control

Changing a definition or an anchor after Phase 3 begins invalidates every score derived from it.
If one must change, it is a new rubric version (`rubric-v2`), every record stamped `rubric-v1` is
re-queued, and the change is recorded here with its reason. Records carry which rubric version
scored them precisely so this stays possible.
