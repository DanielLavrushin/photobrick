// Palette lookups shared by the UI (the engine's palette is the single source of colour data).

import { baseById, DEFAULT_PALETTE, PANEL_STUDS, type BaseOption, type MosaicResult, type PaletteColor, type Rgb, type SizeSpec } from '@photobrick/engine';

export const PALETTE = DEFAULT_PALETTE;

const BY_ID = new Map<number, PaletteColor>(PALETTE.colors.map((c) => [c.id, c]));
/** Colour for ids missing from the palette (e.g. a share made with a newer palette). */
export const UNKNOWN_RGB: Rgb = [128, 128, 128];

export function colorById(id: number): PaletteColor | undefined {
  return BY_ID.get(id);
}

/** sRGB colour of each local index of a result (what MosaicViewer and renderMosaicPng expect). */
export function rgbOfIds(ids: readonly number[]): Rgb[] {
  return ids.map((id) => BY_ID.get(id)?.rgb ?? UNKNOWN_RGB);
}

/** Palette colours enabled by default, in palette order. */
export const DEFAULT_ENABLED_IDS: readonly number[] = PALETTE.colors.filter((c) => c.defaultEnabled).map((c) => c.id);

/** The colour ids a settings object allows (null = the defaults). */
export function enabledIds(enabledColors: number[] | null): Set<number> {
  return new Set(enabledColors ?? DEFAULT_ENABLED_IDS);
}

export function baseOf(id: string): BaseOption {
  return baseById(id);
}

/** Panel size of a result (its grid is always whole panels when made by the app). */
export function sizeOfResult(r: Pick<MosaicResult, 'width' | 'height'>): SizeSpec {
  return { panelsW: Math.max(1, Math.ceil(r.width / PANEL_STUDS)), panelsH: Math.max(1, Math.ceil(r.height / PANEL_STUDS)) };
}

/** Relative luminance (0..1) of an sRGB colour. */
export function luminance(rgb: Rgb): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** Black or white text on a background colour, whichever has more contrast. */
export function textOn(rgb: Rgb): '#000000' | '#ffffff' {
  const L = luminance(rgb);
  // Contrast with black (L + .05)/.05 against white 1.05/(L + .05): equal at L ~ 0.179.
  return L > 0.179 ? '#000000' : '#ffffff';
}

export function rgbCss(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
