# Scoring rubric

What every subjective index in the corpus **means**, on a scale anyone can apply the same way
twice.

**Status: v1 — anchors approved by the owner.** All five open questions are ruled on; see
"Owner's rulings" at the end. Records scored against this document are stamped `rubric-v1`.
One interpretation is flagged for confirmation (dread; see construct 1).

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

## The core constructs

These carry the most weight: they are 84% of pre-override score variance. The first four are
**four separate constructs**, per the owner's decision — not two constructs with two names each. Each is defined
on its own terms below, and a work in one medium is never scored by analogy to another.

---

### 1. `atmosphericDreadIndex` — film, TV, books

**Sustained oppressive atmosphere — the feeling that the air in this work is heavy and the floor is
not solid.** Dread is ambient and anticipatory, carried by tone, space, sound and pacing. Sustained
tension counts. Episodic tension does not.

> **Owner's ruling, and the one place this document interprets rather than records.** Asked whether
> dread means "wrongness" or "tension", the owner answered: *"I always thought dread was tension
> like the Shining."* Those two halves pull slightly apart — *The Shining* is the archetype of
> sustained atmospheric oppression, and is **not** a tense film in the plot-suspense sense for long
> stretches. This definition takes the example as the authority and reads "tension" as *sustained*
> tension: the register *The Shining* sustains, not the spike a chase scene produces. If that is
> wrong, it is cheap to correct — say so and the anchors below shift, before Phase 3 writes
> anything.

**This is NOT:**
- **Fright.** Jump scares, shocks and gore are the derived `scary` index. A film can be terrifying
  with little dread (most slashers) or dread-soaked and never frightening (*Stalker*).
- **Episodic suspense.** A film that is gripping in set pieces and relaxed between them scores
  mid-band, not high. The test is whether the pressure *persists* when nothing is happening.
- **Sadness or bleakness.** A devastating drama is not dreadful unless the air is also heavy.
  *Umberto D.* is shattering and barely dreadful at all.
- **Subject matter.** A film about a terrible event is not automatically high — dread is in the
  handling, not the topic.

**Decision procedure.** Ask: *if I paused this at a random quiet moment, would the air still feel
heavy?* If yes, you are above 70. If the pressure disappears whenever the plot rests, you are
mid-band. If there is no pressure to begin with, below 40.

**Anchors** — film/TV:

| Score | Work | Why it sits here |
|---|---|---|
| **97** | *The Shining* (m02) | The dread precedes and outlives every event; the building itself is the source. Definitional. |
| **80** | *No Country for Old Men* (m56) | Sustained moral wrongness and inevitability, but the film breathes between pressures. |
| **70** | *Jaws* (m63) | The water stays unsafe even in daylight scenes — real sustained pressure, but it lifts on land in a way the anchors above never do. |
| **55** | *Inglourious Basterds* (m112) | Two of the most oppressive scenes ever staged, connected by long stretches of relish and swagger. Episodic, not ambient. |
| **20** | *The Princess Bride* (m145) | Peril exists and is never once unsettling. |

**Anchors** — books:

| Score | Work | Why |
|---|---|---|
| **95** | *House of Leaves* (b77) | The book's form is the dread; the wrongness is structural. |
| **80** | *Blindsight* (b34) | Cosmic wrongness sustained throughout, but the prose is analytic rather than oppressive. |
| **60** | *Frankenstein* (b35) | Gothic unease, punctuated by long stretches of argument and travel. |
| **40** | *Endurance* (b47) | Genuine peril, told with warmth and competence — the register is admiration, not dread. |
| **15** | *Greenlights* (b49) | None. |

> The current corpus disagrees with several of these — *Jaws* 88, *Inglourious Basterds* 78,
> *Endurance* 70 — and that disagreement is the point. Those are category errors (episodic suspense
> and bleakness scored as ambient pressure), which is exactly what this definition exists to catch.

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

**Anchors:**

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

**Anchors** — film/TV:

