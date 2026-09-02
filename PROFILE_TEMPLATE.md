# Profile template

Most personalization no longer needs this file: expand any card and use **Declare
favorite**, **Mark owned**, or **Boost `<creator>`** to build a profile by clicking.
This document is for the fields those buttons don't cover yet — `genreBoost`,
`vibeBoost`, `silverTierIds`, `bookAffinity`, `cosmicHorrorCanon` — or if you'd rather
hand-build or bulk-edit a whole profile at once. This is that file's shape, documented
field by field, with a small filled-in example.

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
  "bookAffinity": { "b19": 92 },

  "watchlist": { "c02": 1 }
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
| `genreBoost` | `[[genreKeyword, weight], ...]` | Boosts works whose genre list contains `genreKeyword` (lowercase, substring match — `"sci-fi"`, `"noir"`, `"heist"`, etc.). |
| `vibeBoost` | `{ vibeTag: weight }` | Boosts works tagged with an exact vibe/context string (see any card's vibe tag in the app for exact spelling). |
| `silverTierIds` | `[id, ...]` | Second-tier favorites — less pull than `declaredGoatIds`, but still lifts the score meaningfully. |
| `bookAffinity` | `{ id: scoreFloor }` | Sets a specific book's match score to at least this value (0–100). |
| `cosmicHorrorDeclaredIds` / `cosmicHorrorCanon` | `[id,...]` / `{ id: score }` | Feed the Cosmic Horror Index in Reference Matrices, same idea as above. |
| `watchlist` | `{ contenderId: rank }` | Ranks specific Contenders Ledger entries (`c01`, `c02`, ...) above the model's own anticipation score, in the order given. |

## How to use it

1. Copy the JSON above, edit it with real titles/creators/genres you care about.
2. Save it as a `.json` file.
3. Open `share.html`, click **Import** in the header, pick your file.
4. The page reloads with your profile applied. Use **Export** any time to get the
   current state back out as a file — handy for moving between browsers/devices, or
   for backing up before you experiment further.
