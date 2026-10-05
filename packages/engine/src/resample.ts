// Crop window and exact linear-light area resampling (algorithm spec step 1).

import { SRGB_TO_LINEAR } from './color.ts';
import { MAX_GRID_SIDE, PANEL_STUDS } from './presets.ts';
import type { Crop, SizeSpec, WorkingImage } from './types.ts';

/** Grid dimensions in studs for a panel size. Throws on non-integer or out-of-range panel counts. */
export function gridSize(size: SizeSpec): { width: number; height: number } {
  const maxPanels = MAX_GRID_SIDE / PANEL_STUDS;
  for (const v of [size.panelsW, size.panelsH]) {
    if (!Number.isInteger(v) || v < 1 || v > maxPanels) throw new RangeError(`panel count must be an integer in 1..${maxPanels}, got ${v}`);
  }
  return { width: size.panelsW * PANEL_STUDS, height: size.panelsH * PANEL_STUDS };
}

const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Largest crop zoom: beyond this a stud covers well under one source pixel. */
export const MAX_ZOOM = 64;

/**
 * The crop window in source pixels (fractional). It has the grid's aspect ratio; zoom 1 is the largest
 * such window that fits, zoom z is 1/z of that (z is clamped to 1..MAX_ZOOM). The window is shifted,
 * never shrunk, to stay inside the image.
 */
export function cropRect(imgW: number, imgH: number, gw: number, gh: number, crop: Crop): { x: number; y: number; w: number; h: number } {
  if (!(imgW > 0 && imgH > 0 && gw > 0 && gh > 0)) throw new RangeError('cropRect: sizes must be positive');
  const aspect = gw / gh;
  let bw: number, bh: number;
  if (imgW / imgH > aspect) {
    bh = imgH;
    bw = Math.min(imgW, imgH * aspect);
  } else {
    bw = imgW;
    bh = Math.min(imgH, imgW / aspect);
  }
  const zoom = Math.min(MAX_ZOOM, Math.max(1, finiteOr(crop.zoom, 1)));
  const w = bw / zoom, h = bh / zoom;
  const cx = finiteOr(crop.cx, 0.5) * imgW, cy = finiteOr(crop.cy, 0.5) * imgH;
  const x = Math.min(Math.max(cx - w / 2, 0), imgW - w);
  const y = Math.min(Math.max(cy - h / 2, 0), imgH - h);
  return { x, y, w, h };
}

// Byte offsets of R, G, B inside a pixel read as one Uint32 (platform byte order).
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
const rS = LITTLE_ENDIAN ? 0 : 24, gS = LITTLE_ENDIAN ? 8 : 16, bS = LITTLE_ENDIAN ? 16 : 8;