| Score | Work | Why |
|---|---|---|
| **99** | *2001: A Space Odyssey* (m01) | The film's subject is the limit of comprehension itself. |
| **85** | *Shutter Island* (m84) | The reconstruction is total, but singular and resolved. |
| **65** | *Interstellar* (m06) | Demanding physics in service of a legible, linear emotional story. |
| **50** | *Catch Me If You Can* (m102) | A clever story, straightforwardly told. |
| **20** | *10 Things I Hate About You* (m139) | None required. |

**Anchors** — books:

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

**Anchors:**

| Score | Work | Why |
|---|---|---|
| **100** | *Dwarf Fortress* (g91) | Unbounded interacting simulation. The ceiling by definition. |
| **85** | *Metal Gear Solid V* (g09) | Many deep interlocking systems, but each is separable and learnable. |
| **65** | *Persona 5 Royal* (g108) | Two or three well-defined systems (calendar, social, combat) in clean interaction. |
| **45** | *Baba Is You* (g58) | One system, taken to its limit. Deep to *think about*, shallow to *operate*. |
| **20** | *Gone Home* (g238) | Navigation and reading. |

---

### 4b. `conceptualDepth` — games only — **NEW FIELD, not yet in the schema**

**How much the game asks you to rebuild your model of what is real, true or knowable.** The games
counterpart of `ontologicalComplexity`, requested by the owner when ruling that `systemsComplexity`
should mean mechanical depth: *"mechanical seems right but having a conceptual equivalent would be
good."*

Without it, games are the only medium with no conceptual axis at all, and works whose whole point
is conceptual — *Outer Wilds*, *The Beginner's Guide*, *Metal Gear Solid 2* — are invisible to
every complexity-based filter, family lens and cross-medium pairing in the app. It also means a
person whose taste runs to ideas rather than systems gets no game recommendations that match it.

Same construct and same scale as `ontologicalComplexity`; scored identically. **This is a schema
addition**, so it carries real cost: a new required field on all 258 games, plus validator,
adapter and engine wiring. Scheduled for Phase 3 alongside the games rescore, not before.

**Anchors:**

| Score | Work | Why |
|---|---|---|
| **99** | *Outer Wilds* (g45) | The game is an epistemology: the only thing that changes is what you know. |
| **85** | *Metal Gear Solid 2* (g07) | Deliberately destabilises the player's relationship to the game itself. |
| **65** | *BioShock* (g34) | One genuine reframing, cleanly delivered inside a conventional shooter. |
| **45** | *Baba Is You* (g58) | Rules are the toy, but the world's nature is never in question. |
| **15** | *Wii Sports* (g255) | None. |

---

### 5. `emotionalWarmth` — all four media — **NEW FIELD, not yet in the schema**

**How much the work extends care — toward the people in it, and toward you.** Generosity,
affection, humane attention. The sense of being in good hands.

This is the fifth core construct, and the reason it exists is structural rather than aesthetic.
The other four — dread, immersion, ontological complexity, systems complexity — are all
*intensity* axes: unease, absorption, difficulty. Nothing in the schema measured whether a work is
kind. So a person whose taste runs to warmth, wit or company had **no index their taste could load
onto**, and could express it only through genre boosts, while a person who likes dread-soaked
puzzle-boxes had four indices working for them. That is a property of who the corpus was first
built for, not a fact about media, and it capped how well the app could ever serve anyone else.

**This is NOT:**
- **A happy ending, or happiness at all.** *Grave of the Fireflies* is devastating and among the
  warmest works in the ledger. *The Wolf of Wall Street* is a party and ice cold.
- **Comedy.** Independent axes. *Dr. Strangelove* is hilarious and glacial; *The Bear* is warm and
  frequently unbearable.
- **Sentimentality.** Manipulation is the *opposite* of warmth — it uses characters to produce a
  feeling in you rather than attending to them. Score it low, not high.
- **Low stakes or coziness.** A brutal work can be deeply warm; a gentle one can be indifferent.
- **The absence of dread.** Deliberately orthogonal, which is what makes it worth its own field:
  *Come and See* is near-maximal on both.

