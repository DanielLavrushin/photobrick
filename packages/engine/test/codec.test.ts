import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, fromBase64Url, MAX_SHARE_CHARS, ShareDecodeError, toBase64Url } from '../src/index.ts';
import type { MosaicResult, ShareDecodeReason } from '../src/index.ts';
import { lcg } from './helpers.ts';

const META = { part: '98138', base: 'dbg' };

function randomResult(width: number, height: number, k: number, seed: number): MosaicResult {
  const rnd = lcg(seed);
  const cells = Uint8Array.from({ length: width * height }, () => Math.floor(rnd() * rnd() * k));
  const colorIds = Array.from({ length: k }, (_, i) => (i * 7919) % 65536);
  return { width, height, cells, colorIds };
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const buf = await new Response(new Blob([data.slice()]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return new Uint8Array(buf);
}

/** Share bytes with an arbitrary header and body, for crafting invalid input. */
async function craft(o: { magic?: number[]; version?: number; w: number; h: number; ids: number[]; cells: Uint8Array; body?: Uint8Array }): Promise<string> {
  const head = [...(o.magic ?? [0x50, 0x42]), o.version ?? 1, 5, ...'98138'.split('').map((c) => c.charCodeAt(0)), 3, 100, 98, 103];
  head.push(o.w & 255, o.w >> 8, o.h & 255, o.h >> 8, o.ids.length);
  for (const id of o.ids) head.push(id & 255, id >> 8);
  const body = o.body ?? (await deflateRaw(o.cells));
  const bytes = new Uint8Array(head.length + body.length);
  bytes.set(head);
  bytes.set(body, head.length);
  return toBase64Url(bytes);
}

async function reason(p: Promise<unknown>): Promise<ShareDecodeReason> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ShareDecodeError);
    return (e as ShareDecodeError).reason;
  }
  throw new Error('expected decodeShare to reject');
}

describe('base64url', () => {
  it('matches btoa without padding for every length', () => {
    const rnd = lcg(9);
    for (let n = 0; n < 70; n++) {
      const b = Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
      const ref = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(toBase64Url(b)).toBe(ref);
      expect(Array.from(fromBase64Url(ref))).toEqual(Array.from(b));
    }
  });

  it('rejects padding, other alphabets, bad lengths and non-canonical endings', () => {
    for (const bad of ['AA==', 'A+B/', 'ABCDE', 'AB!D', 'é']) expect(() => fromBase64Url(bad)).toThrow(ShareDecodeError);
    // 'AB' and 'AAB' leave non-zero bits after the last whole byte
    expect(() => fromBase64Url('AB')).toThrow(ShareDecodeError);
    expect(() => fromBase64Url('AAB')).toThrow(ShareDecodeError);
    expect(Array.from(fromBase64Url('AA'))).toEqual([0]);
    expect(Array.from(fromBase64Url(''))).toEqual([]);
  });
});

