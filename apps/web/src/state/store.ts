// App state (zustand). The photo lives only in the engine worker (working image) and in the compare
// bitmap; neither ever leaves the device. Every settings change regenerates the mosaic, coalesced to
// one request per animation frame, and the worker client keeps only the latest request.

import { create } from 'zustand';
import { cropRect, defaultSettings, gridSize, MAX_ZOOM, type GenerateTimings, type MosaicResult, type MosaicSettings } from '@photobrick/engine';
import { EngineClient, EngineError } from '../worker/client.ts';
import { DecodeError, MAX_WORKING_SIDE } from '../worker/decode.ts';
import { decodeCompareBitmap } from '../worker/mainDecode.ts';
import { clearShareHash } from '../share/hash.ts';
import { saveLook, withLook } from './persist.ts';

export type Phase = 'landing' | 'loading' | 'editor' | 'shared';

export interface LoadedImage {
  name: string;
  /** Working image size (EXIF-oriented, long side <= 2048): the crop rect's coordinate space. */
  width: number;
  height: number;
  /** The photo for hold-to-compare, same aspect ratio as the working image, or null while it decodes. */
  compareBitmap: ImageBitmap | null;
}

export type AppErrorCode = 'heic' | 'decode' | 'too-small' | 'no-image' | 'internal' | 'share-invalid' | 'example-fetch';

export interface AppError {
  code: AppErrorCode;
  /** Technical detail for the console; never shown as the main message. */
  detail?: string;
}

export interface SharedMeta {
  part: string;
  base: string;
}

export interface AppState {
  phase: Phase;
  /** Name of what is being opened (phase 'loading'). */
  loadingName: string | null;
  image: LoadedImage | null;
  settings: MosaicSettings | null;
  result: MosaicResult | null;
  timings: GenerateTimings | null;
  busy: boolean;
  error: AppError | null;
  /** Phase 'shared': what the share link said about the mosaic. */
  shared: SharedMeta | null;
  /** The viewer moves the crop window instead of the view. */
  cropMode: boolean;

  openFile(file: Blob, name: string): Promise<void>;
  openUrl(url: string, name: string): Promise<void>;
  setSettings(update: Partial<MosaicSettings> | ((s: MosaicSettings) => MosaicSettings)): void;
  moveCrop(dxStuds: number, dyStuds: number): void;
  zoomCrop(factor: number): void;
  setCropZoom(zoom: number): void;
  resetCrop(): void;
  setCropMode(on: boolean): void;
  newPhoto(): void;
  openShared(data: string): Promise<void>;
  leaveShared(): void;
  retry(): void;
  clearError(): void;
}

let engine: EngineClient | null = null;
function client(): EngineClient {
  engine ??= new EngineClient();
  return engine;
}

/** Bumped by every open (file, example, share): older async work checks it and gives up. */
let openToken = 0;
/** What to open again on retry(). */
let lastOpen: (() => Promise<void>) | null = null;
let raf = 0;

class FetchError extends Error {
  override name = 'FetchError';
}

function toAppError(err: unknown): AppError {
  if (err instanceof EngineError || err instanceof DecodeError) return { code: err.code, detail: err.message };
  return { code: 'internal', detail: err instanceof Error ? err.message : String(err) };
}

/** ~2x the viewer's CSS long side (estimated from the window), at most the working image. */
export function compareLongSide(workW: number, workH: number): number {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const h = typeof window === 'undefined' ? 800 : window.innerHeight;
  const desktop = w >= 900;
  const viewerLong = desktop ? Math.max(w - 380, h - 120) : Math.max(w, h * 0.56);
  return Math.max(64, Math.min(MAX_WORKING_SIDE, Math.max(workW, workH), Math.round(2 * viewerLong)));
}

/** Largest useful crop zoom: one source pixel per stud. */
export function maxCropZoom(imgW: number, imgH: number, settings: MosaicSettings): number {
  const { width: gw, height: gh } = gridSize(settings.size);
  const full = cropRect(imgW, imgH, gw, gh, { cx: 0.5, cy: 0.5, zoom: 1 });
  return Math.max(1, Math.min(MAX_ZOOM, full.w / gw));
}

/** Source pixels per stud of the current crop window. */
export function pxPerStud(imgW: number, imgH: number, settings: MosaicSettings): number {
  const { width: gw, height: gh } = gridSize(settings.size);
  return cropRect(imgW, imgH, gw, gh, settings.crop).w / gw;
}

