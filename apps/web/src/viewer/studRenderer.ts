import type { Rgb } from '@photobrick/engine';
import type { View } from './viewMath.ts';

export type RendererKind = 'webgl2' | 'canvas2d';

/** Either a <canvas> in the page or an OffscreenCanvas (used by the PNG export). */
export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

/** The largest local colour table a mosaic may have (MosaicResult.colorIds). */
export const MAX_COLORS = 255;

/**
 * Draws a grid of round tiles. Implementations keep a CPU copy of everything they are given, so a
 * lost GPU context can be rebuilt without asking the caller again.
 */
export interface StudRenderer {
  readonly kind: RendererKind;
  /** The canvas being drawn on. createRenderer may have swapped in a new element; always use this one. */
  readonly canvas: RenderCanvas;
  /**
   * Replaces the mosaic. cells[i] (i = y * width + x) indexes `colors`; `base` shows between the
   * tiles. The cells are copied. Throws RangeError for more than MAX_COLORS colours or a short
   * `cells` array.
   */
  setMosaic(cells: Uint8Array, width: number, height: number, colors: readonly Rgb[], base: Rgb): void;
  /** Changes one stud to local colour index `localIndex` (for editing); call render() afterwards. */
  setCell(index: number, localIndex: number): void;
  /** Scale in CSS px per stud; origin in CSS px. */
  setView(view: View): void;
  /** Page colour outside the mosaic. */
  setBackground(rgb: Rgb): void;
  /** Thin lines every 16 studs marking the build panels. */
  setPanelGrid(show: boolean): void;
  /** CSS size of the canvas and the devicePixelRatio (the renderer caps it at MAX_DPR). */
  resize(cssW: number, cssH: number, dpr: number): void;
  /** Device pixels per CSS pixel actually used for the backing store. */
  pixelRatio(): number;
  render(): void;
  /** True while a WebGL context is lost (always false for Canvas2D). Drawing calls are no-ops then. */
  isLost(): boolean;
  /** Frees GPU resources and releases the WebGL context. The renderer is unusable afterwards. */
  destroy(): void;
}

export interface RendererEvents {
  /** The WebGL context was lost; the renderer keeps its state and waits for a restore. */
  onContextLost?: () => void;
  /** The context came back and was rebuilt; the caller should schedule a redraw. */
  onContextRestored?: () => void;
}

/** Common validation for setMosaic. Returns the number of cells. */
export function checkMosaic(cells: Uint8Array, width: number, height: number, colors: readonly Rgb[]): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`invalid grid size ${width}x${height}`);
  }
  const n = width * height;
  if (cells.length < n) throw new RangeError(`cells has ${cells.length} entries, grid needs ${n}`);
  if (colors.length > MAX_COLORS) throw new RangeError(`${colors.length} colours, at most ${MAX_COLORS} are supported`);
  return n;
}

/** Backing-store size for a CSS size: dpr capped, and both sides within `maxSide` device px. */
export function backingSize(cssW: number, cssH: number, dpr: number, maxDpr: number, maxSide: number): { w: number; h: number; ratio: number } {
  const w0 = Math.max(1, cssW);
  const h0 = Math.max(1, cssH);
  const ratio = Math.max(Number.MIN_VALUE, Math.min(dpr > 0 ? dpr : 1, maxDpr, maxSide / w0, maxSide / h0));
  return { w: Math.max(1, Math.round(w0 * ratio)), h: Math.max(1, Math.round(h0 * ratio)), ratio };
}
