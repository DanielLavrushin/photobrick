import { describe, expect, it } from 'vitest';
import { applyAdjust, DEFAULT_ADJUST, isNeutralAdjust, linToOklab } from '../src/index.ts';
import { lcg } from './helpers.ts';

const NEUTRAL = { exposure: 0, contrast: 1, saturation: 1, detail: 0 };

function randomGrid(n: number, seed = 5): Float32Array {
  const rnd = lcg(seed);
  return Float32Array.from({ length: 3 * n }, () => rnd());
}

function lab(lin: Float32Array, i: number): [number, number, number] {
  const t = new Float64Array(3);
  linToOklab(lin[3 * i], lin[3 * i + 1], lin[3 * i + 2], t);
  return [t[0], t[1], t[2]];
}

describe('applyAdjust', () => {
  it('is the identity with neutral settings, and returns a copy', () => {
    const lin = randomGrid(48 * 32);
    const out = applyAdjust(lin, 48, 32, NEUTRAL);
    expect(isNeutralAdjust(NEUTRAL)).toBe(true);
    expect(out).not.toBe(lin);
    expect(Array.from(out)).toEqual(Array.from(lin));
  });

  it('defaults leave a uniform image unchanged (detail only sharpens edges)', () => {
    expect(isNeutralAdjust(DEFAULT_ADJUST)).toBe(false);
    const lin = new Float32Array(3 * 16 * 16);
    for (let i = 0; i < 256; i++) lin.set([0.3, 0.2, 0.1], 3 * i);
    const out = applyAdjust(lin, 16, 16, DEFAULT_ADJUST);
    for (let i = 0; i < lin.length; i++) expect(out[i]).toBeCloseTo(lin[i], 5);
  });

  it('exposure +1 EV doubles linear light', () => {
    const lin = Float32Array.from([0.1, 0.2, 0.3, 0.05, 0.4, 0.25]);
    const out = applyAdjust(lin, 2, 1, { ...NEUTRAL, exposure: 1 });
    for (let i = 0; i < lin.length; i++) expect(out[i]).toBeCloseTo(2 * lin[i], 5);
  });

  it('saturation 0 gives neutral greys; saturation scales OKLab chroma', () => {
    const lin = randomGrid(64, 9);
    const grey = applyAdjust(lin, 8, 8, { ...NEUTRAL, saturation: 0 });
    const more = applyAdjust(lin, 8, 8, { ...NEUTRAL, saturation: 0.5 });
    for (let i = 0; i < 64; i++) {
      const [, a, b] = lab(grey, i);
      expect(Math.hypot(a, b)).toBeLessThan(2e-4);
      const [, a0, b0] = lab(lin, i), [, a1, b1] = lab(more, i);
      expect(Math.hypot(a1, b1)).toBeCloseTo(0.5 * Math.hypot(a0, b0), 3);
    }
  });

  it('contrast scales OKLab L around 0.5', () => {
    const lin = Float32Array.from([0.05, 0.05, 0.05, 0.6, 0.6, 0.6]);
    const out = applyAdjust(lin, 2, 1, { ...NEUTRAL, contrast: 1.2 });
    for (const i of [0, 1]) expect(lab(out, i)[0] - 0.5).toBeCloseTo(1.2 * (lab(lin, i)[0] - 0.5), 4);
  });

  it('detail increases contrast across an edge', () => {
    const W = 8, H = 4, lin = new Float32Array(3 * W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lin.fill(x < 4 ? 0.2 : 0.6, 3 * (y * W + x), 3 * (y * W + x) + 3);
    const out = applyAdjust(lin, W, H, { ...NEUTRAL, detail: 1 });
    expect(out[3 * 3]).toBeLessThan(0.2);
    expect(out[3 * 4]).toBeGreaterThan(0.6);
    expect(out[0]).toBeCloseTo(0.2, 2); // far from the edge: almost unchanged
  });

  it('clips to the linear gamut', () => {
    const lin = randomGrid(100, 11);
    const out = applyAdjust(lin, 10, 10, { exposure: 2, contrast: 1.5, saturation: 1.5, detail: 1 });
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('rejects a size mismatch', () => {
    expect(() => applyAdjust(new Float32Array(10), 2, 2, DEFAULT_ADJUST)).toThrow(RangeError);
  });
});
