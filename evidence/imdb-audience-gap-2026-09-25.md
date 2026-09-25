# Corpus audienceScore vs IMDb user rating

Generated 2026-09-25 by `scripts/measure-imdb-gap.js`. A measurement only: nothing in `data/` was changed.

Each movie and TV work was matched to TMDB by normalised title or original title (exact, or exact plus a `:`/`or` subtitle) within ±1 year of the corpus year, taking the most-voted TMDB candidate when several qualify, then to its IMDb id through TMDB's external ids, then looked up in IMDb's `title.ratings.tsv.gz` (downloaded 2026-09-25, 1,713,837 rated titles). Games and books are out of scope. The per-work table is in the `.json` beside this file.

Rows marked ⚠ have fewer than 1,000 IMDb votes: their IMDb mean is noisy, and a big gap there may be IMDb's noise as much as ours. A big gap can also mean the match itself is wrong (a same-titled work within a year), so check the IMDb id before acting on any single row.

## Movies

**Matched: 1976 of 2012** (98%) have an IMDb rating to compare against.

| Outcome | Works |
|---|---:|
| TMDB match, IMDb id, IMDb rating | 1976 |
| No TMDB result with the title within ±1 year | 36 |

Gap = our `audienceScore` − IMDb rating × 10. Positive = the corpus rates it higher than IMDb users do.

| | All matched | ≥ 1,000 IMDb votes |
|---|---:|---:|
| Works | 1976 | 1976 |
| ***Offset*** | | |
| **Average offset** (mean gap) | **+5.4** | **+5.4** |
| Median gap | +6.0 | +6.0 |
| Corpus higher / lower than IMDb | 1551 / 352 | 1551 / 352 |
| ***Raw gap*** | | |
| **Median absolute gap** (typical) | **7.0** | **7.0** |
| Mean / RMS absolute gap | 7.2 / 8.5 | 7.2 / 8.5 |
| Within ±5 / ±10 points | 37% / 78% | 37% / 78% |
| 90th / 95th percentile absolute gap | 13.0 / 15.0 | 13.0 / 15.0 |
| Gaps over 15 / over 20 points | 65 / 21 | 65 / 21 |
| **Worst absolute gap** | **28.0** | **28.0** |
| ***Gap after removing the offset*** | | |
| **Median absolute gap** (typical) | **4.4** | **4.4** |
| Mean / RMS absolute gap | 5.1 / 6.6 | 5.1 / 6.6 |
| Within ±5 / ±10 points | 59% / 89% | 59% / 89% |
| 90th / 95th percentile absolute gap | 10.4 / 13.4 | 10.4 / 13.4 |
| Gaps over 15 / over 20 points | 63 / 18 | 63 / 18 |
| Worst absolute gap | 30.4 | 30.4 |
| ***Order and spread*** | | |
| **Spearman rank correlation** | **0.81** | **0.81** |
| Pearson correlation | 0.84 | 0.84 |
| Spread (SD): ours / IMDb×10 | 11.5 / 7.8 | 11.5 / 7.8 |

### 20 biggest outliers

Ranked by raw gap. "Gap − offset" subtracts this medium's average offset (+5.4); "Percentile" is the work's standing among the 1976 matched movies on each side (ours → IMDb).

