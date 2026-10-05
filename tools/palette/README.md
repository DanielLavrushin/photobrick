# @photobrick/palette-tool

Builds the palette files the engine ships with:

| Output | Part |
| --- | --- |
| `packages/engine/src/palette/98138.json` | 98138 Tile Round 1 x 1 (the default mosaic part) |
| `packages/engine/src/palette/6141.json` | 6141 Plate Round 1 x 1 with Solid Stud, BrickLink 4073 (for a future "studded" option) |

The files follow the `Palette` / `PaletteColor` types in `packages/engine/src/types.ts`. They are generated,
never hand-edited, and committed. The app never talks to Rebrickable, BrickLink or LEGO at runtime.

## Usage

```sh
pnpm palette                                  # 98138, downloads the CSVs if the cache is older than a day
pnpm palette -- --part 98138,6141             # several parts (the CSVs are read once)
pnpm palette -- --offline                     # use tools/palette/.cache only, no network at all
```

From `tools/palette`: `node --experimental-strip-types src/build.ts [options]`. Options:

| Option | Meaning |
| --- | --- |
| `--part <p>` | Part to build, repeatable or comma-separated. Known parts are listed in `src/config.ts`. Default 98138. |
| `--offline` | Use the cached CSV files only. Missing files are an error. |
| `--min-year <year>` | A colour is "current" if it appears in a set from this year on. Default 2023. |
| `--out <file>` | Write somewhere else (one part only). |
| `--cache <dir>` | CSV cache directory. Default `tools/palette/.cache` (gitignored). |
| `--external-from <file>` | Rebuild `data/colors-external.json` from a saved `/api/v3/lego/colors/` response. |

The tool prints every colour with its quantity, set count, last year, tier, Pick a Brick status and
element, the colours it skipped and why, any new codes, and warnings. It writes a file only when its
content changes. All writes are atomic (temporary file + rename), so the engine and the dev server
never read a half-written palette.

## Refreshing the palette (about monthly)

1. Run `pnpm palette -- --part 98138,6141` (with `REBRICKABLE_API_KEY` set if you also want to refresh the
   external colour ids).
2. Review the diff of `packages/engine/src/palette/*.json` and `tools/palette/data/*.json`. Look for colours that
   appear or disappear, tier changes and new codes.
3. Run the engine tests, then commit.

Never run the tool at build or deploy time, and never from the app.

## Where each field comes from

Rebrickable data comes from the CSV downloads at `https://cdn.rebrickable.com/media/downloads/<name>.csv.gz`:
`colors`, `elements`, `inventories`, `inventory_parts` and `sets`.

**Which colours are included.** A colour is included when all of these hold:

- It is a plain opaque colour. That means `is_trans` is false and the name shows no special finish (see
  `src/finish.ts`): chrome, metallic (including Flat Silver, Flat Dark Gold, Copper, Gold and Silver), pearl,
  glitter, glow, speckle, satin, opal, marbled, Clikits, Modulex, rubber or neon/fluorescent. Rebrickable's
  placeholder colours (`[Unknown]`, `[No Color/Any Color]`) are excluded too.
- It has at least one element of the part in `elements.csv`.
- It is current: it appears in a set released in `--min-year` or later.

**How sets are counted.** Only the newest inventory version of each set counts. Spare parts and minifigure
inventories are left out. These rules come from the research script `build_palette.py`.

| Field | Source |
| --- | --- |
| `part`, `partName`, `blPart` | `src/config.ts` |
| `rev` | Date of the `Last-Modified` header of `colors.csv.gz`, taken from the `.meta.json` sidecar written at download. Without a sidecar, the file's modification date is used. |
| `pricesAsOf` | The oldest date among the price snapshots used |
| `blEurDefault` | Median of the BrickLink sample's `soldNewQtyAvgDkk` / 7.46, rounded to 4 decimals. 6141 has no sample of its own, so it uses the 98138 sample. |
| `attribution` | Rebrickable credit plus the price sources and their date |
| `id`, `name`, `hex`, `rgb` | `colors.csv` |
| `code` | `data/codes.json` (see below) |
| `tier` | Pieces across set inventories: at least 300 is `core`, under 100 is `rare`, anything else is `extended` |
| `defaultEnabled` | If the part has a Pick a Brick snapshot: sold there. Otherwise: `tier !== 'rare'`. |
| `blId`, `blName`, `legoId` | `data/colors-external.json` |
| `elementId` | The Pick a Brick element if the colour is sold there. Otherwise the research heuristic over `elements.csv`: an element of a preferred design (`src/config.ts`) first, then the highest element id. |
| `pab`, `pabDkk` | `data/pab-dk-<part>.json`. Only status `AVAILABLE` counts as sold. |
| `pabEur` | `pabDkk / 7.46`, rounded to 2 decimals (the krone is pegged to the euro) |
| `blEur` | `data/bricklink-prices-<part>.json`, matched by BrickLink colour id: `soldNewQtyAvgDkk / 7.46`, rounded to 4 decimals. `null` if the colour was not sampled. |

The output is sorted by pieces in sets (descending), then by colour id. It is 2-space JSON with a trailing
newline, so the same inputs always give the same bytes.

## Data files (`data/`, committed)

### `codes.json`

