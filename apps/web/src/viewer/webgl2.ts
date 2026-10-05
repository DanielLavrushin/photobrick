// WebGL2 stud renderer: one fullscreen triangle, one draw call. The grid is an R8UI texture of local
// colour indices and the colours a 256x1 RGBA8 texture, so the cost depends on screen pixels, not on
// the number of studs (docs/research/round1-bench-render.md).

import type { Rgb } from '@photobrick/engine';
import {
  DEFAULT_BACKGROUND,
  DISC_AREA,
  GAP_SHADE,
  MAX_DPR,
  PANEL_GRID,
  STUD_LOOK,
  detailFactor,
  lodFactor,
  panelLinePx,
} from './studLook.ts';
import { backingSize, checkMosaic, type RenderCanvas, type RendererEvents, type StudRenderer } from './studRenderer.ts';
import type { View } from './viewMath.ts';

/** GLSL float literal. */
const f = (x: number): string => {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};

const L = STUD_LOOK;

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// highp everywhere: with mediump, fp16 GPUs turn far-away studs into squares (round2-webkit-check.md §4).
// The CPU also passes the origin relative to the first visible cell (uCell0) so position maths stays
// small even at the far corner of a 256-stud grid.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform highp usampler2D uGrid;
uniform highp sampler2D uPal;
uniform ivec2 uGridSize;
uniform ivec2 uCell0;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uCanvasH;
uniform vec3 uBase;
uniform vec3 uBg;
uniform float uDetail;
uniform float uLod;
uniform vec4 uPanel;
uniform float uPanelWidth;
uniform float uPanelHaloWidth;
uniform float uPanelHalo;
out vec4 outColor;

const float R = ${f(L.radius)};
const float BEVEL_IN = ${f(L.bevelInner)};
const float BEVEL_OUT = ${f(L.bevelOuter)};
const float BEVEL_K = ${f(L.bevelStrength)};
const vec2 LIGHT = vec2(${f(L.lightX)}, ${f(L.lightY)});
const vec2 HL_POS = vec2(${f(L.highlightX)}, ${f(L.highlightY)});
const float HL_SHARP = ${f(L.highlightSharpness)};
const float HL_K = ${f(L.highlightStrength)};
const vec2 SH_OFF = vec2(${f(L.shadowX)}, ${f(L.shadowY)});
const float SH_IN = ${f(L.shadowInner)};
const float SH_OUT = ${f(L.shadowOuter)};
const float SH_K = ${f(L.shadowStrength)};
const float DISC_AREA = ${f(DISC_AREA)};
const float GAP_SHADE = ${f(GAP_SHADE)};
const float PANEL = ${f(PANEL_GRID.every)};