| # | id | Title | Year | Ours | IMDb ×10 | Gap | Gap − offset | Percentile | IMDb votes | IMDb id |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | m1123 | Black Panther: Wakanda Forever | 2022 | 94 | 66.0 | +28.0 | +22.6 | 98 → 19 | 402,463 | tt9114286 |
| 2 | m116 | Iron Lung | 2025 | 86 | 58.0 | +28.0 | +22.6 | 74 → 5 | 32,362 | tt27564844 |
| 3 | m69 | Mandy | 2018 | 92 | 65.0 | +27.0 | +21.6 | 94 → 16 | 99,757 | tt6998518 |
| 4 | m1005 | Ad Astra | 2019 | 40 | 65.0 | -25.0 | -30.4 | 0 → 16 | 284,461 | tt2935510 |
| 5 | m1015 | Star Wars: The Last Jedi | 2017 | 43 | 68.0 | -25.0 | -30.4 | 1 → 25 | 727,584 | tt2527336 |
| 6 | m1129 | Black Widow | 2021 | 91 | 66.0 | +25.0 | +19.6 | 92 → 19 | 490,178 | tt3480822 |
| 7 | m1186 | Scream VI | 2023 | 89 | 64.0 | +25.0 | +19.6 | 85 → 14 | 155,954 | tt17663992 |
| 8 | m1414 | Bad Boys for Life | 2020 | 90 | 65.0 | +25.0 | +19.6 | 89 → 16 | 199,748 | tt1502397 |
| 9 | m1152 | Saw X | 2023 | 90 | 66.0 | +24.0 | +18.6 | 89 → 19 | 100,414 | tt21807222 |
| 10 | m961 | Terrifier 2 | 2022 | 84 | 60.0 | +24.0 | +18.6 | 64 → 7 | 84,795 | tt10403420 |
| 11 | m1059 | Creed III | 2023 | 90 | 67.0 | +23.0 | +17.6 | 89 → 22 | 111,291 | tt11145118 |
| 12 | m1511 | Fast X | 2023 | 80 | 57.0 | +23.0 | +17.6 | 49 → 4 | 150,358 | tt5433140 |
| 13 | m1167 | Ghostbusters: Afterlife | 2021 | 92 | 70.0 | +22.0 | +16.6 | 94 → 32 | 243,593 | tt4513678 |
| 14 | m100 | Sinners | 2025 | 96 | 75.0 | +21.0 | +15.6 | 99 → 57 | 527,177 | tt31193180 |
| 15 | m1095 | Terminator Genisys | 2015 | 42 | 63.0 | -21.0 | -26.4 | 1 → 12 | 310,164 | tt1340138 |
| 16 | m1130 | Shang-Chi and the Legend of the Ten Rings | 2021 | 94 | 73.0 | +21.0 | +15.6 | 98 → 46 | 502,664 | tt9376612 |
| 17 | m1155 | Furious 7 | 2015 | 92 | 71.0 | +21.0 | +15.6 | 94 → 37 | 445,244 | tt2820852 |
| 18 | m1160 | Godzilla Minus One | 2023 | 97 | 76.0 | +21.0 | +15.6 | 100 → 63 | 231,333 | tt23289160 |
| 19 | m1360 | Anyone but You | 2023 | 82 | 61.0 | +21.0 | +15.6 | 56 → 8 | 180,416 | tt26047818 |
| 20 | m1388 | Mother! | 2017 | 45 | 66.0 | -21.0 | -26.4 | 1 → 19 | 270,987 | tt5109784 |

### 20 biggest rank disagreements

Ranked by how far apart the work's percentile is on the two sides. This is the disagreement that survives the app's per-medium normalisation.

