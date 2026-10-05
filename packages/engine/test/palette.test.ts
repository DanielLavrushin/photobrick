import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, loadPalette, PaletteError } from '../src/index.ts';
import raw from '../src/palette/98138.json' with { type: 'json' };

const clone = (): Record<string, unknown> & { colors: Record<string, unknown>[] } => JSON.parse(JSON.stringify(raw));

describe('DEFAULT_PALETTE', () => {
  it('is the validated 98138 palette', () => {
    expect(DEFAULT_PALETTE.part).toBe('98138');
    expect(DEFAULT_PALETTE.colors.length).toBe(raw.colors.length);
    expect(DEFAULT_PALETTE.colors.length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_PALETTE.attribution).toMatch(/Rebrickable/);
    for (const c of DEFAULT_PALETTE.colors) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('contains every colour the styles and bases rely on', () => {
    const ids = new Set(DEFAULT_PALETTE.colors.map((c) => c.id));
    for (const id of [0, 308, 70, 84, 92, 19, 78, 15, 72, 71]) expect(ids.has(id)).toBe(true);
  });
});

describe('loadPalette', () => {
  it('accepts the build output and returns a normalised copy', () => {
    const p = loadPalette(clone());
    expect(p).toEqual(DEFAULT_PALETTE);
    expect(p).not.toBe(DEFAULT_PALETTE);
  });

  const bad: [string, (p: ReturnType<typeof clone>) => void, RegExp][] = [
    ['not an object', (p) => Object.assign(p, { colors: 'x' }), /colors/],
    ['empty colour list', (p) => (p.colors = []), /colors/],
    ['rgb not matching hex', (p) => (p.colors[0].rgb = [1, 2, 3]), /rgb/],
    ['bad hex', (p) => (p.colors[0].hex = 'black'), /hex/],
    ['duplicate id', (p) => (p.colors[1].id = p.colors[0].id), /duplicate colour id/],
    ['duplicate code', (p) => (p.colors[1].code = p.colors[0].code), /duplicate code/],
    ['missing name', (p) => delete p.colors[2].name, /name/],
    ['bad tier', (p) => (p.colors[0].tier = 'legendary'), /tier/],
    ['negative price', (p) => (p.colors[0].pabEur = -1), /pabEur/],
    ['non-integer BrickLink id', (p) => (p.colors[0].blId = 1.5), /blId/],
    ['bad element id', (p) => (p.colors[0].elementId = 'abc'), /elementId/],
    ['missing part', (p) => delete p.part, /part/],
    ['id beyond u16', (p) => (p.colors[0].id = 70000), /16 bits/],
  ];
  for (const [what, mutate, msg] of bad) {
    it(`rejects: ${what}`, () => {
      const p = clone();
      mutate(p);
      expect(() => loadPalette(p)).toThrow(PaletteError);
      expect(() => loadPalette(p)).toThrow(msg);
    });
  }

  it('rejects non-objects', () => {
    expect(() => loadPalette(null)).toThrow(PaletteError);
    expect(() => loadPalette([])).toThrow(PaletteError);
  });
});
