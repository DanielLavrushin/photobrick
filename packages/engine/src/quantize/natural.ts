// "natural" style: the skin-aware quantiser (docs/research/round2-skin-tone-fix.md section 3).
// A faithful port of the research prototype skin-tone-fix/js/skinaware.mjs, checked cell for cell by
// test/quantize-parity.test.ts:
//   1. a chroma knee on skin-like colours,
//   2. a per-cell metric that blends from okhw2 to hue-strict, chroma-strict, lightness-tolerant weights,
//   3. a 30 degree hue gate for skin targets,
//   4. positional 2-colour mixing of close palette pairs (Yliluoma-style, 4x4 Bayer anchored to the grid).

import { hueDeg, linToOklab, type PaletteLab } from '../color.ts';
import { allocCellMetric, type CellMetric } from './metric.ts';

export interface NaturalOptions {
  // skin-likeness window (OKLab hue in degrees, chroma)
  h0: number;
  h1: number;
  hSoft: number;
  cLo: number;
  cHi: number;
  cFade: number;
  // chroma knee on skin-like colours (a wider chroma window, so saturated skin is included)
  kneeC0: number;
  kneeSlope: number;
  kneeCHi: number;
  // metric weights on fully skin-like targets (okhw2 = 1, 1, 2 elsewhere; blended by skin-likeness)
  kL: number;
  kC: number;
  kH: number;
  kOver: number;
  kUnder: number;
  /** Degrees; skin targets (w > 0.5, C >= 0.03) may not use a tile with C >= 0.03 more than this hue away. */
  hueGate: number;
  /** Only palette pairs closer than this (okhw2) may be mixed. settings.dither maps to 0.2 * dither. */
  maxPair: number;
  /** Mixing ratios 1/R .. (R-1)/R. */
  R: number;
  /** Yliluoma pair penalty: lambda * d(Pi, Pj) * (|r - 0.5| + 0.5). */
  lambda: number;
  /** 0..1 blend of the skin-aware behaviour (0 = plain okhw2). settings.skinProtect. */
  strength: number;
}

export const NATURAL_DEFAULTS: Readonly<NaturalOptions> = Object.freeze({
  h0: 35, h1: 100, hSoft: 15, cLo: 0.015, cHi: 0.11, cFade: 0.05,
  kneeC0: 0.08, kneeSlope: 0.5, kneeCHi: 0.14,
  kL: 0.6, kC: 2.0, kH: 3.0, kOver: 2.0, kUnder: 1.5,
  hueGate: 30,
  maxPair: 0.1,
  R: 4,
  lambda: 0.5,
  strength: 1,
});

/** Palette colours plus every allowed mix (i, j, ratio r): mix m shows J[m] where Bayer < R[m], else I[m]. */
export interface NaturalTables {
  readonly pal: PaletteLab;
  /** Number of mixes (K pure colours plus 3 per close pair with R = 4). */
  readonly M: number;
  readonly I: Uint8Array;
  readonly J: Uint8Array;
  readonly R: Float64Array;
  readonly pen: Float64Array;
  readonly mL: Float64Array;
  readonly ma: Float64Array;
  readonly mb: Float64Array;
  readonly mC: Float64Array;
}

const BAYER4 = /* @__PURE__ */ Float64Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (v) => (v + 0.5) / 16);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function skinW(L: number, C: number, h: number, o: NaturalOptions, cHi: number, cFade: number): number {
  const wh = clamp01((h - (o.h0 - o.hSoft)) / o.hSoft) * clamp01((o.h1 + o.hSoft - h) / o.hSoft);
  const wc = clamp01(C / o.cLo) * clamp01((cHi + cFade - C) / cFade);
  const wl = clamp01((L - 0.2) / 0.1);
  return wh * wc * wl;
}

// okhw distance with explicit weights (not squared), as in the prototype.
function okhw(L1: number, a1: number, b1: number, C1: number, L2: number, a2: number, b2: number, C2: number, wL: number, wC: number, wH: number): number {
  const dL = L1 - L2, dC = C1 - C2, da = a1 - a2, db = b1 - b2;
  const dH2 = Math.max(da * da + db * db - dC * dC, 0);
  return Math.sqrt(Math.max(wL * dL * dL + wC * dC * dC + wH * dH2, 0));
}

/** Builds the mix table. Pure; callers cache it (see quantize/index.ts). */
export function prepareNatural(pal: PaletteLab, maxPair: number, R: number, lambda: number): NaturalTables {
  const K = pal.k, { L: pL, a: pa, b: pb, C: pC, lin } = pal;
  if (K > 256) throw new RangeError('natural quantiser supports at most 256 colours');
  const I: number[] = [], J: number[] = [], Rr: number[] = [], pen: number[] = [];
  for (let i = 0; i < K; i++) {
    for (let j = i; j < K; j++) {
      if (i === j) {
        I.push(i);
        J.push(i);
        Rr.push(0);
        pen.push(0);
        continue;
      }
      const dij = okhw(pL[i], pa[i], pb[i], pC[i], pL[j], pa[j], pb[j], pC[j], 1, 1, 2);
      if (dij > maxPair) continue;
      for (let r = 1; r < R; r++) {
        const q = r / R;
        I.push(i);
        J.push(j);
        Rr.push(q);
        pen.push(lambda * dij * (Math.abs(q - 0.5) + 0.5));
      }
    }
  }
  const M = I.length;
  const mL = new Float64Array(M), ma = new Float64Array(M), mb = new Float64Array(M), mC = new Float64Array(M);
  const t = new Float64Array(3);
  for (let m = 0; m < M; m++) {
    // Mix in linear light (what the eye integrates), then convert to OKLab.
    const i = 3 * I[m], j = 3 * J[m], q = Rr[m];
    linToOklab((1 - q) * lin[i] + q * lin[j], (1 - q) * lin[i + 1] + q * lin[j + 1], (1 - q) * lin[i + 2] + q * lin[j + 2], t);
    mL[m] = t[0];
    ma[m] = t[1];
    mb[m] = t[2];
    mC[m] = Math.sqrt(t[1] * t[1] + t[2] * t[2]);
  }
  return { pal, M, I: Uint8Array.from(I), J: Uint8Array.from(J), R: Float64Array.from(Rr), pen: Float64Array.from(pen), mL, ma, mb, mC };
}

