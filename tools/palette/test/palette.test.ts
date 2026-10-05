import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type PartConfig } from '../src/config.ts';
import { buildPalette, median, preferredElement, selectColors, serializePalette, type PaletteInputs } from '../src/palette.ts';
import { loadDataset, type CsvName, type Dataset } from '../src/rebrickable.ts';
import { parseBrickLinkSnapshot, parsePabSnapshot, type BrickLinkSnapshot, type PabSnapshot } from '../src/snapshots.ts';

// A tiny Rebrickable world. Part 98138 in:
//   Black       400 pcs (inventory 2 = newest version of s1-1, 2024)       -> core
//   White       150 + 20 pcs (s1-1 2024, s3-1 2025)                        -> extended
//   Sand Green  120 pcs (s3-1)                                             -> extended, new code
//   Red          50 pcs                                                    -> rare
// Excluded: Medium Blue (last set 2019), Trans-Clear and Pearl Gold (finishes), Blue (only in a
// minifig inventory), Green (no element), the old inventory version 1, spares and another part.
const FIXTURE: Record<CsvName, string> = {
  colors: [
    'id,name,rgb,is_trans,num_parts,num_sets,y1,y2',
    '-1,[Unknown],0033B2,False,17,2,2000,2000',
    '0,Black,05131D,False,1,1,1957,2027',
    '15,White,FFFFFF,False,1,1,1957,2027',
    '4,Red,C91A09,False,1,1,1957,2027',
    '47,Trans-Clear,FCFCFC,True,1,1,1957,2027',
    '297,Pearl Gold,AA7F2E,False,1,1,1957,2027',
    '73,Medium Blue,5A93DB,False,1,1,1957,2027',
    '378,Sand Green,a0bcac,False,1,1,1957,2027',
    '1,Blue,0055BF,False,1,1,1957,2027',
    '2,Green,237841,False,1,1,1957,2027',
  ].join('\n'),
  sets: [
    'set_num,name,year,theme_id,num_parts,img_url',
    's1-1,"Art, Big",2024,709,1,https://example.invalid/s1.jpg',
    's2-1,Old,2019,1,1,',
    's3-1,"New ""one""",2025,1,1,',
  ].join('\r\n'),
  inventories: ['id,version,set_num', '1,1,s1-1', '2,2,s1-1', '3,1,s2-1', '4,1,s3-1', '5,1,fig-000001'].join('\n'),
  inventory_parts: [
    'inventory_id,part_num,color_id,quantity,is_spare,img_url',
    '1,98138,0,999,False,',
    '2,98138,0,400,False,',
    '2,98138,0,5,True,',
    '2,98138,15,150,False,',
    '4,98138,15,20,False,',
    '2,98138,4,50,False,',
    '3,98138,73,500,False,',
    '2,98138,47,300,False,',
    '2,98138,297,300,False,',
    '5,98138,1,1000,False,',
    '4,98138,378,120,False,',
    '4,98138,2,300,False,',
    '4,3001,0,100,False,',
  ].join('\n'),
  elements: [
    'element_id,part_num,color_id,design_id',
    '4646844,98138,0,98138',
    '6284070,98138,0,35381',
    '6564903,98138,15,35381',
    '6284572,98138,15,35381',
    '6001549,98138,15,',
    '6284574,98138,4,35381',
    '6000001,98138,73,',
    '1,98138,47,35380',
    '2,98138,297,',
    '6284575,98138,1,35381',
    '6403175,98138,378,',
    '7000000,3001,0,',
  ].join('\n'),
};

/** Reverses the data rows of every file (header first), to show that input order does not matter. */
function reversed(files: Record<CsvName, string>): Record<CsvName, string> {
  const out = {} as Record<CsvName, string>;
  for (const [name, text] of Object.entries(files) as [CsvName, string][]) {
    const [header, ...rows] = text.split(/\r?\n/);
    out[name] = [header, ...rows.reverse()].join('\n');
  }
  return out;
}

function load(files: Record<CsvName, string>, parts: readonly string[] = ['98138']): Promise<Dataset> {
  // Feed the gzip bytes in small pieces so decompression and parsing cross chunk boundaries.
  return loadDataset((name) => {
    const gz = gzipSync(files[name]);
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < gz.length; i += 16) pieces.push(gz.subarray(i, i + 16));
    return pieces;
  }, parts);
}

const CONFIG: PartConfig = {
  part: '98138',
  partName: 'Tile Round 1 x 1',
  blPart: '98138',
  preferredDesigns: ['35381', '35380'],
  pab: 'pab.json',
  brickLink: 'bl.json',
  blDefault: 'bl.json',
};

const PAB: PabSnapshot = parsePabSnapshot(
  {
    source: 'test',
    date: '2026-09-24',
    market: 'DK',
    currency: 'DKK',
    part: '98138',
    designId: '35381',
    elements: [
      { elementId: '6284070', colorId: 0, name: 'Black', priceDkk: 0.36, status: 'AVAILABLE' },
      // The heuristic prefers 6564903 for White; Pick a Brick sells 6284572, which must win.
      { elementId: '6284572', colorId: 15, name: 'White', priceDkk: 0.31, status: 'AVAILABLE' },
      { elementId: '6284574', colorId: 4, name: 'Red', priceDkk: 0.36, status: 'SOLD_OUT' },
      { elementId: '2', colorId: 297, name: 'Pearl Gold', priceDkk: 0.36, status: 'AVAILABLE' },
    ],
  },
  'pab.json',
);

