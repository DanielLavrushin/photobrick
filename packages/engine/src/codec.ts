// Share-link codec: the grid (never the photo) as base64url text.
//
// Bytes (version 1):
//   'P' 'B' | u8 version = 1 | u8 partLen, ASCII part | u8 baseLen, ASCII base id |
//   u16le width | u16le height | u8 K | K x u16le Rebrickable colour id | deflate-raw(width*height cells)
// Cells are local indices into the colour ids, 1 byte each, row-major. Compressed bytes are not canonical
// across browsers (WebKit's deflate differs from zlib), so never derive ids from them.

import { MAX_GRID_SIDE } from './presets.ts';
import type { MosaicResult } from './types.ts';

export const SHARE_VERSION = 1;
const MAGIC0 = 0x50, MAGIC1 = 0x42; // 'P', 'B'
/** Longest accepted share text: a 256 x 256 grid stored uncompressed plus the largest header. */
export const MAX_SHARE_CHARS = 96 * 1024;

export type ShareDecodeReason = 'format' | 'base64' | 'too-long' | 'truncated' | 'magic' | 'version' | 'header' | 'size' | 'colors' | 'deflate' | 'cells';

/** Thrown by decodeShare for any input that is not a valid share. */
export class ShareDecodeError extends Error {
  override name = 'ShareDecodeError';
  readonly reason: ShareDecodeReason;

  constructor(reason: ShareDecodeReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------------------------
// base64url without padding (Uint8Array.toBase64 needs Safari 18.2+)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV = /* @__PURE__ */ (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
  }
  if (n - i === 1) {
    const v = bytes[i] << 16;
    s += B64[v >> 18] + B64[(v >> 12) & 63];
  } else if (n - i === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63];
  }
  return s;
}