// Alpha is rare in photos, so opacity is checked once per pixel buffer. The working image is
// treated as immutable, like everything else the engine receives.
const opaqueCache = new WeakMap<Uint8ClampedArray, { n: number; opaque: boolean }>();
function isOpaque(data: Uint8ClampedArray, n: number): boolean {
  const hit = opaqueCache.get(data);
  if (hit && hit.n === n) return hit.opaque;
  let opaque = true;
  for (let i = 3; i < 4 * n; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  opaqueCache.set(data, { n, opaque });
  return opaque;
}

/**
 * Exact box average of the crop window in linear light, with fractional cell edges, as two separable
 * passes (rows are summed horizontally once, then distributed to the output rows they overlap).
 * Transparent pixels are composited over white. Returns gw*gh*3 linear RGB values.
 */
export function resampleToGrid(img: WorkingImage, crop: Crop, gw: number, gh: number): Float32Array {
  const W = img.width, H = img.height, d = img.data;
  if (!(Number.isInteger(W) && Number.isInteger(H) && W > 0 && H > 0)) throw new RangeError('resampleToGrid: bad image size');
  if (d.length < 4 * W * H) throw new RangeError('resampleToGrid: pixel buffer too short');
  if (!(Number.isInteger(gw) && Number.isInteger(gh) && gw > 0 && gh > 0)) throw new RangeError('resampleToGrid: bad grid size');
  const LUT = SRGB_TO_LINEAR;
  // Opaque images are read as whole RGBA words (needs 4-byte alignment; a misaligned view is copied).
  let px: Uint32Array | null = null;
  if (isOpaque(d, W * H)) {
    const src = d.byteOffset % 4 === 0 ? d : d.slice(0, 4 * W * H);
    px = new Uint32Array(src.buffer, src.byteOffset, W * H);
  }
  const r = cropRect(W, H, gw, gh, crop);
  const sx = r.w / gw, sy = r.h / gh;

  // Horizontal cell spans: first pixel, end (exclusive), weights of the partial first and last pixels.
  const xs = new Int32Array(gw), xe = new Int32Array(gw);
  const wf = new Float64Array(gw), wl = new Float64Array(gw), invW = new Float64Array(gw);
  for (let gx = 0; gx < gw; gx++) {
    const a = r.x + gx * sx;
    const b = Math.min(W, gx === gw - 1 ? r.x + r.w : r.x + (gx + 1) * sx);
    const i0 = Math.min(W - 1, Math.floor(a));
    const i1 = Math.max(i0 + 1, Math.ceil(b));
    xs[gx] = i0;
    xe[gx] = i1;
    if (i1 - i0 === 1) {
      wf[gx] = b - a;
      wl[gx] = 0;
    } else {
      wf[gx] = i0 + 1 - a;
      wl[gx] = b - (i1 - 1);
    }
    invW[gx] = 1 / (b - a);
  }
  // Vertical cell edges.
  const ya = new Float64Array(gh), yb = new Float64Array(gh);
  for (let gy = 0; gy < gh; gy++) {
    ya[gy] = r.y + gy * sy;
    yb[gy] = Math.min(H, gy === gh - 1 ? r.y + r.h : r.y + (gy + 1) * sy);
  }

  const acc = new Float64Array(gw * gh * 3);
  const hrow = new Float64Array(gw * 3);
  const j0 = Math.min(H - 1, Math.floor(r.y)), j1 = Math.max(j0 + 1, Math.ceil(r.y + r.h));
  for (let j = j0; j < j1; j++) {
    const row = j * W;
    for (let gx = 0; gx < gw; gx++) {
      const i0 = xs[gx], i1 = xe[gx];
      let sr: number, sg: number, sb: number;
      if (px) {
        // One 32-bit load per pixel instead of three byte loads.
        const last = row + i1 - 1;
        let p = row + i0, v = px[p], w = wf[gx];
        sr = w * LUT[(v >>> rS) & 255];
        sg = w * LUT[(v >>> gS) & 255];
        sb = w * LUT[(v >>> bS) & 255];
        for (p++; p < last; p++) {
          v = px[p];
          sr += LUT[(v >>> rS) & 255];
          sg += LUT[(v >>> gS) & 255];
          sb += LUT[(v >>> bS) & 255];
        }
        if (i1 - i0 > 1) {
          v = px[p];
          w = wl[gx];
          sr += w * LUT[(v >>> rS) & 255];
          sg += w * LUT[(v >>> gS) & 255];
          sb += w * LUT[(v >>> bS) & 255];
        }
      } else {
        let o = 4 * (row + i0);
        sr = sg = sb = 0;
        for (let i = i0; i < i1; i++, o += 4) {
          const w = i === i0 ? wf[gx] : i === i1 - 1 ? wl[gx] : 1;
          const al = d[o + 3] / 255, bg = w * (1 - al), wa = w * al;
          sr += wa * LUT[d[o]] + bg;
          sg += wa * LUT[d[o + 1]] + bg;
          sb += wa * LUT[d[o + 2]] + bg;
        }
      }
      const s = invW[gx];
      hrow[3 * gx] = sr * s;
      hrow[3 * gx + 1] = sg * s;
      hrow[3 * gx + 2] = sb * s;
    }
    // Output rows overlapping source row j (a margin of one row absorbs rounding in the division).
    const g0 = Math.max(0, Math.floor((j - r.y) / sy) - 1);
    const g1 = Math.min(gh - 1, Math.floor((j + 1 - r.y) / sy) + 1);
    for (let gy = g0; gy <= g1; gy++) {
      const wy = Math.min(j + 1, yb[gy]) - Math.max(j, ya[gy]);
      if (wy <= 0) continue;
      const base = 3 * gy * gw;
      for (let k = 0; k < 3 * gw; k++) acc[base + k] += wy * hrow[k];
    }
  }
  const out = new Float32Array(gw * gh * 3);
  for (let gy = 0; gy < gh; gy++) {
    const s = 1 / (yb[gy] - ya[gy]), base = 3 * gy * gw;
    for (let k = 0; k < 3 * gw; k++) out[base + k] = acc[base + k] * s;
  }
  return out;
}
