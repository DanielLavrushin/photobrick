// Main-thread side of the engine worker. load(file) decodes the photo in the worker (falling back to
// a main-thread decode when the worker can't), generate(settings) regenerates the mosaic.
//
// Latest wins: at most one generate is in the worker at a time. A call replaced by a newer one before
// it was sent resolves with null; so does every generate that a load() overtakes. Results arrive in
// the order they were asked for, so each non-null result is newer than the one before it.

import type { GenerateTimings, MosaicResult, MosaicSettings } from '@photobrick/engine';
import { DecodeError } from './decode.ts';
import { decodePixels as decodePixelsOnMainThread } from './mainDecode.ts';
import type { EngineErrorCode, EngineRequest, EngineResponse } from './protocol.ts';

export class EngineError extends Error {
  override name = 'EngineError';
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface GenerateOutput {
  result: MosaicResult;
  timings: GenerateTimings;
}

/** The part of Worker the client uses (a fake in tests). */
export interface WorkerPort {
  postMessage(message: EngineRequest, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<EngineResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}

export type PixelDecoder = (file: Blob) => Promise<{ width: number; height: number; data: ArrayBuffer }>;

export interface EngineClientOptions {
  createWorker?: () => WorkerPort;
  /** Main-thread decoder used when the worker reports 'decode' or 'heic'. */
  decodePixels?: PixelDecoder;
}

type Settle<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };

function defaultWorker(): WorkerPort {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'photobrick-engine' }) as unknown as WorkerPort;
}

function defaultDecodePixels(file: Blob): Promise<{ width: number; height: number; data: ArrayBuffer }> {
  return decodePixelsOnMainThread(file);
}

export class EngineClient {
  private readonly createWorker: () => WorkerPort;
  private readonly decodePixels: PixelDecoder;
  private worker: WorkerPort | null = null;
  private seq = 0;
  /** Requests answered by one response each (load / loadPixels). */
  private readonly waiting = new Map<number, Settle<EngineResponse>>();
  /** Outstanding load() calls, resolved with null when a newer load starts. */
  private readonly loads = new Set<Settle<{ width: number; height: number } | null>>();
  private loadGen = 0;
  private loading = false;
  private inFlight: ({ seq: number } & Settle<GenerateOutput | null>) | null = null;
  private pending: ({ settings: MosaicSettings } & Settle<GenerateOutput | null>) | null = null;
  private disposed = false;

  constructor(options: EngineClientOptions = {}) {
    this.createWorker = options.createWorker ?? defaultWorker;
    this.decodePixels = options.decodePixels ?? defaultDecodePixels;
  }

  /**
   * Decodes the photo and makes it the working image. Resolves with its EXIF-oriented size (long side
   * <= 2048), or null when a newer load() replaced this one. Rejects with EngineError.
   */
  load(file: Blob): Promise<{ width: number; height: number } | null> {
    this.dropGenerates();
    for (const l of this.loads) l.resolve(null);
    this.loads.clear();
    // The worker never answers a load that a newer one overtook: release those waiters now.
    for (const [seq, w] of this.waiting) w.resolve({ type: 'error', seq, code: 'internal', message: 'superseded' });
    this.waiting.clear();
    const gen = ++this.loadGen;
    this.loading = true;
    return new Promise((resolve, reject) => {
      const settle: Settle<{ width: number; height: number } | null> = { resolve, reject };
      this.loads.add(settle);
      this.runLoad(file, gen).then(
        (v) => {
          if (this.loads.delete(settle)) resolve(v);
        },
        (e: unknown) => {
          if (this.loads.delete(settle)) reject(e);
        },
      ).finally(() => {
        if (gen === this.loadGen) {
          this.loading = false;
          this.pump();
        }
      });
    });
  }

