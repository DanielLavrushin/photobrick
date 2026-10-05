/// <reference lib="webworker" />
// The engine worker: decodes the photo once, keeps the working image resident and regenerates the
// mosaic on request. Protocol: ./protocol.ts and docs/ARCHITECTURE.md ("Worker protocol").

import { generate, type WorkingImage } from '@photobrick/engine';
import { decodeToBitmap, DecodeError, MAX_WORKING_SIDE, MIN_IMAGE_SIDE } from './decode.ts';
import type { EngineErrorCode, EngineRequest, EngineResponse } from './protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let image: WorkingImage | null = null;
/** seq of the newest load request; an older decode that finishes late is discarded. */
let newestLoad = 0;

function post(msg: EngineResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

function fail(seq: number, code: EngineErrorCode, message: string): void {
  post({ type: 'error', seq, code, message });
}

async function decode(file: Blob): Promise<WorkingImage> {
  // Without OffscreenCanvas (Safari < 16.4) the client decodes on the main thread and sends pixels.
  if (typeof OffscreenCanvas === 'undefined') throw new DecodeError('decode', 'OffscreenCanvas is not available in this worker');
  const bmp = await decodeToBitmap(file, MAX_WORKING_SIDE);
  try {
    const { width, height } = bmp;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new DecodeError('decode', 'no 2D context on OffscreenCanvas');
    ctx.drawImage(bmp, 0, 0);
    // getImageData returns sRGB by default; the data array stays resident, the canvas is dropped.
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bmp.close();
  }
}

async function load(seq: number, file: Blob): Promise<void> {
  newestLoad = seq;
  try {
    const img = await decode(file);
    if (seq !== newestLoad) return;
    image = img;
    post({ type: 'loaded', seq, width: img.width, height: img.height });
  } catch (err) {
    if (seq !== newestLoad) return;
    if (err instanceof DecodeError) fail(seq, err.code, err.message);
    else fail(seq, 'internal', err instanceof Error ? err.message : String(err));
  }
}

function loadPixels(seq: number, width: number, height: number, data: ArrayBuffer): void {
  newestLoad = seq;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0) || data.byteLength < width * height * 4) {
    fail(seq, 'decode', 'invalid pixel buffer');
    return;
  }
  if (Math.min(width, height) < MIN_IMAGE_SIDE) {
    fail(seq, 'too-small', `the image is only ${width} x ${height} pixels`);
    return;
  }
  image = { width, height, data: new Uint8ClampedArray(data, 0, width * height * 4) };
  post({ type: 'loaded', seq, width, height });
}

function run(seq: number, settings: Extract<EngineRequest, { type: 'generate' }>['settings']): void {
  if (!image) {
    fail(seq, 'no-image', 'no image loaded');
    return;
  }
  try {
    const { result, timings } = generate(image, settings);
    post({ type: 'result', seq, result, timings }, [result.cells.buffer]);
  } catch (err) {
    fail(seq, 'internal', err instanceof Error ? err.message : String(err));
  }
}

scope.onmessage = (e: MessageEvent<EngineRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'load':
      void load(req.seq, req.file);
      break;
    case 'loadPixels':
      loadPixels(req.seq, req.width, req.height, req.data);
      break;
    case 'generate':
      run(req.seq, req.settings);
      break;
  }
};
