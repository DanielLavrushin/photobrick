// One description of how a round 1x1 tile on its base plate is drawn. The WebGL2 shader, the Canvas2D
// fallback and the PNG export all read these numbers, so the three can't drift apart.
//
// Lengths are fractions of the stud pitch (8 mm) and are measured from the centre of the cell.
// Colour amounts are in sRGB 0..1 units, added to the tile colour (the look was tuned that way).

import type { Rgb } from '@photobrick/engine';

export const STUD_LOOK = {
  /** Tile radius. A real 98138 is ~7.8 mm on the 8 mm grid; 0.46 keeps the gap readable on screens. */
  radius: 0.46,
  /** Bevel ring just inside the rim, lit from the top left. */
  bevelInner: 0.09,
  bevelOuter: 0.02,
  bevelStrength: 0.3,
  lightX: -Math.SQRT1_2,
  lightY: -Math.SQRT1_2,
  /** Soft specular spot on the flat top, up and left of the centre. */
  highlightX: -0.16,
  highlightY: -0.16,
  /** Gaussian falloff: exp(-sharpness * r^2). */
  highlightSharpness: 55,
  highlightStrength: 0.22,
  /** Soft shadow each tile casts on the base plate, offset down and right. */
  shadowX: 0.02,
  shadowY: 0.025,
  /** The shadow fades from radius + shadowInner (full) to radius + shadowOuter (none). */
  shadowInner: -0.02,
  shadowOuter: 0.08,
  shadowStrength: 0.55,
  /**
   * Bevel and highlight are thinner than a pixel on small studs and would alias, so they fade out
   * between these sizes (device px per stud).
   */
  detailFadePx: [5, 10],
  /**
   * Level of detail: below lodPx[0] device px per stud each stud is drawn as its area-average colour
   * (tile and gap mixed); above lodPx[1] it is fully drawn; in between the two cross-fade. Without this,
   * a zoomed-out mosaic shows moire from the gap pattern beating against the pixel grid.
   */
  lodPx: [3, 6],
} as const;

/** Thin lines every PANEL_STUDS studs, marking the 16x16 LEGO Art panels. */
export const PANEL_GRID = {
  /** Studs per panel side; matches the engine's PANEL_STUDS. */
  every: 16,
  /** Core line width in CSS px. */
  width: 1.5,
  color: [255, 255, 255] as Rgb,
  opacity: 0.9,
  /** A 1 CSS px dark halo on both sides so the line reads on light tiles too. */
  haloOpacity: 0.45,
} as const;

/**
 * Panel line widths in whole device pixels (core, and the halo on each side). Both renderers also
 * snap the lines to the pixel grid: a 1.5 px line on a pixel boundary would smear into two grey pixels.
 */
export function panelLinePx(pixelRatio: number): { core: number; halo: number } {
  return { core: Math.max(1, Math.round(PANEL_GRID.width * pixelRatio)), halo: Math.max(1, Math.round(pixelRatio)) };
}

/** Page background around the mosaic when the caller gives none. */
export const DEFAULT_BACKGROUND: Rgb = [238, 238, 240];

/** Largest devicePixelRatio the viewer renders at; beyond 2 the extra pixels only cost battery. */
export const MAX_DPR = 2;

/** Fraction of a cell covered by the tile. */
export const DISC_AREA = Math.PI * STUD_LOOK.radius * STUD_LOOK.radius;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 1 = draw every stud as its average colour, 0 = full detail. */
export function lodFactor(devicePxPerStud: number): number {
  return 1 - smoothstep(STUD_LOOK.lodPx[0], STUD_LOOK.lodPx[1], devicePxPerStud);
}

/** 1 = bevel and highlight at full strength, 0 = flat tile tops. */
export function detailFactor(devicePxPerStud: number): number {
  return smoothstep(STUD_LOOK.detailFadePx[0], STUD_LOOK.detailFadePx[1], devicePxPerStud);
}

/** How strongly the tile whose centre is (cx, cy) shades the base plate at (x, y), 0..1. */
export function shadowOcclusion(x: number, y: number, cx: number, cy: number): number {
  const dx = x - cx - STUD_LOOK.shadowX;
  const dy = y - cy - STUD_LOOK.shadowY;
  const r = STUD_LOOK.radius;
  return 1 - smoothstep(r + STUD_LOOK.shadowInner, r + STUD_LOOK.shadowOuter, Math.sqrt(dx * dx + dy * dy));
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * The sRGB multiplier g for which base * g, in linear light, equals the mean of the shadowed base
 * plate over the gap area of an interior cell. Lets the level-of-detail colour match the detailed
 * look, so zooming through the cross-fade doesn't pulse. Integrated numerically once at load
 * (128 x 128 samples, well under a millisecond).
 */
export const GAP_SHADE: number = integrateGapShade(128);

function integrateGapShade(n: number): number {
  const r = STUD_LOOK.radius;
  let sum = 0;
  let count = 0;
  for (let j = 0; j < n; j++) {
    const y = (j + 0.5) / n - 0.5;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n - 0.5;
      if (x * x + y * y <= r * r) continue;
      // Own tile plus the neighbours across the nearer vertical and horizontal cell edges: the only
      // tiles whose shadow reaches this point (the shader evaluates the same three).
      const sx = x < 0 ? -1 : 1;
      const sy = y < 0 ? -1 : 1;
      const occ = Math.max(shadowOcclusion(x, y, 0, 0), shadowOcclusion(x, y, sx, 0), shadowOcclusion(x, y, 0, sy));
      // Linear light is close enough to a 2.2 power of the sRGB factor for a mean of scale factors.
      sum += Math.pow(1 - STUD_LOOK.shadowStrength * occ, 2.2);
      count++;
    }
  }
  return Math.pow(sum / count, 1 / 2.2);
}

/**
 * The colour a stud averages to when it is too small to draw: tile and (shaded) base plate mixed by
 * area in linear light. Writes 8-bit sRGB into out[o..o+2].
 */
export function averageStudColor(stud: Rgb, base: Rgb, out: Uint8ClampedArray | Uint8Array | number[], o = 0): void {
  for (let c = 0; c < 3; c++) {
    const gap = srgbToLinear((base[c] / 255) * GAP_SHADE);
    const tile = srgbToLinear(stud[c] / 255);
    out[o + c] = Math.round(linearToSrgb(gap + (tile - gap) * DISC_AREA) * 255);
  }
}

/**
 * The base plate as the flat Canvas2D fallback paints it: the mean colour of the shaded gap of the
 * WebGL look. It also keeps tiles in the base colour visible as discs.
 */
export function flatGapColor(base: Rgb): Rgb {
  return [Math.round(base[0] * GAP_SHADE), Math.round(base[1] * GAP_SHADE), Math.round(base[2] * GAP_SHADE)];
}

const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** '#rrggbb' for an 8-bit colour. */
export function rgbToCss(c: Rgb): string {
  return '#' + (((1 << 24) | (byte(c[0]) << 16) | (byte(c[1]) << 8) | byte(c[2])) >>> 0).toString(16).slice(1);
}
