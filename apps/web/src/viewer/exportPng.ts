// Full-resolution PNG of a mosaic with the viewer's stud look. Rendered offscreen and encoded from
// the same drawing buffer, never read back from the on-screen canvas (round2-webkit-check.md, must-do 6).

import type { MosaicResult, Rgb } from '@photobrick/engine';
import { Canvas2DRenderer, makeCanvas } from './canvas2d.ts';
import { forcedRenderer } from './createRenderer.ts';
import type { RenderCanvas, StudRenderer } from './studRenderer.ts';
import { WebGL2Renderer } from './webgl2.ts';

/** iOS 16/17 refuse canvases larger than 4096 x 4096 px worth of area. */
export const MAX_EXPORT_PIXELS = 16_777_216;
/** Per-side cap, inside every current browser's canvas limit. */
export const MAX_EXPORT_SIDE = 8192;

/** The whole-number px per stud actually used: the request, reduced until the image fits the caps. */
export function exportPxPerStud(width: number, height: number, pxPerStud: number, maxSide = MAX_EXPORT_SIDE): number {
  const byArea = Math.floor(Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, width * height)));
  const bySide = Math.floor(maxSide / Math.max(1, width, height));
  return Math.max(1, Math.min(Math.floor(pxPerStud), byArea, bySide));
}

/**
 * Renders the mosaic at `pxPerStud` (reduced to fit MAX_EXPORT_PIXELS and the GPU's limits; the
 * image is width * px by height * px) and returns a PNG. Uses WebGL2 when available (and not
 * forced off with ?renderer=canvas2d), else flat Canvas2D discs. The GPU context is released before
 * the promise settles.
 */
export async function renderMosaicPng(result: MosaicResult, colors: readonly Rgb[], base: Rgb, pxPerStud: number): Promise<Blob> {
  const { width, height } = result;
  if (width <= 0 || height <= 0) throw new RangeError('the mosaic is empty');
  if (!(pxPerStud >= 1)) throw new RangeError(`pxPerStud must be at least 1, got ${pxPerStud}`);
  const renderer = createExportRenderer();
  try {
    const maxSide = renderer instanceof WebGL2Renderer ? Math.min(MAX_EXPORT_SIDE, renderer.maxCanvasSide()) : MAX_EXPORT_SIDE;
    const px = exportPxPerStud(width, height, pxPerStud, maxSide);
    // At dpr 1, CSS px are device px: the canvas is exactly the image.
    renderer.resize(width * px, height * px, 1);
    renderer.setMosaic(result.cells, width, height, colors, base);
    renderer.setView({ scale: px, ox: 0, oy: 0 });
    renderer.render();
    return await encodePng(renderer.canvas);
  } finally {
    renderer.destroy();
  }
}

function createExportRenderer(): StudRenderer {
  if (forcedRenderer() === 'canvas2d') return new Canvas2DRenderer(makeCanvas(1, 1), { maxDpr: 1 });
  // preserveDrawingBuffer: the encoder may read the buffer after this task has ended.
  const glOptions = { preserveDrawingBuffer: true, maxDpr: 1 };
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new WebGL2Renderer(new OffscreenCanvas(1, 1), {}, glOptions);
    } catch {
      // Safari < 17 has no WebGL on OffscreenCanvas; try a detached <canvas> next.
    }
  }
  if (typeof document !== 'undefined') {
    try {
      return new WebGL2Renderer(document.createElement('canvas'), {}, glOptions);
    } catch {
      // No WebGL2 at all: flat discs below.
    }
  }
  return new Canvas2DRenderer(makeCanvas(1, 1), { maxDpr: 1 });
}

function encodePng(canvas: RenderCanvas): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}