| # | id | Title | Year | Ours | IMDb ×10 | Percentile | Δ percentile | Gap | IMDb votes | IMDb id |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | m1123 | Black Panther: Wakanda Forever | 2022 | 94 | 66.0 | 98 → 19 | +79 | +28.0 | 402,463 | tt9114286 |
| 2 | m69 | Mandy | 2018 | 92 | 65.0 | 94 → 16 | +78 | +27.0 | 99,757 | tt6998518 |
| 3 | m1129 | Black Widow | 2021 | 91 | 66.0 | 92 → 19 | +73 | +25.0 | 490,178 | tt3480822 |
| 4 | m1414 | Bad Boys for Life | 2020 | 90 | 65.0 | 89 → 16 | +73 | +25.0 | 199,748 | tt1502397 |
| 5 | m1186 | Scream VI | 2023 | 89 | 64.0 | 85 → 14 | +71 | +25.0 | 155,954 | tt17663992 |
| 6 | m1152 | Saw X | 2023 | 90 | 66.0 | 89 → 19 | +70 | +24.0 | 100,414 | tt21807222 |
| 7 | m116 | Iron Lung | 2025 | 86 | 58.0 | 74 → 5 | +69 | +28.0 | 32,362 | tt27564844 |
| 8 | m1059 | Creed III | 2023 | 90 | 67.0 | 89 → 22 | +67 | +23.0 | 111,291 | tt11145118 |
| 9 | m1889 | A Face in the Crowd | 1957 | 72 | 81.0 | 26 → 89 | -63 | -9.0 | 19,574 | tt0050371 |
| 10 | m1167 | Ghostbusters: Afterlife | 2021 | 92 | 70.0 | 94 → 32 | +62 | +22.0 | 243,593 | tt4513678 |
| 11 | m1883 | Fail Safe | 1964 | 72 | 80.0 | 26 → 84 | -58 | -8.0 | 28,427 | tt0058083 |
| 12 | m1891 | Inherit the Wind | 1960 | 74 | 81.0 | 31 → 89 | -58 | -7.0 | 35,974 | tt0053946 |
| 13 | m1155 | Furious 7 | 2015 | 92 | 71.0 | 94 → 37 | +57 | +21.0 | 445,244 | tt2820852 |
| 14 | m961 | Terrifier 2 | 2022 | 84 | 60.0 | 64 → 7 | +57 | +24.0 | 84,795 | tt10403420 |
| 15 | m84 | Shutter Island | 2010 | 77 | 82.0 | 37 → 93 | -56 | -5.0 | 1,686,366 | tt1130884 |
| 16 | m721 | La Terra Trema | 1948 | 68 | 78.0 | 19 → 74 | -55 | -10.0 | 6,313 | tt0040866 |
| 17 | m1394 | The Devil Wears Prada | 2006 | 89 | 70.0 | 85 → 32 | +53 | +19.0 | 573,334 | tt0458352 |
| 18 | m1886 | Advise & Consent | 1962 | 66 | 77.0 | 15 → 68 | -53 | -11.0 | 8,180 | tt0055728 |
| 19 | m233 | E.T. the Extra-Terrestrial | 1982 | 72 | 79.0 | 26 → 79 | -53 | -7.0 | 477,173 | tt0083866 |
| 20 | m720 | Shoeshine | 1946 | 74 | 80.0 | 31 → 84 | -53 | -6.0 | 9,157 | tt0038913 |

<details><summary>Unmatched works (36)</summary>

| id | Title | Year | Why |
|---|---|---:|---|
| m62 | The End of Evangelion | 1997 | no-tmdb-match |
| m117 | Harry Potter and the Sorcerer's Stone | 2001 | no-tmdb-match |
| m120 | The Odyssey (Nolan) | 2026 | no-tmdb-match |
| m122 | Star Wars: A New Hope | 1977 | no-tmdb-match |
| m276 | Wages of Fear | 1953 | no-tmdb-match |
| m284 | Mad Max 2: The Road Warrior | 1981 | no-tmdb-match |
| m303 | Nausicaä of the Valley of the Wind | 1984 | no-tmdb-match |
| m467 | Ringu | 1998 | no-tmdb-match |
| m989 | You're Next | 2011 | no-tmdb-match |
| m651 | Dont Look Back | 1967 | no-tmdb-match |
| m700 | National Lampoon's Animal House | 1978 | no-tmdb-match |
| m1010 | Star Wars: The Empire Strikes Back | 1980 | no-tmdb-match |
| m1011 | Star Wars: Return of the Jedi | 1983 | no-tmdb-match |
| m1086 | The Hunger Games: The Ballad of Songbirds and Snakes | 2023 | no-tmdb-match |
| m1089 | Alien 3 | 1992 | no-tmdb-match |
| m1108 | X2: X-Men United | 2003 | no-tmdb-match |
| m1112 | X-Men: Dark Phoenix | 2019 | no-tmdb-match |
| m1170 | Ocean's 8 | 2018 | no-tmdb-match |
| m1265 | 101 Dalmatians | 1961 | no-tmdb-match |
| m1305 | The Boy in the Striped Pajamas | 2008 | no-tmdb-match |
| m1331 | Alien vs. Predator | 2004 | no-tmdb-match |
| m1390 | The Human Centipede | 2009 | no-tmdb-match |
| m1419 | European Vacation | 1985 | no-tmdb-match |
| m1420 | Christmas Vacation | 1989 | no-tmdb-match |
| m1455 | MASH | 1970 | no-tmdb-match |
| m1515 | The Transporter 2 | 2005 | no-tmdb-match |
| m1547 | Gone in 60 Seconds | 2000 | no-tmdb-match |
| m1582 | Twelve Angry Men | 1957 | no-tmdb-match |
| m1704 | Dr. Dolittle | 1998 | no-tmdb-match |
| m1828 | Il Postino: The Postman | 1994 | no-tmdb-match |
| m1834 | 12 Monkeys | 1995 | no-tmdb-match |
| m1879 | Apocalypse Now Redux | 2001 | no-tmdb-match |
| m1909 | Blood In Blood Out | 1993 | no-tmdb-match |
| m1924 | When the Levees Broke | 2006 | no-tmdb-match |
| m1946 | The Great Train Robbery (1978) | 1978 | no-tmdb-match |
| m1948 | Gone in 60 Seconds (2000) | 2000 | no-tmdb-match |

