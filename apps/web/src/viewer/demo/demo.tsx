// Dev-only playground for the viewer (served at /viewer-demo.html by the Vite dev server). Also the
// page e2e/viewer-check.mjs drives through window.__viewerDemo.
//
// URL parameters: size=48x48|64x96|128x128|256x192|256x256|47x33 (odd widths exercise unaligned
// texture rows), base=dbg|black|white|lbg|tan, bg=light|dark,
// grid=1, compare=1, split=0..1, mode=crop, renderer=canvas2d (read by createRenderer).

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { MosaicResult, Rgb } from '@photobrick/engine';
import palette from '@photobrick/engine/palette/98138.json';
import {
  MosaicViewer,
  exportPxPerStud,
  renderMosaicPng,
  type MosaicViewerHandle,
  type RendererKind,
  type View,
} from '../index.ts';
import { flatGapColor } from '../studLook.ts';

const SIZES = ['48x48', '64x96', '128x128', '256x192', '256x256', '47x33'] as const;
type SizeKey = (typeof SIZES)[number];

const rgbOf = (id: number): Rgb => {
  const c = palette.colors.find((p) => p.id === id);
  if (!c) throw new Error(`colour ${id} is not in the palette`);
  return [c.rgb[0], c.rgb[1], c.rgb[2]];
};

const BASES: Record<string, { label: string; rgb: Rgb }> = {
  dbg: { label: 'Dark Bluish Gray', rgb: rgbOf(72) },
  black: { label: 'Black', rgb: rgbOf(0) },
  white: { label: 'White', rgb: rgbOf(15) },
  lbg: { label: 'Light Bluish Gray', rgb: rgbOf(71) },
  tan: { label: 'Tan', rgb: rgbOf(19) },
};
const BACKGROUNDS: Record<string, Rgb> = { light: [238, 238, 240], dark: [28, 29, 34] };

// 20 palette colours ordered by luminance, so the radial pattern reads as a gradient.
const DEMO_COLORS = palette.colors
  .slice(0, 20)
  .map((c) => ({ id: c.id, rgb: [c.rgb[0], c.rgb[1], c.rgb[2]] as Rgb }))
  .sort((a, b) => luma(a.rgb) - luma(b.rgb));

function luma(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Colour index of the pattern at stud coordinates (u, v): radial rings, rotated in four sectors. */
function patternIndex(u: number, v: number, w: number, h: number): number {
  const cx = w * 0.42;
  const cy = h * 0.46;
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  const r = Math.hypot(u - cx, v - cy) / maxR;
  const a = (Math.atan2(v - cy, u - cx) / (2 * Math.PI) + 1) % 1;
  const ring = Math.min(19, Math.floor(r * 20));
  return (ring + (Math.floor(a * 4) === 1 ? 7 : 0)) % 20;
}

function makeMosaic(w: number, h: number): MosaicResult {
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y * w + x] = patternIndex(x + 0.5, y + 0.5, w, h);
  return { width: w, height: h, cells, colorIds: DEMO_COLORS.map((c) => c.id) };
}

/** The "photo" for compare: the same pattern, continuous, 8 px per stud plus a 64 px margin. */
const PHOTO_PX = 8;
const PHOTO_MARGIN = 64;
async function makePhoto(w: number, h: number): Promise<ImageBitmap> {
  const W = w * PHOTO_PX + 2 * PHOTO_MARGIN;
  const H = h * PHOTO_PX + 2 * PHOTO_MARGIN;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5 - PHOTO_MARGIN) / PHOTO_PX;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5 - PHOTO_MARGIN) / PHOTO_PX;
      const c = DEMO_COLORS[patternIndex(u, v, w, h)].rgb;
      const o = (py * W + px) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Stud grid lines every 16 studs in the photo, to see the alignment in compare mode.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  for (let k = 0; k <= w; k += 16) ctx.fillRect(PHOTO_MARGIN + k * PHOTO_PX - 1, 0, 2, H);
  for (let k = 0; k <= h; k += 16) ctx.fillRect(0, PHOTO_MARGIN + k * PHOTO_PX - 1, W, 2);
  return createImageBitmap(canvas);
}