const BL: BrickLinkSnapshot = parseBrickLinkSnapshot(
  {
    source: 'test',
    date: '2026-09-23',
    currency: 'DKK',
    blPart: '98138',
    rows: [
      { blColorId: 11, blColorName: 'Black', ...stats(0.2) },
      { blColorId: 1, blColorName: 'White', ...stats(0.16) },
      { blColorId: 48, blColorName: 'Sand Green', ...stats(0.44) },
      { blColorId: 999, blColorName: 'Nowhere', ...stats(0.3) },
    ],
  },
  'bl.json',
);

function stats(avg: number) {
  return {
    soldNewTimes: 1,
    soldNewQty: 1,
    soldNewQtyAvgDkk: avg,
    stockNewLots: 1,
    stockNewQty: 1,
    stockNewMinDkk: 0.01,
    stockNewQtyAvgDkk: avg,
  };
}

const EXTERNAL = new Map([
  [0, { blId: 11, blName: 'Black', legoId: 26 }],
  [15, { blId: 1, blName: 'White', legoId: 1 }],
  [4, { blId: 5, blName: 'Red', legoId: 21 }],
  [378, { blId: 48, blName: 'Sand Green', legoId: 151 }],
]);

// SG belongs to a retired colour, so Sand Green must get another code.
const CODES = new Map<number, string>([
  [0, 'BK'],
  [15, 'WH'],
  [4, 'RD'],
  [9000, 'SG'],
]);

function inputs(dataset: Dataset, over: Partial<PaletteInputs> = {}): PaletteInputs {
  return {
    config: CONFIG,
    rules: DEFAULT_RULES,
    dataset,
    external: EXTERNAL,
    codes: CODES,
    rev: '2026-09-23',
    pab: PAB,
    brickLink: BL,
    blDefault: BL,
    ...over,
  };
}

const FIXTURE_DATASET = await load(FIXTURE);

describe('dataset aggregation', () => {
  it('counts the newest inventory version of real sets only, without spares', async () => {
    const usage = (await load(FIXTURE)).parts.get('98138')!.usage;
    expect(usage.get(0)).toEqual({ qty: 400, lastYear: 2024, sets: 1 });
    expect(usage.get(15)).toEqual({ qty: 170, lastYear: 2025, sets: 2 });
    expect(usage.get(73)).toEqual({ qty: 500, lastYear: 2019, sets: 1 });
    expect(usage.has(1)).toBe(false); // minifig inventory
  });

  it('selects plain opaque current colours that have an element, by quantity', async () => {
    const { selected, rejected } = selectColors(await load(FIXTURE), '98138', DEFAULT_RULES);
    expect(selected.map((s) => [s.color.id, s.tier])).toEqual([
      [0, 'core'],
      [15, 'extended'],
      [378, 'extended'],
      [4, 'rare'],
    ]);
    expect(Object.fromEntries(rejected.map((r) => [r.id, r.reason]))).toEqual({
      1: 'in no set inventory',
      2: 'no element id',
      47: 'special finish (trans)',
      73: 'last in a set from 2019',
      297: 'special finish (metallic, pearl)',
    });
  });

  it('honours --min-year', async () => {
    const { selected } = selectColors(await load(FIXTURE), '98138', { ...DEFAULT_RULES, minYear: 2019 });
    expect(selected.map((s) => s.color.id)).toEqual([73, 0, 15, 378, 4]);
  });
});

