// Imperative core of <MosaicViewer>: owns the canvases, the renderer, the view and the gestures, so
// panning and zooming never go through React. The component only forwards props to update().

import type { MosaicResult, Rgb } from '@photobrick/engine';
import { Canvas2DRenderer } from './canvas2d.ts';
import { createRenderer } from './createRenderer.ts';
import { DEFAULT_BACKGROUND, MAX_DPR } from './studLook.ts';
import type { RendererKind, StudRenderer } from './studRenderer.ts';
import { clampView, fitView, sameView, zoomAt, zoomLimits, type View } from './viewMath.ts';

export interface CompareSpec {
  /** The original (EXIF-oriented) photo. */
  image: ImageBitmap | HTMLImageElement | null;
  /** The crop window, in the image's own pixel coordinates. It is drawn exactly over the mosaic. */
  rect: { x: number; y: number; w: number; h: number };
  active: boolean;
  /**
   * 0..1: show the photo only left of this fraction of the visible part of the mosaic (a before/after
   * slider). Omit to cover the whole mosaic.
   */
  split?: number;
}

export interface MosaicViewerProps {
  result: MosaicResult | null;
  /** colors[i] is the sRGB colour of local index i (result.colorIds[i]). */
  colors: readonly Rgb[];
  /** Base plate colour, visible between the round tiles. */
  base: Rgb;
  /** Page colour around the mosaic. Default DEFAULT_BACKGROUND. */
  background?: Rgb;
  compare?: CompareSpec;
  showPanelGrid?: boolean;
  /** 'crop': dragging, wheel and pinch report crop changes instead of moving the view. Default 'view'. */
  interaction?: 'view' | 'crop';
  /** Free space around the fitted mosaic, CSS px. Default 8. */
  fitPadding?: number;
  /**
   * Crop mode: pointer movement since the last call, in studs of the current grid (positive = right /
   * down), coalesced to at most one call per frame. For "the photo follows the finger", move the crop
   * window by -dx, -dy studs.
   */
  onCropDrag?: (dxStuds: number, dyStuds: number) => void;
  /** Crop mode: multiply the crop zoom by `factor` (> 1 = zoom in, the photo gets bigger). */
  onCropZoom?: (factor: number) => void;
  /** Called on the first frame and whenever the renderer changes; `reason` explains a fallback. */
  onRendererChange?: (kind: RendererKind, reason: string | null) => void;
  /** Called after a frame whose view differs from the previous one. */
  onViewChange?: (view: View) => void;
}

export interface MosaicViewerHandle {
  /** Fit the whole mosaic into the viewer. */
  fit(): void;
  getView(): View;
  /** Zoom by `factor` around (cx, cy) CSS px in the viewer, default the centre. */
  zoomBy(factor: number, cx?: number, cy?: number): void;
  /** Draw now instead of on the next animation frame (e.g. right before reading pixels). */
  redraw(): void;
  getRendererKind(): RendererKind | null;
  /** The canvas currently drawn on (it changes when the viewer falls back to Canvas2D). */
  getCanvas(): HTMLCanvasElement | null;
}

interface Pointer {
  x: number;
  y: number;
  x0: number;
  y0: number;
  t0: number;
  moved: boolean;
}

/** How long a lost context may take to come back after the page is visible before we switch to Canvas2D. */
export const CONTEXT_RESTORE_GRACE_MS = 1000;
const DEFAULT_PADDING = 8;
const TAP_SLOP = 8;
const TAP_MAX_MS = 350;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DIST = 32;
const WHEEL_ZOOM_PER_PX = 0.0015;
/** Trackpad pinch arrives as ctrl+wheel with small deltas. */
const PINCH_WHEEL_ZOOM_PER_PX = 0.01;
const KEY_ZOOM = 1.25;
const KEY_PAN = 0.1;
const EMPTY_CELLS = new Uint8Array(0);
const CANVAS_CSS = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;';

const EMPTY_PROPS: MosaicViewerProps = { result: null, colors: [], base: [0, 0, 0] };

export class ViewerController {
  private readonly host: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D | null;
  private props: MosaicViewerProps = EMPTY_PROPS;
  private renderer: StudRenderer | null = null;
  private fallbackReason: string | null = null;
  private reportedKind: RendererKind | null = null;
  private view: View = { scale: 1, ox: 0, oy: 0 };
  private notifiedView: View | null = null;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  /** The view follows fit() until the user zooms or pans. */
  private fitted = true;
  /** Grid size the current view was made for; a result of another size refits. */
  private viewW = -1;
  private viewH = -1;
  private raf = 0;
  private lossTimer: ReturnType<typeof setTimeout> | undefined;
  private overlayShown = false;
  private readonly pointers = new Map<number, Pointer>();
  private hostX = 0;
  private hostY = 0;
  private multiTouch = false;
  private pinchDist = 0;
  private pinchX = 0;
  private pinchY = 0;
  private lastTapT = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;
  private gestureScale = 1;
  private cropDx = 0;
  private cropDy = 0;
  private cropZoom = 1;
  private readonly resizeObserver: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private destroyed = false;

