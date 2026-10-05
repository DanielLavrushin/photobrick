import { describe, expect, it } from 'vitest';
import { billOfMaterials, DEFAULT_PALETTE, PAB_MAX_ELEMENTS, toBrickLinkXml, toPickABrickCsv, toRebrickableCsv } from '../src/index.ts';
import type { BomLine } from '../src/index.ts';
import { testPalette } from './helpers.ts';

function line(colorId: number, total: number, extra: Partial<BomLine> = {}): BomLine {
  return { colorId, name: `Colour ${colorId}`, code: 'XX', hex: '#000000', count: total, spares: 0, total, blId: colorId + 1, elementId: String(6000000 + colorId), pab: true, tier: 'core', ...extra };
}

describe('toBrickLinkXml', () => {
  it('writes a wanted list without an XML declaration', () => {
    const xml = toBrickLinkXml([line(0, 1030, { blId: 11, name: 'Black', code: 'BK' }), line(322, 12, { blId: 156, name: 'Medium Azure', code: 'MA' })], DEFAULT_PALETTE);
    expect(xml).not.toContain('<?xml');
    expect(xml.startsWith('<INVENTORY>\n<ITEM>\n')).toBe(true);
    expect(xml.endsWith('</ITEM>\n</INVENTORY>\n')).toBe(true);
    expect(xml).toContain(
      '<ITEM>\n<ITEMTYPE>P</ITEMTYPE>\n<ITEMID>98138</ITEMID>\n<COLOR>11</COLOR>\n<MINQTY>1030</MINQTY>\n<CONDITION>N</CONDITION>\n<REMARKS>PhotoBrick BK Black</REMARKS>\n</ITEM>',
    );
    expect(xml.match(/<ITEM>/g)?.length).toBe(2);
  });

  it('uses the BrickLink part number and escapes text', () => {
    const pal = testPalette([], { blPart: '4073' });
    const xml = toBrickLinkXml([line(1, 5, { name: `Tom & Jerry's <"best">\u0001`, code: 'T&' })], pal);
    expect(xml).toContain('<ITEMID>4073</ITEMID>');
    expect(xml).toContain('<REMARKS>PhotoBrick T&amp; Tom &amp; Jerry&apos;s &lt;&quot;best&quot;&gt;</REMARKS>');
  });

  it('leaves out colours without a BrickLink id', () => {
    const xml = toBrickLinkXml([line(1, 5, { blId: null }), line(2, 5)], DEFAULT_PALETTE);
    expect(xml.match(/<ITEM>/g)?.length).toBe(1);
    expect(xml).toContain('<COLOR>3</COLOR>');
    expect(toBrickLinkXml([], DEFAULT_PALETTE)).toBe('<INVENTORY>\n</INVENTORY>\n');
  });
});

describe('toPickABrickCsv', () => {
  it('writes elementId,quantity rows', () => {
    const { csv, warnings } = toPickABrickCsv([line(0, 1030 - 100), line(15, 12)]);
    expect(csv).toBe('elementId,quantity\n6000000,930\n6000015,12\n');
    expect(warnings).toEqual([]);
  });

  it('caps quantities at 999 with a warning', () => {
    const { csv, warnings } = toPickABrickCsv([line(0, 2500, { name: 'Black', code: 'BK' })]);
    expect(csv).toBe('elementId,quantity\n6000000,999\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Black \(BK\).*2500.*999/);
  });

  it('skips lines without an element id and warns about colours not sold there', () => {
    const { csv, warnings } = toPickABrickCsv([line(1, 5, { elementId: null }), line(2, 5, { pab: false })]);
    expect(csv).toBe('elementId,quantity\n6000002,5\n');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/no LEGO element id/);
    expect(warnings[1]).toMatch(/not sold on Pick a Brick/);
  });

  it(`warns above ${PAB_MAX_ELEMENTS} distinct elements`, () => {
    const lines = Array.from({ length: PAB_MAX_ELEMENTS + 1 }, (_, i) => line(i, 3));
    const { csv, warnings } = toPickABrickCsv(lines);
    expect(csv.trim().split('\n')).toHaveLength(PAB_MAX_ELEMENTS + 2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/201 different elements/);
    expect(toPickABrickCsv(lines.slice(0, PAB_MAX_ELEMENTS)).warnings).toEqual([]);
  });
});

describe('toRebrickableCsv', () => {
  it('writes Part,Color,Quantity with Rebrickable ids', () => {
    expect(toRebrickableCsv([line(0, 1030), line(322, 12)], DEFAULT_PALETTE)).toBe('Part,Color,Quantity\n98138,0,1030\n98138,322,12\n');
  });

  it('works end to end from a bill of materials', () => {
    const bom = billOfMaterials({ width: 3, height: 1, cells: Uint8Array.from([0, 0, 1]), colorIds: [72, 15] }, DEFAULT_PALETTE);
    expect(toRebrickableCsv(bom, DEFAULT_PALETTE)).toBe('Part,Color,Quantity\n98138,72,4\n98138,15,3\n');
  });
});
