import { defaultSettings, type MosaicSettings } from '@photobrick/engine';
import { describe, expect, it } from 'vitest';
import { EngineClient, EngineError, type WorkerPort } from './client.ts';
import type { EngineRequest, EngineResponse } from './protocol.ts';

/** A worker that records requests; the test answers them by hand. */
class FakeWorker implements WorkerPort {
  onmessage: ((e: MessageEvent<EngineResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: EngineRequest[] = [];
  terminated = false;
  postMessage(message: EngineRequest): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(msg: EngineResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<EngineResponse>);
  }
  last<T extends EngineRequest['type']>(type: T): Extract<EngineRequest, { type: T }> {
    const found = [...this.sent].reverse().find((m) => m.type === type);
    if (!found) throw new Error(`no ${type} request`);
    return found as Extract<EngineRequest, { type: T }>;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const result = (seq: number): EngineResponse => ({
  type: 'result',
  seq,
  result: { width: 1, height: 1, cells: new Uint8Array([0]), colorIds: [seq] },
  timings: { resampleMs: 0, adjustMs: 0, quantizeMs: 0, postMs: 0, totalMs: 0 },
});
const settings = (dither: number): MosaicSettings => ({ ...defaultSettings(100, 100), dither });

function setup(decodePixels = async () => ({ width: 32, height: 32, data: new ArrayBuffer(32 * 32 * 4) })) {
  const w = new FakeWorker();
  const client = new EngineClient({ createWorker: () => w, decodePixels });
  return { w, client };
}

async function loaded(w: FakeWorker, client: EngineClient) {
  const p = client.load(new Blob(['x']));
  await tick();
  const req = w.last('load');
  w.reply({ type: 'loaded', seq: req.seq, width: 200, height: 100 });
  return p;
}

describe('EngineClient', () => {
  it('loads and reports the working image size', async () => {
    const { w, client } = setup();
    await expect(loaded(w, client)).resolves.toEqual({ width: 200, height: 100 });
  });

  it('keeps one generate in flight; a call replaced before sending resolves with null', async () => {
    const { w, client } = setup();
    await loaded(w, client);
    const a = client.generate(settings(0.1));
    const b = client.generate(settings(0.2));
    const c = client.generate(settings(0.3));
    expect(w.sent.filter((m) => m.type === 'generate')).toHaveLength(1);
    await expect(b).resolves.toBeNull();
    const first = w.last('generate');
    expect(first.settings.dither).toBe(0.1);
    w.reply(result(first.seq));
    expect((await a)?.result.colorIds).toEqual([first.seq]);
    // The newest pending call is sent as soon as the worker is free.
    const second = w.last('generate');
    expect(second.settings.dither).toBe(0.3);
    expect(client.busy).toBe(true);
    w.reply(result(second.seq));
    expect((await c)?.result.colorIds).toEqual([second.seq]);
    expect(client.busy).toBe(false);
  });

  it('a load overtakes pending and in-flight generates, and stale results are dropped', async () => {
    const { w, client } = setup();
    await loaded(w, client);
    const a = client.generate(settings(0.1));
    const inFlight = w.last('generate');
    const b = client.generate(settings(0.2));
    const next = client.load(new Blob(['y']));
    await expect(a).resolves.toBeNull();
    await expect(b).resolves.toBeNull();
    // The old image's result arrives late and is ignored.
    w.reply(result(inFlight.seq));
    const c = client.generate(settings(0.5));
    await tick();
    expect(w.sent.filter((m) => m.type === 'generate')).toHaveLength(1); // waits for the load
    w.reply({ type: 'loaded', seq: w.last('load').seq, width: 50, height: 60 });
    await expect(next).resolves.toEqual({ width: 50, height: 60 });
    await tick();
    const after = w.last('generate');
    expect(after.settings.dither).toBe(0.5);
    w.reply(result(after.seq));
    expect((await c)?.result.colorIds).toEqual([after.seq]);
  });

  it('a newer load resolves the older one with null', async () => {
    const { w, client } = setup();
    const first = client.load(new Blob(['a']));
    await tick();
    const second = client.load(new Blob(['b']));
    await expect(first).resolves.toBeNull();
    await tick();
    w.reply({ type: 'loaded', seq: w.last('load').seq, width: 10, height: 20 });
    await expect(second).resolves.toEqual({ width: 10, height: 20 });
  });

  it('falls back to main-thread pixels when the worker cannot decode', async () => {
    const { w, client } = setup();
    const p = client.load(new Blob(['svg']));
    await tick();
    w.reply({ type: 'error', seq: w.last('load').seq, code: 'decode', message: 'no OffscreenCanvas' });
    await tick();
    const px = w.last('loadPixels');
    expect([px.width, px.height, px.data.byteLength]).toEqual([32, 32, 32 * 32 * 4]);
    w.reply({ type: 'loaded', seq: px.seq, width: 32, height: 32 });
    await expect(p).resolves.toEqual({ width: 32, height: 32 });
  });

  it('reports heic when neither the worker nor the main thread can decode', async () => {
    const { w, client } = setup(async () => {
      throw new Error('nope');
    });
    const p = client.load(new Blob(['heic']));
    await tick();
    w.reply({ type: 'error', seq: w.last('load').seq, code: 'heic', message: 'heic' });
    await expect(p).rejects.toMatchObject({ code: 'heic' });
    await expect(p).rejects.toBeInstanceOf(EngineError);
  });

  it('passes too-small through without a fallback', async () => {
    const { w, client } = setup();
    const p = client.load(new Blob(['tiny']));
    await tick();
    w.reply({ type: 'error', seq: w.last('load').seq, code: 'too-small', message: '8 x 8' });
    await expect(p).rejects.toMatchObject({ code: 'too-small' });
    expect(w.sent.some((m) => m.type === 'loadPixels')).toBe(false);
  });

  it('rejects everything when the worker crashes, and starts a new worker next time', async () => {
    let made = 0;
    const workers: FakeWorker[] = [];
    const client = new EngineClient({
      createWorker: () => {
        made++;
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
    });
    const p = client.load(new Blob(['x']));
    await tick();
    workers[0].onerror?.({ message: 'boom' } as ErrorEvent);
    await expect(p).rejects.toMatchObject({ code: 'internal' });
    expect(workers[0].terminated).toBe(true);
    void client.load(new Blob(['y']));
    await tick();
    expect(made).toBe(2);
  });
});