vec3 toLin(vec3 c) {
  return mix(c * (1.0 / 12.92), pow((c + 0.055) * (1.0 / 1.055), vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// A stud's area-average colour (linear light), for the level of detail.
vec3 cellAverage(ivec2 c, vec3 gapLin) {
  c = clamp(c, ivec2(0), uGridSize - 1);
  uint i = texelFetch(uGrid, c, 0).r;
  return mix(gapLin, toLin(texelFetch(uPal, ivec2(int(i), 0), 0).rgb), DISC_AREA);
}

// Shadow that the tile in cell (cell + o) casts at f (f is relative to the centre of 'cell').
float occlusion(vec2 f, ivec2 cell, ivec2 o) {
  ivec2 c = cell + o;
  if (c.x < 0 || c.y < 0 || c.x >= uGridSize.x || c.y >= uGridSize.y) return 0.0;
  return 1.0 - smoothstep(R + SH_IN, R + SH_OUT, length(f - vec2(o) - SH_OFF));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 pl = (frag - uOrigin) / uScale;
  vec2 fl = floor(pl);
  vec2 p = vec2(uCell0) + pl;
  vec2 size = vec2(uGridSize);

  // Coverage of this pixel by the base plate, a 1 px box filter against the page background.
  vec2 edge = min(p, size - p) * uScale;
  float plate = clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0);
  if (plate <= 0.0) {
    outColor = vec4(uBg, 1.0);
    return;
  }

  ivec2 cell = clamp(uCell0 + ivec2(fl), ivec2(0), uGridSize - 1);
  uint idx = texelFetch(uGrid, cell, 0).r;
  vec3 stud = texelFetch(uPal, ivec2(int(idx), 0), 0).rgb;
  vec2 f = pl - fl - 0.5;
  float d = length(f);
  float px = 1.0 / uScale;

  // Tile coverage: a 1 px box filter across the rim.
  float disc = clamp((R - d) * uScale + 0.5, 0.0, 1.0);

  // Tile top: bevel ring lit from the top left plus a soft highlight, both fading on small studs.
  vec2 n = d > 1e-4 ? f / d : vec2(0.0);
  float ring = smoothstep(R - BEVEL_IN - 0.5 * px, R - BEVEL_OUT + 0.5 * px, d);
  vec3 top = stud + uDetail * (ring * dot(n, LIGHT) * BEVEL_K);
  vec2 h = f - HL_POS;
  top += uDetail * HL_K * exp(-dot(h, h) * HL_SHARP);

  // Base plate between the tiles, in the soft shadow of this tile and the neighbours across the
  // nearer vertical and horizontal cell edges (no other tile's shadow reaches this far).
  ivec2 s = ivec2(f.x < 0.0 ? -1 : 1, f.y < 0.0 ? -1 : 1);
  float occ = max(occlusion(f, cell, ivec2(0)), max(occlusion(f, cell, ivec2(s.x, 0)), occlusion(f, cell, ivec2(0, s.y))));
  vec3 gap = uBase * (1.0 - SH_K * occ);

  // Blend in linear light so partly covered pixels have the right brightness.
  vec3 lin = mix(toLin(gap), toLin(clamp(top, 0.0, 1.0)), disc);

  // Level of detail: tiny studs become their area-average colour instead of beating against the
  // pixel grid (moire). The pixel's footprint (px studs wide) is box-filtered over the 2x2 cells it
  // can overlap, an exact area average while studs are at least a pixel wide.
  if (uLod > 0.0) {
    vec3 gapLin = toLin(uBase * GAP_SHADE);
    vec2 c0 = floor(pl - 0.5 * px);
    vec2 w = clamp((pl + 0.5 * px - c0 - 1.0) * uScale, 0.0, 1.0);
    ivec2 k = uCell0 + ivec2(c0);
    vec3 top = mix(cellAverage(k, gapLin), cellAverage(k + ivec2(1, 0), gapLin), w.x);
    vec3 bottom = mix(cellAverage(k + ivec2(0, 1), gapLin), cellAverage(k + ivec2(1, 1), gapLin), w.x);
    lin = mix(lin, mix(top, bottom, w.y), uLod);
  }

  vec3 col = toSrgb(mix(toLin(uBg), lin, plate));

  // Panel grid: a UI overlay, composited in sRGB like the page would, and only over the plate.
  if (uPanel.a > 0.0) {
    vec2 k = floor(p / PANEL + 0.5);
    // Nearest line in device px, its left/top edge snapped to a whole pixel (uPanelWidth is whole).
    vec2 line = frag - (p - k * PANEL) * uScale;
    vec2 dl = abs(frag - (floor(line - 0.5 * uPanelWidth + 0.5) + 0.5 * uPanelWidth));
    // Inner panel boundaries only; the outer edge is visible anyway.
    if (k.x <= 0.0 || k.x >= size.x / PANEL) dl.x = 1e9;
    if (k.y <= 0.0 || k.y >= size.y / PANEL) dl.y = 1e9;
    float dm = min(dl.x, dl.y);
    float halo = clamp(0.5 * uPanelWidth + uPanelHaloWidth - dm + 0.5, 0.0, 1.0);
    float core = clamp(0.5 * uPanelWidth - dm + 0.5, 0.0, 1.0);
    col = mix(col, vec3(0.0), halo * uPanelHalo * plate);
    col = mix(col, uPanel.rgb, core * uPanel.a * plate);
  }

  outColor = vec4(col, 1.0);
}`;

const UNIFORMS = [
  'uGrid', 'uPal', 'uGridSize', 'uCell0', 'uOrigin', 'uScale', 'uCanvasH', 'uBase', 'uBg',
  'uDetail', 'uLod', 'uPanel', 'uPanelWidth', 'uPanelHaloWidth', 'uPanelHalo',
] as const;
type UniformName = (typeof UNIFORMS)[number];

interface GlResources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject | null;
  grid: WebGLTexture;
  palette: WebGLTexture;
  u: Record<UniformName, WebGLUniformLocation | null>;
}

/** Thrown when WebGL2 can't be used. contextCreated: the canvas now holds a WebGL2 context. */
export class WebGL2InitError extends Error {
  readonly contextCreated: boolean;
  constructor(message: string, contextCreated: boolean) {
    super(message);
    this.name = 'WebGL2InitError';
    this.contextCreated = contextCreated;
  }
}

export interface WebGL2Options {
  /** Keep the drawing buffer after compositing (export reads it back). Default false. */
  preserveDrawingBuffer?: boolean;
  /** Upper bound for the device pixel ratio. Default MAX_DPR. */
  maxDpr?: number;
}

const ZERO_TEXEL = new Uint8Array(1);
const EMPTY = new Uint8Array(0);

export class WebGL2Renderer implements StudRenderer {
  readonly kind = 'webgl2' as const;
  readonly canvas: RenderCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly loseExt: WEBGL_lose_context | null;
  private readonly events: RendererEvents;
  private readonly maxDpr: number;
  private readonly maxSide: number;
  private readonly maxTexture: number;
  private res: GlResources | null;
  private lost = false;
  private destroyed = false;
  // CPU copies, the source for every (re)upload.
  private cells: Uint8Array = EMPTY;
  private gw = 0;
  private gh = 0;
  private readonly palette = new Uint8Array(256 * 4);
  private base: Rgb = [0, 0, 0];
  private bg: Rgb = DEFAULT_BACKGROUND;
  private panelGrid = false;
  private view: View = { scale: 1, ox: 0, oy: 0 };
  private ratio = 1;

  constructor(canvas: RenderCanvas, events: RendererEvents = {}, options: WebGL2Options = {}) {
    this.canvas = canvas;
    this.events = events;
    this.maxDpr = options.maxDpr ?? MAX_DPR;
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new WebGL2InitError('WebGL2 is not available', false);
    this.gl = gl;
    this.loseExt = gl.getExtension('WEBGL_lose_context');
    if (gl.isContextLost()) throw new WebGL2InitError('the WebGL2 context was lost on creation', true);
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxSide = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, viewport[0], viewport[1]);
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    try {
      this.res = this.build();
    } catch (err) {
      this.releaseContext();
      throw new WebGL2InitError(`WebGL2 setup failed: ${(err as Error).message}`, true);
    }
    (canvas as EventTarget).addEventListener('webglcontextlost', this.handleLost, false);
    (canvas as EventTarget).addEventListener('webglcontextrestored', this.handleRestored, false);
  }

  setMosaic(cells: Uint8Array, width: number, height: number, colors: readonly Rgb[], base: Rgb): void {
    const n = checkMosaic(cells, width, height, colors);
    if (width > this.maxTexture || height > this.maxTexture) {
      throw new RangeError(`grid ${width}x${height} exceeds the GPU texture limit ${this.maxTexture}`);
    }
    this.cells = cells.slice(0, n);
    this.gw = width;
    this.gh = height;
    const pal = this.palette;
    pal.fill(0);
    for (let k = 0; k < colors.length; k++) {
      const c = colors[k];
      pal[k * 4] = c[0];
      pal[k * 4 + 1] = c[1];
      pal[k * 4 + 2] = c[2];
      pal[k * 4 + 3] = 255;
    }
    this.base = [base[0], base[1], base[2]];
    if (this.res && !this.lost) {
      this.uploadPalette(this.res);
      this.uploadGrid(this.res);
    }
  }

  setCell(index: number, localIndex: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cells.length) throw new RangeError(`cell ${index} is outside the grid`);
    if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex > 255) throw new RangeError(`invalid colour index ${localIndex}`);
    this.cells[index] = localIndex;
    const res = this.res;
    if (!res || this.lost) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.grid);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, index % this.gw, Math.floor(index / this.gw), 1, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.cells, index);
  }

  setView(view: View): void {
    this.view = view;
  }

  setBackground(rgb: Rgb): void {
    this.bg = [rgb[0], rgb[1], rgb[2]];
  }

  setPanelGrid(show: boolean): void {
    this.panelGrid = show;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const { w, h, ratio } = backingSize(cssW, cssH, dpr, this.maxDpr, this.maxSide);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ratio = ratio;
  }

  pixelRatio(): number {
    return this.ratio;
  }

  /** Largest backing-store side this GPU can draw into (renderbuffer and viewport limits). */
  maxCanvasSide(): number {
    return this.maxSide;
  }

  render(): void {
    const res = this.res;
    const gl = this.gl;
    if (!res || this.lost || this.destroyed || gl.isContextLost()) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    const bg = this.bg;
    const r = this.ratio;
    const s = this.view.scale * r;
    const ox = this.view.ox * r;
    const oy = this.view.oy * r;
    if (this.gw === 0 || this.gh === 0 || !(s > 0) || !Number.isFinite(ox) || !Number.isFinite(oy)) {
      gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const c0x = Math.min(this.gw - 1, Math.max(0, Math.floor(-ox / s)));
    const c0y = Math.min(this.gh - 1, Math.max(0, Math.floor(-oy / s)));
    const u = res.u;
    gl.useProgram(res.program);
    gl.bindVertexArray(res.vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, res.palette);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.grid);
    gl.uniform2i(u.uGridSize, this.gw, this.gh);
    gl.uniform2i(u.uCell0, c0x, c0y);
    gl.uniform2f(u.uOrigin, ox + c0x * s, oy + c0y * s);
    gl.uniform1f(u.uScale, s);
    gl.uniform1f(u.uCanvasH, H);
    gl.uniform3f(u.uBase, this.base[0] / 255, this.base[1] / 255, this.base[2] / 255);
    gl.uniform3f(u.uBg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    gl.uniform1f(u.uDetail, detailFactor(s));
    gl.uniform1f(u.uLod, lodFactor(s));
    const pc = PANEL_GRID.color;
    gl.uniform4f(u.uPanel, pc[0] / 255, pc[1] / 255, pc[2] / 255, this.panelGrid ? PANEL_GRID.opacity : 0);
    const line = panelLinePx(r);
    gl.uniform1f(u.uPanelWidth, line.core);
    gl.uniform1f(u.uPanelHaloWidth, line.halo);
    gl.uniform1f(u.uPanelHalo, PANEL_GRID.haloOpacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    (this.canvas as EventTarget).removeEventListener('webglcontextlost', this.handleLost, false);
    (this.canvas as EventTarget).removeEventListener('webglcontextrestored', this.handleRestored, false);
    const res = this.res;
    this.res = null;
    const gl = this.gl;
    if (res && !gl.isContextLost()) {
      gl.deleteTexture(res.grid);
      gl.deleteTexture(res.palette);
      gl.deleteVertexArray(res.vao);
      gl.deleteProgram(res.program);
    }
    // Browsers keep at most ~16 live contexts per page; React StrictMode mounts twice.
    this.releaseContext();
    this.cells = EMPTY;
  }

  private releaseContext(): void {
    if (!this.gl.isContextLost()) this.loseExt?.loseContext();
  }

  private readonly handleLost = (e: Event): void => {
    // Without preventDefault the context can never be restored.
    e.preventDefault();
    this.lost = true;
    this.res = null;
    this.events.onContextLost?.();
  };

  private readonly handleRestored = (): void => {
    if (this.destroyed) return;
    try {
      this.res = this.build();
    } catch {
      // Stay lost; the owner falls back to Canvas2D when a restore doesn't take.
      this.res = null;
      return;
    }
    this.lost = false;
    this.events.onContextRestored?.();
  };

  private build(): GlResources {
    const gl = this.gl;
    const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    const u = {} as Record<UniformName, WebGLUniformLocation | null>;
    for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);
    const grid = gl.createTexture();
    const palette = gl.createTexture();
    if (!grid || !palette) throw new Error('createTexture failed');
    const res: GlResources = { program, vao: gl.createVertexArray(), grid, palette, u };
    for (const [unit, tex] of [[gl.TEXTURE1, palette], [gl.TEXTURE0, grid]] as const) {
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.uploadPalette(res);
    this.uploadGrid(res);
    gl.useProgram(program);
    gl.uniform1i(u.uGrid, 0);
    gl.uniform1i(u.uPal, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    return res;
  }

  private uploadPalette(res: GlResources): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, res.palette);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.palette);
    gl.activeTexture(gl.TEXTURE0);
  }

  private uploadGrid(res: GlResources): void {
    const gl = this.gl;
    const empty = this.gw === 0 || this.gh === 0;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.grid);
    // Rows of an odd-width grid are not 4-byte aligned.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8UI,
      empty ? 1 : this.gw, empty ? 1 : this.gh, 0,
      gl.RED_INTEGER, gl.UNSIGNED_BYTE, empty ? ZERO_TEXEL : this.cells,
    );
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log ?? 'no log'}`);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
  const log = ok ? null : gl.getProgramInfoLog(program);
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!ok) {
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log ?? 'no log'}`);
  }
  return program;
}

/** The fragment shader source (tests check its precision and constants). */
export const STUD_FRAGMENT_SHADER = FRAGMENT_SHADER;