/** A cell metric plus what the natural quantiser needs per cell: the target hue and the hue-gate flag. */
export interface NaturalCells extends CellMetric {
  readonly h: Float64Array;
  readonly gate: Uint8Array;
}

/** Steps 1-2 for every cell: OKLab target, skin chroma knee, per-cell metric weights, hue gate. */
export function naturalCells(lin: Float32Array, n: number, o: NaturalOptions): NaturalCells {
  const c: NaturalCells = { ...allocCellMetric(n), h: new Float64Array(n), gate: new Uint8Array(n) };
  const s = o.strength;
  const t = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    linToOklab(lin[3 * i], lin[3 * i + 1], lin[3 * i + 2], t);
    const L = t[0];
    let a = t[1], b = t[2], C = Math.sqrt(a * a + b * b);
    const h = hueDeg(a, b);
    // 1. chroma knee for skin-like colours (hue unchanged)
    const wk = s * skinW(L, C, h, o, o.kneeCHi, o.cFade);
    if (wk > 0 && C > o.kneeC0) {
      const Cn = C + wk * (o.kneeC0 + (C - o.kneeC0) * o.kneeSlope - C), f = Cn / C;
      a *= f;
      b *= f;
      C = Cn;
    }
    // 2. per-cell metric weights
    const w = s * skinW(L, C, h, o, o.cHi, o.cFade);
    const wC = 1 + w * (o.kC - 1);
    c.L[i] = L;
    c.a[i] = a;
    c.b[i] = b;
    c.C[i] = C;
    c.h[i] = h;
    c.wL[i] = 1 + w * (o.kL - 1);
    c.wH[i] = 2 + w * (o.kH - 2);
    c.wOv[i] = wC * (1 + w * (o.kOver - 1));
    c.wUn[i] = wC * (1 + w * (o.kUnder - 1));
    c.gate[i] = w > 0.5 && C >= 0.03 ? 1 : 0;
  }
  return c;
}

/**
 * Steps 3-4: picks each cell's best mix and writes one of its two members to `out` (indices into the
 * palette). Optionally records the two members of each cell's mix (equal for a pure colour).
 */
export function quantizeNatural(
  cells: NaturalCells,
  gw: number,
  gh: number,
  T: NaturalTables,
  hueGate: number,
  out: Uint8Array,
  mixA?: Uint8Array,
  mixB?: Uint8Array,
): void {
  const { M, I, J, R, pen, mL, ma, mb, mC } = T;
  const { k: K, C: pC, h: ph } = T.pal;
  const { L: cL, a: ca, b: cb, C: cC, h: ch, gate: cg, wL: cwL, wOv: cwOv, wUn: cwUn, wH: cwH } = cells;
  const bad = new Uint8Array(K);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const n = y * gw + x;
      const L = cL[n], a = ca[n], b = cb[n], C = cC[n];
      const wL = cwL[n], wOv = cwOv[n], wUn = cwUn[n], wH = cwH[n];
      const gate = cg[n] === 1;
      if (gate) {
        const h = ch[n];
        for (let k = 0; k < K; k++) {
          let dh = Math.abs(h - ph[k]) % 360;
          if (dh > 180) dh = 360 - dh;
          bad[k] = pC[k] >= 0.03 && dh > hueGate ? 1 : 0;
        }
      }
      // 3. best mix, tracking the best gate-respecting one and the best overall
      let best = 0, bd = Infinity, bestG = -1, bdG = Infinity;
      for (let m = 0; m < M; m++) {
        const dL = L - mL[m], dC = C - mC[m], da = a - ma[m], db = b - mb[m];
        const h2 = da * da + db * db - dC * dC;
        const dH2 = h2 > 0 ? h2 : 0;
        const d2 = wL * dL * dL + (mC[m] > C ? wOv : wUn) * dC * dC + wH * dH2;
        const d = Math.sqrt(d2 > 0 ? d2 : 0) + pen[m];
        if (d < bd) {
          bd = d;
          best = m;
        }
        if (gate && d < bdG && bad[I[m]] === 0 && bad[J[m]] === 0) {
          bdG = d;
          bestG = m;
        }
      }
      const m = gate && bestG >= 0 ? bestG : best;
      // 4. positional (ordered) choice between the two members, anchored to grid coordinates
      out[n] = BAYER4[((y & 3) << 2) | (x & 3)] < R[m] ? J[m] : I[m];
      if (mixA && mixB) {
        mixA[n] = I[m];
        mixB[n] = J[m];
      }
    }
  }
}