/** Strict decoder: rejects padding, other alphabets, impossible lengths and non-zero trailing bits. */
export function fromBase64Url(s: string): Uint8Array {
  const n = s.length;
  if (n % 4 === 1) throw new ShareDecodeError('base64', 'invalid base64url length');
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  const val = (j: number): number => {
    const c = s.charCodeAt(j);
    const v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) throw new ShareDecodeError('base64', `invalid base64url character at ${j}`);
    return v;
  };
  let o = 0, j = 0;
  for (; j + 3 < n; j += 4) {
    const v = (val(j) << 18) | (val(j + 1) << 12) | (val(j + 2) << 6) | val(j + 3);
    out[o++] = v >> 16;
    out[o++] = (v >> 8) & 255;
    out[o++] = v & 255;
  }
  const rest = n - j;
  if (rest === 2) {
    const v = (val(j) << 18) | (val(j + 1) << 12);
    if (v & 0xffff) throw new ShareDecodeError('base64', 'non-canonical base64url ending');
    out[o] = v >> 16;
  } else if (rest === 3) {
    const v = (val(j) << 18) | (val(j + 1) << 12) | (val(j + 2) << 6);
    if (v & 0xff) throw new ShareDecodeError('base64', 'non-canonical base64url ending');
    out[o] = v >> 16;
    out[o + 1] = (v >> 8) & 255;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// deflate-raw through the web Compression Streams API

class CapExceeded extends Error {}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, cap: number): Promise<Uint8Array> {
  // Blob.stream() + pipeThrough keeps write-side errors inside the pipe (no unhandled rejections).
  const reader = new Blob([data.slice()]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      await reader.cancel().catch(() => undefined);
      throw new CapExceeded();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

const PRINTABLE = /^[\x21-\x7e]{1,255}$/;

function asciiBytes(s: string, what: string): Uint8Array {
  if (!PRINTABLE.test(s)) throw new RangeError(`encodeShare: ${what} must be 1..255 printable ASCII characters`);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function checkResult(r: MosaicResult): void {
  const { width: w, height: h, cells, colorIds } = r;
  if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= MAX_GRID_SIDE && h <= MAX_GRID_SIDE)) {
    throw new RangeError(`encodeShare: grid must be 1..${MAX_GRID_SIDE} studs per side`);
  }
  if (cells.length !== w * h) throw new RangeError('encodeShare: cells.length must equal width * height');
  const K = colorIds.length;
  if (K < 1 || K > 255) throw new RangeError('encodeShare: 1..255 colours required');
  const seen = new Set<number>();
  for (const id of colorIds) {
    if (!(Number.isInteger(id) && id >= 0 && id <= 0xffff)) throw new RangeError(`encodeShare: colour id ${id} is not a u16`);
    if (seen.has(id)) throw new RangeError(`encodeShare: duplicate colour id ${id}`);
    seen.add(id);
  }
  for (let i = 0; i < cells.length; i++) if (cells[i] >= K) throw new RangeError(`encodeShare: cell ${i} uses colour ${cells[i]} of ${K}`);
}

/** Encodes a mosaic as base64url text for a share link. Throws RangeError on an invalid mosaic. */
export async function encodeShare(result: MosaicResult, meta: { part: string; base: string }): Promise<string> {
  checkResult(result);
  const part = asciiBytes(meta.part, 'part'), base = asciiBytes(meta.base, 'base');
  const K = result.colorIds.length;
  const headerLen = 3 + 1 + part.length + 1 + base.length + 4 + 1 + 2 * K;
  const body = await pipe(result.cells, new CompressionStream('deflate-raw'), Infinity);
  const bytes = new Uint8Array(headerLen + body.length);
  const dv = new DataView(bytes.buffer);
  let o = 0;
  bytes[o++] = MAGIC0;
  bytes[o++] = MAGIC1;
  bytes[o++] = SHARE_VERSION;
  bytes[o++] = part.length;
  bytes.set(part, o);
  o += part.length;
  bytes[o++] = base.length;
  bytes.set(base, o);
  o += base.length;
  dv.setUint16(o, result.width, true);
  dv.setUint16(o + 2, result.height, true);
  o += 4;
  bytes[o++] = K;
  for (const id of result.colorIds) {
    dv.setUint16(o, id, true);
    o += 2;
  }
  bytes.set(body, o);
  return toBase64Url(bytes);
}

/** Decodes share text. Throws ShareDecodeError on anything malformed, truncated, oversized or inconsistent. */
export async function decodeShare(s: string): Promise<{ result: MosaicResult; part: string; base: string }> {
  if (typeof s !== 'string') throw new ShareDecodeError('format', 'share data must be a string');
  if (s.length > MAX_SHARE_CHARS) throw new ShareDecodeError('too-long', 'share data is too long');
  const bytes = fromBase64Url(s);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const need = (k: number): void => {
    if (o + k > bytes.length) throw new ShareDecodeError('truncated', 'share data is truncated');
  };
  const ascii = (what: string): string => {
    need(1);
    const len = bytes[o++];
    need(len);
    let str = '';
    for (let i = 0; i < len; i++) str += String.fromCharCode(bytes[o + i]);
    o += len;
    if (!PRINTABLE.test(str)) throw new ShareDecodeError('header', `invalid ${what}`);
    return str;
  };
  need(3);
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) throw new ShareDecodeError('magic', 'not PhotoBrick share data');
  if (bytes[2] !== SHARE_VERSION) throw new ShareDecodeError('version', `unsupported share version ${bytes[2]}`);
  o = 3;
  const part = ascii('part');
  const base = ascii('base');
  need(5);
  const width = dv.getUint16(o, true), height = dv.getUint16(o + 2, true);
  o += 4;
  if (width < 1 || height < 1 || width > MAX_GRID_SIDE || height > MAX_GRID_SIDE) throw new ShareDecodeError('size', `invalid grid size ${width} x ${height}`);
  const K = bytes[o++];
  if (K < 1) throw new ShareDecodeError('colors', 'no colours');
  need(2 * K);
  const colorIds: number[] = [];
  const seen = new Set<number>();
  for (let k = 0; k < K; k++, o += 2) {
    const id = dv.getUint16(o, true);
    if (seen.has(id)) throw new ShareDecodeError('colors', `duplicate colour id ${id}`);
    seen.add(id);
    colorIds.push(id);
  }
  if (o >= bytes.length) throw new ShareDecodeError('truncated', 'share data has no cells');
  const n = width * height;
  let cells: Uint8Array;
  try {
    cells = await pipe(bytes.subarray(o), new DecompressionStream('deflate-raw'), n);
  } catch (e) {
    if (e instanceof CapExceeded) throw new ShareDecodeError('cells', 'more cells than the grid holds');
    throw new ShareDecodeError('deflate', 'corrupt cell data');
  }
  if (cells.length !== n) throw new ShareDecodeError('cells', `expected ${n} cells, got ${cells.length}`);
  for (let i = 0; i < n; i++) if (cells[i] >= K) throw new ShareDecodeError('cells', `cell ${i} uses colour ${cells[i]} of ${K}`);
  return { result: { width, height, cells, colorIds }, part, base };
}