</details>

## TV

**Matched: 486 of 503** (97%) have an IMDb rating to compare against.

| Outcome | Works |
|---|---:|
| TMDB match, IMDb id, IMDb rating | 486 |
| TMDB match but TMDB lists no IMDb id | 1 |
| No TMDB result with the title within ±1 year | 16 |

Gap = our `audienceScore` − IMDb rating × 10. Positive = the corpus rates it higher than IMDb users do.

| | All matched | ≥ 1,000 IMDb votes |
|---|---:|---:|
| Works | 486 | 486 |
| ***Offset*** | | |
| **Average offset** (mean gap) | **+4.0** | **+4.0** |
| Median gap | +4.0 | +4.0 |
| Corpus higher / lower than IMDb | 402 / 57 | 402 / 57 |
| ***Raw gap*** | | |
| **Median absolute gap** (typical) | **4.0** | **4.0** |
| Mean / RMS absolute gap | 4.9 / 6.1 | 4.9 / 6.1 |
| Within ±5 / ±10 points | 63% / 94% | 63% / 94% |
| 90th / 95th percentile absolute gap | 9.0 / 11.0 | 9.0 / 11.0 |
| Gaps over 15 / over 20 points | 6 / 3 | 6 / 3 |
| **Worst absolute gap** | **24.0** | **24.0** |
| ***Gap after removing the offset*** | | |
| **Median absolute gap** (typical) | **3.0** | **3.0** |
| Mean / RMS absolute gap | 3.2 / 4.6 | 3.2 / 4.6 |
| Within ±5 / ±10 points | 80% / 97% | 80% / 97% |
| 90th / 95th percentile absolute gap | 7.0 / 8.0 | 7.0 / 8.0 |
| Gaps over 15 / over 20 points | 5 / 3 | 5 / 3 |
| Worst absolute gap | 28.0 | 28.0 |
| ***Order and spread*** | | |
| **Spearman rank correlation** | **0.75** | **0.75** |
| Pearson correlation | 0.71 | 0.71 |
| Spread (SD): ours / IMDb×10 | 6.0 / 6.0 | 6.0 / 6.0 |

### 20 biggest outliers

Ranked by raw gap. "Gap − offset" subtracts this medium's average offset (+4.0); "Percentile" is the work's standing among the 486 matched TV shows on each side (ours → IMDb).

