// Every t('literal') / i18nKey="literal" in the source must exist in en.json (with plural forms),
// and so must the key families built at run time.
import { BASES, SIZE_PRESETS } from '@photobrick/engine';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../lib/examples.ts';
import en from './en.json';

// All app sources as text (the viewer has no user-visible strings of its own).
const SOURCES = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../viewer/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function has(key: string): boolean {
  let node: unknown = en;
  const parts = key.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== 'object') return false;
    const obj = node as Record<string, unknown>;
    const k = parts[i];
    if (i === parts.length - 1) return typeof obj[k] === 'string' || (typeof obj[`${k}_one`] === 'string' && typeof obj[`${k}_other`] === 'string');
    node = obj[k];
  }
  return false;
}

describe('i18n keys', () => {
  const used = new Set<string>();
  for (const code of Object.values(SOURCES)) {
    for (const m of code.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of code.matchAll(/i18nKey="([a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
  }

  it('finds the keys used in the source', () => {
    expect(used.size).toBeGreaterThan(150);
  });

  it('has every literal key', () => {
    expect([...used].filter((k) => !has(k))).toEqual([]);
  });

  it('has every key family built at run time', () => {
    const dynamic = [
      ...SIZE_PRESETS.flatMap((p) => [`size.preset.${p.id}`, `size.presetName.${p.id}`]),
      ...['natural', 'faithful', 'sepia', 'greyscale'].flatMap((s) => [`look.style.${s}.name`, `look.style.${s}.desc`]),
      ...BASES.flatMap((b) => [`bases.${b.id}`, `bases.colour.${b.id}`, `bases.part.${b.part}`]),
      ...['size', 'look', 'colours', 'parts', 'build'].map((id) => `tabs.${id}`),
      ...EXAMPLES.map((e) => e.titleKey),
    ];
    expect(dynamic.filter((k) => !has(k))).toEqual([]);
  });

  it('keeps the LEGO Fair Play disclaimer verbatim', () => {
    expect(en.legal.disclaimer).toBe('LEGO® is a trademark of the LEGO Group of companies which does not sponsor, authorize or endorse this site.');
  });
});
