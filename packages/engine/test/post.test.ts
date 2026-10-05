import { describe, expect, it } from 'vitest';
import { activeColors, buildCostModel, compact, DEFAULT_PALETTE, despeckle, limitColors, mergeSmallLots, quantize, resampleToGrid } from '../src/index.ts';
import type { CostModel } from '../src/index.ts';
import { lcg, photoLike, settings } from './helpers.ts';

/** A cost model from an explicit n x k table. */
function tableCost(n: number, k: number, f: (i: number, c: number) => number): CostModel {
  const t = Float64Array.from({ length: n * k }, (_, j) => f(Math.floor(j / k), j % k));
  return { n, k, cost: (i, c) => t[i * k + c] };
}

function counts(cells: Uint8Array, k: number): number[] {
  const c = new Array<number>(k).fill(0);
  for (const v of cells) c[v]++;
  return c;
}

function isolated(cells: Uint8Array, w: number, h: number): number {
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cells[y * w + x];
      const same = (x > 0 && cells[y * w + x - 1] === c) || (x < w - 1 && cells[y * w + x + 1] === c) || (y > 0 && cells[(y - 1) * w + x] === c) || (y < h - 1 && cells[(y + 1) * w + x] === c);
      if (!same) n++;
    }
  }
  return n;
}

// A real-ish case: the default pipeline's quantiser output on a synthetic photo.
const W = 64, H = 48;
const s = settings({ style: 'faithful', dither: 1 });
const colors = activeColors(DEFAULT_PALETTE, s);
const lin = resampleToGrid(photoLike(640, 480, 2), { cx: 0.5, cy: 0.5, zoom: 1 }, W, H);
const q = quantize(lin, W, H, colors, s);
const cost = buildCostModel(lin, W, H, colors, s);

describe('limitColors', () => {
  it('uses at most maxColors colours and leaves the input untouched', () => {
    const before = q.slice();
    const used = new Set(q).size;
    expect(used).toBeGreaterThan(12);
    for (const max of [1, 2, 6, 12]) {
      const r = limitColors(q, cost, max);
      expect(new Set(r.cells).size).toBeLessThanOrEqual(max);
      expect(r.kept.length).toBeLessThanOrEqual(max);
      for (const v of r.cells) expect(r.kept).toContain(v);
    }
    expect(Array.from(q)).toEqual(Array.from(before));
  });

  it('keeps cells whose colour survives and is a no-op under the limit', () => {
    const r = limitColors(q, cost, 8);
    for (let i = 0; i < q.length; i++) if (r.kept.includes(q[i])) expect(r.cells[i]).toBe(q[i]);
    const all = limitColors(q, cost, 255);
    expect(Array.from(all.cells)).toEqual(Array.from(q));
  });

  it('swap refinement can bring in an unused colour that beats the greedy choice', () => {
    // Colour 2 is the best single compromise but no cell uses it, so elimination alone cannot pick it.
    const c = tableCost(4, 3, (i, k) => (i % 2 === 0 ? [0, 10, 1] : [10, 0, 1])[k]);
    const r = limitColors(Uint8Array.from([0, 1, 0, 1]), c, 1);
    expect(r.kept).toEqual([2]);
    expect(Array.from(r.cells)).toEqual([2, 2, 2, 2]);
  });

  it('greedy elimination drops the colour whose cells lose least', () => {
    // colour 1's cells lose 0.1 each by moving to colour 0; colour 2's cells would lose 5 each.
    const cells = Uint8Array.from([0, 0, 1, 1, 1, 2, 2]);
    const c = tableCost(7, 3, (i, k) => (k === cells[i] ? 0 : cells[i] === 1 && k === 0 ? 0.1 : 5));
    const r = limitColors(cells, c, 2);
    expect(r.kept).toEqual([0, 2]);
    expect(Array.from(r.cells)).toEqual([0, 0, 0, 0, 0, 2, 2]);
  });
});