| # | id | Title | Year | Ours | IMDb ×10 | Gap | Gap − offset | Percentile | IMDb votes | IMDb id |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | t05 | Watchmen | 2019 | 58 | 82.0 | -24.0 | -28.0 | 0 → 48 | 148,465 | tt7049682 |
| 2 | t442 | Hannah Montana | 2006 | 78 | 55.0 | +23.0 | +19.0 | 10 → 0 | 48,170 | tt0493093 |
| 3 | t63 | The Curse | 2023 | 48 | 71.0 | -23.0 | -27.0 | 0 → 6 | 17,793 | tt13623608 |
| 4 | t467 | Melrose Place | 1992 | 76 | 60.0 | +16.0 | +12.0 | 5 → 0 | 14,512 | tt0103491 |
| 5 | t493 | Supergirl | 2015 | 78 | 62.0 | +16.0 | +12.0 | 10 → 1 | 136,211 | tt4016454 |
| 6 | t517 | The Witcher | 2019 | 62 | 78.0 | -16.0 | -20.0 | 1 → 25 | 625,596 | tt5180504 |
| 7 | t323 | The Powerpuff Girls | 1998 | 87 | 73.0 | +14.0 | +10.0 | 58 → 8 | 53,291 | tt0175058 |
| 8 | t427 | Mad About You | 1992 | 82 | 68.0 | +14.0 | +10.0 | 25 → 3 | 27,496 | tt0103484 |
| 9 | t428 | Full House | 1987 | 82 | 68.0 | +14.0 | +10.0 | 25 → 3 | 67,912 | tt0092359 |
| 10 | t440 | iCarly | 2007 | 82 | 68.0 | +14.0 | +10.0 | 25 → 3 | 50,932 | tt0972534 |
| 11 | t468 | Beverly Hills, 90210 | 1990 | 80 | 66.0 | +14.0 | +10.0 | 17 → 2 | 41,427 | tt0098749 |
| 12 | t475 | Lizzie McGuire | 2001 | 80 | 66.0 | +14.0 | +10.0 | 17 → 2 | 21,864 | tt0273366 |
| 13 | t37 | Silo | 2023 | 68 | 81.0 | -13.0 | -17.0 | 1 → 41 | 243,550 | tt14688458 |
| 14 | t450 | Danny Phantom | 2004 | 85 | 72.0 | +13.0 | +9.0 | 43 → 7 | 23,748 | tt0366005 |
| 15 | t492 | The Flash | 2014 | 87 | 74.0 | +13.0 | +9.0 | 58 → 11 | 388,921 | tt3107288 |
| 16 | t300 | Tuca & Bertie | 2019 | 86 | 74.0 | +12.0 | +8.0 | 51 → 11 | 9,375 | tt8036272 |
| 17 | t33 | The Knick | 2014 | 96 | 84.0 | +12.0 | +8.0 | 99 → 63 | 57,702 | tt2937900 |
| 18 | t429 | Family Matters | 1989 | 78 | 66.0 | +12.0 | +8.0 | 10 → 2 | 32,418 | tt0096579 |
| 19 | t465 | Dynasty | 1981 | 76 | 64.0 | +12.0 | +8.0 | 5 → 1 | 9,493 | tt0081856 |
| 20 | t64 | Undone | 2019 | 94 | 82.0 | +12.0 | +8.0 | 96 → 48 | 27,199 | tt8101850 |

### 20 biggest rank disagreements

Ranked by how far apart the work's percentile is on the two sides. This is the disagreement that survives the app's per-medium normalisation.

