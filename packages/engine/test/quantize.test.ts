import { describe, expect, it } from 'vitest';
import {
  activeColors,
  buildCostModel,
  DEFAULT_PALETTE,
  GREYSCALE_COLOR_IDS,
  linToOklab,
  naturalOptions,
  quantize,
  resampleToGrid,
  SEPIA_COLOR_IDS,
  SRGB_TO_LINEAR,
} from '../src/index.ts';
import type { PaletteColor, StylePreset } from '../src/index.ts';
import { naturalTables, paletteLabOf } from '../src/quantize/index.ts';
import { photoLike, settings, testColor, testPalette } from './helpers.ts';

const W = 48, H = 32;
const lin = resampleToGrid(photoLike(480, 320, 4), { cx: 0.5, cy: 0.5, zoom: 1 }, W, H);
const STYLES: StylePreset[] = ['natural', 'faithful', 'sepia', 'greyscale'];

describe('activeColors', () => {
  it('natural and faithful use the default-enabled colours in palette order', () => {
    const c = activeColors(DEFAULT_PALETTE, settings({ style: 'natural' }));
    expect(c.map((x) => x.id)).toEqual(DEFAULT_PALETTE.colors.filter((x) => x.defaultEnabled).map((x) => x.id));
  });

  it('enabledColors selects colours, including ones off by default', () => {
    const off = DEFAULT_PALETTE.colors.find((x) => !x.defaultEnabled);
    expect(off).toBeDefined();
    const c = activeColors(DEFAULT_PALETTE, settings({ style: 'faithful', enabledColors: [15, 0, off!.id, 999999] }));
    expect(c.map((x) => x.id).sort((a, b) => a - b)).toEqual([0, 15, off!.id].sort((a, b) => a - b));
  });

  it('an empty selection falls back to the defaults', () => {
    expect(activeColors(DEFAULT_PALETTE, settings({ enabledColors: [] })).length).toBe(DEFAULT_PALETTE.colors.filter((x) => x.defaultEnabled).length);
  });

  it('sepia and greyscale use their fixed colours, intersected with enabledColors unless < 2 remain', () => {
    expect(activeColors(DEFAULT_PALETTE, settings({ style: 'sepia' })).map((c) => c.id)).toEqual([...SEPIA_COLOR_IDS]);
    expect(activeColors(DEFAULT_PALETTE, settings({ style: 'greyscale' })).map((c) => c.id)).toEqual([...GREYSCALE_COLOR_IDS]);
    expect(activeColors(DEFAULT_PALETTE, settings({ style: 'greyscale', enabledColors: [0, 15, 4] })).map((c) => c.id)).toEqual([0, 15]);
    expect(activeColors(DEFAULT_PALETTE, settings({ style: 'greyscale', enabledColors: [15, 4] })).map((c) => c.id)).toEqual([...GREYSCALE_COLOR_IDS]);
  });
});

