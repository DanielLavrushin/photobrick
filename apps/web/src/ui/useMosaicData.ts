// Everything the UI derives from the current mosaic: viewer colours, parts list, cost, base pieces.

import { useMemo } from 'react';
import {
  basePieces,
  billOfMaterials,
  DEFAULT_BASE_ID,
  estimateCost,
  physicalSizeCm,
  type BaseOption,
  type BomLine,
  type CostEstimate,
  type MosaicResult,
  type Rgb,
  type SizeSpec,
} from '@photobrick/engine';
import { baseOf, PALETTE, rgbOfIds, sizeOfResult } from '../lib/palette.ts';
import { useApp } from '../state/store.ts';

export interface MosaicData {
  result: MosaicResult;
  colors: Rgb[];
  base: BaseOption;
  size: SizeSpec;
  cm: { w: number; h: number };
  studs: number;
  bom: BomLine[];
  spares: number;
  /** Tiles to order: studs + spares. */
  pieces: number;
  cost: CostEstimate;
  basePcs: { part: string; colorId: number; count: number };
}

export function computeMosaicData(result: MosaicResult, baseId: string): MosaicData {
  const base = baseOf(baseId);
  const size = sizeOfResult(result);
  const bom = billOfMaterials(result, PALETTE);
  let spares = 0;
  let pieces = 0;
  for (const l of bom) {
    spares += l.spares;
    pieces += l.total;
  }
  return {
    result,
    colors: rgbOfIds(result.colorIds),
    base,
    size,
    cm: physicalSizeCm(size),
    studs: result.width * result.height,
    bom,
    spares,
    pieces,
    cost: estimateCost(bom, PALETTE),
    basePcs: basePieces(size, base),
  };
}

export function useBaseId(): string {
  return useApp((s) => (s.phase === 'shared' ? s.shared?.base : s.settings?.base) ?? DEFAULT_BASE_ID);
}

/** Derived data for the displayed mosaic, or null before the first result. */
export function useMosaicData(): MosaicData | null {
  const result = useApp((s) => s.result);
  const baseId = useBaseId();
  return useMemo(() => (result ? computeMosaicData(result, baseId) : null), [result, baseId]);
}
