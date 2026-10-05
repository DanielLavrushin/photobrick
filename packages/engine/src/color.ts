// Colour conversions: sRGB <-> linear light <-> OKLab (Ottosson 2020, https://bottosson.github.io/posts/oklab/).
//
// Determinism note: everything here uses only IEEE-exact arithmetic (+ - * / sqrt) plus Math.cbrt,
// Math.atan2 and Math.pow. V8 and SpiderMonkey both use fdlibm for these; JavaScriptCore uses the
// system libm, which can differ in the last bit. A last-bit difference can only change a result when
// two candidate distances tie to ~1e-16, which the research runs never observed. Math.hypot is avoided
// on purpose: its rounding is implementation-defined, sqrt(a*a + b*b) is not.

import type { Rgb } from './types.ts';

function srgbToLinear(u8: number): number {
  const x = u8 / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** sRGB 8-bit value -> linear light in [0,1] (IEC 61966-2-1), 256 entries. */
export const SRGB_TO_LINEAR: Float32Array = /* @__PURE__ */ (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i);
  return t;
})();

/** Linear light -> nearest sRGB 8-bit value (input is clamped to [0,1]). */
export function linearToSrgb8(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 255;
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/** Linear sRGB -> OKLab, written to out[o..o+2]. */
export function linToOklab(r: number, g: number, b: number, out: Float64Array | Float32Array, o = 0): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** OKLab -> linear sRGB (not clipped), written to out[o..o+2]. */
export function oklabToLin(L: number, a: number, b: number, out: Float64Array | Float32Array, o = 0): void {
  let l = L + 0.3963377774 * a + 0.2158037573 * b;
  let m = L - 0.1055613458 * a - 0.0638541728 * b;
  let s = L - 0.0894841775 * a - 1.291485548 * b;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  out[o] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[o + 1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[o + 2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
}

const RAD_TO_DEG = 180 / Math.PI;

/** OKLab hue angle in degrees, [0, 360). */
export function hueDeg(a: number, b: number): number {
  const h = Math.atan2(b, a) * RAD_TO_DEG;
  return h < 0 ? h + 360 : h;
}

/** '#RRGGBB' -> [r, g, b]; throws on anything else. */
export function hexToRgb(hex: string): Rgb {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new RangeError(`not a #RRGGBB colour: ${JSON.stringify(hex)}`);
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** OKLab coordinates of a palette, one entry per colour, computed from the sRGB catalogue values. */
export interface PaletteLab {
  readonly k: number;
  /** Linear RGB, 3 per colour. */
  readonly lin: Float64Array;
  readonly L: Float64Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
  /** Chroma sqrt(a^2 + b^2). */
  readonly C: Float64Array;
  /** Hue in degrees. */
  readonly h: Float64Array;
}

export function paletteLab(rgbs: readonly Rgb[]): PaletteLab {
  const k = rgbs.length;
  const lin = new Float64Array(3 * k);
  const L = new Float64Array(k), a = new Float64Array(k), b = new Float64Array(k);
  const C = new Float64Array(k), h = new Float64Array(k);
  const t = new Float64Array(3);
  for (let i = 0; i < k; i++) {
    const [r, g, bl] = rgbs[i];
    lin[3 * i] = SRGB_TO_LINEAR[r];
    lin[3 * i + 1] = SRGB_TO_LINEAR[g];
    lin[3 * i + 2] = SRGB_TO_LINEAR[bl];
    linToOklab(lin[3 * i], lin[3 * i + 1], lin[3 * i + 2], t);
    L[i] = t[0];
    a[i] = t[1];
    b[i] = t[2];
    C[i] = Math.sqrt(t[1] * t[1] + t[2] * t[2]);
    h[i] = hueDeg(t[1], t[2]);
  }
  return { k, lin, L, a, b, C, h };
}