  constructor(host: HTMLElement, stage: HTMLElement, overlay: HTMLCanvasElement) {
    this.host = host;
    this.stage = stage;
    this.overlay = overlay;
    this.overlayCtx = overlay.getContext('2d');
    const rect = stage.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.dpr = window.devicePixelRatio || 1;
    this.installRenderer(false, null);
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(stage);
    host.addEventListener('pointerdown', this.onPointerDown);
    host.addEventListener('pointermove', this.onPointerMove);
    host.addEventListener('pointerup', this.onPointerUp);
    host.addEventListener('pointercancel', this.onPointerUp);
    host.addEventListener('lostpointercapture', this.onPointerUp);
    host.addEventListener('wheel', this.onWheel, { passive: false });
    host.addEventListener('keydown', this.onKeyDown);
    // Desktop Safari reports trackpad pinches only as gesture events.
    host.addEventListener('gesturestart', this.onGestureStart);
    host.addEventListener('gesturechange', this.onGestureChange);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.watchDpr();
    this.updateCursor();
  }

  update(next: MosaicViewerProps): void {
    const prev = this.props;
    this.props = next;
    const r = this.renderer;
    let dirty = false;
    if (next.result !== prev.result || !sameColors(next.colors, prev.colors) || !sameRgb(next.base, prev.base)) {
      this.applyMosaic();
      dirty = true;
    }
    const res = next.result;
    if (res && (res.width !== this.viewW || res.height !== this.viewH)) {
      this.fitNow();
      dirty = true;
    }
    const bg = next.background ?? DEFAULT_BACKGROUND;
    if (!sameRgb(bg, prev.background ?? DEFAULT_BACKGROUND)) {
      r?.setBackground(bg);
      dirty = true;
    }
    if (!!next.showPanelGrid !== !!prev.showPanelGrid) {
      r?.setPanelGrid(!!next.showPanelGrid);
      dirty = true;
    }
    if ((next.interaction ?? 'view') !== (prev.interaction ?? 'view')) {
      this.resetGesture();
      // The whole crop window should be visible while it is being moved.
      if (next.interaction === 'crop') this.fitNow();
      this.updateCursor();
      dirty = true;
    }
    if (next.fitPadding !== prev.fitPadding && this.fitted) {
      this.fitNow();
      dirty = true;
    }
    if (!sameCompare(next.compare, prev.compare)) dirty = true;
    if (dirty) this.requestDraw();
  }

  fit(): void {
    this.fitNow();
    this.requestDraw();
  }

  getView(): View {
    return { ...this.view };
  }

  zoomBy(factor: number, cx = this.cssW / 2, cy = this.cssH / 2): void {
    this.zoomAround(factor, cx, cy);
  }

  redraw(): void {
    this.drawNow();
  }

  rendererKind(): RendererKind | null {
    return this.renderer?.kind ?? null;
  }

