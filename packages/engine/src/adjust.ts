// Tone and colour adjustments at grid resolution (algorithm spec step 2).

import { linToOklab, oklabToLin } from './color.ts';
import type { Adjust } from './types.ts';

export const DEFAULT_ADJUST: Readonly<Adjust> = Object.freeze({ exposure: 0, contrast: 1, saturation: 1, detail: 0.3 });

/** True when applyAdjust would return its input unchanged. */
export function isNeutralAdjust(adj: Adjust): boolean {
  return adj.exposure === 0 && adj.contrast === 1 && adj.saturation === 1 && adj.detail === 0;
}

const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

// Normalised 1-D Gaussian, sigma = 1 stud, radius 3.
const GAUSS = /* @__PURE__ */ (() => {
  const w = new Float64Array(7);
  let sum = 0;
  for (let i = -3; i <= 3; i++) sum += w[i + 3] = Math.exp(-0.5 * i * i);
  for (let i = 0; i < 7; i++) w[i] /= sum;
  return w;
})();

/** Separable Gaussian blur (sigma 1) with edge renormalisation: out-of-grid taps are dropped. */
function blur(src: Float64Array, gw: number, gh: number): Float64Array {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  for (let y = 0; y < gh; y++) {
    const row = y * gw;
    for (let x = 0; x < gw; x++) {
      let s = 0, ws = 0;
      const k0 = Math.max(-3, -x), k1 = Math.min(3, gw - 1 - x);
      for (let k = k0; k <= k1; k++) {
        const w = GAUSS[k + 3];
        s += w * src[row + x + k];
        ws += w;
      }
      tmp[row + x] = s / ws;
    }
  }
  for (let y = 0; y < gh; y++) {
    const k0 = Math.max(-3, -y), k1 = Math.min(3, gh - 1 - y);
    for (let x = 0; x < gw; x++) {
      let s = 0, ws = 0;
      for (let k = k0; k <= k1; k++) {
        const w = GAUSS[k + 3];
        s += w * tmp[(y + k) * gw + x];
        ws += w;
      }
      out[y * gw + x] = s / ws;
    }
  }
  return out;
}

/**
 * Exposure (x 2^EV in linear light), contrast around L = 0.5 and saturation in OKLab, then unsharp
 * detail on OKLab L (sigma = 1 stud), then clip to [0,1] linear. Returns a new array.
 */
export function applyAdjust(lin: Float32Array, gw: number, gh: number, adjust: Adjust): Float32Array {
  const n = gw * gh;
  if (lin.length !== 3 * n) throw new RangeError(`applyAdjust: expected ${3 * n} values, got ${lin.length}`);
  if (isNeutralAdjust(adjust)) return lin.slice();
  const gain = Math.pow(2, finite(adjust.exposure, 0));
  const contrast = finite(adjust.contrast, 1);
  const sat = finite(adjust.saturation, 1);
  const detail = finite(adjust.detail, 0);

  const L = new Float64Array(n), A = new Float64Array(n), B = new Float64Array(n);
  const t = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    linToOklab(lin[3 * i] * gain, lin[3 * i + 1] * gain, lin[3 * i + 2] * gain, t);
    L[i] = 0.5 + contrast * (t[0] - 0.5);
    A[i] = t[1] * sat;
    B[i] = t[2] * sat;
  }
  if (detail !== 0) {
    const g = blur(L, gw, gh);
    for (let i = 0; i < n; i++) L[i] += detail * (L[i] - g[i]);
  }
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    oklabToLin(L[i], A[i], B[i], t);
    for (let c = 0; c < 3; c++) {
      const v = t[c];
      out[3 * i + c] = v > 0 ? (v < 1 ? v : 1) : 0;
    }
  }
  return out;
}
