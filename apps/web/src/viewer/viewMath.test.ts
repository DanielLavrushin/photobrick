import { describe, expect, it } from 'vitest';
import { FIT_SNAP_MAX_LOSS, MAX_CSS_PX_PER_STUD, clampView, fitView, screenToCell, zoomAt, zoomLimits, type View } from './viewMath.ts';

describe('fitView', () => {
  it('fits a landscape grid by width and centres it vertically', () => {
    const v = fitView(128, 64, 1000, 800, 0);
    expect(v.scale).toBeCloseTo(1000 / 128);
    expect(v.ox).toBeCloseTo(0);
    expect(v.oy).toBeCloseTo((800 - 64 * v.scale) / 2);
  });

  it('fits a portrait grid by height and keeps the padding', () => {
    const v = fitView(64, 96, 600, 700, 8);
    expect(v.scale).toBeCloseTo((700 - 16) / 96);
    expect(v.oy).toBeCloseTo(8);
    expect(v.ox).toBeCloseTo((600 - 64 * v.scale) / 2);
    expect(v.ox).toBeGreaterThan(8);
  });

  it('snaps to whole device pixels per stud when that costs little', () => {
    // 128 studs in 700 - 16 css px at dpr 2: 10.69 device px per stud -> 10.
    const v = fitView(128, 128, 1000, 700, 8, 2);
    expect(v.scale * 2).toBe(10);
    expect(v.ox * 2).toBe(Math.round(v.ox * 2));
    expect(v.oy * 2).toBe(Math.round(v.oy * 2));
    expect(v.oy).toBeGreaterThanOrEqual(8);
    // 3.56 device px per stud would lose 16% at 3: keep the exact fit, origin still on a pixel.
    const w = fitView(256, 192, 1280, 700, 8, 1);
    expect(w.scale).toBeCloseTo(684 / 192, 12);
    expect(Number.isInteger(w.ox) && Number.isInteger(w.oy)).toBe(true);
    for (const [gw, gh, cw, ch, r] of [[48, 48, 412, 700, 2.625], [64, 96, 999, 777, 1.5], [256, 192, 412, 600, 2]] as const) {
      const exact = fitView(gw, gh, cw, ch, 8);
      const snapped = fitView(gw, gh, cw, ch, 8, r);
      expect(snapped.scale).toBeLessThanOrEqual(exact.scale);
      expect(snapped.scale).toBeGreaterThanOrEqual(exact.scale * (1 - FIT_SNAP_MAX_LOSS) - 1e-12);
    }
  });

  it('stays finite for degenerate sizes', () => {
    for (const v of [fitView(0, 0, 100, 100), fitView(48, 48, 0, 0, 8), fitView(48, 48, 10, 10, 20)]) {
      expect(Number.isFinite(v.scale) && v.scale > 0).toBe(true);
      expect(Number.isFinite(v.ox) && Number.isFinite(v.oy)).toBe(true);
    }
  });
});

describe('zoomAt', () => {
  const limits = { min: 1, max: 100 };

  it('keeps the point under the cursor fixed', () => {
    const v: View = { scale: 4, ox: 10, oy: 20 };
    const cx = 137;
    const cy = 59;
    const before = { x: (cx - v.ox) / v.scale, y: (cy - v.oy) / v.scale };
    const z = zoomAt(v, 2.5, cx, cy, limits);
    expect(z.scale).toBe(10);
    expect((cx - z.ox) / z.scale).toBeCloseTo(before.x, 10);
    expect((cy - z.oy) / z.scale).toBeCloseTo(before.y, 10);
  });

  it('clamps to the limits and still keeps the anchor', () => {
    const v: View = { scale: 50, ox: -300, oy: -200 };
    const z = zoomAt(v, 10, 200, 100, limits);
    expect(z.scale).toBe(100);
    expect((200 - z.ox) / z.scale).toBeCloseTo((200 - v.ox) / v.scale, 10);
    expect(zoomAt(v, 0.001, 0, 0, limits).scale).toBe(1);
  });

  it('is the identity for factor 1', () => {
    const v: View = { scale: 7, ox: 3, oy: -4 };
    expect(zoomAt(v, 1, 55, 66, limits)).toEqual(v);
  });
});

describe('zoomLimits', () => {
  it('ranges from the fitted scale to MAX_CSS_PX_PER_STUD', () => {
    const l = zoomLimits(128, 128, 800, 600, 8);
    expect(l.min).toBeCloseTo(fitView(128, 128, 800, 600, 8).scale);
    expect(l.max).toBe(MAX_CSS_PX_PER_STUD);
  });

  it('never has max below min for tiny grids in big viewers', () => {
    const l = zoomLimits(2, 2, 4000, 4000);
    expect(l.max).toBeGreaterThanOrEqual(l.min);
  });
});

describe('clampView', () => {
  it('keeps a mosaic smaller than the viewer entirely inside it', () => {
    const c = clampView({ scale: 2, ox: -500, oy: 900 }, 100, 100, 400, 400, 10);
    expect(c.ox).toBe(10);
    expect(c.oy).toBe(400 - 10 - 200);
  });

  it('lets a larger mosaic pan only until its edge reaches the margin', () => {
    const big = { scale: 10, ox: 0, oy: 0 };
    const right = clampView({ ...big, ox: -5000 }, 100, 100, 400, 300, 8);
    expect(right.ox).toBe(400 - 8 - 1000);
    const left = clampView({ ...big, ox: 300 }, 100, 100, 400, 300, 8);
    expect(left.ox).toBe(8);
    const inside = clampView({ ...big, ox: -250, oy: -300 }, 100, 100, 400, 300, 8);
    expect(inside).toEqual({ scale: 10, ox: -250, oy: -300 });
  });

  it('leaves part of the mosaic visible whatever the input', () => {
    for (const ox of [-1e6, -1234, 0, 777, 1e6]) {
      const c = clampView({ scale: 3, ox, oy: ox }, 256, 192, 412, 915, 8);
      expect(c.ox).toBeLessThan(412);
      expect(c.ox + 256 * 3).toBeGreaterThan(0);
      expect(c.oy).toBeLessThan(915);
      expect(c.oy + 192 * 3).toBeGreaterThan(0);
    }
  });
});

describe('screenToCell', () => {
  const v: View = { scale: 10, ox: 5, oy: 7 };

  it('maps points to studs', () => {
    expect(screenToCell(v, 5, 7, 4, 3)).toEqual({ x: 0, y: 0 });
    expect(screenToCell(v, 14.99, 16.99, 4, 3)).toEqual({ x: 0, y: 0 });
    expect(screenToCell(v, 15, 17, 4, 3)).toEqual({ x: 1, y: 1 });
    expect(screenToCell(v, 44.9, 36.9, 4, 3)).toEqual({ x: 3, y: 2 });
  });

  it('returns null outside the grid', () => {
    expect(screenToCell(v, 4.9, 10, 4, 3)).toBeNull();
    expect(screenToCell(v, 45, 10, 4, 3)).toBeNull();
    expect(screenToCell(v, 10, 37, 4, 3)).toBeNull();
  });

  it('inverts the stud-centre mapping', () => {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(screenToCell(v, v.ox + (x + 0.5) * v.scale, v.oy + (y + 0.5) * v.scale, 4, 3)).toEqual({ x, y });
      }
    }
  });
});