**Decision procedure.** Ask: *does this work love anybody in it?* If it regards its people with
affection and takes their inner lives seriously — including the ones it condemns — you are above
70. If it regards them with interest but no tenderness, 40–60. If it uses them as instruments for
a plot, a spectacle or a thesis, below 30. For non-fiction and games without characters, the
question becomes *does it care about its subject and its reader/player?* — Sagan does, a reference
textbook does not, and a textbook scoring low is correct rather than a gap.

**Anchors** — film/TV:

| Score | Work | Why |
|---|---|---|
| **95** | *It's a Wonderful Life* (m514) | The subject *is* a community's care for one man. Definitional. |
| **80** | *Grave of the Fireflies* (m183) | Unbearable and tender at once — the proof that warmth is not happiness. |
| **65** | *Interstellar* (m06) | Real love at its centre, delivered through a film that is often cold in execution. |
| **40** | *No Country for Old Men* (m56) | Moral seriousness about its people, no affection for them. |
| **10** | *The Shining* (m02) | Sympathy actively withheld; the family is material. |

**Anchors** — books:

| Score | Work | Why |
|---|---|---|
| **95** | *Cosmos* (b05) | Sagan's humanism, extended to the reader and the universe alike. |
| **80** | *The Hobbit* (b18) | Affectionate toward nearly everyone in it. |
| **60** | *Endurance* (b47) | Humane and admiring, but the register is competence rather than care. |
| **35** | *Blindsight* (b34) | Cold by design — the coldness *is* the argument. |
| **10** | *The Principles of Quantum Mechanics* (b03) | None, and correctly so. |

**Anchors** — games:

| Score | Work | Why |
|---|---|---|
| **95** | *Stardew Valley* (g119) | The entire design is an act of care. |
| **80** | *Undertale* (g52) | Insists you reckon with the interiority of everything you meet. |
| **65** | *Journey* (g70) | Wordless companionship, real but abstract. |
| **40** | *Wii Sports* (g255) | Cheerful and empty of persons — nothing to extend care toward. |
| **15** | *Dark Souls* (g03) | A world that regards you with indifference, deliberately and thematically. |

**Cost, stated plainly.** This is a schema addition on **2,508 records**, not a formula change.
Until every record carries a value it cannot become a required field, so the sequence is: score it
in reviewed batches during Phase 3 (same rubric, same protocol as every other index), then wire it
into `validate-corpus.js`, the adapter, `gm`, and the filter sliders in one commit once the data
is complete. Half-populating it would be worse than not having it — a filter that silently hides
every unscored work.

---

### 6. `comicIntent` — all four media — **NEW FIELD, not yet in the schema**

**How much the work is trying to be funny, and how well it lands.** Wit, absurdity, timing,
comic construction — whether or not the work is a comedy.

Promoted from a derived index to a scored one because the derived version cannot see what matters.
`funny` is computed as *genre contains "comedy"* plus a slice of audience score, so a genuinely
witty drama scores as though it were humourless, and a leaden comedy scores as though it worked.
That makes humour the one major taste a person cannot actually filter for.

**This is NOT:**
- **Genre.** *Succession* and *Fleabag* are funnier than most things filed under Comedy. A work's
  shelf is not its wit.
- **Lightness or warmth.** *Dr. Strangelove* is one of the funniest films ever made and glacial;
  *Grave of the Fireflies* is warm and has no jokes. Independent of construct 5 by design.
- **Whether *you* laughed.** The question is whether the comic construction works, not whether it
  is to your taste.

**Decision procedure.** Ask: *is comedy one of the tools this work is using, and does it work?*
Sustained and successful, 80+. Real and frequent inside another mode, 55–75. Occasional levity,
25–45. No comic intent at all, below 15 — and that is a normal, correct score, not a gap.

**Anchors** — film/TV:

