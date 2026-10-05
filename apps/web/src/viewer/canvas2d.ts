// Canvas2D fallback: flat discs on the base colour, used when WebGL2 is missing or its context stays
// lost. The gaps get the mean shade of the WebGL look (flatGapColor), which also keeps tiles in the
// base colour visible. One arc() + fill() per visible stud: in WebKit that beats batching arcs by colour 2-3x
// (round2-webkit-check.md §5). Small studs switch to a one-pixel-per-stud image of average colours,
// the same level of detail as the shader.

import type { Rgb } from '@photobrick/engine';
import {
  DEFAULT_BACKGROUND,
  MAX_DPR,
  PANEL_GRID,
  STUD_LOOK,
  averageStudColor,
  flatGapColor,
  lodFactor,
  panelLinePx,
  rgbToCss,
} from './studLook.ts';
import { backingSize, checkMosaic, type RenderCanvas, type StudRenderer } from './studRenderer.ts';
import type { View } from './viewMath.ts';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const EMPTY = new Uint8Array(0);
const BLACK: Rgb = [0, 0, 0];
const TAU = Math.PI * 2;
/** Level of detail above which the flat fallback draws only the average-colour image. */
const DISC_SKIP_LOD = 0.9;
/** Canvas2D has no hard size limit, but browsers refuse canvases past ~16k px a side. */
const MAX_SIDE = 16384;

export interface Canvas2DOptions {
  /** Upper bound for the device pixel ratio. Default MAX_DPR. */
  maxDpr?: number;
}