interface ExportCheck {
  width: number;
  height: number;
  px: number;
  requestedPx: number;
  bytes: number;
  ms: number;
  checked: number;
  /** Largest channel difference between a stud centre and its palette colour. */
  maxCentreErr: number;
  /** Largest channel difference between a cell corner and the base colour (WebGL look). */
  maxGapErr: number;
  /** Same against the flat Canvas2D gap colour. */
  maxFlatGapErr: number;
  png?: string;
}

interface SnapshotCheck {
  kind: RendererKind | null;
  width: number;
  height: number;
  nonBackground: number;
  distinctColours: number;
  devicePxPerStud: number;
  studsChecked: number;
  maxStudErr: number;
}

/** Everything the crop callbacks reported since the page loaded. */
interface CropTotals {
  dx: number;
  dy: number;
  zoom: number;
  dragCalls: number;
  zoomCalls: number;
}

interface DemoApi {
  ready: boolean;
  state(): { kind: RendererKind | null; reason: string | null; view: View; size: string; logs: string[]; crop: CropTotals };
  /** flatGap: the base plate as the Canvas2D fallback paints it. */
  mosaic(): { width: number; height: number; cells: number[]; colors: Rgb[]; base: Rgb; flatGap: Rgb; background: Rgb };
  zoomBy(factor: number, cx?: number, cy?: number): View;
  fit(): View;
  /** null when the viewer is not on WebGL2. */
  isLost(): boolean | null;
  loseContext(): boolean;
  restoreContext(): boolean;
  snapshot(): SnapshotCheck;
  /** RGB at CSS px points of the viewer, from the mosaic canvas (drawn now) or the compare overlay (RGBA). */
  readPixels(points: [number, number][], layer?: 'mosaic' | 'overlay'): number[][];
  exportCheck(px: number, withPng?: boolean): Promise<ExportCheck>;
}

declare global {
  interface Window {
    __viewerDemo?: DemoApi;
  }
}

const params = new URLSearchParams(location.search);
const initialSize = (SIZES as readonly string[]).includes(params.get('size') ?? '') ? (params.get('size') as SizeKey) : '64x96';

function setParam(key: string, value: string | null): void {
  const u = new URL(location.href);
  if (value === null) u.searchParams.delete(key);
  else u.searchParams.set(key, value);
  history.replaceState(null, '', u);
}