  private async runLoad(file: Blob, gen: number): Promise<{ width: number; height: number } | null> {
    let resp = await this.request({ type: 'load', seq: ++this.seq, file });
    if (gen !== this.loadGen) return null;
    if (resp.type === 'error' && (resp.code === 'decode' || resp.code === 'heic')) {
      let px: { width: number; height: number; data: ArrayBuffer };
      try {
        px = await this.decodePixels(file);
      } catch (err) {
        if (err instanceof DecodeError && err.code === 'too-small') throw new EngineError('too-small', err.message);
        throw new EngineError(resp.code, resp.message);
      }
      if (gen !== this.loadGen) return null;
      resp = await this.request({ type: 'loadPixels', seq: ++this.seq, width: px.width, height: px.height, data: px.data }, [px.data]);
      if (gen !== this.loadGen) return null;
    }
    if (resp.type === 'loaded') return { width: resp.width, height: resp.height };
    if (resp.type === 'error') throw new EngineError(resp.code, resp.message);
    throw new EngineError('internal', `unexpected response '${resp.type}' to load`);
  }

  /**
   * Regenerates the mosaic from the working image. Resolves with null when a newer generate() or a
   * load() superseded this call before its result was due.
   */
  generate(settings: MosaicSettings): Promise<GenerateOutput | null> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        resolve(null);
        return;
      }
      this.pending?.resolve(null);
      this.pending = { settings, resolve, reject };
      this.pump();
    });
  }

  /** Starts the worker ahead of the first photo (fetches and parses the engine script). */
  warmUp(): void {
    if (!this.disposed) this.port();
  }

  /** True while a generate is in the worker or waiting to be sent. */
  get busy(): boolean {
    return this.inFlight !== null || this.pending !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dropGenerates();
    for (const l of this.loads) l.resolve(null);
    this.loads.clear();
    for (const w of this.waiting.values()) w.reject(new EngineError('internal', 'engine disposed'));
    this.waiting.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  private dropGenerates(): void {
    this.pending?.resolve(null);
    this.pending = null;
    this.inFlight?.resolve(null);
    this.inFlight = null;
  }

  private pump(): void {
    if (this.disposed || this.loading || this.inFlight || !this.pending) return;
    const job = this.pending;
    this.pending = null;
    const seq = ++this.seq;
    this.inFlight = { seq, resolve: job.resolve, reject: job.reject };
    try {
      this.port().postMessage({ type: 'generate', seq, settings: job.settings }, []);
    } catch (err) {
      this.inFlight = null;
      job.reject(new EngineError('internal', err instanceof Error ? err.message : String(err)));
    }
  }

  private request(msg: EngineRequest, transfer: Transferable[] = []): Promise<EngineResponse> {
    if (this.disposed) return Promise.reject(new EngineError('internal', 'engine disposed'));
    return new Promise((resolve, reject) => {
      this.waiting.set(msg.seq, { resolve, reject });
      try {
        this.port().postMessage(msg, transfer);
      } catch (err) {
        this.waiting.delete(msg.seq);
        reject(new EngineError('internal', err instanceof Error ? err.message : String(err)));
      }
    });
  }

  private port(): WorkerPort {
    if (this.worker) return this.worker;
    const w = this.createWorker();
    w.onmessage = (e) => this.onResponse(e.data);
    w.onerror = (e) => this.onCrash(e.message || 'the engine worker failed');
    this.worker = w;
    return w;
  }

  private onResponse(resp: EngineResponse): void {
    const waiter = this.waiting.get(resp.seq);
    if (waiter) {
      this.waiting.delete(resp.seq);
      waiter.resolve(resp);
      return;
    }
    const job = this.inFlight;
    if (!job || job.seq !== resp.seq) return; // stale: overtaken by a load
    this.inFlight = null;
    if (resp.type === 'result') job.resolve({ result: resp.result, timings: resp.timings });
    else if (resp.type === 'error') job.reject(new EngineError(resp.code, resp.message));
    else job.reject(new EngineError('internal', `unexpected response '${resp.type}' to generate`));
    this.pump();
  }

  /** The worker died (failed to start, or crashed): fail everything; the next request starts a new one. */
  private onCrash(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    const err = new EngineError('internal', message);
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
    this.inFlight?.reject(err);
    this.inFlight = null;
    this.pending?.reject(err);
    this.pending = null;
  }
}
