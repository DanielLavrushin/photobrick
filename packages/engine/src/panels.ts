// 16 x 16 panels for panel-by-panel instructions.

import { PANEL_STUDS } from './presets.ts';
import type { MosaicResult, Panel } from './types.ts';

/** Panel cell value for positions outside the mosaic (only in a partial last row or column). */
export const PANEL_EMPTY = 255;

/** Row letters A..Z, then AA, AB, ... (bijective base 26). */
function rowLetters(n: number): string {
  let s = '';
  for (let v = n + 1; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s;
  return s;
}

/** Panel label: row letter (py) + column number (px + 1), e.g. panelLabel(2, 1) = 'B3'. */
export function panelLabel(px: number, py: number): string {
  if (!(Number.isInteger(px) && Number.isInteger(py) && px >= 0 && py >= 0)) throw new RangeError('panel coordinates must be integers >= 0');
  return `${rowLetters(py)}${px + 1}`;
}

/**
 * The mosaic cut into 16 x 16 panels, row by row (A1, A2, ..., B1, ...). A partial last panel is
 * padded with PANEL_EMPTY. counts lists local colour indices in ascending order.
 */
export function panelsOf(result: MosaicResult): Panel[] {
  const { width: W, height: H, cells } = result;
  if (cells.length !== W * H) throw new RangeError('panelsOf: grid size does not match cells');
  const K = result.colorIds.length;
  const P = PANEL_STUDS;
  const panels: Panel[] = [];
  const tally = new Int32Array(K);
  for (let py = 0; py * P < H; py++) {
    for (let px = 0; px * P < W; px++) {
      const pc = new Uint8Array(P * P).fill(PANEL_EMPTY);
      tally.fill(0);
      const yEnd = Math.min(P, H - py * P), xEnd = Math.min(P, W - px * P);
      for (let yy = 0; yy < yEnd; yy++) {
        const src = (py * P + yy) * W + px * P;
        for (let xx = 0; xx < xEnd; xx++) {
          const v = cells[src + xx];
          if (v >= K) throw new RangeError(`panelsOf: cell uses colour ${v} of ${K}`);
          pc[yy * P + xx] = v;
          tally[v]++;
        }
      }
      const counts = new Map<number, number>();
      for (let k = 0; k < K; k++) if (tally[k] > 0) counts.set(k, tally[k]);
      panels.push({ px, py, label: panelLabel(px, py), cells: pc, counts });
    }
  }
  return panels;
}