describe('mergeSmallLots', () => {
  it('leaves no colour with fewer than minLot studs', () => {
    for (const minLot of [2, 10, 40]) {
      const small = counts(q, colors.length).filter((n) => n > 0 && n < minLot).length;
      const r = mergeSmallLots(q, cost, minLot);
      for (const n of counts(r.cells, colors.length)) if (n > 0) expect(n).toBeGreaterThanOrEqual(minLot);
      if (small > 0) expect(r.merged.length).toBeGreaterThan(0);
      if (minLot >= 10) expect(small).toBeGreaterThan(0);
    }
  });

  it("moves a small lot to each cell's next-best remaining colour", () => {
    // 12 cells: 10 of colour 0, 2 of colour 1. Cell 10 prefers 2 over 0 as its second choice, but 2 is unused.
    const cells = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    const c = tableCost(12, 3, (i, k) => (k === cells[i] ? 0 : k === 2 ? 0.1 : 0.5));
    const r = mergeSmallLots(cells, c, 5);
    expect(Array.from(r.cells)).toEqual(new Array(12).fill(0));
    expect(r.merged).toEqual([1]);
  });

  it('merges smallest first, so a lot that grows past minLot survives', () => {
    // colour 2 (3 cells) merges into colour 1 (4 cells), which then has 7 >= 5 and stays.
    const cells = Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2]);
    const c = tableCost(13, 3, (i, k) => (k === cells[i] ? 0 : cells[i] === 2 && k === 1 ? 0.01 : 1));
    const r = mergeSmallLots(cells, c, 5);
    expect(counts(r.cells, 3)).toEqual([6, 7, 0]);
  });

  it('does nothing when no colour could reach minLot, or minLot <= 1', () => {
    expect(Array.from(mergeSmallLots(Uint8Array.from([0, 1, 2]), tableCost(3, 3, () => 1), 10).cells)).toEqual([0, 1, 2]);
    expect(Array.from(mergeSmallLots(q, cost, 1).cells)).toEqual(Array.from(q));
  });
});

describe('despeckle', () => {
  it('reduces isolated studs', () => {
    const r = despeckle(q, W, H, cost);
    expect(r.changed).toBeGreaterThan(0);
    expect(isolated(r.cells, W, H)).toBeLessThan(isolated(q, W, H));
  });

  it('switches an isolated stud to the most common neighbour when cheap, never when too costly', () => {
    const cells = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const cheap = tableCost(9, 2, (i, k) => (i === 4 ? [0.03, 0] : [0, 1])[k]);
    expect(Array.from(despeckle(cells, 3, 3, cheap).cells)).toEqual(new Array(9).fill(0));
    const dear = tableCost(9, 2, (i, k) => (i === 4 ? [0.05, 0] : [0, 1])[k]);
    expect(despeckle(cells, 3, 3, dear).changed).toBe(0);
    expect(despeckle(cells, 3, 3, cheap, { theta: 2 }).changed).toBe(0);
  });

  it('never touches protected studs', () => {
    const protect = new Uint8Array(W * H).fill(1);
    expect(despeckle(q, W, H, cost, { protect }).changed).toBe(0);
  });
});

describe('compact', () => {
  it('orders the colour table by descending count and re-indexes cells', () => {
    const r = compact(Uint8Array.from([2, 2, 0, 2, 3, 3]), 3, 2, [10, 11, 12, 13]);
    expect(r.colorIds).toEqual([12, 13, 10]);
    expect(Array.from(r.cells)).toEqual([0, 0, 2, 0, 1, 1]);
    expect([r.width, r.height]).toEqual([3, 2]);
  });

  it('breaks count ties by the original colour order', () => {
    const rnd = lcg(1);
    const cells = Uint8Array.from({ length: 40 }, () => Math.floor(rnd() * 4));
    const r = compact(cells, 8, 5, [7, 6, 5, 4]);
    const c = counts(r.cells, r.colorIds.length);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1]);
  });
});
