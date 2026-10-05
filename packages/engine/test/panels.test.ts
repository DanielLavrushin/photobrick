import { describe, expect, it } from 'vitest';
import { PANEL_EMPTY, panelLabel, panelsOf } from '../src/index.ts';
import type { MosaicResult } from '../src/index.ts';

function grid(width: number, height: number, f: (x: number, y: number) => number, colors = 4): MosaicResult {
  const cells = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[y * width + x] = f(x, y);
  return { width, height, cells, colorIds: Array.from({ length: colors }, (_, i) => 100 + i) };
}

describe('panelLabel', () => {
  it('is row letter plus column number', () => {
    expect(panelLabel(0, 0)).toBe('A1');
    expect(panelLabel(2, 1)).toBe('B3');
    expect(panelLabel(15, 15)).toBe('P16');
    expect(panelLabel(0, 25)).toBe('Z1');
    expect(panelLabel(0, 26)).toBe('AA1');
    expect(() => panelLabel(-1, 0)).toThrow(RangeError);
  });
});

describe('panelsOf', () => {
  it('cuts the grid into 16 x 16 panels, row by row', () => {
    const r = grid(48, 32, (x, y) => (Math.floor(x / 16) + 3 * Math.floor(y / 16)) % 4);
    const panels = panelsOf(r);
    expect(panels.map((p) => p.label)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    expect(panels.map((p) => [p.px, p.py])).toEqual([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
    for (const p of panels) {
      expect(p.cells.length).toBe(256);
      const v = (p.px + 3 * p.py) % 4;
      expect([...p.counts]).toEqual([[v, 256]]);
      expect(p.cells.every((c) => c === v)).toBe(true);
    }
  });

  it('copies cells in row-major panel order', () => {
    const r = grid(32, 16, (x, y) => (x + 2 * y) % 3, 3);
    const [a, b] = panelsOf(r);
    for (let yy = 0; yy < 16; yy++) {
      for (let xx = 0; xx < 16; xx++) {
        expect(a.cells[yy * 16 + xx]).toBe(r.cells[yy * 32 + xx]);
        expect(b.cells[yy * 16 + xx]).toBe(r.cells[yy * 32 + 16 + xx]);
      }
    }
    const total = [0, 0, 0];
    for (const p of [a, b]) for (const [k, n] of p.counts) total[k] += n;
    expect(total.reduce((s, n) => s + n, 0)).toBe(512);
  });

  it('pads a partial last panel with PANEL_EMPTY', () => {
    const panels = panelsOf(grid(20, 18, () => 1));
    expect(panels.map((p) => p.label)).toEqual(['A1', 'A2', 'B1', 'B2']);
    const last = panels[3];
    expect([...last.counts]).toEqual([[1, 4 * 2]]);
    expect(last.cells[0]).toBe(1);
    expect(last.cells[4]).toBe(PANEL_EMPTY);
    expect(last.cells[2 * 16]).toBe(PANEL_EMPTY);
    expect(panels[1].counts.get(1)).toBe(4 * 16);
  });
});
