// The whole pipeline: resample -> adjust -> quantise -> post-process -> compact.

import { applyAdjust, isNeutralAdjust } from './adjust.ts';
import { DEFAULT_PALETTE } from './palette/index.ts';
import { compact, despeckle, limitColors, mergeSmallLots } from './post.ts';
import { activeColors, quantizeDetailed } from './quantize/index.ts';
import { MetricCostModel } from './quantize/metric.ts';
import { gridSize, resampleToGrid } from './resample.ts';
import type { GenerateTimings, MosaicResult, MosaicSettings, Palette, WorkingImage } from './types.ts';

function distinct(cells: Uint8Array, k: number): number {
  const seen = new Uint8Array(k);
  let n = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!seen[cells[i]]) {
      seen[cells[i]] = 1;
      n++;
    }
  }
  return n;
}

function remap(cells: Uint8Array, table: readonly number[]): Uint8Array {
  const out = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) out[i] = table[cells[i]];
  return out;
}

/**
 * Generates the mosaic for a working image. Deterministic: the same image, settings and palette give
 * the same bytes. Throws RangeError on invalid sizes or an empty colour selection.
 *
 * - maxColors: limitColors picks the colour subset, then the style's quantiser runs again inside that
 *   subset so dithering and mixing work with the colours that are left.
 * - despeckle (natural style): studs that belong to an intentional 2-colour mix are protected, so the
 *   mixing pattern survives. Studs whose cell chose a pure colour are despeckled as in other styles.
 */
export function generate(img: WorkingImage, settings: MosaicSettings, palette: Palette = DEFAULT_PALETTE): { result: MosaicResult; timings: GenerateTimings } {
  const t0 = performance.now();
  const { width: gw, height: gh } = gridSize(settings.size);
  const lin = resampleToGrid(img, settings.crop, gw, gh);
  const t1 = performance.now();
  const target = isNeutralAdjust(settings.adjust) ? lin : applyAdjust(lin, gw, gh, settings.adjust);
  const t2 = performance.now();
  const colors = activeColors(palette, settings);
  const q = quantizeDetailed(target, gw, gh, colors, settings);
  const t3 = performance.now();

  let { cells, mixA, mixB } = q;
  const cost = new MetricCostModel(q.metric, q.pal);
  const maxColors = settings.maxColors;
  if (maxColors !== null && Number.isFinite(maxColors) && distinct(cells, colors.length) > Math.max(1, Math.floor(maxColors))) {
    const { kept } = limitColors(cells, cost, maxColors);
    const sub = quantizeDetailed(target, gw, gh, kept.map((k) => colors[k]), settings);
    cells = remap(sub.cells, kept);
    mixA = sub.mixA && remap(sub.mixA, kept);
    mixB = sub.mixB && remap(sub.mixB, kept);
  }
  const minLot = Number.isFinite(settings.minLot) ? Math.floor(settings.minLot) : 0;
  if (minLot > 1) cells = mergeSmallLots(cells, cost, minLot).cells;
  if (settings.despeckle) {
    let protect: Uint8Array | null = null;
    if (mixA && mixB) {
      protect = new Uint8Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        const a = mixA[i], b = mixB[i], c = cells[i];
        protect[i] = a !== b && (c === a || c === b) ? 1 : 0;
      }
    }
    cells = despeckle(cells, gw, gh, cost, { protect }).cells;
  }
  const result = compact(cells, gw, gh, colors.map((c) => c.id));
  const t4 = performance.now();
  return {
    result,
    timings: { resampleMs: t1 - t0, adjustMs: t2 - t1, quantizeMs: t3 - t2, postMs: t4 - t3, totalMs: t4 - t0 },
  };
}