  canvas(): HTMLCanvasElement | null {
    return (this.renderer?.canvas as HTMLCanvasElement | undefined) ?? null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.lossTimer);
    this.resizeObserver.disconnect();
    const host = this.host;
    host.removeEventListener('pointerdown', this.onPointerDown);
    host.removeEventListener('pointermove', this.onPointerMove);
    host.removeEventListener('pointerup', this.onPointerUp);
    host.removeEventListener('pointercancel', this.onPointerUp);
    host.removeEventListener('lostpointercapture', this.onPointerUp);
    host.removeEventListener('wheel', this.onWheel);
    host.removeEventListener('keydown', this.onKeyDown);
    host.removeEventListener('gesturestart', this.onGestureStart);
    host.removeEventListener('gesturechange', this.onGestureChange);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    const r = this.renderer;
    this.renderer = null;
    if (r) {
      r.destroy();
      (r.canvas as HTMLCanvasElement).remove();
    }
    this.overlay.width = 1;
    this.overlay.height = 1;
  }

  // ------------------------------------------------------------------------------------------------
  // Renderer

  private installRenderer(forceCanvas2d: boolean, reason: string | null): void {
    const old = this.renderer;
    this.renderer = null;
    if (old) {
      old.destroy();
      (old.canvas as HTMLCanvasElement).remove();
    }
    const canvas = document.createElement('canvas');
    canvas.style.cssText = CANVAS_CSS;
    canvas.setAttribute('aria-hidden', 'true');
    this.stage.append(canvas);
    let fallback = reason;
    let r: StudRenderer;
    try {
      r = forceCanvas2d
        ? new Canvas2DRenderer(canvas)
        : createRenderer(canvas, (why) => (fallback = why), {
            onContextLost: this.onContextLost,
            onContextRestored: this.onContextRestored,
          });
    } catch (err) {
      canvas.remove();
      console.error('[viewer] no renderer available', err);
      return;
    }
    this.renderer = r;
    this.fallbackReason = fallback;
    this.reportedKind = null;
    r.resize(this.cssW, this.cssH, this.dpr);
    r.setBackground(this.props.background ?? DEFAULT_BACKGROUND);
    r.setPanelGrid(!!this.props.showPanelGrid);
    this.applyMosaic();
    this.requestDraw();
  }

  private applyMosaic(): void {
    const r = this.renderer;
    if (!r) return;
    const { result, colors, base } = this.props;
    if (result) r.setMosaic(result.cells, result.width, result.height, colors, base);
    else r.setMosaic(EMPTY_CELLS, 0, 0, [], base);
  }

  private readonly onContextLost = (): void => {
    this.armLossTimer();
  };

  private readonly onContextRestored = (): void => {
    clearTimeout(this.lossTimer);
    this.lossTimer = undefined;
    this.requestDraw();
  };

  private armLossTimer(): void {
    clearTimeout(this.lossTimer);
    this.lossTimer = undefined;
    // A hidden page (e.g. iOS in the background) gets its grace period once it is visible again.
    if (document.visibilityState !== 'visible') return;
    this.lossTimer = setTimeout(() => {
      this.lossTimer = undefined;
      if (!this.destroyed && this.renderer?.isLost()) this.installRenderer(true, 'the WebGL context was lost and not restored');
    }, CONTEXT_RESTORE_GRACE_MS);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      if (this.renderer?.isLost()) this.armLossTimer();
      else this.requestDraw();
    } else {
      clearTimeout(this.lossTimer);
      this.lossTimer = undefined;
    }
  };

  // ------------------------------------------------------------------------------------------------
  // Size and view

  private readonly onResize = (entries: ResizeObserverEntry[]): void => {
    const box = entries[entries.length - 1].contentRect;
    // Draw right away: resizing clears the canvas, and waiting for the next frame would flash.
    if (this.setSize(box.width, box.height)) this.drawNow();
  };

  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    this.dprQuery?.addEventListener('change', this.onDprChange);
  }

  private readonly onDprChange = (): void => {
    this.watchDpr();
    if (this.setSize(this.cssW, this.cssH)) this.drawNow();
  };

  private setSize(w: number, h: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return false;
    const oldW = this.cssW;
    const oldH = this.cssH;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.renderer?.resize(w, h, dpr);
    if (this.fitted || oldW <= 0 || oldH <= 0) {
      this.fitNow();
    } else {
      // Keep what was in the middle in the middle.
      this.view = this.constrain({ scale: this.view.scale, ox: this.view.ox + (w - oldW) / 2, oy: this.view.oy + (h - oldH) / 2 });
    }
    return true;
  }

  private padding(): number {
    return this.props.fitPadding ?? DEFAULT_PADDING;
  }

  /** Device px per CSS px of the mosaic canvas. */
  private pixelRatio(): number {
    return this.renderer?.pixelRatio() ?? Math.min(this.dpr, MAX_DPR);
  }

  private fitNow(): void {
    this.fitted = true;
    const res = this.props.result;
    if (!res || this.cssW <= 0 || this.cssH <= 0) return;
    this.view = fitView(res.width, res.height, this.cssW, this.cssH, this.padding(), this.pixelRatio());
    this.viewW = res.width;
    this.viewH = res.height;
  }

  private constrain(v: View): View {
    const res = this.props.result;
    if (!res) return v;
    return clampView(v, res.width, res.height, this.cssW, this.cssH, this.padding());
  }

  private zoomAround(factor: number, cx: number, cy: number): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    if (this.props.interaction === 'crop') {
      this.cropZoom *= factor;
      this.requestDraw();
      return;
    }
    const res = this.props.result;
    if (!res || this.cssW <= 0 || this.cssH <= 0) return;
    const limits = zoomLimits(res.width, res.height, this.cssW, this.cssH, this.padding(), this.pixelRatio());
    const next = zoomAt(this.view, factor, cx, cy, limits);
    // Zoomed all the way out is the fitted view (centred, and it follows resizes again).
    if (next.scale <= limits.min * (1 + 1e-9)) this.fitNow();
    else {
      this.view = this.constrain(next);
      this.fitted = false;
    }
    this.requestDraw();
  }

  private panBy(dx: number, dy: number): void {
    if (this.props.interaction === 'crop') {
      if (this.view.scale > 0) {
        this.cropDx += dx / this.view.scale;
        this.cropDy += dy / this.view.scale;
      }
      this.requestDraw();
      return;
    }
    if (!this.props.result) return;
    this.view = this.constrain({ scale: this.view.scale, ox: this.view.ox + dx, oy: this.view.oy + dy });
    this.fitted = false;
    this.requestDraw();
  }

  // ------------------------------------------------------------------------------------------------
  // Drawing

  private requestDraw(): void {
    if (this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    this.raf = 0;
    this.drawNow();
  };

  private drawNow(): void {
    if (this.destroyed) return;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.flushCrop();
    const r = this.renderer;
    if (r) {
      r.setView(this.view);
      r.render();
      if (this.reportedKind !== r.kind) {
        this.reportedKind = r.kind;
        this.props.onRendererChange?.(r.kind, this.fallbackReason);
      }
    }
    this.drawOverlay();
    if (!this.notifiedView || !sameView(this.notifiedView, this.view)) {
      this.notifiedView = this.view;
      this.props.onViewChange?.({ ...this.view });
    }
  }

  private flushCrop(): void {
    if (this.cropDx !== 0 || this.cropDy !== 0) {
      const dx = this.cropDx;
      const dy = this.cropDy;
      this.cropDx = 0;
      this.cropDy = 0;
      this.props.onCropDrag?.(dx, dy);
    }
    if (this.cropZoom !== 1) {
      const f = this.cropZoom;
      this.cropZoom = 1;
      this.props.onCropZoom?.(f);
    }
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const c = this.props.compare;
    const res = this.props.result;
    const img = c?.image;
    const show = !!c && c.active && !!img && imageReady(img) && !!res && res.width > 0 && res.height > 0 && c.rect.w > 0 && c.rect.h > 0 && this.cssW > 0 && this.cssH > 0;
    if (!show) {
      if (this.overlayShown) {
        // Shrinking clears it and frees the memory.
        this.overlay.width = 1;
        this.overlay.height = 1;
        this.overlayShown = false;
      }
      return;
    }
    this.overlayShown = true;
    // Same backing-store ratio as the mosaic canvas, so the photo lands on the same device pixels.
    const ratio = this.pixelRatio();
    const W = Math.max(1, Math.round(this.cssW * ratio));
    const H = Math.max(1, Math.round(this.cssH * ratio));
    if (this.overlay.width !== W) this.overlay.width = W;
    if (this.overlay.height !== H) this.overlay.height = H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const v = this.view;
    const mw = res.width * v.scale;
    const mh = res.height * v.scale;
    const x0 = Math.max(0, v.ox);
    const x1 = Math.min(this.cssW, v.ox + mw);
    const y0 = Math.max(0, v.oy);
    const y1 = Math.min(this.cssH, v.oy + mh);
    if (x1 <= x0 || y1 <= y0) return;
    const split = c.split === undefined ? 1 : Math.min(1, Math.max(0, c.split));
    const xs = x0 + split * (x1 - x0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (xs > x0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, xs - x0, y1 - y0);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try {
        ctx.drawImage(img, c.rect.x, c.rect.y, c.rect.w, c.rect.h, v.ox, v.oy, mw, mh);
      } catch {
        // A closed ImageBitmap throws; showing just the mosaic is the right outcome.
      }
      ctx.restore();
    }
    if (c.split !== undefined && split > 0 && split < 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(xs - 1.5, y0, 3, y1 - y0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(xs - 0.75, y0, 1.5, y1 - y0);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Input

  private updateCursor(): void {
    const crop = this.props.interaction === 'crop';
    // On the stage, not the host: React owns the host's style prop.
    this.stage.style.cursor = crop ? 'move' : this.pointers.size > 0 ? 'grabbing' : 'grab';
  }

  private resetGesture(): void {
    this.pointers.clear();
    this.multiTouch = false;
    this.cropDx = 0;
    this.cropDy = 0;
    this.cropZoom = 1;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Two fingers make a pinch; a third is ignored.
    if (this.pointers.size >= 2) return;
    const rect = this.host.getBoundingClientRect();
    this.hostX = rect.left;
    this.hostY = rect.top;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.pointers.set(e.pointerId, { x, y, x0: x, y0: y, t0: e.timeStamp, moved: false });
    try {
      this.host.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone (synthetic events); capture is only a convenience.
    }
    if (this.pointers.size === 2) {
      this.multiTouch = true;
      this.startPinch();
    }
    this.updateCursor();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const x = e.clientX - this.hostX;
    const y = e.clientY - this.hostY;
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx === 0 && dy === 0) return;
    p.x = x;
    p.y = y;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > TAP_SLOP) p.moved = true;
    if (this.pointers.size === 1) this.panBy(dx, dy);
    else this.pinchMove();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    const wasMulti = this.multiTouch;
    this.multiTouch = false;
    if (e.type === 'pointerup' && !wasMulti && !p.moved && e.timeStamp - p.t0 < TAP_MAX_MS) this.tap(p.x, p.y, e.timeStamp);
    this.updateCursor();
  };

  private tap(x: number, y: number, t: number): void {
    if (t - this.lastTapT < DOUBLE_TAP_MS && Math.hypot(x - this.lastTapX, y - this.lastTapY) < DOUBLE_TAP_DIST) {
      this.lastTapT = -Infinity;
      this.fit();
      return;
    }
    this.lastTapT = t;
    this.lastTapX = x;
    this.lastTapY = y;
  }

  private firstTwo(): [Pointer, Pointer] | null {
    const it = this.pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? [a, b] : null;
  }

  private startPinch(): void {
    const two = this.firstTwo();
    if (!two) return;
    const [a, b] = two;
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchX = (a.x + b.x) / 2;
    this.pinchY = (a.y + b.y) / 2;
  }

  private pinchMove(): void {
    const two = this.firstTwo();
    if (!two) return;
    const [a, b] = two;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const factor = this.pinchDist > 0 && dist > 0 ? dist / this.pinchDist : 1;
    const dx = mx - this.pinchX;
    const dy = my - this.pinchY;
    this.pinchDist = dist;
    this.pinchX = mx;
    this.pinchY = my;
    // Zoom around the midpoint, then follow the midpoint (two-finger pan).
    this.zoomAround(factor, mx - dx, my - dy);
    this.panBy(dx, dy);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.host.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.cssH || 800 : 1;
    const k = e.ctrlKey ? PINCH_WHEEL_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX;
    const step = Math.min(0.7, Math.max(-0.7, e.deltaY * unit * k));
    this.zoomAround(Math.exp(-step), e.clientX - rect.left, e.clientY - rect.top);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const w = this.cssW;
    const h = this.cssH;
    switch (e.key) {
      case '+':
      case '=':
        this.zoomAround(KEY_ZOOM, w / 2, h / 2);
        break;
      case '-':
      case '_':
        this.zoomAround(1 / KEY_ZOOM, w / 2, h / 2);
        break;
      case '0':
        this.fit();
        break;
      // Arrows look in their direction, like dragging the content the other way.
      case 'ArrowLeft':
        this.panBy(w * KEY_PAN, 0);
        break;
      case 'ArrowRight':
        this.panBy(-w * KEY_PAN, 0);
        break;
      case 'ArrowUp':
        this.panBy(0, h * KEY_PAN);
        break;
      case 'ArrowDown':
        this.panBy(0, -h * KEY_PAN);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  private readonly onGestureStart = (e: Event): void => {
    e.preventDefault();
    this.gestureScale = 1;
  };

  private readonly onGestureChange = (e: Event): void => {
    e.preventDefault();
    // On iOS the same pinch also arrives as touch pointers, which already drive it.
    if (this.pointers.size > 0) return;
    const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
    if (!g.scale) return;
    const rect = this.host.getBoundingClientRect();
    const factor = g.scale / this.gestureScale;
    this.gestureScale = g.scale;
    this.zoomAround(factor, (g.clientX ?? rect.left + this.cssW / 2) - rect.left, (g.clientY ?? rect.top + this.cssH / 2) - rect.top);
  };
}

function imageReady(img: ImageBitmap | HTMLImageElement): boolean {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return img.complete && img.naturalWidth > 0;
  return img.width > 0;
}

function sameRgb(a: Rgb, b: Rgb): boolean {
  return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

function sameColors(a: readonly Rgb[], b: readonly Rgb[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameRgb(a[i], b[i])) return false;
  return true;
}

function sameCompare(a: CompareSpec | undefined, b: CompareSpec | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.image === b.image && a.active === b.active && a.split === b.split &&
    a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.w === b.rect.w && a.rect.h === b.rect.h
  );
}