describe('quantize', () => {
  for (const style of STYLES) {
    for (const dither of [0, 0.5, 1]) {
      it(`${style} dither=${dither} is deterministic and uses only allowed colours`, () => {
        const s = settings({ style, dither });
        const colors = activeColors(DEFAULT_PALETTE, s);
        const a = quantize(lin, W, H, colors, s);
        const b = quantize(lin, W, H, colors, s);
        expect(Array.from(a)).toEqual(Array.from(b));
        for (const v of a) expect(v).toBeLessThan(colors.length);
        if (style === 'sepia') for (const v of a) expect(SEPIA_COLOR_IDS).toContain(colors[v].id);
        if (style === 'greyscale') for (const v of a) expect(GREYSCALE_COLOR_IDS).toContain(colors[v].id);
      });
    }
  }

  it('respects enabledColors', () => {
    const s = settings({ style: 'natural', enabledColors: [0, 15, 4, 1] });
    const colors = activeColors(DEFAULT_PALETTE, s);
    const q = quantize(lin, W, H, colors, s);
    for (const v of q) expect([0, 15, 4, 1]).toContain(colors[v].id);
  });

  it('faithful with dither 0 is the plain okhw2 nearest colour', () => {
    const s = settings({ style: 'faithful', dither: 0 });
    const colors = activeColors(DEFAULT_PALETTE, s);
    const q = quantize(lin, W, H, colors, s);
    const lab = (r: number, g: number, b: number): number[] => {
      const t = new Float64Array(3);
      linToOklab(r, g, b, t);
      return [...t];
    };
    const pal = colors.map((c) => lab(SRGB_TO_LINEAR[c.rgb[0]], SRGB_TO_LINEAR[c.rgb[1]], SRGB_TO_LINEAR[c.rgb[2]]));
    for (let i = 0; i < W * H; i++) {
      const [L, a, b] = lab(lin[3 * i], lin[3 * i + 1], lin[3 * i + 2]);
      const C = Math.sqrt(a * a + b * b);
      let best = 0, bd = Infinity;
      pal.forEach(([pL, pa, pb], k) => {
        const pC = Math.sqrt(pa * pa + pb * pb), dC = C - pC;
        const d = (L - pL) ** 2 + dC ** 2 + 2 * Math.max((a - pa) ** 2 + (b - pb) ** 2 - dC ** 2, 0);
        if (d < bd) [bd, best] = [d, k];
      });
      expect(q[i]).toBe(best);
    }
  });

  it('natural mixes two close colours in a Bayer pattern for an in-between target', () => {
    // A flat target halfway (in linear light) between Tan and Light Nougat.
    const tan = testColor(19, '#E4CD9E'), ln = testColor(78, '#F6D7B3'), black = testColor(0, '#05131D');
    const mid = [0, 1, 2].map((c) => (SRGB_TO_LINEAR[tan.rgb[c]] + SRGB_TO_LINEAR[ln.rgb[c]]) / 2);
    const grid = new Float32Array(3 * 64);
    for (let i = 0; i < 64; i++) grid.set(mid, 3 * i);
    const colors: PaletteColor[] = [black, tan, ln];
    const mixed = quantize(grid, 8, 8, colors, settings({ style: 'natural', dither: 0.5 }));
    const counts = [0, 0, 0];
    for (const v of mixed) counts[v]++;
    expect(counts).toEqual([0, 32, 32]);
    // mixing off: one flat colour
    const flat = quantize(grid, 8, 8, colors, settings({ style: 'natural', dither: 0 }));
    expect(new Set(flat).size).toBe(1);
  });

  it('maps settings to natural options', () => {
    expect(naturalOptions({ dither: 0.5, skinProtect: 1 })).toMatchObject({ maxPair: 0.1, strength: 1 });
    expect(naturalOptions({ dither: 2, skinProtect: -1 })).toMatchObject({ maxPair: 0.2, strength: 0 });
  });

  it('rejects empty or oversized colour lists and size mismatches', () => {
    const s = settings();
    expect(() => quantize(lin, W, H, [], s)).toThrow(RangeError);
    const many = Array.from({ length: 256 }, (_, i) => testColor(i, [i, i, i]));
    expect(() => quantize(lin, W, H, many, s)).toThrow(RangeError);
    expect(() => quantize(lin, W, H + 1, activeColors(DEFAULT_PALETTE, s), s)).toThrow(RangeError);
  });
});

describe('palette caches', () => {
  it('reuses prepared tables for an unchanged colour list, rebuilds them when it changes', () => {
    const s = settings({ style: 'natural' });
    const a = activeColors(DEFAULT_PALETTE, s), b = activeColors(DEFAULT_PALETTE, s);
    expect(a).not.toBe(b);
    const o = naturalOptions(s);
    const t1 = naturalTables(a, o);
    expect(naturalTables(b, o)).toBe(t1);
    expect(paletteLabOf(b)).toBe(t1.pal);
    expect(naturalTables(a.slice(1), o)).not.toBe(t1);
    expect(naturalTables(a, naturalOptions({ dither: 1, skinProtect: 1 }))).not.toBe(t1);
    // one entry per pure colour plus 3 ratios for each close pair
    expect((t1.M - a.length) % 3).toBe(0);
    expect(t1.M).toBeGreaterThan(a.length);
  });
});

describe('buildCostModel', () => {
  it('is zero for an exact palette colour and grows with distance', () => {
    const colors = [testColor(0, '#000000'), testColor(1, '#808080'), testColor(2, '#FFFFFF')];
    const g = SRGB_TO_LINEAR[128];
    const cost = buildCostModel(Float32Array.from([g, g, g]), 1, 1, colors, settings({ style: 'faithful' }));
    expect(cost.n).toBe(1);
    expect(cost.k).toBe(3);
    expect(cost.cost(0, 1)).toBeCloseTo(0, 6);
    expect(cost.cost(0, 0)).toBeGreaterThan(0.5);
    expect(cost.cost(0, 2)).toBeGreaterThan(0.3);
  });

  it('greyscale cost ignores chroma', () => {
    const colors = [testColor(0, '#777777'), testColor(1, '#FF0000')];
    const red = testPalette(colors).colors[1];
    const lr = [SRGB_TO_LINEAR[red.rgb[0]], SRGB_TO_LINEAR[red.rgb[1]], SRGB_TO_LINEAR[red.rgb[2]]];
    const cost = buildCostModel(Float32Array.from(lr), 1, 1, colors, settings({ style: 'greyscale' }));
    expect(cost.cost(0, 1)).toBeCloseTo(0, 6);
  });
});
