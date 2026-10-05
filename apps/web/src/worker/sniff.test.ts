import { describe, expect, it } from 'vitest';
import { fitWithin, heifKind, looksLikeHeic, orientedSize, sniffImage } from './sniff.ts';

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const u32be = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function ftyp(major: string, compatible: string[]): Uint8Array {
  const size = 16 + 4 * compatible.length;
  return Uint8Array.from([...u32be(size), ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii), 0, 0, 0, 0]);
}

/** A minimal JPEG: SOI, APP1 EXIF with one IFD entry (orientation), SOF0 with the size. */
function jpeg(width: number, height: number, orientation?: number, littleEndian = false): Uint8Array {
  const u16 = (n: number) => (littleEndian ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (littleEndian ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : u32be(n));
  const bytes: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    const tiff = [...ascii(littleEndian ? 'II' : 'MM'), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
    const payload = [...ascii('Exif'), 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload);
  }
  // APP0 JFIF before SOF, to make sure other segments are skipped.
  bytes.push(0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0);
  bytes.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xff, 0xda, 0, 2);
  return Uint8Array.from(bytes);
}

describe('heif brands', () => {
  it('detects HEIC from the major brand and from compatible brands', () => {
    expect(looksLikeHeic(ftyp('heic', ['mif1', 'heic']))).toBe(true);
    expect(looksLikeHeic(ftyp('heix', []))).toBe(true);
    expect(looksLikeHeic(ftyp('mif1', ['heic']))).toBe(true);
    expect(looksLikeHeic(ftyp('msf1', ['hevc']))).toBe(true);
    expect(looksLikeHeic(ftyp('isom', ['hevx']))).toBe(true);
  });

  it('does not call AVIF HEIC, although AVIF also lists mif1', () => {
    expect(heifKind(ftyp('avif', ['mif1', 'miaf']))).toBe('avif');
    expect(heifKind(ftyp('avis', ['msf1']))).toBe('avif');
    expect(looksLikeHeic(ftyp('avif', ['mif1', 'miaf', 'MA1B']))).toBe(false);
  });

  it('ignores files without an ftyp box', () => {
    expect(looksLikeHeic(jpeg(10, 10))).toBe(false);
    expect(looksLikeHeic(new Uint8Array(0))).toBe(false);
    expect(looksLikeHeic(ftyp('mp42', ['isom']))).toBe(false);
  });
});

describe('sniffImage', () => {
  it('reads JPEG size and EXIF orientation in both byte orders', () => {
    expect(sniffImage(jpeg(4032, 3024, 6))).toEqual({ kind: 'jpeg', width: 4032, height: 3024, orientation: 6 });
    expect(sniffImage(jpeg(4032, 3024, 3, true))).toEqual({ kind: 'jpeg', width: 4032, height: 3024, orientation: 3 });
    expect(sniffImage(jpeg(640, 480))).toEqual({ kind: 'jpeg', width: 640, height: 480 });
  });

  it('swaps width and height for orientations 5..8', () => {
    expect(orientedSize(sniffImage(jpeg(4032, 3024, 6)))).toEqual({ width: 3024, height: 4032 });
    expect(orientedSize(sniffImage(jpeg(4032, 3024, 8)))).toEqual({ width: 3024, height: 4032 });
    expect(orientedSize(sniffImage(jpeg(4032, 3024, 2)))).toEqual({ width: 4032, height: 3024 });
  });

  it('gives no size for a JPEG cut before its SOF marker', () => {
    const full = jpeg(800, 600, 1);
    const cut = full.slice(0, full.length - 25);
    expect(orientedSize(sniffImage(cut))).toBeNull();
  });

  it('reads PNG, GIF and WebP sizes', () => {
    const png = Uint8Array.from([0x89, ...ascii('PNG'), 13, 10, 26, 10, 0, 0, 0, 13, ...ascii('IHDR'), ...u32be(1920), ...u32be(1080), 8, 6, 0, 0, 0]);
    expect(sniffImage(png)).toEqual({ kind: 'png', width: 1920, height: 1080 });
    const gif = Uint8Array.from([...ascii('GIF89a'), 64, 1, 200, 0, 0]);
    expect(sniffImage(gif)).toEqual({ kind: 'gif', width: 320, height: 200 });
    const vp8x = Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, 0xff, 0x0f, 0, 0x37, 0x0b, 0]);
    expect(sniffImage(vp8x)).toEqual({ kind: 'webp', width: 4096, height: 2872 });
  });

  it('returns unknown for other data', () => {
    expect(sniffImage(Uint8Array.from(ascii('hello world, not an image')))).toEqual({ kind: 'unknown' });
  });
});

describe('fitWithin', () => {
  it('scales the long side down and never enlarges', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 10, 2048)).toEqual({ width: 2048, height: 2 });
  });
});
