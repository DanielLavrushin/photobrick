// Post-processing on the index grid (algorithm spec step 4) and compaction (step 5).
// Every function is pure: it returns a new grid and leaves its input untouched. Colour indices refer
// to the colour list the cost model was built for.

import type { CostModel } from './quantize/metric.ts';
import type { MosaicResult } from './types.ts';

function checkGrid(cells: Uint8Array, cost: CostModel): void {
  if (cells.length !== cost.n) throw new RangeError(`grid has ${cells.length} cells, cost model ${cost.n}`);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] >= cost.k) throw new RangeError(`cell ${i} uses colour ${cells[i]}, cost model has ${cost.k}`);
  }
}

function countsOf(cells: Uint8Array, k: number): Int32Array {
  const counts = new Int32Array(k);
  for (let i = 0; i < cells.length; i++) counts[cells[i]]++;
  return counts;
}

// Improvements smaller than this are rounding noise; ignoring them guarantees the swap loop ends.
const SWAP_EPS = 1e-9;
const MAX_SWAPS = 32;

export interface LimitColorsResult {
  cells: Uint8Array;
  /** Colour indices allowed after the limit, ascending (not all of them need to be used). */
  kept: number[];
}

/**
 * Use at most `maxColors` colours. Picks the set S that minimises the sum over cells of the cost of
 * the nearest colour in S: greedy backward elimination from the colours in use (repeatedly drop the
 * colour whose cells lose least by moving to their second best), then 1-swap refinement against every
 * colour of the model (k-medoids style). Cells keep their colour if it is in S, otherwise they take
 * their nearest colour in S.
 */
export function limitColors(cells: Uint8Array, cost: CostModel, maxColors: number): LimitColorsResult {
  checkGrid(cells, cost);
  const N = cost.n, K = cost.k;
  const max = Math.max(1, Math.floor(Number.isFinite(maxColors) ? maxColors : K));
  const counts = countsOf(cells, K);
  const inS = new Uint8Array(K);
  let size = 0;
  for (let k = 0; k < K; k++) {
    if (counts[k] > 0) {
      inS[k] = 1;
      size++;
    }
  }
  const keptOf = (): number[] => {
    const kept: number[] = [];
    for (let k = 0; k < K; k++) if (inS[k]) kept.push(k);
    return kept;
  };
  if (size <= max) return { cells: cells.slice(), kept: keptOf() };

  // Nearest and second-nearest colour in S for every cell, with their costs.
  const best = new Uint8Array(N), sec = new Uint8Array(N);
  const bestC = new Float64Array(N), secC = new Float64Array(N);
  const rank = (i: number): void => {
    let b = -1, s = -1, bc = Infinity, sc = Infinity;
    for (let k = 0; k < K; k++) {
      if (!inS[k]) continue;
      const c = cost.cost(i, k);
      if (c < bc) {
        s = b;
        sc = bc;
        b = k;
        bc = c;
      } else if (c < sc) {
        s = k;
        sc = c;
      }
    }
    best[i] = b;
    bestC[i] = bc;
    sec[i] = s < 0 ? b : s;
    secC[i] = sc;
  };
  for (let i = 0; i < N; i++) rank(i);

  const delta = new Float64Array(K);
  while (size > max) {
    delta.fill(0);
    for (let i = 0; i < N; i++) delta[best[i]] += secC[i] - bestC[i];
    let drop = -1;
    for (let k = 0; k < K; k++) if (inS[k] && (drop < 0 || delta[k] < delta[drop])) drop = k;
    inS[drop] = 0;
    size--;
    for (let i = 0; i < N; i++) if (best[i] === drop || sec[i] === drop) rank(i);
  }

  const perOut = new Float64Array(K);
  for (let iter = 0; iter < MAX_SWAPS; iter++) {
    let gainBest = -SWAP_EPS, out = -1, inn = -1;
    for (let cin = 0; cin < K; cin++) {
      if (inS[cin]) continue;
      // Swapping cout for cin: cells that prefer cin move there whatever leaves (common term); the
      // others only change if their nearest colour is the one leaving (perOut term).
      let common = 0;
      perOut.fill(0);
      for (let i = 0; i < N; i++) {
        const ci = cost.cost(i, cin);
        if (ci < bestC[i]) common += ci - bestC[i];
        else perOut[best[i]] += Math.min(ci, secC[i]) - bestC[i];
      }
      for (let k = 0; k < K; k++) {
        if (!inS[k]) continue;
        const g = common + perOut[k];
        if (g < gainBest) {
          gainBest = g;
          out = k;
          inn = cin;
        }
      }
    }
    if (out < 0) break;
    inS[out] = 0;
    inS[inn] = 1;
    for (let i = 0; i < N; i++) rank(i);
  }

  const res = new Uint8Array(N);
  for (let i = 0; i < N; i++) res[i] = inS[cells[i]] ? cells[i] : best[i];
  return { cells: res, kept: keptOf() };
}