| # | id | Title | Year | Ours | IMDb ×10 | Percentile | Δ percentile | Gap | IMDb votes | IMDb id |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | t41 | Game of Thrones | 2011 | 82 | 92.0 | 25 → 98 | -73 | -10.0 | 2,665,289 | tt0944947 |
| 2 | t11 | Westworld | 2016 | 77 | 84.0 | 7 → 63 | -56 | -7.0 | 561,586 | tt0475784 |
| 3 | t267 | The Honeymooners | 1955 | 82 | 86.0 | 25 → 80 | -55 | -4.0 | 6,943 | tt0042114 |
| 4 | t400 | House of Cards | 2013 | 82 | 86.0 | 25 → 80 | -55 | -4.0 | 563,722 | tt1856010 |
| 5 | t192 | Oz | 1997 | 84 | 87.0 | 35 → 87 | -52 | -3.0 | 118,017 | tt0118421 |
| 6 | t418 | Reacher | 2022 | 91 | 80.0 | 86 → 35 | +51 | +11.0 | 317,822 | tt9288030 |
| 7 | t323 | The Powerpuff Girls | 1998 | 87 | 73.0 | 58 → 8 | +50 | +14.0 | 53,291 | tt0175058 |
| 8 | t22 | Fargo | 2014 | 85 | 88.0 | 43 → 92 | -49 | -3.0 | 475,738 | tt2802850 |
| 9 | t304 | The Newsroom | 2012 | 83 | 86.0 | 31 → 80 | -49 | -3.0 | 136,627 | tt1870479 |
| 10 | t312 | Adolescence | 2025 | 92 | 81.0 | 90 → 41 | +49 | +11.0 | 317,176 | tt31806037 |
| 11 | t05 | Watchmen | 2019 | 58 | 82.0 | 0 → 48 | -48 | -24.0 | 148,465 | tt7049682 |
| 12 | t64 | Undone | 2019 | 94 | 82.0 | 96 → 48 | +48 | +12.0 | 27,199 | tt8101850 |
| 13 | t232 | Sacred Games | 2018 | 82 | 85.0 | 25 → 72 | -47 | -3.0 | 99,067 | tt6077448 |
| 14 | t45 | The Bear | 2022 | 82 | 85.0 | 25 → 72 | -47 | -3.0 | 326,376 | tt14452776 |
| 15 | t492 | The Flash | 2014 | 87 | 74.0 | 58 → 11 | +47 | +13.0 | 388,921 | tt3107288 |
| 16 | t27 | Black Mirror | 2011 | 85 | 87.0 | 43 → 87 | -44 | -2.0 | 749,723 | tt2085059 |
| 17 | t513 | Cheer | 2020 | 90 | 80.0 | 79 → 35 | +44 | +10.0 | 7,325 | tt11426660 |
| 18 | t55 | The Returned | 2012 | 90 | 80.0 | 79 → 35 | +44 | +10.0 | 22,503 | tt2521668 |
| 19 | t116 | Dekalog | 1989 | 86 | 89.0 | 51 → 94 | -43 | -3.0 | 35,286 | tt0092337 |
| 20 | t310 | Poker Face | 2023 | 88 | 77.0 | 65 → 22 | +43 | +11.0 | 69,523 | tt14269590 |

<details><summary>Unmatched works (17)</summary>

| id | Title | Year | Why |
|---|---|---:|---|
| t02 | Twin Peaks: The Return | 2017 | no-tmdb-match |
| t110 | Mushishi | 2005 | no-tmdb-match |
| t144 | Peaky Blinders: The Immortal Man | 2026 | no-tmdb-match |
| t152 | Deadwood: The Movie | 2019 | no-tmdb-match |
| t172 | The Office (US) | 2005 | no-tmdb-match |
| t173 | The Office (UK) | 2001 | no-tmdb-match |
| t222 | Deutschland 83 | 2015 | no-tmdb-match |
| t244 | Odd Taxi | 2021 | no-tmdb-match |
| t246 | Haikyuu!! | 2014 | no-tmdb-match |
| t292 | Daredevil | 2015 | no-tmdb-match |
| t315 | Looney Tunes | 1930 | no-imdb-id |
| t316 | Tom and Jerry | 1940 | no-tmdb-match |
| t396 | Cosmos: A Spacetime Odyssey | 2014 | no-tmdb-match |
| t398 | Are You Afraid of the Dark? | 1990 | no-tmdb-match |
| t419 | Jack Ryan | 2018 | no-tmdb-match |
| t451 | Degrassi: The Next Generation | 2001 | no-tmdb-match |
| t494 | Legends of Tomorrow | 2016 | no-tmdb-match |

</details>

---

_This product uses the TMDB API but is not endorsed or certified by TMDB. Information courtesy of IMDb (https://www.imdb.com). Used with permission, for personal and non-commercial use._
