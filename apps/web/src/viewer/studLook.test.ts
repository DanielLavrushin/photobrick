import { PANEL_STUDS } from '@photobrick/engine';
import { describe, expect, it } from 'vitest';
import { exportPxPerStud, MAX_EXPORT_PIXELS } from './exportPng.ts';
import {
  PANEL_GRID,
  DISC_AREA,
  GAP_SHADE,
  STUD_LOOK,
  averageStudColor,
  detailFactor,
  flatGapColor,
  linearToSrgb,
  lodFactor,
  rgbToCss,
  shadowOcclusion,
  srgbToLinear,
} from './studLook.ts';
import { backingSize, checkMosaic } from './studRenderer.ts';
import { STUD_FRAGMENT_SHADER } from './webgl2.ts';

describe('stud look', () => {
  it('draws panel lines on the engine\'s panel boundaries', () => {
    expect(PANEL_GRID.every).toBe(PANEL_STUDS);
  });

  it('leaves about a third of each cell to the base plate', () => {
    expect(DISC_AREA).toBeCloseTo(Math.PI * 0.46 * 0.46, 12);
    expect(1 - DISC_AREA).toBeGreaterThan(0.3);
    expect(1 - DISC_AREA).toBeLessThan(0.36);
  });

  it('shades the gap a little on average, never more than the shadow strength', () => {
    expect(GAP_SHADE).toBeLessThan(1);
    expect(GAP_SHADE).toBeGreaterThan(1 - STUD_LOOK.shadowStrength);
  });

  it('casts the shadow down and to the right', () => {
    const r = STUD_LOOK.radius + 0.03;
    expect(shadowOcclusion(r, 0, 0, 0)).toBeGreaterThan(shadowOcclusion(-r, 0, 0, 0));
    expect(shadowOcclusion(0, r, 0, 0)).toBeGreaterThan(shadowOcclusion(0, -r, 0, 0));
    expect(shadowOcclusion(0, 0, 0, 0)).toBe(1);
    // A cell corner is out of reach of its own tile's shadow.
    expect(shadowOcclusion(0.5, 0.5, 0, 0)).toBe(0);
  });

  it('fades level of detail and fine detail monotonically with stud size', () => {
    expect(lodFactor(1)).toBe(1);
    expect(lodFactor(STUD_LOOK.lodPx[0])).toBe(1);
    expect(lodFactor(STUD_LOOK.lodPx[1])).toBe(0);
    expect(lodFactor(40)).toBe(0);
    expect(detailFactor(2)).toBe(0);
    expect(detailFactor(40)).toBe(1);
    let prevLod = 2;
    let prevDetail = -1;
    for (let px = 0.5; px < 20; px += 0.25) {
      expect(lodFactor(px)).toBeLessThanOrEqual(prevLod);
      expect(detailFactor(px)).toBeGreaterThanOrEqual(prevDetail);
      prevLod = lodFactor(px);
      prevDetail = detailFactor(px);
    }
  });

  it('keeps fine detail off until level of detail is fully off', () => {
    // Otherwise sub-pixel bevels would alias while the average colour is still fading out.
    expect(STUD_LOOK.detailFadePx[0]).toBeLessThanOrEqual(STUD_LOOK.lodPx[1]);
  });

  it('round-trips sRGB through linear light', () => {
    for (let v = 0; v <= 255; v++) expect(Math.round(linearToSrgb(srgbToLinear(v / 255)) * 255)).toBe(v);
  });

  it('averages tile and shaded gap by area in linear light', () => {
    const out = [0, 0, 0];
    averageStudColor([255, 255, 255], [0, 0, 0], out);
    const expected = Math.round(linearToSrgb(DISC_AREA) * 255);
    expect(out).toEqual([expected, expected, expected]);
    averageStudColor([0, 0, 0], [255, 255, 255], out);
    const gap = Math.round(linearToSrgb((1 - DISC_AREA) * srgbToLinear(GAP_SHADE)) * 255);
    expect(out).toEqual([gap, gap, gap]);
  });

  it('paints the flat gap with the mean shade', () => {
    expect(flatGapColor([255, 255, 255])).toEqual([1, 1, 1].map(() => Math.round(255 * GAP_SHADE)));
    expect(flatGapColor([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('formats CSS colours', () => {
    expect(rgbToCss([0, 0, 0])).toBe('#000000');
    expect(rgbToCss([5, 19, 29])).toBe('#05131d');
    expect(rgbToCss([255, 255, 255])).toBe('#ffffff');
  });
});

describe('renderer helpers', () => {
  it('caps the device pixel ratio and the canvas side', () => {
    expect(backingSize(400, 300, 3, 2, 16384)).toEqual({ w: 800, h: 600, ratio: 2 });
    expect(backingSize(400, 300, 1.5, 2, 16384)).toEqual({ w: 600, h: 450, ratio: 1.5 });
    const capped = backingSize(5000, 1000, 2, 2, 4096);
    expect(capped.w).toBeLessThanOrEqual(4096);
    expect(capped.ratio).toBeCloseTo(4096 / 5000);
    expect(backingSize(0, 0, 0, 2, 4096).w).toBeGreaterThan(0);
  });

  it('validates mosaics', () => {
    expect(checkMosaic(new Uint8Array(6), 3, 2, [[0, 0, 0]])).toBe(6);
    expect(() => checkMosaic(new Uint8Array(5), 3, 2, [])).toThrow(RangeError);
    expect(() => checkMosaic(new Uint8Array(6), 3.5, 2, [])).toThrow(RangeError);
    const tooMany = Array.from({ length: 256 }, () => [0, 0, 0] as const);
    expect(() => checkMosaic(new Uint8Array(1), 1, 1, tooMany)).toThrow(RangeError);
  });

  it('shrinks exports to the iOS canvas limit', () => {
    expect(exportPxPerStud(48, 48, 20)).toBe(20);
    const px = exportPxPerStud(256, 192, 20);
    expect(px).toBe(18);
    expect(256 * px * 192 * px).toBeLessThanOrEqual(MAX_EXPORT_PIXELS);
    expect(exportPxPerStud(256, 256, 40, 4096)).toBe(16);
    expect(exportPxPerStud(64, 64, 12.7)).toBe(12);
    expect(exportPxPerStud(4096, 4096, 20)).toBe(1);
  });
});

describe('stud shader source', () => {
  it('uses highp everywhere (mediump turns far studs into squares on fp16 GPUs)', () => {
    expect(STUD_FRAGMENT_SHADER).toMatch(/precision highp float;/);
    expect(STUD_FRAGMENT_SHADER).toMatch(/precision highp int;/);
    expect(STUD_FRAGMENT_SHADER).toMatch(/uniform highp usampler2D uGrid;/);
    expect(STUD_FRAGMENT_SHADER).not.toMatch(/mediump|lowp/);
  });

  it('writes every look constant as a GLSL float literal', () => {
    const consts = [...STUD_FRAGMENT_SHADER.matchAll(/const float (\w+) = ([^;]+);/g)];
    expect(consts.length).toBeGreaterThanOrEqual(12);
    for (const [, name, value] of consts) {
      expect(value, name).toMatch(/^-?\d+(\.\d+)?(e-?\d+)?$/);
      expect(value, name).toMatch(/[.e]/);
    }
    expect(STUD_FRAGMENT_SHADER).toContain(`const float R = ${STUD_LOOK.radius};`);
  });
});