describe('share codec', () => {
  it('round-trips grids of every size class', async () => {
    const cases: [number, number, number][] = [[1, 1, 1], [16, 16, 2], [64, 48, 38], [48, 96, 40], [256, 256, 255], [256, 1, 7]];
    for (const [w, h, k] of cases) {
      const r = randomResult(w, h, k, w * 1000 + h);
      const s = await encodeShare(r, META);
      expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(s.length).toBeLessThanOrEqual(MAX_SHARE_CHARS);
      const d = await decodeShare(s);
      expect(d.part).toBe('98138');
      expect(d.base).toBe('dbg');
      expect([d.result.width, d.result.height]).toEqual([w, h]);
      expect(d.result.colorIds).toEqual(r.colorIds);
      expect(Array.from(d.result.cells)).toEqual(Array.from(r.cells));
    }
  });

  it('produces identical output for identical input', async () => {
    const r = randomResult(64, 48, 20, 1);
    const a = await encodeShare(r, META), b = await encodeShare({ ...r, cells: r.cells.slice() }, META);
    expect(a).toBe(b);
    expect(a.startsWith(toBase64Url(Uint8Array.from([0x50, 0x42, 1])))).toBe(true);
  });

  it('writes the documented header', async () => {
    const s = await encodeShare({ width: 2, height: 1, cells: Uint8Array.from([0, 1]), colorIds: [0x0102, 15] }, { part: '98138', base: 'dbg' });
    const bytes = fromBase64Url(s);
    expect(Array.from(bytes.subarray(0, 21))).toEqual([0x50, 0x42, 1, 5, 57, 56, 49, 51, 56, 3, 100, 98, 103, 2, 0, 1, 0, 2, 2, 1, 15]);
  });

  it('rejects invalid mosaics on encode', async () => {
    const ok: MosaicResult = { width: 4, height: 1, cells: Uint8Array.from([0, 1, 2, 1]), colorIds: [0, 15, 72] };
    await expect(encodeShare(ok, META)).resolves.toMatch(/^UEIB/);
    await expect(encodeShare({ ...ok, width: 5 }, META)).rejects.toThrow(RangeError);
    await expect(encodeShare({ ...ok, colorIds: [] }, META)).rejects.toThrow(RangeError);
    await expect(encodeShare({ ...ok, colorIds: [1, 1, 2] }, META)).rejects.toThrow(RangeError);
    await expect(encodeShare({ ...ok, colorIds: [1, 2] }, META)).rejects.toThrow(RangeError);
    await expect(encodeShare(ok, { part: '', base: 'dbg' })).rejects.toThrow(RangeError);
    await expect(encodeShare(ok, { part: '98138', base: 'd b' })).rejects.toThrow(RangeError);
    await expect(encodeShare({ width: 257, height: 1, cells: new Uint8Array(257), colorIds: [0] }, META)).rejects.toThrow(RangeError);
  });

  it('rejects corrupt, truncated and oversized input with ShareDecodeError', async () => {
    const r = randomResult(64, 48, 30, 5);
    const good = await encodeShare(r, META);
    const bytes = fromBase64Url(good);

    // truncated anywhere: header or compressed body
    for (const cut of [0, 2, 3, 9, 16, 30, bytes.length - 40, bytes.length - 1]) {
      await expect(decodeShare(toBase64Url(bytes.subarray(0, cut)))).rejects.toThrow(ShareDecodeError);
    }
    // corrupt compressed body
    const bad = bytes.slice();
    for (let i = 90; i < 110; i++) bad[i] ^= 0xa5;
    await expect(decodeShare(toBase64Url(bad))).rejects.toThrow(ShareDecodeError);
    // garbage and non-base64
    expect(await reason(decodeShare('not base64!'))).toBe('base64');
    expect(await reason(decodeShare('A'.repeat(MAX_SHARE_CHARS + 4)))).toBe('too-long');
    expect(await reason(decodeShare(123 as unknown as string))).toBe('format');
    expect(await reason(decodeShare(''))).toBe('truncated');

    const cells = Uint8Array.from([0, 1, 1, 0]);
    expect(await reason(decodeShare(await craft({ magic: [0x50, 0x43], w: 2, h: 2, ids: [0, 15], cells })))).toBe('magic');
    expect(await reason(decodeShare(await craft({ version: 2, w: 2, h: 2, ids: [0, 15], cells })))).toBe('version');
    expect(await reason(decodeShare(await craft({ w: 0, h: 2, ids: [0, 15], cells })))).toBe('size');
    expect(await reason(decodeShare(await craft({ w: 257, h: 2, ids: [0, 15], cells })))).toBe('size');
    expect(await reason(decodeShare(await craft({ w: 2, h: 2, ids: [], cells })))).toBe('colors');
    expect(await reason(decodeShare(await craft({ w: 2, h: 2, ids: [15, 15], cells })))).toBe('colors');
    // a cell index outside the colour table
    expect(await reason(decodeShare(await craft({ w: 2, h: 2, ids: [0, 15], cells: Uint8Array.from([0, 1, 2, 0]) })))).toBe('cells');
    // too few cells, and a body that inflates to more than width * height (decompression bomb)
    expect(await reason(decodeShare(await craft({ w: 2, h: 2, ids: [0, 15], cells: Uint8Array.from([0, 1, 1]) })))).toBe('cells');
    expect(await reason(decodeShare(await craft({ w: 2, h: 2, ids: [0, 15], cells: new Uint8Array(1 << 20) })))).toBe('cells');
    // no body at all, and a body that is not deflate data
    expect(await reason(decodeShare(await craft({ w: 2, h: 2, ids: [0, 15], cells, body: new Uint8Array(0) })))).toBe('truncated');
    expect(await reason(decodeShare(await craft({ w: 2, h: 2, ids: [0, 15], cells, body: Uint8Array.from([0xff, 0xff, 0xff, 0xff]) })))).toBe('deflate');
    // control characters in the part number
    const ctl = fromBase64Url(await craft({ w: 2, h: 2, ids: [0, 15], cells }));
    ctl[4] = 0x0a;
    expect(await reason(decodeShare(toBase64Url(ctl)))).toBe('header');
  });
});