describe('buildPalette', () => {
  it('builds the expected palette', async () => {
    const build = buildPalette(inputs(await load(FIXTURE)));
    const p = build.palette;
    expect({ ...p, colors: undefined }).toEqual({
      part: '98138',
      partName: 'Tile Round 1 x 1',
      blPart: '98138',
      rev: '2026-09-23',
      pricesAsOf: '2026-09-23',
      blEurDefault: 0.0335, // median(0.16, 0.2, 0.3, 0.44) = 0.25 DKK / 7.46
      attribution:
        'Colour and part data from Rebrickable (rebrickable.com). Prices are snapshots from ' +
        'LEGO Pick a Brick (DK) (2026-09-24) and BrickLink (2026-09-23).',
      colors: undefined,
    });
    expect(p.colors).toEqual([
      {
        id: 0, name: 'Black', hex: '#05131D', rgb: [5, 19, 29], code: 'BK', tier: 'core', defaultEnabled: true,
        blId: 11, blName: 'Black', legoId: 26, elementId: '6284070', pab: true, pabDkk: 0.36, pabEur: 0.05,
        blEur: 0.0268,
      },
      {
        id: 15, name: 'White', hex: '#FFFFFF', rgb: [255, 255, 255], code: 'WH', tier: 'extended',
        defaultEnabled: true, blId: 1, blName: 'White', legoId: 1, elementId: '6284572', pab: true,
        pabDkk: 0.31, pabEur: 0.04, blEur: 0.0214,
      },
      {
        id: 378, name: 'Sand Green', hex: '#A0BCAC', rgb: [160, 188, 172], code: 'SA', tier: 'extended',
        defaultEnabled: false, blId: 48, blName: 'Sand Green', legoId: 151, elementId: '6403175', pab: false,
        pabDkk: null, pabEur: null, blEur: 0.059,
      },
      {
        id: 4, name: 'Red', hex: '#C91A09', rgb: [201, 26, 9], code: 'RD', tier: 'rare', defaultEnabled: false,
        blId: 5, blName: 'Red', legoId: 21, elementId: '6284574', pab: false, pabDkk: null, pabEur: null,
        blEur: null,
      },
    ]);
    expect(build.added).toEqual([{ id: 378, name: 'Sand Green', code: 'SA' }]);
    expect(build.codes.get(9000)).toBe('SG');
    expect(build.warnings).toEqual([
      'sold on Pick a Brick but not in the palette: Pearl Gold (297): special finish (metallic, pearl)',
      'BrickLink sample colour 999 Nowhere matches no palette colour',
    ]);
  });

  it('is deterministic: same bytes on every run and for any input row order', async () => {
    const a = serializePalette(buildPalette(inputs(await load(FIXTURE))).palette);
    const b = serializePalette(buildPalette(inputs(await load(FIXTURE))).palette);
    const c = serializePalette(buildPalette(inputs(await load(reversed(FIXTURE)))).palette);
    const shuffledPab = { ...PAB, elements: [...PAB.elements].reverse() };
    const shuffledBl = { ...BL, rows: [...BL.rows].reverse() };
    const d = serializePalette(
      buildPalette(inputs(await load(reversed(FIXTURE)), { pab: shuffledPab, brickLink: shuffledBl, blDefault: shuffledBl }))
        .palette,
    );
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(d).toBe(a);
  });

  it('writes 2-space JSON with the Palette key order and a trailing newline', async () => {
    const text = serializePalette(buildPalette(inputs(await load(FIXTURE))).palette);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.startsWith('{\n  "part": "98138",\n  "partName"')).toBe(true);
    const parsed = JSON.parse(text) as { colors: Record<string, unknown>[] } & Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'part', 'partName', 'blPart', 'rev', 'pricesAsOf', 'blEurDefault', 'attribution', 'colors',
    ]);
    expect(Object.keys(parsed.colors[0])).toEqual([
      'id', 'name', 'hex', 'rgb', 'code', 'tier', 'defaultEnabled', 'blId', 'blName', 'legoId', 'elementId',
      'pab', 'pabDkk', 'pabEur', 'blEur',
    ]);
  });

  it('without price snapshots enables every non-rare colour and has no prices', async () => {
    const dataset = await load(FIXTURE);
    const p = buildPalette(inputs(dataset, { config: { ...CONFIG, pab: null, brickLink: null }, pab: null, brickLink: null }))
      .palette;
    expect(p.colors.map((c) => [c.id, c.defaultEnabled])).toEqual([
      [0, true],
      [15, true],
      [378, true],
      [4, false],
    ]);
    expect(p.colors.every((c) => !c.pab && c.pabDkk === null && c.pabEur === null && c.blEur === null)).toBe(true);
    expect(p.colors.find((c) => c.id === 15)!.elementId).toBe('6564903'); // heuristic
    expect(p.attribution).toBe(
      'Colour and part data from Rebrickable (rebrickable.com). Prices are snapshots from BrickLink, 2026-09-23.',
    );
  });

  it('rejects a Pick a Brick element whose colour disagrees with Rebrickable', () => {
    const bad = { ...PAB, elements: [{ ...PAB.elements[0], colorId: 15 }] };
    expect(() => buildPalette(inputs(FIXTURE_DATASET, { pab: bad }))).toThrow(/colour 15 in the snapshot but 0/);
  });

  it('rejects snapshots for another part', () => {
    expect(() => buildPalette(inputs(FIXTURE_DATASET, { pab: { ...PAB, part: '6141' } }))).toThrow(/for part 6141/);
    expect(() => buildPalette(inputs(FIXTURE_DATASET, { brickLink: { ...BL, blPart: '4073' } }))).toThrow(/4073/);
  });
});


describe('helpers', () => {
  it('prefers an element of a preferred design, then the highest element id', () => {
    expect(
      preferredElement(
        [
          { elementId: '9999999', designId: null },
          { elementId: '6284572', designId: '35381' },
          { elementId: '6564903', designId: '35381' },
        ],
        ['35381'],
      ),
    ).toBe('6564903');
    expect(preferredElement([{ elementId: '1', designId: null }, { elementId: '2', designId: null }], [])).toBe('2');
    expect(preferredElement([], ['35381'])).toBeNull();
  });

  it('takes the median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([0.44, 0.16, 0.2, 0.3])).toBeCloseTo(0.25, 12);
    expect(() => median([])).toThrow();
  });
});
