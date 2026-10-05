// Per-cell colour metric shared by the quantisers and the post-processing steps.
//
// Every style measures the distance from a cell's target T to a palette colour P as
//   d = sqrt(wL*dL^2 + wC*dC^2 + wH*dH^2),   dH^2 = max(da^2 + db^2 - dC^2, 0)   (OKLab)
// where wC is wOv when P is more chromatic than T and wUn otherwise. faithful (okhw2) is 1/1/2,
// sepia 4/1/1, greyscale 1/0/0, and natural computes per-cell weights from the cell's skin-likeness.

import type { PaletteLab } from '../color.ts';

export interface MatchWeights {
  readonly wL: number;
  readonly wC: number;
  readonly wH: number;
}

/** Target colour and metric weights of every cell (OKLab, after the natural style's chroma knee). */
export interface CellMetric {
  readonly n: number;
  readonly L: Float64Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly C: Float64Array;
  readonly wL: Float64Array;
  /** Chroma weight when the palette colour is more chromatic than the target. */
  readonly wOv: Float64Array;
  /** Chroma weight when it is not. */
  readonly wUn: Float64Array;
  readonly wH: Float64Array;
}

export function allocCellMetric(n: number): CellMetric {
  return {
    n,
    L: new Float64Array(n),
    a: new Float64Array(n),
    b: new Float64Array(n),
    C: new Float64Array(n),
    wL: new Float64Array(n),
    wOv: new Float64Array(n),
    wUn: new Float64Array(n),
    wH: new Float64Array(n),
  };
}

/**
 * The cost of showing colour k at cell i, used by limitColors, mergeSmallLots and despeckle.
 * Colour indices refer to the same colour list the index grid uses.
 */
export interface CostModel {
  /** Number of cells. */
  readonly n: number;
  /** Number of colours. */
  readonly k: number;
  /** Style metric distance in OKLab units (the despeckle threshold compares 100x this). */
  cost(i: number, k: number): number;
}

export class MetricCostModel implements CostModel {
  readonly n: number;
  readonly k: number;
  private readonly m: CellMetric;
  private readonly p: PaletteLab;

  constructor(metric: CellMetric, pal: PaletteLab) {
    this.n = metric.n;
    this.k = pal.k;
    this.m = metric;
    this.p = pal;
  }

  cost(i: number, k: number): number {
    const m = this.m, p = this.p;
    const C = m.C[i];
    const dL = m.L[i] - p.L[k], dC = C - p.C[k], da = m.a[i] - p.a[k], db = m.b[i] - p.b[k];
    const h2 = da * da + db * db - dC * dC;
    const dH2 = h2 > 0 ? h2 : 0;
    const d2 = m.wL[i] * dL * dL + (p.C[k] > C ? m.wOv[i] : m.wUn[i]) * dC * dC + m.wH[i] * dH2;
    return Math.sqrt(d2 > 0 ? d2 : 0);
  }
}
