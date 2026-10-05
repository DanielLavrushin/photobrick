// Guards the committed outputs and data: palettes are only ever written by the tool (canonical
// formatting), their codes are the reserved ones, and the price fields agree with the snapshots.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Palette } from '../../../packages/engine/src/types.ts';
import { parseCodeBook } from '../src/codes.ts';
import { DEFAULT_RULES, PARTS } from '../src/config.ts';
import { isFlatOpaque } from '../src/finish.ts';
import { roundTo, serializePalette } from '../src/palette.ts';
import { PAB_SOLD_STATUS, parseBrickLinkSnapshot, parseColorsExternal, parsePabSnapshot } from '../src/snapshots.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = (path: string): string => resolve(REPO_ROOT, path);
const data = (file: string): unknown => JSON.parse(readFileSync(root(`tools/palette/data/${file}`), 'utf8'));

const codes = parseCodeBook(data('codes.json'));
const external = parseColorsExternal(data('colors-external.json'));

describe.each(Object.values(PARTS))('committed palette $part', (config) => {
  const text = readFileSync(root(`packages/engine/src/palette/${config.part}.json`), 'utf8');
  const palette = JSON.parse(text) as Palette;

  it('is in the canonical format the tool writes', () => {
    expect(serializePalette(palette)).toBe(text);
  });

  it('describes the configured part', () => {
    expect(palette.part).toBe(config.part);
    expect(palette.partName).toBe(config.partName);
    expect(palette.blPart).toBe(config.blPart);
    expect(palette.attribution).toMatch(/^Colour and part data from Rebrickable \(rebrickable\.com\)\./);
  });

  it('uses the reserved code of every colour, each once', () => {
    expect(palette.colors.length).toBeGreaterThan(0);
    for (const c of palette.colors) expect(c.code, c.name).toBe(codes.get(c.id));
    expect(new Set(palette.colors.map((c) => c.code)).size).toBe(palette.colors.length);
    expect(new Set(palette.colors.map((c) => c.id)).size).toBe(palette.colors.length);
  });

  it('holds only plain opaque colours with consistent fields', () => {
    for (const c of palette.colors) {
      expect(isFlatOpaque(c.id, c.name, false), c.name).toBe(true);
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(c.rgb).toEqual([1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)));
      const ext = external.get(c.id);
      expect([c.blId, c.blName, c.legoId]).toEqual([ext?.blId ?? null, ext?.blName ?? null, ext?.legoId ?? null]);
      expect(c.pab).toBe(c.pabDkk !== null);
      expect(c.pabEur).toBe(c.pabDkk === null ? null : roundTo(c.pabDkk / DEFAULT_RULES.dkkPerEur, 2));
    }
  });

  it('agrees with its price snapshots', () => {
    const pab = config.pab === null ? null : parsePabSnapshot(data(config.pab), config.pab);
    const bl = config.brickLink === null ? null : parseBrickLinkSnapshot(data(config.brickLink), config.brickLink);
    for (const c of palette.colors) {
      const offer = pab?.elements.find((e) => e.colorId === c.id && e.status === PAB_SOLD_STATUS);
      expect(c.pab, c.name).toBe(offer !== undefined);
      if (offer !== undefined) {
        expect(c.elementId).toBe(offer.elementId);
        expect(c.pabDkk).toBe(offer.priceDkk);
      }
      expect(c.defaultEnabled, c.name).toBe(pab !== null ? c.pab : c.tier !== 'rare');
      const row = bl?.rows.find((r) => r.blColorId === c.blId);
      expect(c.blEur, c.name).toBe(row === undefined ? null : roundTo(row.soldNewQtyAvgDkk / DEFAULT_RULES.dkkPerEur, 4));
    }
  });
});
