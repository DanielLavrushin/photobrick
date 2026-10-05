// "faithful" style: hue-weighted OKLab (okhw2) with constrained Floyd-Steinberg error diffusion
// (docs/research/round1-color-science.md, Stage 3). A port of ditherFS / nearestAll from the research
// prototype color-science/js/engine.mjs, generalised to the weighted metrics of sepia and greyscale.
//
// Constrained FS: serpentine scan, error kept in OKLab with gains (s, 0.3 s, 0.3 s) and its length
// clamped to 0.12, and a cell may only take a colour within tau = 0.04 of the best match for its
// original (undithered) target, so dithering never introduces far-away colours.

import { linToOklab, oklabToLin, type PaletteLab } from '../color.ts';
import type { CellMetric, MatchWeights } from './metric.ts';

export const OKHW2: MatchWeights = Object.freeze({ wL: 1, wC: 1, wH: 2 });

export interface DitherOptions {
  /** 0..1 error diffusion strength (settings.dither). */
  strength: number;
  /** Chroma error gain relative to lightness. */
  chroma: number;
  /** Candidate radius around the best match of the original target (metric units). */
  tau: number;
  /** Maximum length of the diffused error vector (OKLab units). */
  clamp: number;
}

export const DITHER_DEFAULTS: Readonly<DitherOptions> = Object.freeze({ strength: 0.5, chroma: 0.3, tau: 0.04, clamp: 0.12 });

// Weighted squared distance; with (1, 1, 2) this is the prototype's okhw2 operation for operation.
function dist2(L1: number, a1: number, b1: number, C1: number, L2: number, a2: number, b2: number, C2: number, w: MatchWeights): number {
  const dL = L1 - L2, dC = C1 - C2, da = a1 - a2, db = b1 - b2;
  const h2 = da * da + db * db - dC * dC;
  return w.wL * dL * dL + w.wC * dC * dC + w.wH * (h2 > 0 ? h2 : 0);
}

/** OKLab of every cell into `metric` (L, a, b, C) with constant weights `w`. */
export function fillLabMetric(lin: Float32Array, metric: CellMetric, w: MatchWeights): void {
  const t = new Float64Array(3);
  for (let i = 0; i < metric.n; i++) {
    linToOklab(lin[3 * i], lin[3 * i + 1], lin[3 * i + 2], t);
    metric.L[i] = t[0];
    metric.a[i] = t[1];
    metric.b[i] = t[2];
    metric.C[i] = Math.sqrt(t[1] * t[1] + t[2] * t[2]);
  }
  metric.wL.fill(w.wL);
  metric.wOv.fill(w.wC);
  metric.wUn.fill(w.wC);
  metric.wH.fill(w.wH);
}

/** Plain nearest colour under metric `w` for every cell of `metric`. */
export function nearestInto(metric: CellMetric, pal: PaletteLab, w: MatchWeights, out: Uint8Array): void {
  const { L, a, b, C } = metric, K = pal.k;
  const { L: pL, a: pa, b: pb, C: pC } = pal;
  for (let i = 0; i < metric.n; i++) {
    const l = L[i], aa = a[i], bb = b[i], c = C[i];
    let best = 0, bd = Infinity;
    for (let k = 0; k < K; k++) {
      const d = dist2(l, aa, bb, c, pL[k], pa[k], pb[k], pC[k], w);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    out[i] = best;
  }
}

/** Constrained Floyd-Steinberg in OKLab over the targets in `metric` (their original OKLab). */
export function ditherInto(metric: CellMetric, gw: number, gh: number, pal: PaletteLab, w: MatchWeights, opt: DitherOptions, out: Uint8Array): void {
  const N = gw * gh, K = pal.k;
  const { L: pL, a: pa, b: pb, C: pC } = pal;
  const oL = metric.L, oa = metric.a, ob = metric.b, oC = metric.C;
  const work = new Float64Array(3 * N);
  const d0min = new Float64Array(N);
  const d0arg = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    work[3 * i] = oL[i];
    work[3 * i + 1] = oa[i];
    work[3 * i + 2] = ob[i];
    let bd = Infinity, bk = 0;
    for (let k = 0; k < K; k++) {
      const d = dist2(oL[i], oa[i], ob[i], oC[i], pL[k], pa[k], pb[k], pC[k], w);
      if (d < bd) {
        bd = d;
        bk = k;
      }
    }
    d0min[i] = Math.sqrt(bd);
    d0arg[i] = bk;
  }
  const gL = opt.strength, gC = opt.strength * opt.chroma, clamp = opt.clamp, tau = opt.tau;
  const t = new Float64Array(3), lin = new Float64Array(3);
  const push = (x: number, y: number, eL: number, ea: number, eb: number, wt: number): void => {
    if (x < 0 || x >= gw || y >= gh) return;
    const j = 3 * (y * gw + x);
    work[j] += eL * wt;
    work[j + 1] += ea * wt;
    work[j + 2] += eb * wt;
  };
  for (let y = 0; y < gh; y++) {
    const rev = (y & 1) === 1, dir = rev ? -1 : 1;
    for (let xi = 0; xi < gw; xi++) {
      const x = rev ? gw - 1 - xi : xi, i = y * gw + x;
      // Clip the accumulated colour to the displayable gamut via linear RGB.
      oklabToLin(work[3 * i], work[3 * i + 1], work[3 * i + 2], lin);
      linToOklab(Math.min(1, Math.max(0, lin[0])), Math.min(1, Math.max(0, lin[1])), Math.min(1, Math.max(0, lin[2])), t);
      const C = Math.sqrt(t[1] * t[1] + t[2] * t[2]);
      const lim = d0min[i] + tau;
      let best = -1, bd = Infinity;
      for (let k = 0; k < K; k++) {
        if (Math.sqrt(dist2(oL[i], oa[i], ob[i], oC[i], pL[k], pa[k], pb[k], pC[k], w)) > lim) continue;
        const d = Math.sqrt(dist2(t[0], t[1], t[2], C, pL[k], pa[k], pb[k], pC[k], w)) * 100;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      if (best < 0) best = d0arg[i]; // only reachable with non-finite input
      out[i] = best;
      let eL = (t[0] - pL[best]) * gL, ea = (t[1] - pa[best]) * gC, eb = (t[2] - pb[best]) * gC;
      const len = Math.sqrt(eL * eL + ea * ea + eb * eb);
      if (len > clamp) {
        const sc = clamp / len;
        eL *= sc;
        ea *= sc;
        eb *= sc;
      }
      push(x + dir, y, eL, ea, eb, 7 / 16);
      push(x - dir, y + 1, eL, ea, eb, 3 / 16);
      push(x, y + 1, eL, ea, eb, 5 / 16);
      push(x + dir, y + 1, eL, ea, eb, 1 / 16);
    }
  }
}