/** Starts the engine worker early (e.g. while the landing page is idle). */
export function warmUpEngine(): void {
  try {
    client().warmUp();
  } catch (err) {
    console.warn('[photobrick] engine warm-up failed', err);
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function closeCompare(image: LoadedImage | null): void {
  try {
    image?.compareBitmap?.close();
  } catch {
    // already closed
  }
}

export const useApp = create<AppState>()((set, get) => {
  function scheduleGenerate(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      void runGenerate();
    });
  }

  async function runGenerate(): Promise<void> {
    const { settings, phase } = get();
    if (!settings || phase !== 'editor') return;
    saveLook(settings);
    const token = openToken;
    const c = client();
    set({ busy: true });
    try {
      const out = await c.generate(settings);
      if (token !== openToken) return;
      if (out) set({ result: out.result, timings: out.timings, busy: c.busy });
      else set({ busy: c.busy });
    } catch (err) {
      if (token !== openToken) return;
      const e = toAppError(err);
      console.error('[photobrick] generate failed', err);
      set({ busy: c.busy, error: e });
    }
  }

  function applyCrop(crop: MosaicSettings['crop']): void {
    const { image, settings } = get();
    if (!image || !settings) return;
    // Store the centre of the clamped window, so dragging back from an edge responds immediately.
    const { width: gw, height: gh } = gridSize(settings.size);
    const zoom = clamp(crop.zoom, 1, maxCropZoom(image.width, image.height, settings));
    const r = cropRect(image.width, image.height, gw, gh, { ...crop, zoom });
    get().setSettings({ crop: { cx: (r.x + r.w / 2) / image.width, cy: (r.y + r.h / 2) / image.height, zoom } });
  }

  async function open(load: () => Promise<Blob>, name: string): Promise<void> {
    const token = ++openToken;
    // A failed open goes back to the mosaic on screen (the worker keeps its image until a load
    // succeeds); from the landing page it shows the error there.
    const prev = get();
    const back: Partial<AppState> | null =
      prev.phase === 'editor' || prev.phase === 'shared'
        ? { phase: prev.phase, image: prev.image, settings: prev.settings, result: prev.result, timings: prev.timings, shared: prev.shared }
        : null;
    set({ phase: 'loading', loadingName: name, error: null, cropMode: false, busy: false });
    try {
      const file = await load();
      if (token !== openToken) return;
      const size = await client().load(file);
      if (!size || token !== openToken) return;
      closeCompare(prev.image);
      clearShareHash();
      const settings = withLook(defaultSettings(size.width, size.height));
      set({ phase: 'editor', loadingName: null, image: { name, width: size.width, height: size.height, compareBitmap: null }, settings, result: null, timings: null, shared: null });
      scheduleGenerate();
      decodeCompareBitmap(file, compareLongSide(size.width, size.height)).then(
        (bmp) => {
          const img = get().image;
          if (token !== openToken || !img) {
            bmp.close();
            return;
          }
          set({ image: { ...img, compareBitmap: bmp } });
        },
        (err: unknown) => console.warn('[photobrick] no compare photo', err),
      );
    } catch (err) {
      if (token !== openToken) return;
      const e = err instanceof FetchError ? { code: 'example-fetch' as const, detail: err.message } : toAppError(err);
      console.warn('[photobrick] could not open', name, err);
      if (back) set({ ...back, loadingName: null, error: e });
      else {
        closeCompare(prev.image);
        set({ phase: 'landing', loadingName: null, error: e, image: null, settings: null, result: null, timings: null, shared: null });
      }
    }
  }

  return {
    phase: 'landing',
    loadingName: null,
    image: null,
    settings: null,
    result: null,
    timings: null,
    busy: false,
    error: null,
    shared: null,
    cropMode: false,

    openFile(file, name) {
      lastOpen = () => get().openFile(file, name);
      return open(async () => file, name);
    },

    openUrl(url, name) {
      lastOpen = () => get().openUrl(url, name);
      return open(async () => {
        let res: Response;
        try {
          res = await fetch(url);
        } catch (err) {
          throw new FetchError(`fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!res.ok) throw new FetchError(`fetch ${url}: HTTP ${res.status}`);
        return res.blob();
      }, name);
    },

    setSettings(update) {
      const cur = get().settings;
      if (!cur) return;
      const next = typeof update === 'function' ? update(cur) : { ...cur, ...update };
      set({ settings: next });
      scheduleGenerate();
    },

    moveCrop(dx, dy) {
      const { image, settings } = get();
      if (!image || !settings) return;
      const { width: gw, height: gh } = gridSize(settings.size);
      const r = cropRect(image.width, image.height, gw, gh, settings.crop);
      // The photo follows the finger: the window moves the other way.
      const cx = (r.x + r.w / 2 - (dx * r.w) / gw) / image.width;
      const cy = (r.y + r.h / 2 - (dy * r.h) / gh) / image.height;
      applyCrop({ ...settings.crop, cx, cy });
    },

    zoomCrop(factor) {
      const s = get().settings;
      if (!s || !(factor > 0)) return;
      applyCrop({ ...s.crop, zoom: s.crop.zoom * factor });
    },

    setCropZoom(zoom) {
      const s = get().settings;
      if (!s) return;
      applyCrop({ ...s.crop, zoom });
    },

    resetCrop() {
      if (get().settings) get().setSettings({ crop: { cx: 0.5, cy: 0.5, zoom: 1 } });
    },

    setCropMode(on) {
      if (get().cropMode !== on) set({ cropMode: on });
    },

    newPhoto() {
      openToken++;
      closeCompare(get().image);
      clearShareHash();
      set({ phase: 'landing', loadingName: null, image: null, settings: null, result: null, timings: null, shared: null, cropMode: false, busy: false, error: null });
    },

    async openShared(data) {
      const token = ++openToken;
      closeCompare(get().image);
      set({ phase: 'loading', loadingName: null, error: null, image: null, settings: null, result: null, timings: null, shared: null, cropMode: false, busy: false });
      try {
        const { decodeShare } = await import('../share/codec.ts');
        const decoded = await decodeShare(data);
        if (token !== openToken) return;
        set({ phase: 'shared', result: decoded.result, shared: { part: decoded.part, base: decoded.base } });
      } catch (err) {
        if (token !== openToken) return;
        console.warn('[photobrick] invalid share link', err);
        clearShareHash();
        set({ phase: 'landing', error: { code: 'share-invalid', detail: err instanceof Error ? err.message : String(err) } });
      }
    },

    leaveShared() {
      get().newPhoto();
    },

    retry() {
      if (lastOpen) void lastOpen();
    },

    clearError() {
      if (get().error) set({ error: null });
    },
  };
});
