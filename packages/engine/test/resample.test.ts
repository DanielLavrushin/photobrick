import { describe, expect, it } from 'vitest';
import { cropRect, gridSize, MAX_ZOOM, resampleToGrid, SRGB_TO_LINEAR } from '../src/index.ts';
import { image, lcg } from './helpers.ts';

const CENTRE = { cx: 0.5, cy: 0.5, zoom: 1 };

describe('gridSize', () => {
  it('is 16 studs per panel', () => {
    expect(gridSize({ panelsW: 4, panelsH: 3 })).toEqual({ width: 64, height: 48 });
    expect(gridSize({ panelsW: 16, panelsH: 1 })).toEqual({ width: 256, height: 16 });
  });
  it('rejects fractional, zero and oversized panel counts', () => {
    for (const s of [{ panelsW: 0, panelsH: 3 }, { panelsW: 2.5, panelsH: 3 }, { panelsW: 17, panelsH: 3 }, { panelsW: 3, panelsH: Number.NaN }]) {
      expect(() => gridSize(s)).toThrow(RangeError);
    }
  });
});

describe('cropRect', () => {
  it('takes the largest window of the grid aspect, centred', () => {
    expect(cropRect(400, 300, 64, 48, CENTRE)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    // 3:2 photo into a 4:3 grid: full height, trimmed width
    const r = cropRect(300, 200, 64, 48, CENTRE);
    expect(r.w).toBeCloseTo(800 / 3, 9);
    expect(r.x).toBeCloseTo(150 - 400 / 3, 9);
    expect([r.y, r.h]).toEqual([0, 200]);
    // portrait photo into a square grid
    expect(cropRect(100, 200, 16, 16, CENTRE)).toEqual({ x: 0, y: 50, w: 100, h: 100 });
  });

  it('keeps the grid aspect ratio at any zoom', () => {
    for (const zoom of [1, 1.5, 3.7]) {
      const r = cropRect(1234, 987, 80, 64, { cx: 0.3, cy: 0.6, zoom });
      expect(r.w / r.h).toBeCloseTo(80 / 64, 12);
    }
  });

  it('zoom 2 halves the window; zoom below 1 counts as 1', () => {
    expect(cropRect(400, 300, 64, 48, { cx: 0.5, cy: 0.5, zoom: 2 })).toEqual({ x: 100, y: 75, w: 200, h: 150 });
    expect(cropRect(400, 300, 64, 48, { cx: 0.5, cy: 0.5, zoom: 0.25 })).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('caps the zoom', () => {
    const r = cropRect(4096, 4096, 16, 16, { cx: 0.5, cy: 0.5, zoom: 1e12 });
    expect(r.w).toBe(4096 / MAX_ZOOM);
    const out = resampleToGrid(image(64, 64, () => [10, 20, 30]), { cx: 0.5, cy: 0.5, zoom: 1e12 }, 256, 256);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('clamps the window inside the image', () => {
    expect(cropRect(400, 300, 64, 48, { cx: 0, cy: 0, zoom: 2 })).toEqual({ x: 0, y: 0, w: 200, h: 150 });
    expect(cropRect(400, 300, 64, 48, { cx: 1, cy: 1, zoom: 2 })).toEqual({ x: 200, y: 150, w: 200, h: 150 });
    expect(cropRect(400, 300, 16, 16, { cx: -5, cy: 7, zoom: 1 })).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    const nan = cropRect(400, 300, 64, 48, { cx: Number.NaN, cy: Number.NaN, zoom: Number.NaN });
    expect(nan).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});

describe('resampleToGrid', () => {
  it('reproduces a uniform image exactly, for fractional cell sizes too', () => {
    for (const [W, H, gw, gh] of [[64, 48, 16, 16], [100, 77, 48, 32], [37, 91, 16, 32], [10, 10, 32, 32]]) {
      const img = image(W, H, () => [200, 100, 30]);
      const out = resampleToGrid(img, CENTRE, gw, gh);
      expect(out.length).toBe(gw * gh * 3);
      for (let i = 0; i < gw * gh; i++) {
        expect(out[3 * i]).toBeCloseTo(SRGB_TO_LINEAR[200], 6);
        expect(out[3 * i + 1]).toBeCloseTo(SRGB_TO_LINEAR[100], 6);
        expect(out[3 * i + 2]).toBeCloseTo(SRGB_TO_LINEAR[30], 6);
      }
    }
  });

  it('averages a 1 px black/white checkerboard to linear 0.5 (not sRGB 128)', () => {
    const img = image(64, 64, (x, y) => ((x + y) & 1 ? [255, 255, 255] : [0, 0, 0]));
    const out = resampleToGrid(img, CENTRE, 16, 16);
    for (const v of out) expect(v).toBeCloseTo(0.5, 6);
    // fractional cells: still 0.5 to within one pixel's share of the cell
    const frac = resampleToGrid(image(99, 99, (x, y) => ((x + y) & 1 ? [255, 255, 255] : [0, 0, 0])), CENTRE, 16, 16);
    for (const v of frac) expect(Math.abs(v - 0.5)).toBeLessThan(0.03);
  });

  it('weights partial pixels at fractional cell edges', () => {
    // 3 x 1 image into a 2 x 1 grid: window x = 0.5 .. 2.5, cells [0.5, 1.5] and [1.5, 2.5]
    const img = image(3, 1, (x) => (x === 0 ? [0, 0, 0] : x === 1 ? [255, 255, 255] : [128, 128, 128]));
    const out = resampleToGrid(img, CENTRE, 2, 1);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[3]).toBeCloseTo(0.5 + 0.5 * SRGB_TO_LINEAR[128], 6);
  });

  it('samples only the crop window', () => {
    const img = image(200, 100, (x) => (x < 100 ? [255, 0, 0] : [0, 0, 255]));
    const left = resampleToGrid(img, { cx: 0.25, cy: 0.5, zoom: 2 }, 16, 16);
    for (let i = 0; i < 256; i++) expect([left[3 * i], left[3 * i + 1], left[3 * i + 2]]).toEqual([1, 0, 0]);
    const right = resampleToGrid(img, { cx: 1, cy: 0.5, zoom: 1 }, 16, 16);
    for (let i = 0; i < 256; i++) expect(right[3 * i + 2]).toBe(1);
  });

  it('keeps orientation: row 0 is the top of the image', () => {
    const img = image(32, 32, (_x, y) => (y < 16 ? [255, 255, 255] : [0, 0, 0]));
    const out = resampleToGrid(img, CENTRE, 2, 2);
    expect([out[0], out[3], out[6], out[9]]).toEqual([1, 1, 0, 0]);
  });

  it('composites transparent pixels over white', () => {
    const img = image(4, 4, (x) => (x < 2 ? [0, 0, 0, 0] : [0, 0, 0, 255]));
    const out = resampleToGrid(img, CENTRE, 2, 1);
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[3]).toBeCloseTo(0, 6);
    const half = resampleToGrid(image(2, 2, () => [0, 0, 0, 51]), CENTRE, 1, 1);
    expect(half[0]).toBeCloseTo(0.8, 6);
  });

  it('is deterministic', () => {
    const rnd = lcg(3);
    const img = image(301, 211, () => [rnd() * 255, rnd() * 255, rnd() * 255]);
    const a = resampleToGrid(img, { cx: 0.4, cy: 0.55, zoom: 1.3 }, 48, 32);
    const b = resampleToGrid(img, { cx: 0.4, cy: 0.55, zoom: 1.3 }, 48, 32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('reads a misaligned pixel view the same as an aligned one', () => {
    const rnd = lcg(8);
    const img = image(97, 61, () => [rnd() * 255, rnd() * 255, rnd() * 255]);
    const shifted = new Uint8ClampedArray(img.data.length + 1);
    shifted.set(img.data, 1);
    const view = { width: 97, height: 61, data: shifted.subarray(1) };
    expect(view.data.byteOffset % 4).toBe(1);
    const crop = { cx: 0.45, cy: 0.5, zoom: 1.2 };
    expect(Array.from(resampleToGrid(view, crop, 32, 16))).toEqual(Array.from(resampleToGrid(img, crop, 32, 16)));
  });

  it('gives the same result on the opaque fast path and the alpha path', () => {
    const rnd = lcg(12);
    const opaque = image(50, 40, () => [rnd() * 255, rnd() * 255, rnd() * 255]);
    const withAlpha = { ...opaque, data: opaque.data.slice() };
    withAlpha.data[4 * 50 * 40 - 1] = 254; // one nearly opaque pixel in the far corner forces the alpha path
    const a = resampleToGrid(opaque, CENTRE, 20, 16), b = resampleToGrid(withAlpha, CENTRE, 20, 16);
    for (let i = 0; i < a.length - 3; i++) expect(b[i]).toBeCloseTo(a[i], 6);
  });

  it('rejects bad input', () => {
    expect(() => resampleToGrid({ width: 10, height: 10, data: new Uint8ClampedArray(10) }, CENTRE, 4, 4)).toThrow(RangeError);
    expect(() => resampleToGrid(image(4, 4, () => [0, 0, 0]), CENTRE, 0, 4)).toThrow(RangeError);
  });
});
