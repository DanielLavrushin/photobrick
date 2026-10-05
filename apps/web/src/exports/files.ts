// Shopping-list and image downloads. Loaded on demand (the first export click).

import { toBrickLinkXml, toPickABrickCsv, toRebrickableCsv, type BomLine, type MosaicResult, type Rgb } from '@photobrick/engine';
import { downloadBlob } from '../lib/download.ts';
import { PALETTE } from '../lib/palette.ts';
import { exportPxPerStud, renderMosaicPng } from '../viewer/index.ts';

/** BrickLink wanted list. Returns the lines BrickLink can't express (no BrickLink colour id). */
export function saveBrickLink(lines: BomLine[], stem: string): BomLine[] {
  const xml = toBrickLinkXml(lines, PALETTE);
  downloadBlob(new Blob([xml], { type: 'application/xml' }), `${stem}-bricklink-wanted-list.xml`);
  return lines.filter((l) => l.blId === null);
}

/** LEGO Pick a Brick upload CSV. Returns the engine's warnings (plain English sentences). */
export function savePickABrick(lines: BomLine[], stem: string): string[] {
  const { csv, warnings } = toPickABrickCsv(lines);
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `${stem}-pick-a-brick.csv`);
  return warnings;
}

export function saveRebrickable(lines: BomLine[], stem: string): void {
  downloadBlob(new Blob([toRebrickableCsv(lines, PALETTE)], { type: 'text/csv' }), `${stem}-rebrickable.csv`);
}

export async function savePng(result: MosaicResult, colors: readonly Rgb[], base: Rgb, stem: string, pxPerStud: number): Promise<{ width: number; height: number }> {
  const blob = await renderMosaicPng(result, colors, base, pxPerStud);
  const px = exportPxPerStud(result.width, result.height, pxPerStud);
  downloadBlob(blob, `${stem}.png`);
  return { width: result.width * px, height: result.height * px };
}
