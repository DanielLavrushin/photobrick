import { describe, expect, it } from 'vitest';
import {
  BASES,
  basePieces,
  billOfMaterials,
  countColors,
  DEFAULT_ADJUST,
  DEFAULT_BASE_ID,
  defaultSettings,
  estimateCost,
  LEGO_ART_SIZE,
  physicalSizeCm,
  SIZE_PRESETS,
  suggestSize,
} from '../src/index.ts';
import type { MosaicResult } from '../src/index.ts';
import { testColor, testPalette } from './helpers.ts';

function result(counts: number[], colorIds: number[]): MosaicResult {
  const cells: number[] = [];
  counts.forEach((n, k) => cells.push(...new Array<number>(n).fill(k)));
  return { width: cells.length, height: 1, cells: Uint8Array.from(cells), colorIds };
}

const palette = testPalette([
  testColor(0, '#05131D', { name: 'Black', code: 'BK', blEur: 0.02, pabEur: 0.05, pabDkk: 0.36 }),
  testColor(15, '#FFFFFF', { name: 'White', code: 'WH', blEur: null, pabEur: 0.04, pabDkk: 0.3 }),
  testColor(288, '#184632', { name: 'Dark Green', code: 'GD', blEur: 0.1, pab: false, pabEur: null, pabDkk: null, elementId: null }),
]);

describe('countColors', () => {
  it('counts studs per Rebrickable colour id', () => {
    const r = result([3, 0, 2], [15, 0, 288]);
    expect([...countColors(r)]).toEqual([[15, 3], [288, 2]]);
  });
  it('rejects cells outside the colour table', () => {
    expect(() => countColors({ width: 1, height: 1, cells: Uint8Array.from([1]), colorIds: [0] })).toThrow(RangeError);
  });
});

describe('billOfMaterials', () => {
  it('adds max(2, ceil(3%)) spares and sorts by count', () => {
    const lines = billOfMaterials(result([10, 1000, 100], [15, 0, 288]), palette);
    expect(lines.map((l) => [l.colorId, l.count, l.spares, l.total])).toEqual([
      [0, 1000, 30, 1030],
      [288, 100, 3, 103],
      [15, 10, 2, 12],
    ]);
    expect(lines[0]).toMatchObject({ name: 'Black', code: 'BK', hex: '#05131D', blId: 1000, elementId: '6000000', pab: true, tier: 'core' });
  });

  it('takes custom spare rules', () => {
    const [l] = billOfMaterials(result([200], [0]), palette, { sparesPct: 10, minSpares: 0 });
    expect(l.spares).toBe(20);
    const [z] = billOfMaterials(result([5], [0]), palette, { sparesPct: 0, minSpares: 0 });
    expect(z.total).toBe(5);
    expect(() => billOfMaterials(result([5], [0]), palette, { sparesPct: -1 })).toThrow(RangeError);
  });

  it('breaks count ties by colour id and names colours missing from the palette', () => {
    const lines = billOfMaterials(result([5, 5], [15, 4242]), palette);
    expect(lines.map((l) => l.colorId)).toEqual([15, 4242]);
    expect(lines[1]).toMatchObject({ name: 'Colour 4242', blId: null, elementId: null, pab: false });
  });
});

describe('estimateCost', () => {
  it('prices BrickLink per colour with the default for unsampled colours, and Pick a Brick where sold', () => {
    const lines = billOfMaterials(result([1000, 100, 10], [0, 288, 15]), palette);
    const cost = estimateCost(lines, palette);
    // BrickLink: 1030 * 0.02 + 103 * 0.1 + 12 * 0.04 (default)
    expect(cost.bricklinkEur).toBe(Math.round((1030 * 0.02 + 103 * 0.1 + 12 * 0.04) * 100) / 100);
    // Pick a Brick: Black and White only; Dark Green is not sold there
    expect(cost.pickABrickEur).toBe(Math.round((1030 * 0.05 + 12 * 0.04) * 100) / 100);
    expect(cost.pickABrickDkk).toBe(Math.round((1030 * 0.36 + 12 * 0.3) * 100) / 100);
    expect(cost.notOnPab).toEqual([288]);
    expect(cost.pricesAsOf).toBe('2026-09-24');
  });

  it('has null Pick a Brick totals when nothing is sold there', () => {
    const cost = estimateCost(billOfMaterials(result([50], [288]), palette), palette);
    expect(cost.pickABrickEur).toBeNull();
    expect(cost.pickABrickDkk).toBeNull();
    expect(cost.notOnPab).toEqual([288]);
  });
});

