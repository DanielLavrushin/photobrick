import { Canvas2DRenderer } from './canvas2d.ts';
import type { RendererEvents, StudRenderer } from './studRenderer.ts';
import { WebGL2InitError, WebGL2Renderer } from './webgl2.ts';

/** `?renderer=canvas2d` in the page URL forces the fallback (for testing). */
export function forcedRenderer(): 'canvas2d' | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get('renderer') === 'canvas2d' ? 'canvas2d' : null;
}

/**
 * WebGL2 when available, else Canvas2D. `onFallback` receives the reason whenever the result is not
 * WebGL2. A canvas keeps the first context type it was given, so if WebGL2 failed after creating its
 * context, the Canvas2D renderer draws on a fresh clone that replaces `canvas` in the DOM: use the
 * returned renderer's `canvas`.
 */
export function createRenderer(canvas: HTMLCanvasElement, onFallback?: (reason: string) => void, events?: RendererEvents): StudRenderer {
  if (forcedRenderer() === 'canvas2d') {
    onFallback?.('forced by ?renderer=canvas2d');
    return new Canvas2DRenderer(canvas);
  }
  try {
    return new WebGL2Renderer(canvas, events);
  } catch (err) {
    onFallback?.((err as Error).message);
    let target = canvas;
    if (!(err instanceof WebGL2InitError) || err.contextCreated) {
      target = canvas.cloneNode(false) as HTMLCanvasElement;
      canvas.replaceWith(target);
    }
    return new Canvas2DRenderer(target);
  }
}
