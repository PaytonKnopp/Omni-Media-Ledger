# Substance adequacy for rubric scoring

Per-medium count of works with enough gathered evidence (tags from external catalogues) to score
against RUBRIC.md from evidence, vs. works that would have to be scored from memory or flagged.
Per DATA_RUNBOOK's own rule: a work with no evidence prints "NO EVIDENCE GATHERED — do not score
from memory" on a worksheet and must be left blank, not guessed at.

## Summary

| Medium | Total | With tags (scoreable) | No tags (flag, don't guess) | Coverage |
|---|---|---|---|---|
| Movies | 1,000 | 972 | 28 | 97.2% |
| TV | 250 | 240 | 10 | 96.0% |
| Books | 1,000 | 719 | 281 | 71.9% |
| Games | 258 | 230 | 28 | 89.1% |

Sources per medium: movies/TV — TMDB keywords; books — OpenLibrary subjects + Google Books
categories + Wikidata genre/subject (P136/P921); games — Wikidata genre/subject (IGDB has no key
configured, so it contributes nothing this run).

Books is the one real gap, and it's a genuine gap, not a bug: OpenLibrary/Google Books/Wikidata
all key off search-matching a title, and these three sources together still can't find rich
subject/category data for a meaningful share of older, more obscure, or single-word/generic-titled
books — several of the untagged titles are 18th–20th-century classics, philosophy, and poetry
where none of the three catalogues carries a populated subject list even on a correct title match
(confirmed during this session's book fact-fetching: the same title-collision guard that protects
facts also means an untagged result is a genuine "nothing found," not a suppressed wrong match).

## Movies without evidence (28)

m62, m116, m117, m120, m122, m160, m240, m244, m276, m284, m296, m303, m404, m406, m467, m823,
m840, m871, m594, m621, m630, m651, m664, m700, m716, m717, m726, m750

## TV without evidence (10)

t02, t110, t140, t144, t152, t172, t173, t222, t244, t246

## Games without evidence (28)

g14, g18, g23, g33, g53, g59, g65, g75, g91, g92, g93, g107, g114, g126, g138, g145, g164, g173,
g176, g183, g200, g205, g209, g221, g244, g248, g251, g254

## Books without evidence (281)

b05, b07, b08, b10, b11, b13, b16, b17, b28, b29, b32, b33, b37, b44, b46, b48, b51, b83, b94,
b129, b141, b142, b144, b157, b168, b170, b171, b180, b191, b193, b194, b195, b196, b197, b198,
b200, b201, b202, b206, b214, b215, b217, b223, b225, b228, b243, b244, b251, b253, b255, b258,
b260, b263, b266, b270, b272, b276, b283, b284, b286, b294, b300, b302, b303, b306, b309, b311,
b318, b324, b325, b329, b331, b339, b340, b342, b346, b350, b351, b352, b354, b355, b361, b363,
b365, b369, b370, b372, b373, b377, b379, b381, b384, b390, b391, b393, b394, b398, b399, b402,
b404, b407, b409, b413, b417, b420, b425, b429, b433, b439, b440, b441, b444, b454, b465, b467,
b479, b482, b487, b490, b492, b497, b500, b527, b537, b553, b561, b576, b577, b578, b582, b593,
b596, b598, b601, b602, b603, b605, b613, b614, b621, b623, b627, b630, b633, b638, b639, b648,
b649, b650, b651, b654, b659, b664, b667, b669, b676, b680, b683, b684, b691, b692, b693, b698,
b700, b703, b705, b706, b707, b708, b709, b713, b714, b715, b716, b717, b719, b720, b721, b722,
b724, b725, b727, b729, b731, b736, b737, b738, b741, b743, b751, b754, b757, b762, b763, b765,
b770, b786, b794, b795, b799, b800, b804, b806, b807, b810, b812, b813, b815, b816, b824, b825,
b826, b827, b828, b836, b845, b847, b855, b857, b860, b868, b873, b882, b887, b889, b891, b892,
b895, b897, b899, b906, b907, b908, b910, b911, b912, b913, b914, b915, b919, b923, b924, b928,
b929, b930, b931, b933, b934, b939, b941, b946, b950, b951, b953, b960, b963, b965, b966, b967,
b971, b972, b973, b974, b978, b979, b985, b986, b988, b989, b991, b994, b996, b997, b999, b1000,
b1001, b1003, b1005, b1006, b1007, b1008

## What this means for Phase C

- Do not score these works from memory. The calibration worksheets and any full-corpus scoring
  pass must either skip them (leaving the field unscored, same as an unscored field today) or the
  owner scores them by direct familiarity with the work rather than "from evidence" — a different,
  explicitly-labelled provenance, not silently blended with evidence-sourced scores.
- None of the 40-work self-consistency sample or the 120-work calibration sample includes any of
  these ids — both samples were built preferring tagged works within each decile-medium cell, and
  every cell had enough tagged works available, so neither sample needed to fall back.
- Worth a second substance pass on the 281 untagged books specifically, if closing that gap further
  matters before Phase C scales past the calibration set — candidates: a looser OpenLibrary query
  (drop `intitle:`-style exact matching), or accepting subject data from an edition other than the
  first search hit.