describe('bases and physical size', () => {
  it('counts 16x16 plates and 48x48 baseplates', () => {
    const dbg = BASES.find((b) => b.id === 'dbg')!, bp = BASES.find((b) => b.id === 'baseplate48')!;
    expect(DEFAULT_BASE_ID).toBe('dbg');
    expect(dbg).toMatchObject({ part: '91405', colorId: 72, studsPerPiece: 16 });
    expect(bp).toMatchObject({ part: '4186', colorId: 71, studsPerPiece: 48 });
    expect(basePieces(LEGO_ART_SIZE, dbg)).toEqual({ part: '91405', colorId: 72, count: 9 });
    expect(basePieces(LEGO_ART_SIZE, bp)).toEqual({ part: '4186', colorId: 71, count: 1 });
    expect(basePieces({ panelsW: 4, panelsH: 3 }, bp).count).toBe(2);
    expect(basePieces({ panelsW: 6, panelsH: 6 }, bp).count).toBe(4);
  });

  it('is 12.8 cm per panel', () => {
    expect(physicalSizeCm(LEGO_ART_SIZE)).toEqual({ w: 38.4, h: 38.4 });
    expect(physicalSizeCm({ panelsW: 4, panelsH: 3 })).toEqual({ w: 51.2, h: 38.4 });
  });
});

describe('size presets and defaults', () => {
  it('has S/M/L/XL at 3/4/5/6 panels on the long side', () => {
    expect(SIZE_PRESETS.map((p) => [p.id, p.longPanels, p.longStuds])).toEqual([['s', 3, 48], ['m', 4, 64], ['l', 5, 80], ['xl', 6, 96]]);
  });

  it('follows orientation and aspect ratio', () => {
    expect(suggestSize(4000, 3000)).toEqual({ panelsW: 4, panelsH: 3 });
    expect(suggestSize(3000, 4000)).toEqual({ panelsW: 3, panelsH: 4 });
    expect(suggestSize(1000, 950)).toEqual({ panelsW: 4, panelsH: 4 });
    expect(suggestSize(6000, 1000)).toEqual({ panelsW: 4, panelsH: 2 }); // aspect clamped to 1:2
    expect(suggestSize(4000, 3000, 's')).toEqual({ panelsW: 3, panelsH: 2 });
    expect(suggestSize(4000, 3000, 'xl')).toEqual({ panelsW: 6, panelsH: 5 });
    expect(suggestSize(1000, 3000, 'l')).toEqual({ panelsW: 3, panelsH: 5 });
    expect(suggestSize(0, 0)).toEqual({ panelsW: 4, panelsH: 4 });
  });

  it('defaultSettings matches the spec', () => {
    expect(defaultSettings(4032, 3024)).toEqual({
      size: { panelsW: 4, panelsH: 3 },
      crop: { cx: 0.5, cy: 0.5, zoom: 1 },
      adjust: { ...DEFAULT_ADJUST },
      style: 'natural',
      dither: 0.5,
      skinProtect: 1,
      despeckle: true,
      minLot: 10,
      maxColors: null,
      enabledColors: null,
      base: 'dbg',
    });
    expect(DEFAULT_ADJUST).toEqual({ exposure: 0, contrast: 1, saturation: 1, detail: 0.3 });
  });
});