function Demo() {
  const [size, setSize] = useState<SizeKey>(initialSize);
  const [baseKey, setBaseKey] = useState(params.get('base') && BASES[params.get('base')!] ? params.get('base')! : 'dbg');
  const [bgKey, setBgKey] = useState(params.get('bg') === 'dark' ? 'dark' : 'light');
  const [grid, setGrid] = useState(params.get('grid') === '1');
  const [compare, setCompare] = useState(params.get('compare') === '1');
  const [split, setSplit] = useState(() => {
    const s = params.get('split');
    return s === null ? 1 : Math.min(1, Math.max(0, Number(s)));
  });
  const [crop, setCrop] = useState(params.get('mode') === 'crop');
  const [kind, setKind] = useState<RendererKind | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const [exportPx, setExportPx] = useState(20);
  const [exportInfo, setExportInfo] = useState<{ text: string; url: string } | null>(null);
  const viewerRef = useRef<MosaicViewerHandle>(null);
  const loseExtRef = useRef<WEBGL_lose_context | null>(null);
  const stateRef = useRef({ kind, reason, logs, size });
  useEffect(() => {
    stateRef.current = { kind, reason, logs, size };
  });
  const cropRef = useRef<CropTotals>({ dx: 0, dy: 0, zoom: 1, dragCalls: 0, zoomCalls: 0 });

  const [w, h] = size.split('x').map(Number);
  const result = useMemo(() => makeMosaic(w, h), [w, h]);
  const colors = useMemo(() => DEMO_COLORS.map((c) => c.rgb), []);
  const base = BASES[baseKey].rgb;

  useEffect(() => {
    let alive = true;
    let bitmap: ImageBitmap | null = null;
    void makePhoto(w, h).then((b) => {
      bitmap = b;
      if (alive) setPhoto(b);
      else b.close();
    });
    return () => {
      alive = false;
      bitmap?.close();
    };
  }, [w, h]);

  const log = useCallback((line: string) => setLogs((l) => [line, ...l].slice(0, 8)), []);
  const onCropDrag = useCallback((dx: number, dy: number) => {
    const t = cropRef.current;
    t.dx += dx;
    t.dy += dy;
    t.dragCalls++;
    log(`cropDrag ${dx.toFixed(3)} ${dy.toFixed(3)}`);
  }, [log]);
  const onCropZoom = useCallback((f: number) => {
    cropRef.current.zoom *= f;
    cropRef.current.zoomCalls++;
    log(`cropZoom ${f.toFixed(4)}`);
  }, [log]);
  const onRendererChange = useCallback((k: RendererKind, why: string | null) => {
    setKind(k);
    setReason(why);
  }, []);

  const exportCheck = useCallback(async (px: number, withPng = false): Promise<ExportCheck> => {
    const t0 = performance.now();
    const blob = await renderMosaicPng(result, colors, base, px);
    const ms = performance.now() - t0;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const usedPx = exportPxPerStud(result.width, result.height, px);
    let maxCentreErr = 0;
    let maxGapErr = 0;
    let maxFlatGapErr = 0;
    const flat = flatGapColor(base);
    let checked = 0;
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const expected = colors[result.cells[y * result.width + x]];
        const cx = Math.floor((x + 0.5) * usedPx);
        const cy = Math.floor((y + 0.5) * usedPx);
        const o = (cy * c.width + cx) * 4;
        // A cell corner: out of reach of every tile and shadow, so pure base colour.
        const g = (Math.floor(y * usedPx) * c.width + Math.floor(x * usedPx)) * 4;
        for (let k = 0; k < 3; k++) {
          maxCentreErr = Math.max(maxCentreErr, Math.abs(data[o + k] - expected[k]));
          if (usedPx >= 8) {
            maxGapErr = Math.max(maxGapErr, Math.abs(data[g + k] - base[k]));
            maxFlatGapErr = Math.max(maxFlatGapErr, Math.abs(data[g + k] - flat[k]));
          }
        }
        checked++;
      }
    }
    const width = c.width;
    const height = c.height;
    c.width = 0;
    c.height = 0;
    let png: string | undefined;
    if (withPng) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      png = btoa(s);
    }
    return { width, height, px: usedPx, requestedPx: px, bytes: blob.size, ms, checked, maxCentreErr, maxGapErr, maxFlatGapErr, png };
  }, [result, colors, base]);

  // The e2e hook.
  useEffect(() => {
    const api: DemoApi = {
      ready: true,
      state: () => ({ ...stateRef.current, crop: { ...cropRef.current }, view: viewerRef.current?.getView() ?? { scale: 1, ox: 0, oy: 0 } }),
      mosaic: () => ({ width: result.width, height: result.height, cells: Array.from(result.cells), colors: [...colors], base, flatGap: flatGapColor(base), background: BACKGROUNDS[bgKey] }),
      zoomBy: (f, cx, cy) => {
        viewerRef.current?.zoomBy(f, cx, cy);
        viewerRef.current?.redraw();
        return viewerRef.current!.getView();
      },
      fit: () => {
        viewerRef.current?.fit();
        viewerRef.current?.redraw();
        return viewerRef.current!.getView();
      },
      isLost: () => (viewerRef.current?.getRendererKind() === 'webgl2' ? (webgl(viewerRef.current)?.isContextLost() ?? null) : null),
      loseContext: () => {
        const ext = webgl(viewerRef.current)?.getExtension('WEBGL_lose_context') ?? null;
        if (!ext) return false;
        // Kept: getExtension returns null while the context is lost.
        loseExtRef.current = ext;
        ext.loseContext();
        return true;
      },
      restoreContext: () => {
        const ext = loseExtRef.current;
        if (!ext) return false;
        ext.restoreContext();
        return true;
      },
      snapshot: () => snapshot(viewerRef.current, result, colors, stateRef.current.kind),
      readPixels: (points, layer = 'mosaic') => readPixels(viewerRef.current, points, layer),
      exportCheck,
    };
    window.__viewerDemo = api;
  }, [result, colors, base, bgKey, exportCheck]);

  const doExport = async () => {
    const t0 = performance.now();
    const blob = await renderMosaicPng(result, colors, base, exportPx);
    const px = exportPxPerStud(result.width, result.height, exportPx);
    if (exportInfo) URL.revokeObjectURL(exportInfo.url);
    setExportInfo({
      url: URL.createObjectURL(blob),
      text: `${result.width * px}x${result.height * px} px at ${px} px/stud, ${(blob.size / 1e6).toFixed(2)} MB, ${Math.round(performance.now() - t0)} ms`,
    });
  };

  const bar: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 10px', background: '#fff', borderBottom: '1px solid #ddd' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={bar} data-testid="toolbar">
        <label>
          Size{' '}
          <select value={size} onChange={(e) => { setSize(e.target.value as SizeKey); setParam('size', e.target.value); }}>
            {SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Base{' '}
          <select value={baseKey} onChange={(e) => { setBaseKey(e.target.value); setParam('base', e.target.value); }}>
            {Object.entries(BASES).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
          </select>
        </label>
        <label>
          Page{' '}
          <select value={bgKey} onChange={(e) => { setBgKey(e.target.value); setParam('bg', e.target.value); }}>
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        </label>
        <label><input type="checkbox" checked={grid} onChange={(e) => { setGrid(e.target.checked); setParam('grid', e.target.checked ? '1' : null); }} /> panel grid</label>
        <label><input type="checkbox" checked={crop} onChange={(e) => { setCrop(e.target.checked); setParam('mode', e.target.checked ? 'crop' : null); }} /> crop mode</label>
        <label><input type="checkbox" checked={compare} onChange={(e) => { setCompare(e.target.checked); setParam('compare', e.target.checked ? '1' : null); }} /> compare</label>
        <label>
          split{' '}
          <input type="range" min={0} max={1} step={0.01} value={split} onChange={(e) => { setSplit(Number(e.target.value)); setParam('split', e.target.value); }} />
        </label>
        <button onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}>hold to compare</button>
        <button onClick={() => viewerRef.current?.fit()}>fit</button>
        <span>
          export{' '}
          <input type="number" min={1} max={64} value={exportPx} style={{ width: 48 }} onChange={(e) => setExportPx(Math.max(1, Number(e.target.value) || 1))} /> px/stud{' '}
          <button onClick={() => void doExport()}>PNG</button>
        </span>
        <button onClick={() => window.__viewerDemo?.loseContext()}>lose context</button>
        <button onClick={() => window.__viewerDemo?.restoreContext()}>restore context</button>
        <a href={`?${new URLSearchParams({ ...Object.fromEntries(params), renderer: kind === 'canvas2d' ? 'webgl2' : 'canvas2d' })}`}>
          {kind === 'canvas2d' ? 'use WebGL2' : 'force Canvas2D'}
        </a>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MosaicViewer
          ref={viewerRef}
          result={result}
          colors={colors}
          base={base}
          background={BACKGROUNDS[bgKey]}
          showPanelGrid={grid}
          interaction={crop ? 'crop' : 'view'}
          compare={photo ? { image: photo, rect: { x: PHOTO_MARGIN, y: PHOTO_MARGIN, w: w * PHOTO_PX, h: h * PHOTO_PX }, active: compare, split: split < 1 ? split : undefined } : undefined}
          onCropDrag={onCropDrag}
          onCropZoom={onCropZoom}
          onRendererChange={onRendererChange}
          onViewChange={setView}
        />
      </div>
      <div style={{ ...bar, borderTop: '1px solid #ddd', borderBottom: 0, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} data-testid="status">
        <span data-testid="kind">{kind ?? '-'}</span>
        {reason && <span>({reason})</span>}
        <span>scale {view.scale.toFixed(2)} css px/stud, origin {view.ox.toFixed(1)}, {view.oy.toFixed(1)}</span>
        {exportInfo && <a href={exportInfo.url} download={`mosaic-${size}.png`}>{exportInfo.text}</a>}
        <span>{logs.slice(0, 3).join(' | ')}</span>
      </div>
    </div>
  );
}

