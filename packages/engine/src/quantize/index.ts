// Style dispatch: which colours a style may use, how cells are matched, and the per-cell cost model.

import { paletteLab, type PaletteLab } from '../color.ts';
import type { MosaicSettings, Palette, PaletteColor, Rgb } from '../types.ts';
import { DITHER_DEFAULTS, ditherInto, fillLabMetric, nearestInto, OKHW2 } from './faithful.ts';
import { GREYSCALE_COLOR_IDS, GREYSCALE_WEIGHTS, SEPIA_COLOR_IDS, SEPIA_WEIGHTS } from './lightness.ts';
import { allocCellMetric, MetricCostModel, type CellMetric, type CostModel, type MatchWeights } from './metric.ts';
import { NATURAL_DEFAULTS, naturalCells, prepareNatural, quantizeNatural, type NaturalOptions, type NaturalTables } from './natural.ts';

/** Largest colour list a grid can index (Uint8Array cells; the share codec reserves 255). */
export const MAX_ACTIVE_COLORS = 255;

/**
 * The colours a style may use, in palette order (sepia and greyscale: their fixed list, dark to light).
 * enabledColors (null = every defaultEnabled colour) is ignored when it would leave no colour, or
 * fewer than 2 for sepia and greyscale.
 */
export function activeColors(palette: Palette, settings: Pick<MosaicSettings, 'style' | 'enabledColors'>): PaletteColor[] {
  const enabled = settings.enabledColors ? new Set(settings.enabledColors) : null;
  if (settings.style === 'sepia' || settings.style === 'greyscale') {
    const byId = new Map(palette.colors.map((c) => [c.id, c]));
    const ids = settings.style === 'sepia' ? SEPIA_COLOR_IDS : GREYSCALE_COLOR_IDS;
    const fixed = ids.map((id) => byId.get(id)).filter((c): c is PaletteColor => c !== undefined);
    if (fixed.length >= 2) {
      const chosen = enabled ? fixed.filter((c) => enabled.has(c.id)) : fixed;
      return chosen.length >= 2 ? chosen : fixed;
    }
    // A palette without the style's colours: use the enabled colours with the style's metric.
  }
  if (enabled) {
    const chosen = palette.colors.filter((c) => enabled.has(c.id));
    if (chosen.length > 0) return chosen;
  }
  const defaults = palette.colors.filter((c) => c.defaultEnabled);
  return defaults.length > 0 ? defaults : palette.colors.slice();
}

// Caches keyed by the colour values (never by identity: activeColors returns fresh arrays).
const CACHE_SIZE = 32;
const labCache = new Map<string, PaletteLab>();
const tableCache = new Map<string, NaturalTables>();

function rgbKey(colors: readonly { rgb: Rgb }[]): string {
  let s = '';
  for (const c of colors) s += `${c.rgb[0]},${c.rgb[1]},${c.rgb[2]};`;
  return s;
}

function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  } else {
    cache.delete(key); // re-insert: most recently used last
  }
  cache.set(key, v);
  return v;
}

/** OKLab of a colour list, cached per list of sRGB values. */
export function paletteLabOf(colors: readonly { rgb: Rgb }[]): PaletteLab {
  return remember(labCache, rgbKey(colors), () => paletteLab(colors.map((c) => c.rgb)));
}

/** The natural style's mix table for a colour list, cached per (colour values, table options). */
export function naturalTables(colors: readonly { rgb: Rgb }[], o: NaturalOptions): NaturalTables {
  const key = `${rgbKey(colors)}|${o.maxPair}|${o.R}|${o.lambda}`;
  return remember(tableCache, key, () => prepareNatural(paletteLabOf(colors), o.maxPair, o.R, o.lambda));
}

const unit = (v: number, fallback: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Natural-style options for the settings: skinProtect -> strength, dither -> maxPair = 0.2 * dither. */
export function naturalOptions(settings: Pick<MosaicSettings, 'dither' | 'skinProtect'>): NaturalOptions {
  return { ...NATURAL_DEFAULTS, strength: unit(settings.skinProtect, 1), maxPair: 0.2 * unit(settings.dither, 0.5) };
}

function styleWeights(style: MosaicSettings['style']): MatchWeights {
  return style === 'sepia' ? SEPIA_WEIGHTS : style === 'greyscale' ? GREYSCALE_WEIGHTS : OKHW2;
}

type QuantizeSettings = Pick<MosaicSettings, 'style' | 'dither' | 'skinProtect'>;

/** Quantiser output plus what post-processing needs. */
export interface QuantizeDetail {
  /** Indices into the colour list. */
  cells: Uint8Array;
  /** Per-cell targets and metric weights (the cost model's input). */
  metric: CellMetric;
  pal: PaletteLab;
  /** natural style only: the two members of each cell's mix (equal for a pure colour). */
  mixA: Uint8Array | null;
  mixB: Uint8Array | null;
}

function checkInput(lin: Float32Array, gw: number, gh: number, colors: readonly PaletteColor[]): void {
  if (!(Number.isInteger(gw) && Number.isInteger(gh) && gw > 0 && gh > 0)) throw new RangeError('quantize: bad grid size');
  if (lin.length !== 3 * gw * gh) throw new RangeError(`quantize: expected ${3 * gw * gh} values, got ${lin.length}`);
  if (colors.length < 1 || colors.length > MAX_ACTIVE_COLORS) throw new RangeError(`quantize: need 1..${MAX_ACTIVE_COLORS} colours, got ${colors.length}`);
}

export function quantizeDetailed(lin: Float32Array, gw: number, gh: number, colors: readonly PaletteColor[], settings: QuantizeSettings): QuantizeDetail {
  checkInput(lin, gw, gh, colors);
  const n = gw * gh;
  const cells = new Uint8Array(n);
  if (settings.style === 'natural') {
    const o = naturalOptions(settings);
    const T = naturalTables(colors, o);
    const metric = naturalCells(lin, n, o);
    const mixA = new Uint8Array(n), mixB = new Uint8Array(n);
    quantizeNatural(metric, gw, gh, T, o.hueGate, cells, mixA, mixB);
    return { cells, metric, pal: T.pal, mixA, mixB };
  }
  const pal = paletteLabOf(colors);
  const w = styleWeights(settings.style);
  const metric = allocCellMetric(n);
  fillLabMetric(lin, metric, w);
  const strength = unit(settings.dither, 0.5);
  if (strength === 0) nearestInto(metric, pal, w, cells);
  else ditherInto(metric, gw, gh, pal, w, { ...DITHER_DEFAULTS, strength }, cells);
  return { cells, metric, pal, mixA: null, mixB: null };
}

/**
 * Quantises gw x gh linear-RGB targets with the settings' style. Returns indices into `colors`
 * (use activeColors to get the list a style expects).
 */
export function quantize(lin: Float32Array, gw: number, gh: number, colors: PaletteColor[], settings: MosaicSettings): Uint8Array {
  return quantizeDetailed(lin, gw, gh, colors, settings).cells;
}

/** The style's per-cell cost of each colour in `colors`, for limitColors, mergeSmallLots and despeckle. */
export function buildCostModel(lin: Float32Array, gw: number, gh: number, colors: readonly PaletteColor[], settings: QuantizeSettings): CostModel {
  checkInput(lin, gw, gh, colors);
  const n = gw * gh;
  const pal = paletteLabOf(colors);
  if (settings.style === 'natural') return new MetricCostModel(naturalCells(lin, n, naturalOptions(settings)), pal);
  const metric = allocCellMetric(n);
  fillLabMetric(lin, metric, styleWeights(settings.style));
  return new MetricCostModel(metric, pal);
}
