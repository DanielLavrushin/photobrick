// Messages between the UI thread and the engine worker (see docs/ARCHITECTURE.md, "Worker protocol").
// The latest request wins: the client drops responses whose seq is older than its newest generate.

import type { GenerateTimings, MosaicResult, MosaicSettings } from '@photobrick/engine';

export type EngineRequest =
  /** Decode once and keep the working image resident. `file` is the original Blob/File. */
  | { type: 'load'; seq: number; file: Blob }
  /** Fallback when the worker can't decode (no OffscreenCanvas): RGBA pixels decoded on the main thread. */
  | { type: 'loadPixels'; seq: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'generate'; seq: number; settings: MosaicSettings };

export type EngineErrorCode = 'heic' | 'decode' | 'too-small' | 'no-image' | 'internal';

export type EngineResponse =
  /** Size of the EXIF-oriented working image (long side <= 2048). */
  | { type: 'loaded'; seq: number; width: number; height: number }
  /** result.cells.buffer is transferred. */
  | { type: 'result'; seq: number; result: MosaicResult; timings: GenerateTimings }
  | { type: 'error'; seq: number; code: EngineErrorCode; message: string };