function webgl(handle: MosaicViewerHandle | null): WebGL2RenderingContext | null {
  const c = handle?.getCanvas();
  // Returns the existing context; null when the canvas holds a 2D one.
  return c && handle?.getRendererKind() === 'webgl2' ? c.getContext('webgl2') : null;
}

/** Copies a canvas into readable pixels. A WebGL canvas must be read in the task that drew it. */
function readBack(src: HTMLCanvasElement): { data: Uint8ClampedArray; width: number; height: number } {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = { data, width: c.width, height: c.height };
  c.width = 0;
  c.height = 0;
  return out;
}

function readPixels(handle: MosaicViewerHandle | null, points: [number, number][], layer: 'mosaic' | 'overlay'): number[][] {
  const main = handle?.getCanvas();
  if (!handle || !main) throw new Error('viewer not mounted');
  handle.redraw();
  const src = layer === 'mosaic' ? main : main.closest('[role=img]')!.querySelector<HTMLCanvasElement>(':scope > canvas')!;
  const { data, width, height } = readBack(src);
  const rx = width / main.clientWidth;
  const ry = height / main.clientHeight;
  return points.map(([x, y]) => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(x * rx)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(y * ry)));
    const o = (py * width + px) * 4;
    return layer === 'mosaic' ? [data[o], data[o + 1], data[o + 2]] : [data[o], data[o + 1], data[o + 2], data[o + 3]];
  });
}