export interface MergeSmallLotsResult {
  cells: Uint8Array;
  /** Colour indices that were merged away, in merge order. */
  merged: number[];
}

/**
 * Removes colours used fewer than `minLot` times: repeatedly takes the smallest lot and moves each of
 * its cells to that cell's cheapest remaining colour, so a lot that grows past minLot survives.
 * Stops when every lot has at least minLot cells or one colour is left.
 */
export function mergeSmallLots(cells: Uint8Array, cost: CostModel, minLot: number): MergeSmallLotsResult {
  checkGrid(cells, cost);
  const N = cost.n, K = cost.k;
  const res = cells.slice();
  const merged: number[] = [];
  if (!(minLot > 1) || N < minLot) return { cells: res, merged };
  const counts = countsOf(cells, K);
  const alive = new Uint8Array(K);
  let nAlive = 0;
  for (let k = 0; k < K; k++) {
    if (counts[k] > 0) {
      alive[k] = 1;
      nAlive++;
    }
  }
  while (nAlive > 1) {
    let s = -1;
    for (let k = 0; k < K; k++) if (alive[k] && (s < 0 || counts[k] < counts[s])) s = k;
    if (counts[s] >= minLot) break;
    alive[s] = 0;
    nAlive--;
    merged.push(s);
    for (let i = 0; i < N; i++) {
      if (res[i] !== s) continue;
      let b = -1, bc = Infinity;
      for (let k = 0; k < K; k++) {
        if (!alive[k]) continue;
        const c = cost.cost(i, k);
        if (c < bc) {
          bc = c;
          b = k;
        }
      }
      res[i] = b;
      counts[b]++;
    }
    counts[s] = 0;
  }
  return { cells: res, merged };
}

export interface DespeckleOptions {
  /** Maximum cost increase, in okhw distance x 100. Default 4. */
  theta?: number;
  /** Cells to leave alone (non-zero = protected), e.g. intentional 2-colour mixes. */
  protect?: Uint8Array | null;
}

export interface DespeckleResult {
  cells: Uint8Array;
  /** Number of studs that changed colour. */
  changed: number;
}

/**
 * A stud with no 4-neighbour of its own colour switches to the most common colour among its 8
 * neighbours (first in scan order on ties) if that raises its cost by less than theta / 100.
 * Decisions read the input grid only, so the result does not depend on scan order.
 */
export function despeckle(cells: Uint8Array, gw: number, gh: number, cost: CostModel, opts: DespeckleOptions = {}): DespeckleResult {
  checkGrid(cells, cost);
  if (gw * gh !== cells.length) throw new RangeError('despeckle: grid size does not match cells');
  const theta = opts.theta ?? 4;
  const protect = opts.protect ?? null;
  if (protect && protect.length !== cells.length) throw new RangeError('despeckle: protect mask size does not match cells');
  const res = cells.slice();
  const tally = new Uint8Array(cost.k);
  const nb = new Uint8Array(8);
  let changed = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x, c = cells[i];
      if (protect && protect[i]) continue;
      if ((x > 0 && cells[i - 1] === c) || (x < gw - 1 && cells[i + 1] === c) || (y > 0 && cells[i - gw] === c) || (y < gh - 1 && cells[i + gw] === c)) continue;
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= gw) continue;
          const k = cells[yy * gw + xx];
          nb[m++] = k;
          tally[k]++;
        }
      }
      let top = -1, topN = 0;
      for (let j = 0; j < m; j++) {
        if (tally[nb[j]] > topN) {
          topN = tally[nb[j]];
          top = nb[j];
        }
      }
      for (let j = 0; j < m; j++) tally[nb[j]] = 0;
      if (top < 0 || top === c) continue;
      if ((cost.cost(i, top) - cost.cost(i, c)) * 100 < theta) {
        res[i] = top;
        changed++;
      }
    }
  }
  return { cells: res, changed };
}

/**
 * Builds the result: the colour table shrinks to the colours actually used, ordered by descending
 * count (ties by original index), and cells are re-indexed into it.
 */
export function compact(cells: Uint8Array, width: number, height: number, colorIds: readonly number[]): MosaicResult {
  if (cells.length !== width * height) throw new RangeError('compact: grid size does not match cells');
  const K = colorIds.length;
  const counts = new Int32Array(K);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] >= K) throw new RangeError(`compact: cell ${i} uses colour ${cells[i]} of ${K}`);
    counts[cells[i]]++;
  }
  const order: number[] = [];
  for (let k = 0; k < K; k++) if (counts[k] > 0) order.push(k);
  if (order.length > 255) throw new RangeError('compact: a result can use at most 255 colours');
  order.sort((p, q) => counts[q] - counts[p] || p - q);
  const map = new Uint8Array(K);
  order.forEach((k, j) => (map[k] = j));
  const out = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) out[i] = map[cells[i]];
  return { width, height, cells: out, colorIds: order.map((k) => colorIds[k]) };
}
