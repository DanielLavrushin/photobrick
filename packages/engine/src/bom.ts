// Parts list, cost estimate, base plates and physical size.

import { STUD_MM } from './presets.ts';
import { gridSize } from './resample.ts';
import type { BaseOption, BomLine, CostEstimate, MosaicResult, Palette, PaletteColor, SizeSpec } from './types.ts';

/** Studs per Rebrickable colour id, in colour-table order. Throws on cells outside the colour table. */
export function countColors(result: MosaicResult): Map<number, number> {
  const K = result.colorIds.length;
  const counts = new Int32Array(K);
  const cells = result.cells;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] >= K) throw new RangeError(`cell ${i} uses colour ${cells[i]} of ${K}`);
    counts[cells[i]]++;
  }
  const out = new Map<number, number>();
  for (let k = 0; k < K; k++) {
    if (counts[k] > 0) out.set(result.colorIds[k], (out.get(result.colorIds[k]) ?? 0) + counts[k]);
  }
  return out;
}

export interface BomOptions {
  /** Extra pieces per colour as a percentage of its count. Default 3. */
  sparesPct?: number;
  /** At least this many spares per colour. Default 2. */
  minSpares?: number;
}

const roundCents = (x: number): number => Math.round(x * 100) / 100;

/**
 * One line per colour in the mosaic, sorted by count (descending, then colour id). Colours missing
 * from the palette (e.g. a share made with an older palette) still get a line, named by their id.
 */
export function billOfMaterials(result: MosaicResult, palette: Palette, opts: BomOptions = {}): BomLine[] {
  const pct = opts.sparesPct ?? 3, minSpares = opts.minSpares ?? 2;
  if (!(Number.isFinite(pct) && pct >= 0)) throw new RangeError('sparesPct must be a number >= 0');
  if (!(Number.isInteger(minSpares) && minSpares >= 0)) throw new RangeError('minSpares must be an integer >= 0');
  const byId = new Map<number, PaletteColor>(palette.colors.map((c) => [c.id, c]));
  const lines: BomLine[] = [];
  for (const [colorId, count] of countColors(result)) {
    const c = byId.get(colorId);
    // The epsilon keeps e.g. 100 * 3 / 100 from rounding up to 4 through floating-point noise.
    const spares = Math.max(minSpares, Math.ceil((count * pct) / 100 - 1e-9));
    lines.push({
      colorId,
      name: c?.name ?? `Colour ${colorId}`,
      code: c?.code ?? '??',
      hex: c?.hex ?? '#808080',
      count,
      spares,
      total: count + spares,
      blId: c?.blId ?? null,
      elementId: c?.elementId ?? null,
      pab: c?.pab ?? false,
      tier: c?.tier ?? 'rare',
    });
  }
  lines.sort((p, q) => q.count - p.count || p.colorId - q.colorId);
  return lines;
}

/**
 * Tile cost of a parts list. BrickLink uses each colour's 6-month average (palette.blEurDefault when
 * not sampled). Pick a Brick covers colours sold there with a known price; the rest are listed in
 * notOnPab, and its totals are null when no colour is sold there. Totals are rounded to cents.
 */
export function estimateCost(lines: BomLine[], palette: Palette): CostEstimate {
  const byId = new Map<number, PaletteColor>(palette.colors.map((c) => [c.id, c]));
  let bl = 0, eur = 0, dkk = 0, onPab = 0;
  const notOnPab: number[] = [];
  for (const line of lines) {
    const c = byId.get(line.colorId);
    bl += line.total * (c?.blEur ?? palette.blEurDefault);
    if (line.pab && c && c.pabEur !== null && c.pabDkk !== null) {
      eur += line.total * c.pabEur;
      dkk += line.total * c.pabDkk;
      onPab++;
    } else {
      notOnPab.push(line.colorId);
    }
  }
  return {
    bricklinkEur: roundCents(bl),
    pickABrickEur: onPab > 0 ? roundCents(eur) : null,
    pickABrickDkk: onPab > 0 ? roundCents(dkk) : null,
    notOnPab,
    pricesAsOf: palette.pricesAsOf,
  };
}

/** Base pieces needed under the mosaic: ceil(W / studsPerPiece) x ceil(H / studsPerPiece). */
export function basePieces(size: SizeSpec, base: BaseOption): { part: string; colorId: number; count: number } {
  const { width, height } = gridSize(size);
  if (!(Number.isInteger(base.studsPerPiece) && base.studsPerPiece > 0)) throw new RangeError('studsPerPiece must be a positive integer');
  const count = Math.ceil(width / base.studsPerPiece) * Math.ceil(height / base.studsPerPiece);
  return { part: base.part, colorId: base.colorId, count };
}

/** Finished size in centimetres (8 mm per stud), rounded to 1 mm. */
export function physicalSizeCm(size: SizeSpec): { w: number; h: number } {
  const { width, height } = gridSize(size);
  const cm = (studs: number): number => Math.round(studs * STUD_MM) / 10;
  return { w: cm(width), h: cm(height) };
}
