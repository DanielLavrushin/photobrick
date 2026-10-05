import { describe, expect, it } from 'vitest';
import { hexToRgb, hueDeg, linearToSrgb8, linToOklab, oklabToLin, SRGB_TO_LINEAR } from '../src/index.ts';
import { lcg } from './helpers.ts';

describe('sRGB <-> linear', () => {
  it('LUT is monotonic from 0 to 1', () => {
    expect(SRGB_TO_LINEAR.length).toBe(256);
    expect(SRGB_TO_LINEAR[0]).toBe(0);
    expect(SRGB_TO_LINEAR[255]).toBe(1);
    for (let i = 1; i < 256; i++) expect(SRGB_TO_LINEAR[i]).toBeGreaterThan(SRGB_TO_LINEAR[i - 1]);
    // mid grey 188 is ~50% linear light (the classic gamma checkerboard value)
    expect(SRGB_TO_LINEAR[188]).toBeCloseTo(0.5029, 4);
  });

  it('round-trips every 8-bit value', () => {
    for (let u = 0; u < 256; u++) expect(linearToSrgb8(SRGB_TO_LINEAR[u])).toBe(u);
  });

  it('clamps out-of-range and NaN input', () => {
    expect(linearToSrgb8(-1)).toBe(0);
    expect(linearToSrgb8(2)).toBe(255);
    expect(linearToSrgb8(Number.NaN)).toBe(0);
  });
});

describe('OKLab', () => {
  it('maps white to L=1 and black to L=0 with no chroma', () => {
    const t = new Float64Array(3);
    linToOklab(1, 1, 1, t);
    expect(t[0]).toBeCloseTo(1, 6);
    expect(Math.abs(t[1])).toBeLessThan(1e-6);
    expect(Math.abs(t[2])).toBeLessThan(1e-6);
    linToOklab(0, 0, 0, t);
    expect([...t]).toEqual([0, 0, 0]);
  });

  it('round-trips linear RGB through OKLab', () => {
    const rnd = lcg(7);
    const t = new Float64Array(3), back = new Float64Array(3);
    for (let i = 0; i < 1000; i++) {
      const r = rnd(), g = rnd(), b = rnd();
      linToOklab(r, g, b, t);
      oklabToLin(t[0], t[1], t[2], back);
      expect(back[0]).toBeCloseTo(r, 6);
      expect(back[1]).toBeCloseTo(g, 6);
      expect(back[2]).toBeCloseTo(b, 6);
    }
  });

  it('writes at an offset into Float32Array too', () => {
    const out = new Float32Array(6);
    linToOklab(1, 0, 0, out, 3);
    expect(out[0]).toBe(0);
    expect(out[3]).toBeCloseTo(0.628, 3); // OKLab L of sRGB red
    expect(hueDeg(out[4], out[5])).toBeCloseTo(29.2, 1);
  });

  it('hueDeg is in [0, 360)', () => {
    expect(hueDeg(1, 0)).toBe(0);
    expect(hueDeg(0, 1)).toBeCloseTo(90, 10);
    expect(hueDeg(0, -1)).toBeCloseTo(270, 10);
    expect(hueDeg(-1, -1e-12)).toBeLessThan(360);
  });
});

describe('hexToRgb', () => {
  it('parses #RRGGBB in either case', () => {
    expect(hexToRgb('#05131D')).toEqual([5, 19, 29]);
    expect(hexToRgb('#a0a5a9')).toEqual([160, 165, 169]);
  });
  it('rejects anything else', () => {
    for (const bad of ['05131D', '#123', '#GGGGGG', '#1234567']) expect(() => hexToRgb(bad)).toThrow(RangeError);
  });
});
