import { describe, expect, it } from 'vitest';
import { finishesOf, isFlatOpaque, isPseudoColor } from '../src/finish.ts';

describe('finish detection', () => {
  it.each([
    [0, 'Black'],
    [72, 'Dark Bluish Gray'],
    [1062, 'Vibrant Yellow'],
    [1136, 'Reddish Orange'],
    [379, 'Sand Blue'],
    [1050, 'Coral'],
    [28, 'Dark Tan'],
    [84, 'Medium Nougat'],
  ])('treats %i %s as plain opaque', (id, name) => {
    expect(finishesOf(id, name, false)).toEqual([]);
    expect(isFlatOpaque(id, name, false)).toBe(true);
  });

  it.each([
    [179, 'Flat Silver', false, ['metallic']],
    [147, 'Flat Dark Gold', false, ['metallic']],
    [297, 'Pearl Gold', false, ['metallic', 'pearl']],
    [148, 'Pearl Dark Gray', false, ['pearl']],
    [82, 'Metallic Gold', false, ['metallic']],
    [1092, 'Metallic Copper', false, ['metallic']],
    [383, 'Chrome Silver', false, ['chrome', 'metallic']],
    [1000, 'Glow in Dark White', false, ['glow']],
    [75, 'Speckle Black-Copper', false, ['metallic', 'speckle']],
    [1087, 'Satin Trans-Clear', true, ['satin', 'trans']],
    [1053, 'Opal Trans-Light Blue', true, ['opal', 'trans']],
    [129, 'Glitter Trans-Purple', true, ['glitter', 'trans']],
    [47, 'Trans-Clear', true, ['trans']],
    [1004, 'Trans-Flame Yellowish Orange', true, ['trans']],
    [132, 'Marbled Black and White', false, ['marbled']],
    [16, 'Rubber Black', false, ['rubber']],
    [1011, 'Neon Orange', false, ['fluorescent']],
    [440, 'Modulex Red', false, ['modulex']],
    [9998, 'Clikits Lavender', false, ['clikits']],
  ])('flags %i %s', (id, name, isTrans, expected) => {
    expect(finishesOf(id, name, isTrans)).toEqual(expected);
    expect(isFlatOpaque(id, name, isTrans)).toBe(false);
  });

  it('matches finish words case-insensitively but only as words where the rule says so', () => {
    expect(finishesOf(1, 'PEARL GOLD', false)).toEqual(['metallic', 'pearl']);
    expect(finishesOf(1, 'Goldenrod', false)).toEqual([]);
    expect(finishesOf(1, 'Metalhead', false)).toEqual([]);
  });

  it('rejects Rebrickable placeholder colours', () => {
    expect(isPseudoColor(-1, '[Unknown]')).toBe(true);
    expect(isPseudoColor(9999, '[No Color/Any Color]')).toBe(true);
    expect(finishesOf(-1, '[Unknown]', false)).toEqual(['pseudo']);
    expect(isFlatOpaque(9999, '[No Color/Any Color]', false)).toBe(false);
    expect(isPseudoColor(15, 'White')).toBe(false);
  });
});
