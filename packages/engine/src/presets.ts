// Physical constants, bases, size presets and default settings.

import { DEFAULT_ADJUST } from './adjust.ts';
import type { BaseOption, MosaicSettings, SizeSpec } from './types.ts';

/** Stud pitch in millimetres. */
export const STUD_MM = 8;
/** Studs per side of one panel (the LEGO Art 16 x 16 unit). */
export const PANEL_STUDS = 16;
/** Largest grid side the engine and the share codec accept (16 panels). */
export const MAX_GRID_SIDE = 256;

export const BASES: readonly BaseOption[] = Object.freeze([
  { id: 'dbg', label: 'Dark Bluish Gray', colorId: 72, rgb: [108, 110, 104], part: '91405', studsPerPiece: 16 },
  { id: 'black', label: 'Black', colorId: 0, rgb: [5, 19, 29], part: '91405', studsPerPiece: 16 },
  { id: 'lbg', label: 'Light Bluish Gray', colorId: 71, rgb: [160, 165, 169], part: '91405', studsPerPiece: 16 },
  { id: 'tan', label: 'Tan', colorId: 19, rgb: [228, 205, 158], part: '91405', studsPerPiece: 16 },
  { id: 'baseplate48', label: 'Light Bluish Gray baseplate 48 x 48', colorId: 71, rgb: [160, 165, 169], part: '4186', studsPerPiece: 48 },
] satisfies BaseOption[]);

export const DEFAULT_BASE_ID = 'dbg';

/** The base with this id, or the default base when the id is unknown. */
export function baseById(id: string): BaseOption {
  return BASES.find((b) => b.id === id) ?? BASES[0];
}

export type SizePresetId = 's' | 'm' | 'l' | 'xl';

export interface SizePreset {
  id: SizePresetId;
  /** Panels along the image's long side. */
  longPanels: number;
  /** Studs along the image's long side. */
  longStuds: number;
}

export const SIZE_PRESETS: readonly SizePreset[] = Object.freeze([
  { id: 's', longPanels: 3, longStuds: 48 },
  { id: 'm', longPanels: 4, longStuds: 64 },
  { id: 'l', longPanels: 5, longStuds: 80 },
  { id: 'xl', longPanels: 6, longStuds: 96 },
] satisfies SizePreset[]);

/** A LEGO Art canvas: 3 x 3 panels, 48 x 48 studs. */
export const LEGO_ART_SIZE: Readonly<SizeSpec> = Object.freeze({ panelsW: 3, panelsH: 3 });

/**
 * Panel-aligned size for an image: the preset fixes the panels on the long side, the short side
 * follows the image's aspect ratio (clamped to 1:2 .. 1:1, at least 2 panels).
 */
export function suggestSize(imgW: number, imgH: number, preset: SizePresetId = 'm'): SizeSpec {
  const p = SIZE_PRESETS.find((s) => s.id === preset);
  if (!p) throw new RangeError(`unknown size preset: ${String(preset)}`);
  const long = p.longPanels;
  const valid = imgW > 0 && imgH > 0 && Number.isFinite(imgW) && Number.isFinite(imgH);
  const aspect = valid ? Math.min(1, Math.max(0.5, Math.min(imgW, imgH) / Math.max(imgW, imgH))) : 1;
  const short = Math.max(2, Math.round(long * aspect));
  return !valid || imgW >= imgH ? { panelsW: long, panelsH: short } : { panelsW: short, panelsH: long };
}

export function defaultSettings(imgW: number, imgH: number): MosaicSettings {
  return {
    size: suggestSize(imgW, imgH, 'm'),
    crop: { cx: 0.5, cy: 0.5, zoom: 1 },
    adjust: { ...DEFAULT_ADJUST },
    style: 'natural',
    dither: 0.5,
    skinProtect: 1,
    despeckle: true,
    minLot: 10,
    maxColors: null,
    enabledColors: null,
    base: DEFAULT_BASE_ID,
  };
}