| Score | Work | Why |
|---|---|---|
| **97** | *Monty Python and the Holy Grail* (m137) | Comedy is the entire architecture. Definitional. |
| **85** | *Dr. Strangelove* (m244) | Sustained, exact, and never once warm — which is the point of separating this from warmth. |
| **65** | *Succession* (t44) | Filed as Drama, and one of the funniest things in the ledger. Exactly the case `funny` cannot see. |
| **35** | *Good Will Hunting* (m101) | Genuinely funny in places, inside a film that is not built on it. |
| **5** | *The Shining* (m02) | None intended. |

**Anchors** — books and games:

| Score | Work | Why |
|---|---|---|
| **95** | *The Ultimate Hitchhiker's Guide to the Galaxy* (b28) | The prose exists to be funny. |
| **90** | *Portal 2* (g38) | Comic writing and timing carry the whole game. |
| **60** | *Catch-22* (b87) | Relentlessly funny and about atrocity at the same time. |
| **30** | *Disco Elysium* (g59) | Very funny in a register that is mostly despair. |
| **5** | *Blindsight* (b34) | None intended. |

---

### 7. `aestheticBeauty` — all four media — **NEW FIELD, not yet in the schema**

**How beautiful the work is as a made object** — composition, imagery, sound, language, design.
Beauty as an achievement, independent of subject matter or how pleasant it is to sit with.

Promoted for the same reason as humour: the derived `awe` index blends craft with a genre-and-vibe
bonus, so it approximates *spectacle* rather than beauty, and it has nothing to say about books at
all. Film has `cinematographyScore`, so film's beauty is already measured — this extends the same
question to the other three media, and takes it beyond scale.

**This is NOT:**
- **Spectacle or scale.** A quiet film can be more beautiful than a loud one. That conflation is
  precisely what `awe` gets wrong.
- **Production budget or technical fidelity.** That is `physicalMediaFidelity` /
  `engineeringFidelity`. A hand-drawn game can outscore a photorealistic one.
- **Pleasantness.** *Blood Meridian* is beautiful and appalling.
- **Craft in general.** Prose can be superbly efficient and not beautiful — *Don't Make Me Think*
  is well made and not attempting beauty.

**Decision procedure.** Ask: *would I stop on a single frame, sentence, or screen just to look at
it?* Repeatedly and by design, 85+. Frequently, 65–80. In moments, 40–60. Functional, below 30.

**Anchors** — film/TV:

| Score | Work | Why |
|---|---|---|
| **99** | *Barry Lyndon* (m03) | Every frame composed as a painting, by explicit intent. Definitional. |
| **90** | *In the Mood for Love* (m197) | Colour, framing and restraint doing the work of dialogue. |
| **70** | *Spirited Away* (m59) | Sustained visual invention, in service of story rather than display. |
| **45** | *Good Will Hunting* (m101) | Competently shot; beauty is not what it is for. |
| **20** | *12 Angry Men* (m127) | Deliberately plain — a great film with no aesthetic ambition. |

**Anchors** — books and games:

| Score | Work | Why |
|---|---|---|
| **97** | *Blood Meridian* (b82) | Sentence-level beauty so sustained it survives the horror it describes. |
| **90** | *Journey* (g70) | Every screen composed; the game's argument is made visually. |
| **75** | *Shadow of the Colossus* (g69) | Emptiness and scale used as composition, not spectacle. |
| **45** | *Hollow Knight* (g81) | Handsome and coherent; beauty is a quality, not the point. |
| **15** | *Don't Make Me Think* (b45) | Well made, plainly written, not attempting beauty at all. |

---

## What is still uncovered

The owner's instruction was to do it once and do it properly, so the three gaps the audit found
are all being closed in the same pass rather than one now and two later. After constructs 5-7 the
schema measures: unease, absorption, intellectual demand, mechanical depth, **care, humour and
beauty**, plus craft and reception.

That is deliberately a *taste-space* claim, not a claim to completeness. What it means is that the
main axes a person organises their taste around each have a field their preferences can load onto,
rather than four axes serving one shape of taste and nothing serving the rest.

Known and accepted limits, so nobody mistakes silence for coverage:

