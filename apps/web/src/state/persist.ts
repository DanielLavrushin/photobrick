// The user's look preferences, remembered across photos in localStorage. Size and crop belong to one
// photo and are never stored. Every access is guarded: storage can be missing, full or blocked.

import { BASES, type Adjust, type MosaicSettings, type StylePreset } from '@photobrick/engine';

export const STORAGE_KEY = 'photobrick:look:v1';

export type LookSettings = Pick<MosaicSettings, 'style' | 'base' | 'dither' | 'skinProtect' | 'despeckle' | 'minLot' | 'maxColors' | 'enabledColors' | 'adjust'>;

const STYLES: readonly StylePreset[] = ['natural', 'faithful', 'sepia', 'greyscale'];

const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function sanitizeAdjust(raw: unknown): Adjust | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  if (inRange(a.exposure, -2, 2) && inRange(a.contrast, 0.5, 1.5) && inRange(a.saturation, 0, 1.5) && inRange(a.detail, 0, 1)) {
    return { exposure: a.exposure, contrast: a.contrast, saturation: a.saturation, detail: a.detail };
  }
  return undefined;
}

/** Keeps only valid fields of a stored look (unknown or out-of-range values are dropped). */
export function sanitizeLook(raw: unknown): Partial<LookSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<LookSettings> = {};
  if (typeof r.style === 'string' && (STYLES as readonly string[]).includes(r.style)) out.style = r.style as StylePreset;
  if (typeof r.base === 'string' && BASES.some((b) => b.id === r.base)) out.base = r.base;
  if (inRange(r.dither, 0, 1)) out.dither = r.dither;
  if (inRange(r.skinProtect, 0, 1)) out.skinProtect = r.skinProtect;
  if (typeof r.despeckle === 'boolean') out.despeckle = r.despeckle;
  if (inRange(r.minLot, 0, 30) && Number.isInteger(r.minLot)) out.minLot = r.minLot;
  if (r.maxColors === null || (inRange(r.maxColors, 2, 40) && Number.isInteger(r.maxColors))) out.maxColors = r.maxColors as number | null;
  if (r.enabledColors === null) out.enabledColors = null;
  else if (Array.isArray(r.enabledColors) && r.enabledColors.length >= 2 && r.enabledColors.every((id) => Number.isInteger(id) && id >= 0 && id <= 0xffff)) {
    out.enabledColors = [...new Set(r.enabledColors as number[])];
  }
  const adjust = sanitizeAdjust(r.adjust);
  if (adjust) out.adjust = adjust;
  return out;
}

export function pickLook(s: MosaicSettings): LookSettings {
  return {
    style: s.style,
    base: s.base,
    dither: s.dither,
    skinProtect: s.skinProtect,
    despeckle: s.despeckle,
    minLot: s.minLot,
    maxColors: s.maxColors,
    enabledColors: s.enabledColors,
    adjust: { ...s.adjust },
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadLook(): Partial<LookSettings> {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return raw ? sanitizeLook(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

let lastSaved = '';

export function saveLook(s: MosaicSettings): void {
  try {
    const json = JSON.stringify(pickLook(s));
    if (json === lastSaved) return;
    storage()?.setItem(STORAGE_KEY, json);
    lastSaved = json;
  } catch {
    // Private mode, quota or blocked storage: the preferences just aren't remembered.
  }
}

/** Default settings for a new photo with the remembered look applied. */
export function withLook(defaults: MosaicSettings, look: Partial<LookSettings> = loadLook()): MosaicSettings {
  return { ...defaults, ...look, adjust: { ...(look.adjust ?? defaults.adjust) } };
}