/** Renders now and reads the canvas back in the same task (the WebGL buffer is still intact). */
function snapshot(handle: MosaicViewerHandle | null, result: MosaicResult, colors: readonly Rgb[], kind: RendererKind | null): SnapshotCheck {
  const src = handle?.getCanvas();
  if (!handle || !src) throw new Error('viewer not mounted');
  handle.redraw();
  const c = readBack(src);
  const data = c.data;
  const bg = [data[0], data[1], data[2]];
  let nonBackground = 0;
  const seen = new Set<number>();
  for (let o = 0; o < data.length; o += 4) {
    if (data[o] !== bg[0] || data[o + 1] !== bg[1] || data[o + 2] !== bg[2]) nonBackground++;
    if (seen.size < 4096) seen.add((data[o] << 16) | (data[o + 1] << 8) | data[o + 2]);
  }
  // Stud centres must show the stud's own colour when studs are big enough to have a flat top.
  const v = handle.getView();
  const ratio = src.width / Math.max(1, src.clientWidth || src.width);
  const devicePx = v.scale * ratio;
  let studsChecked = 0;
  let maxStudErr = 0;
  if (devicePx >= 10) {
    const step = Math.max(1, Math.floor((result.width * result.height) / 500));
    for (let i = 0; i < result.width * result.height; i += step) {
      const x = i % result.width;
      const y = Math.floor(i / result.width);
      const sx = Math.floor((v.ox + (x + 0.5) * v.scale) * ratio);
      const sy = Math.floor((v.oy + (y + 0.5) * v.scale) * ratio);
      if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) continue;
      const o = (sy * c.width + sx) * 4;
      const e = colors[result.cells[i]];
      for (let k = 0; k < 3; k++) maxStudErr = Math.max(maxStudErr, Math.abs(data[o + k] - e[k]));
      studsChecked++;
    }
  }
  return {
    kind,
    width: src.width,
    height: src.height,
    nonBackground: nonBackground / (data.length / 4),
    distinctColours: seen.size,
    devicePxPerStud: devicePx,
    studsChecked,
    maxStudErr,
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