- **Romance, catharsis and tension-as-thrill** have no field of their own. Each is reachable
  through a combination that does exist (warmth plus genre; warmth plus dread; dread plus pacing),
  which is why they are not being promoted — but a person whose taste is *specifically* one of
  these is served by genre boosts rather than by an index.
- **Every construct is scored by one person against one rubric.** Consistency is provable;
  correctness is not, because no external source of truth exists for any of them.
- **Nothing measures how a work ages, or the gap between first and repeat encounters.** A work is
  one number per axis, forever.

---

## Cost of constructs 5-7, stated once

Three new fields across 2,508 records is the single largest piece of work in this pass — larger
than the calibration it sits alongside. The sequence is the same for all three, and the order
matters:

1. **Score in reviewed batches during Phase 3**, same rubric and same protocol as every other
   index, with the owner adjudicating the judgement calls.
2. **Only then** wire them into `validate-corpus.js` (required + 0-100 scale), the adapter, `gm`,
   and the filter sliders — in one commit per field, once that field is complete on every record.

A field cannot become required until every record carries it, and half-populating one is worse
than not having it: a filter reading a missing value silently hides every unscored work, which
looks like a smaller library rather than a bug.

Scoring all three together, per work, is also cheaper and better than three separate passes: the
judgements interact (warmth against humour on a comedy, beauty against craft on a film), and
making them side by side is what keeps them independent rather than three restatements of "I liked
it".

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

**Owner's ruling: leave the values as best estimates for now, and settle them in Phase 5** when
network access makes real comparison possible. That is the right call — rewriting ~1,250 reception
values from second-hand search summaries would be replacing one set of unsourced numbers with
another, at evidence grade B.

One part is **not** deferred, because it is an engine bug rather than a data question: the corpus
mixes incompatible scales. Films track
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

## Owner's rulings — closed

All five open questions were answered. Recorded here so they are not reopened.

| # | Question | Ruling |
|---|---|---|
| 1 | Do the proposed anchors stand? | **Approved.** "The anchors look solid, I trust it." Two dread anchors were then adjusted by ruling 2 below — *Jaws* 65 → **70**, *Inglourious Basterds* 45 → **55** — since widening the definition necessarily widens the scale. Anchor *works* are unchanged. |
| 2 | Dread — wrongness or tension? | **Tension, read as sustained tension.** See the interpretation note under construct 1: the answer and its example (*The Shining*) pull slightly apart, and the example wins. Episodic suspense still scores mid-band. **Flagged for correction if that reading is wrong.** |
| 3 | Immersion — absorption or menace? | **Absorption.** "Immersion seems more like absorption to me." Menace moves to the derived `scary` index. This is what unblocks the fix for *Outer Wilds* being rated `M`. |
| 4 | `systemsComplexity` — mechanical or conceptual? | **Mechanical** — plus a new `conceptualDepth` field for games (construct 4b), on the owner's request for "a conceptual equivalent". |
| 5 | Reception sources | **Deferred to Phase 5**, when real sources are reachable. Values stand as best estimates until then. The cross-medium *scale* normalisation is separate and stays in Phase 2. |

### Still to settle — raised, not yet ruled on

**Resolved: the owner chose the real fix.** All four original constructs were "dark" axes, which
capped who the app could serve. The owner's ruling, in his words: *"this originally started as an
app just for me so it is skewed in favor of the things I was looking for... if I want it to be
available to everyone and work for everyone best there should be everything in the system... mine
should still be reflected properly because if it works for everybody it will and should still work
for me."*

So `emotionalWarmth` (construct 5) is added across all four media as a genuinely new raw scored
field, rather than the cheaper option of merely re-scoring the derived `cozy`/`funny`/`emo`
override tables — those are computed *from* the dark axes and would have inherited the same blind
spot. See "What is still uncovered" for the two qualities that remain derived.

## Change control

Changing a definition or an anchor after Phase 3 begins invalidates every score derived from it.
If one must change, it is a new rubric version (`rubric-v2`), every record stamped `rubric-v1` is
re-queued, and the change is recorded here with its reason. Records carry which rubric version
scored them precisely so this stays possible.
