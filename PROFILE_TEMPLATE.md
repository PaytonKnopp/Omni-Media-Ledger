# Profile template

Almost no personalization needs this file anymore: expand any card and click
**Declare favorite**, **Mark owned**, **Boost `<creator>`**, click a genre or vibe
chip to boost it, **Silver tier**, or click the ☆ Rate chip at the bottom-right of
any card to give it your own 0–10 score, to build a profile entirely by clicking.
This document is for the one field those buttons don't cover yet —
`cosmicHorrorCanon` — or if you'd rather hand-build or bulk-edit a whole profile
at once. This is that file's shape, documented field by field, with a small
filled-in example.

**Finding a work's ID:** every card in the Global Controller carries its ID in the
page itself — right-click a card → Inspect, and look for `data-id="m117"` (or `t..`,
`g..`, `b..` for TV/games/books, `c..` for Contenders Ledger entries) on the card's
clickable header. There's no in-app "copy ID" button yet — this is the practical way
today.

You don't need to fill in every field. Anything left out is simply empty for that
person — the engine works fine with a partial profile.

**Import accepts two shapes:** a bare object like the example below (what this
document has always documented, and what hand-built files naturally are), or the
fuller `{version, profile, watchlist, theme, density}` snapshot that the header's
**Export** button now produces — Import auto-detects which one it's looking at by
checking for a `profile` key, so both work without any conversion.

```json
{
  "ownedMedia": {
    "m117": "4K",
    "t17": "Box Set"
  },
  "ownedBooksExtra": {
    "b58": "Paperback"
  },
  "ownedGameIds": ["g45"],

  "declaredCanon": [
    { "cat": "Movies", "items": [
      { "name": "Oppenheimer", "q": "Oppenheimer" }
    ]},
    { "cat": "Books", "items": [
      { "name": "Dune", "q": "Dune" }
    ]}
  ],
  "declaredGoatIds": ["m09"],

  "creatorBoost": [["Denis Villeneuve", 12], ["Greta Gerwig", 8]],
  "bookCreatorBoost": [["Frank Herbert", 10]],
  "genreBoost": [["sci-fi", 5], ["drama", 3]],
  "vibeBoost": { "Late-Night Cosmic Dread": 6 },

  "silverTierIds": ["m14"],
  "bronzeTierIds": ["m22"],
  "ratings": { "m09": 9.5, "b19": 8.5 },

  "watchlist": { "c02": 1 },
  "pinnedIdx": ["snd", "scary"]
}
```

## Field reference

| Field | Shape | What it does |
| --- | --- | --- |
| `ownedMedia` | `{ id: format }` | Marks a film/TV work as owned. `format` is just a label shown in the Collection tab (e.g. `"4K"`, `"BD/DVD"`, `"Box Set"`) — it doesn't affect scoring. |
| `ownedBooksExtra` | `{ id: format }` | Same, for books (`"Paperback"`, `"Hardcover"`, `"Deluxe"`, `"Boxed Set"`). |
| `ownedGameIds` | `[id, ...]` | Marks games as owned. |
| `declaredCanon` | `[{ cat, items: [{ name, q?, note? }] }]` | What shows as your declared favorites on the GOAT Profile tab. `cat` is a free-text category label (Movies, Books, TV Shows, Video Game, Director, Actors, Composers, Cinematographer, Artist, YouTube are the ones the app was built around, but any label works — it's just a heading). `q` is optional: if set and it matches a work's title, that item becomes clickable ("open in Global Controller"). |
| `declaredGoatIds` | `[id, ...]` | Corpus works pinned to a 100 match score and flagged as your declared canon — these are what actually drive the generated recommendations, separate from the display-only `declaredCanon` above. |
| `creatorBoost` | `[[nameSubstring, weight], ...]` | Boosts any work whose creator field contains `nameSubstring`. Weight is roughly 1–15; higher pulls harder. |
| `bookCreatorBoost` | `[[nameSubstring, weight], ...]` | Same, for book authors specifically. |
| `genreBoost` | `[[genreKeyword, weight], ...]` | Boosts works whose genre list contains `genreKeyword` (lowercase, substring match — `"sci-fi"`, `"noir"`, `"heist"`, etc.). Click any genre chip on an expanded card to toggle it. |
| `vibeBoost` | `{ vibeTag: weight }` | Boosts works tagged with an exact vibe/context string (see any card's vibe tag in the app for exact spelling). Click the vibe chip on an expanded card to toggle it. |
| `silverTierIds` | `[id, ...]` | Silver tier — a strong favorite, one notch below Gold (`declaredGoatIds`). Click **Silver tier** on any card's compact row (or an expanded card) to toggle it. |
| `bronzeTierIds` | `[id, ...]` | Bronze tier — a lighter nudge than Silver, for "really like it" without full Gold/Silver weight. Same compact row, **Bronze tier**. |
| `ratings` | `{ id: score }` | Your own personal rating for any work, any medium — 0–10, to one decimal. Optional per title; leaving a work out of this map just means it's unrated. Click the ☆ Rate / ★ chip at the bottom-right of any card to set or clear it. Blends into that work's ★ GOAT Match (a real pull toward the number you gave it, not just a floor — a low rating can pull the match down, not only up), and teaches the same genre/vibe affinity engine `declaredGoatIds`/`silverTierIds`/`bronzeTierIds` do, scaled continuously by how far the rating sits from the 5.0 midpoint. |
| `notInterested` | `{ id: timestamp }` | Titles you passed on with the ✕ on a card ("not interested"), each with when you did it (milliseconds). A passed title is hidden from every list and recommendation — search still finds it — and teaches the same affinity engine as a moderate "no", so similar works rank a little lower. It only counts where nothing stronger was said about the same work: rating, tiering or owning a title clears its pass. Optional; leave it out if you have passed on nothing. |
| `cosmicHorrorDeclaredIds` / `cosmicHorrorCanon` | `[id,...]` / `{ id: score }` | Feed the Cosmic Horror Index in Reference Matrices, same idea as above. |
| `watchlist` | `{ contenderId: rank }` | Ranks specific Contenders Ledger entries (`c01`, `c02`, ...) above the model's own anticipation score, in the order given. |
| `pinnedIdx` | `[indexKey, ...]` | Which of the 16 specialized index sliders (Soundtrack `snd`, Cosmic Horror `ch`, Scariest `scary`, Iconicness `icon`, etc. — see `INDEX_DEFS` in `index.html` for the full key list) show pinned to the main filter screen instead of tucked inside Advanced Filters. Click the 📌 on any slider to toggle it — this only changes what's convenient to filter by, it never affects scoring. |

## How to use it

1. Copy the JSON above, edit it with real titles/creators/genres you care about.
2. Save it as a `.json` file.
3. Open `index.html` (your own account if cloud accounts are set up, or any fresh browser otherwise), click **Import** in the header, pick your file.
4. The page reloads with your profile applied. Use **Export** any time to get the
   current state back out as a file — handy for moving between browsers/devices, or
   for backing up before you experiment further.
