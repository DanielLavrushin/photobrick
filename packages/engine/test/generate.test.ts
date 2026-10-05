import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, generate, GREYSCALE_COLOR_IDS, SEPIA_COLOR_IDS, SRGB_TO_LINEAR, linearToSrgb8 } from '../src/index.ts';
import type { MosaicResult } from '../src/index.ts';
import { image, photoLike, settings, testColor, testPalette } from './helpers.ts';

const photo = photoLike(800, 600, 3);

function countsOf(r: MosaicResult): number[] {
  const c = new Array<number>(r.colorIds.length).fill(0);
  for (const v of r.cells) c[v]++;
  return c;
}

describe('generate', () => {
  it('produces a compact, panel-sized grid with timings', () => {
    const { result, timings } = generate(photo, settings());
    expect([result.width, result.height]).toEqual([64, 48]);
    expect(result.cells.length).toBe(64 * 48);
    const c = countsOf(result);
    for (let i = 0; i < c.length; i++) {
      expect(c[i]).toBeGreaterThanOrEqual(10); // minLot default
      if (i > 0) expect(c[i]).toBeLessThanOrEqual(c[i - 1]);
    }
    const ids = new Set(DEFAULT_PALETTE.colors.map((x) => x.id));
    for (const id of result.colorIds) expect(ids.has(id)).toBe(true);
    for (const k of ['resampleMs', 'adjustMs', 'quantizeMs', 'postMs', 'totalMs'] as const) expect(timings[k]).toBeGreaterThanOrEqual(0);
    expect(timings.totalMs).toBeGreaterThanOrEqual(timings.quantizeMs);
  });

  it('is deterministic for every style', () => {
    for (const style of ['natural', 'faithful', 'sepia', 'greyscale'] as const) {
      const a = generate(photo, settings({ style })).result;
      const b = generate(photo, settings({ style })).result;
      expect(a.colorIds).toEqual(b.colorIds);
      expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    }
  });

  it('sepia and greyscale use only their colours', () => {
    expect(generate(photo, settings({ style: 'sepia' })).result.colorIds.every((id) => SEPIA_COLOR_IDS.includes(id))).toBe(true);
    expect(generate(photo, settings({ style: 'greyscale' })).result.colorIds.every((id) => GREYSCALE_COLOR_IDS.includes(id))).toBe(true);
  });

  it('honours maxColors in every style', () => {
    for (const style of ['natural', 'faithful'] as const) {
      for (const maxColors of [3, 8]) {
        const r = generate(photo, settings({ style, maxColors })).result;
        expect(r.colorIds.length).toBeLessThanOrEqual(maxColors);
        expect(r.colorIds.length).toBeGreaterThan(1);
      }
    }
  });

  it('keeps small lots when minLot is 0 and removes them otherwise', () => {
    const loose = generate(photo, settings({ style: 'faithful', dither: 1, minLot: 0, despeckle: false })).result;
    expect(Math.min(...countsOf(loose))).toBeLessThan(30);
    const tight = generate(photo, settings({ style: 'faithful', dither: 1, minLot: 30, despeckle: false })).result;
    expect(Math.min(...countsOf(tight))).toBeGreaterThanOrEqual(30);
  });

  it('despeckle keeps the natural style’s intentional 2-colour mixes', () => {
    // A flat photo halfway (in linear light) between Tan and Light Nougat becomes a 50/50 Bayer mix.
    const tan = testColor(19, '#E4CD9E'), ln = testColor(78, '#F6D7B3'), black = testColor(0, '#05131D');
    const mid = [0, 1, 2].map((c) => linearToSrgb8((SRGB_TO_LINEAR[tan.rgb[c]] + SRGB_TO_LINEAR[ln.rgb[c]]) / 2));
    const flat = image(64, 64, () => [mid[0], mid[1], mid[2]]);
    const pal = testPalette([black, tan, ln]);
    const s = settings({ size: { panelsW: 2, panelsH: 2 }, style: 'natural', dither: 0.5, despeckle: true, adjust: { exposure: 0, contrast: 1, saturation: 1, detail: 0 } });
    const r = generate(flat, s, pal).result;
    expect([...r.colorIds].sort((a, b) => a - b)).toEqual([19, 78]);
    expect(countsOf(r)).toEqual([512, 512]);
  });

  it('crops, zooms and uses the palette argument', () => {
    const split = image(400, 200, (x) => (x < 200 ? [255, 255, 255] : [0, 0, 0]));
    const pal = testPalette([testColor(1, '#000000'), testColor(2, '#FFFFFF')]);
    const left = generate(split, settings({ size: { panelsW: 1, panelsH: 1 }, crop: { cx: 0, cy: 0.5, zoom: 1 } }), pal).result;
    expect(left.colorIds).toEqual([2]);
    const right = generate(split, settings({ size: { panelsW: 1, panelsH: 1 }, crop: { cx: 1, cy: 0.5, zoom: 1 } }), pal).result;
    expect(right.colorIds).toEqual([1]);
  });

  it('rejects invalid sizes', () => {
    expect(() => generate(photo, settings({ size: { panelsW: 0, panelsH: 3 } }))).toThrow(RangeError);
    expect(() => generate({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, settings())).toThrow(RangeError);
  });
});