Maps each Rebrickable colour id to its 2-character instruction code. **Codes are stable forever.**

- The file is append-only. A colour keeps its code even after it leaves every palette, and a code is never
  given to another colour.
- A new colour gets the first free candidate automatically: word initials (Sand Green → `SG`), then the first
  letter with each later letter, then the first letter with a digit, then any free code.
- The alphabet is A–Z and 2–9. The digits 0 and 1 are left out because they read as O and I.
- Colours are coded in ascending id order, so the result does not depend on the input order.
- The tool writes `codes.json` before any palette. Commit both together.

### `colors-external.json`

Maps each Rebrickable colour id to `{blId, blName, legoId}`. It comes from Rebrickable's `/api/v3/lego/colors/`
`external_ids`, taking the first BrickLink id with its name and the first LEGO id. Everything else in the
response is dropped. The file contains no API key.

- **Refresh:** run the tool with `REBRICKABLE_API_KEY` set. It pages through the API at most one request per
  second, sends the key only in the `Authorization: key …` header, and never logs it. The refresh is
  skipped with `--offline`.
- **From a saved response:** use `--external-from <file>`.

### `pab-dk-98138.json`: Pick a Brick snapshot (manual)

LEGO has no public Pick a Brick API.

- **Current snapshot:** read on 2026-09-24 from lego.com/da-dk. It lists every element returned by a Pick a
  Brick search for design 35381 (98138), with its price in DKK and its status.
- **Dark Purple (6476247):** it carries a note. The design search showed it as the selected product without a
  status, and a 98138 search the same day listed it as in stock.

To update it:

1. Open `https://www.lego.com/da-dk/pick-and-build/pick-a-brick` and search the design id (35381).
2. For each element, record:
   - `elementId`;
   - the Rebrickable `colorId` (the element's colour in `elements.csv`; the tool checks it and fails on a
     mismatch);
   - the Rebrickable colour `name`;
   - `priceDkk`;
   - `status`: `AVAILABLE` if it can be added to the bag, anything else (for example `OUT_OF_STOCK`) if not.
3. Update `date` and `source`, run the tool, and review the diff.

### `bricklink-prices-98138.json`: BrickLink sample (manual)

This is the BrickLink price guide for part 98138 on 2026-09-24, in DKK, for 14 colours. Each row holds:

- `soldNewQtyAvgDkk`: the "Last 6 Months Sales", New, quantity-weighted average price;
- the matching sale counts;
- the current listings (`stockNew*`).

Colours without a row use `blEurDefault`. BrickLink's API is only open to registered sellers, so the sample is
taken by hand.

To update it:

1. Open `https://www.bricklink.com/catalogPG.asp?P=98138&colorID=<BrickLink colour id>` for each colour.
2. Record the values with the BrickLink colour id and name.
3. Update `date`, run the tool, and review the diff.

Don't automate this. Anonymous price-guide views were blocked after about 16 pages in 10 minutes.

## Licence of the data

- **Rebrickable CSV downloads** (downloads page, checked via the Wayback copy of 2026-09-09): "you may automate
  downloading of these zipped CSV files at most once a day. You can use these files for any purpose, including
  commercial, provided you acknowledge Rebrickable as your source of data."
  - Credit is a **condition**. The UI must show "Colour and part data from Rebrickable (rebrickable.com)",
    which is also in each palette's `attribution`.
  - The tool re-downloads a cached file only when its modification time is more than 24 hours old, and
    never with `--offline`.
- **Rebrickable API** (ToS §5.1): any purpose, including commercial; credit is appreciated.
  - The limit is about one request per second, and the key must stay private.
  - The tool uses the API only at build time.
  - Scraping Rebrickable's web pages is forbidden (§5.3); the tool uses only the downloads and the API.
- **Prices:** snapshots of public LEGO Pick a Brick and BrickLink pages, used for cost estimates. They are
  dated in the palette (`pricesAsOf`) and must be presented as estimates.

## Seeding the cache by hand

To build from CSV files you already have (for example the research downloads):

1. Copy them into `tools/palette/.cache/` and keep their timestamps (`cp -p`).
2. Optionally add `colors.csv.gz.meta.json` with `{"url": "…", "lastModified": "2026-09-23", "downloadedAt": "…"}`
   so `rev` is the files' real date rather than the copy date.
3. Run with `--offline`.

Built this way from the 2026-09-23 research CSVs, the tool reproduces the original hand-built `98138.json`
with one correction. Vibrant Yellow's BrickLink price was missing: BrickLink calls that colour "Neon Yellow",
the one-off script matched by Rebrickable name, and the sampled price (0.34 kr → €0.0456) was lost. The
tool matches by BrickLink colour id.

## Development

```sh
pnpm --filter @photobrick/palette-tool test        # vitest
pnpm --filter @photobrick/palette-tool typecheck   # tsc
pnpm exec eslint tools/palette                     # from the repo root
```

The tool uses Node built-ins only (`fs`, `zlib`, `https`) and runs with `--experimental-strip-types`. That
flag means no enums, no namespaces and no constructor parameter properties. The workspace has no
`@types/node`, so `src/node-env.d.ts` declares the few Node APIs the tool uses. Replace it with `@types/node`
when that is added.
