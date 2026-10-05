// Special-finish detection from Rebrickable colour names (the rules of the research script
// build_palette.py). Rebrickable has no finish column, so the name is all there is.

export type Finish =
  | 'chrome'
  | 'clikits'
  | 'fluorescent'
  | 'glitter'
  | 'glow'
  | 'marbled'
  | 'metallic'
  | 'modulex'
  | 'opal'
  | 'pearl'
  | 'pseudo'
  | 'rubber'
  | 'satin'
  | 'speckle'
  | 'trans';

const FINISH_RULES: readonly (readonly [Finish, RegExp])[] = [
  ['chrome', /\bchrome\b/i],
  // Also catches Flat Silver, Flat Dark Gold, Pearl Gold, Copper and the like.
  ['metallic', /\bmetallic\b|\bmetal\b|flat silver|flat dark gold|copper|\bgold\b|silver/i],
  ['pearl', /\bpearl/i],
  ['glitter', /glitter/i],
  ['glow', /\bglow\b/i],
  ['speckle', /speckle/i],
  ['satin', /\bsatin\b/i],
  ['opal', /\bopal\b/i],
  ['marbled', /marbled|swirl/i],
  ['clikits', /clikits/i],
  ['modulex', /modulex/i],
  ['rubber', /rubber/i],
  ['fluorescent', /neon|fluor/i],
];

/**
 * Rebrickable's placeholder colours ('[Unknown]' id -1, '[No Color/Any Color]' id 9999) are not
 * buildable colours.
 */
export function isPseudoColor(id: number, name: string): boolean {
  return id < 0 || id === 9999 || name.startsWith('[');
}

/** The special finishes of a colour, sorted; empty for a plain opaque colour. */
export function finishesOf(id: number, name: string, isTrans: boolean): Finish[] {
  const out: Finish[] = [];
  for (const [tag, rx] of FINISH_RULES) if (rx.test(name)) out.push(tag);
  if (isTrans) out.push('trans');
  if (isPseudoColor(id, name)) out.push('pseudo');
  return out.sort();
}

/** A plain ("flat") opaque colour: the only kind a mosaic palette uses. */
export function isFlatOpaque(id: number, name: string, isTrans: boolean): boolean {
  return finishesOf(id, name, isTrans).length === 0;
}
