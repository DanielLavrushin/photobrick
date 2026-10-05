// Shared test helpers: synthetic images, palettes and settings.

import { DEFAULT_ADJUST, defaultSettings, hexToRgb } from '../src/index.ts';
import type { MosaicSettings, Palette, PaletteColor, Rgb, WorkingImage } from '../src/index.ts';

/** Deterministic 32-bit LCG in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function image(width: number, height: number, px: (x: number, y: number) => readonly [number, number, number, number?]): WorkingImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = px(x, y);
      const o = 4 * (y * width + x);
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return { width, height, data };
}

/** A photo-like test image: gradients, a warm skin-tone disc, and seeded noise. */
export function photoLike(width: number, height: number, seed = 1): WorkingImage {
  const rnd = lcg(seed);
  return image(width, height, (x, y) => {
    const u = x / width, v = y / height;
    const dx = u - 0.5, dy = v - 0.45;
    const skin = dx * dx + dy * dy < 0.04;
    const n = (rnd() - 0.5) * 24;
    return skin
      ? [210 + n - 60 * v, 160 + n - 50 * v, 125 + n - 40 * v]
      : [40 + 180 * u + n, 90 + 120 * v + n, 200 - 150 * u * v + n];
  });
}

export function settings(overrides: Partial<MosaicSettings> = {}): MosaicSettings {
  return { ...defaultSettings(4, 3), adjust: { ...DEFAULT_ADJUST }, ...overrides };
}

/** Minimal palette colour for tests. */
export function testColor(id: number, rgb: Rgb | string, extra: Partial<PaletteColor> = {}): PaletteColor {
  const c = typeof rgb === 'string' ? hexToRgb(rgb) : rgb;
  const hex = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return {
    id,
    name: `Colour ${id}`,
    hex,
    rgb: c,
    code: `C${id % 10}`,
    tier: 'core',
    defaultEnabled: true,
    blId: id + 1000,
    blName: null,
    legoId: null,
    elementId: String(6000000 + id),
    pab: true,
    pabDkk: 0.36,
    pabEur: 0.05,
    blEur: 0.03,
    ...extra,
  };
}

export function testPalette(colors: PaletteColor[], extra: Partial<Palette> = {}): Palette {
  return {
    part: '98138',
    partName: 'Tile Round 1 x 1',
    blPart: '98138',
    rev: 'test',
    pricesAsOf: '2026-09-24',
    blEurDefault: 0.04,
    attribution: 'test',
    colors,
    ...extra,
  };
}