export function makeCanvas(width: number, height: number): RenderCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export class Canvas2DRenderer implements StudRenderer {
  readonly kind = 'canvas2d' as const;
  readonly canvas: RenderCanvas;
  private readonly ctx: Ctx2D;
  private readonly maxDpr: number;
  private cells: Uint8Array = EMPTY;
  private gw = 0;
  private gh = 0;
  /** CSS colour per local index; unused indices draw black. */
  private readonly fills: string[] = new Array<string>(256).fill('#000000');
  /** Level-of-detail colour per local index, 8-bit sRGB triples. */
  private readonly avgLut = new Uint8Array(256 * 3);
  private baseCss = '#000000';
  private bgCss = rgbToCss(DEFAULT_BACKGROUND);
  private panelGrid = false;
  private view: View = { scale: 1, ox: 0, oy: 0 };
  private ratio = 1;
  // One pixel per stud, drawn scaled up when studs are tiny. Built on first use.
  private avg: RenderCanvas | null = null;
  private avgCtx: Ctx2D | null = null;
  private avgPixels: ImageData | null = null;
  private avgDirty = true;

  constructor(canvas: RenderCanvas, options: Canvas2DOptions = {}) {
    const ctx = (canvas as HTMLCanvasElement).getContext('2d', { alpha: false }) as Ctx2D | null;
    if (!ctx) throw new Error('Canvas2D is not available');
    this.canvas = canvas;
    this.ctx = ctx;
    this.maxDpr = options.maxDpr ?? MAX_DPR;
  }

  setMosaic(cells: Uint8Array, width: number, height: number, colors: readonly Rgb[], base: Rgb): void {
    const n = checkMosaic(cells, width, height, colors);
    this.cells = cells.slice(0, n);
    this.gw = width;
    this.gh = height;
    this.baseCss = rgbToCss(flatGapColor(base));
    for (let k = 0; k < 256; k++) {
      const c = k < colors.length ? colors[k] : BLACK;
      this.fills[k] = rgbToCss(c);
      averageStudColor(c, base, this.avgLut, k * 3);
    }
    this.avgDirty = true;
  }

  setCell(index: number, localIndex: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cells.length) throw new RangeError(`cell ${index} is outside the grid`);
    if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex > 255) throw new RangeError(`invalid colour index ${localIndex}`);
    this.cells[index] = localIndex;
    const px = this.avgPixels;
    if (this.avgDirty || !px || !this.avgCtx) return;
    const o = index * 4;
    const l = localIndex * 3;
    px.data[o] = this.avgLut[l];
    px.data[o + 1] = this.avgLut[l + 1];
    px.data[o + 2] = this.avgLut[l + 2];
    this.avgCtx.putImageData(px, 0, 0, index % this.gw, Math.floor(index / this.gw), 1, 1);
  }

  setView(view: View): void {
    this.view = view;
  }

  setBackground(rgb: Rgb): void {
    this.bgCss = rgbToCss(rgb);
  }

  setPanelGrid(show: boolean): void {
    this.panelGrid = show;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const { w, h, ratio } = backingSize(cssW, cssH, dpr, this.maxDpr, MAX_SIDE);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ratio = ratio;
  }

  pixelRatio(): number {
    return this.ratio;
  }

  render(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.bgCss;
    ctx.fillRect(0, 0, W, H);
    const gw = this.gw;
    const gh = this.gh;
    const r = this.ratio;
    const s = this.view.scale * r;
    const ox = this.view.ox * r;
    const oy = this.view.oy * r;
    if (gw === 0 || gh === 0 || !(s > 0) || !Number.isFinite(ox) || !Number.isFinite(oy)) return;
    // Visible cells only.
    const x0 = Math.max(0, Math.floor(-ox / s));
    const y0 = Math.max(0, Math.floor(-oy / s));
    const x1 = Math.min(gw, Math.ceil((W - ox) / s));
    const y1 = Math.min(gh, Math.ceil((H - oy) / s));
    if (x0 >= x1 || y0 >= y1) return;

    ctx.fillStyle = this.baseCss;
    ctx.fillRect(ox, oy, gw * s, gh * s);
    const lod = lodFactor(s);
    // Past DISC_SKIP_LOD the discs barely show but still cost one arc each (~50 ms for 49k studs).
    const discs = lod < DISC_SKIP_LOD;
    if (discs) this.drawDiscs(ctx, s, ox, oy, x0, y0, x1, y1);
    if (lod > 0) {
      const avg = this.averageImage();
      ctx.globalAlpha = discs ? lod : 1;
      // Nearest-neighbour like the shader; smoothing only when several studs share a pixel.
      ctx.imageSmoothingEnabled = s < 1;
      ctx.drawImage(avg, x0, y0, x1 - x0, y1 - y0, ox + x0 * s, oy + y0 * s, (x1 - x0) * s, (y1 - y0) * s);
      ctx.globalAlpha = 1;
    }
    if (this.panelGrid) this.drawPanelGrid(ctx, s, ox, oy, W, H);
  }

  isLost(): boolean {
    return false;
  }

  destroy(): void {
    this.cells = EMPTY;
    if (this.avg) {
      this.avg.width = 0;
      this.avg.height = 0;
    }
    this.avg = null;
    this.avgCtx = null;
    this.avgPixels = null;
    // Frees the backing store now instead of at garbage collection (Safari counts canvas memory).
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private drawDiscs(ctx: Ctx2D, s: number, ox: number, oy: number, x0: number, y0: number, x1: number, y1: number): void {
    const cells = this.cells;
    const fills = this.fills;
    const gw = this.gw;
    const R = s * STUD_LOOK.radius;
    let last = -1;
    for (let y = y0; y < y1; y++) {
      const cy = oy + (y + 0.5) * s;
      const row = y * gw;
      for (let x = x0; x < x1; x++) {
        const k = cells[row + x];
        if (k !== last) {
          ctx.fillStyle = fills[k];
          last = k;
        }
        ctx.beginPath();
        ctx.arc(ox + (x + 0.5) * s, cy, R, 0, TAU);
        ctx.fill();
      }
    }
  }

  private drawPanelGrid(ctx: Ctx2D, s: number, ox: number, oy: number, W: number, H: number): void {
    const step = PANEL_GRID.every * s;
    const left = Math.max(0, ox);
    const right = Math.min(W, ox + this.gw * s);
    const top = Math.max(0, oy);
    const bottom = Math.min(H, oy + this.gh * s);
    const px = panelLinePx(this.ratio);
    const core = px.core;
    const halo = core + 2 * px.halo;
    // One path per pass: overlapping rectangles at crossings fill once (nonzero union), as in the shader.
    for (const [width, style] of [
      [halo, `rgba(0,0,0,${PANEL_GRID.haloOpacity})`],
      [core, `rgba(${PANEL_GRID.color.join(',')},${PANEL_GRID.opacity})`],
    ] as const) {
      ctx.beginPath();
      for (let k = 1; k * PANEL_GRID.every < this.gw; k++) {
        const x = Math.round(ox + k * step - width / 2);
        if (x + width < 0 || x > W) continue;
        ctx.rect(x, top, width, bottom - top);
      }
      for (let k = 1; k * PANEL_GRID.every < this.gh; k++) {
        const y = Math.round(oy + k * step - width / 2);
        if (y + width < 0 || y > H) continue;
        ctx.rect(left, y, right - left, width);
      }
      ctx.fillStyle = style;
      ctx.fill();
    }
  }

  private averageImage(): RenderCanvas {
    if (this.avg && this.avgPixels && this.avgCtx && !this.avgDirty) return this.avg;
    const gw = this.gw;
    const gh = this.gh;
    if (!this.avg || !this.avgCtx || !this.avgPixels || this.avg.width !== gw || this.avg.height !== gh) {
      const c = makeCanvas(gw, gh);
      const cctx = (c as HTMLCanvasElement).getContext('2d') as Ctx2D | null;
      if (!cctx) throw new Error('Canvas2D is not available');
      this.avg = c;
      this.avgCtx = cctx;
      this.avgPixels = cctx.createImageData(gw, gh);
    }
    const d = this.avgPixels.data;
    const lut = this.avgLut;
    const cells = this.cells;
    for (let i = 0, n = gw * gh; i < n; i++) {
      const l = cells[i] * 3;
      const o = i * 4;
      d[o] = lut[l];
      d[o + 1] = lut[l + 1];
      d[o + 2] = lut[l + 2];
      d[o + 3] = 255;
    }
    this.avgCtx.putImageData(this.avgPixels, 0, 0);
    this.avgDirty = false;
    return this.avg;
  }
}
