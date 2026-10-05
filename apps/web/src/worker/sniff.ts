// Image header sniffing: format, pixel size and EXIF orientation from the first bytes of a file.
// Pure functions over bytes (no DOM), shared by the engine worker and the main-thread fallback.
//
// Knowing the size before decoding lets createImageBitmap decode straight to the working size
// (Chrome decodes large JPEGs at 1/2, 1/4 or 1/8 scale), instead of holding a full 50 MP image.

export type ImageKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'unknown';

export interface ImageHeader {
  kind: ImageKind;
  /** Stored (not oriented) size, when the header was found in the bytes read. */
  width?: number;
  height?: number;
  /** EXIF orientation 1..8 (JPEG only); 5..8 swap width and height. */
  orientation?: number;
}

/** Bytes to read from the start of a file: enough for the SOF marker behind big EXIF / ICC blocks. */
export const SNIFF_BYTES = 256 * 1024;

/** HEIF brands of HEIC/HEVC stills and image sequences. AVIF (also HEIF) decodes in browsers. */
const HEIC_MAJOR = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const HEIC_COMPATIBLE = new Set(['heic', 'heix', 'hevc', 'hevx']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

/** 'heic' | 'avif' | null from an ISO BMFF 'ftyp' box at the start of the file. */
export function heifKind(b: Uint8Array): 'heic' | 'avif' | null {
  if (b.length < 16 || ascii(b, 4, 4) !== 'ftyp') return null;
  const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  const end = Math.min(b.length, size >= 16 ? size : 16);
  const major = ascii(b, 8, 4);
  const compatible: string[] = [];
  for (let o = 16; o + 4 <= end; o += 4) compatible.push(ascii(b, o, 4));
  if (AVIF_BRANDS.has(major) || (!HEIC_MAJOR.has(major) && compatible.some((c) => AVIF_BRANDS.has(c)))) return 'avif';
  if (HEIC_MAJOR.has(major) || compatible.some((c) => HEIC_COMPATIBLE.has(c))) return 'heic';
  return null;
}

/** True for HEIC/HEIF photos (e.g. iPhone "High Efficiency"), false for AVIF and everything else. */
export function looksLikeHeic(b: Uint8Array): boolean {
  return heifKind(b) === 'heic';
}

function u16(b: Uint8Array, o: number, le: boolean): number {
  return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
}

function u32(b: Uint8Array, o: number, le: boolean): number {
  return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** Orientation tag (0x0112) from an EXIF APP1 payload starting at `o` ("Exif\0\0" + TIFF). */
function exifOrientation(b: Uint8Array, o: number, end: number): number | undefined {
  if (ascii(b, o, 4) !== 'Exif' || b[o + 4] !== 0 || b[o + 5] !== 0) return undefined;
  const t = o + 6;
  if (t + 8 > end) return undefined;
  const order = ascii(b, t, 2);
  if (order !== 'II' && order !== 'MM') return undefined;
  const le = order === 'II';
  if (u16(b, t + 2, le) !== 42) return undefined;
  const ifd = t + u32(b, t + 4, le);
  if (ifd + 2 > end) return undefined;
  const n = u16(b, ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return undefined;
    if (u16(b, e, le) === 0x0112) {
      const v = u16(b, e + 8, le);
      return v >= 1 && v <= 8 ? v : undefined;
    }
  }
  return undefined;
}

function sniffJpeg(b: Uint8Array): ImageHeader {
  const h: ImageHeader = { kind: 'jpeg' };
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return h;
    const marker = b[o + 1];
    if (marker === 0xff) {
      o++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return h; // end of image / start of scan: no SOF found
    const len = (b[o + 2] << 8) | b[o + 3];
    if (len < 2) return h;
    const seg = o + 4;
    const end = Math.min(b.length, o + 2 + len);
    if (marker === 0xe1 && h.orientation === undefined) h.orientation = exifOrientation(b, seg, end);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (seg + 5 <= b.length) {
        h.height = (b[seg + 1] << 8) | b[seg + 2];
        h.width = (b[seg + 3] << 8) | b[seg + 4];
      }
      return h;
    }
    o += 2 + len;
  }
  return h;
}

function sniffWebp(b: Uint8Array): ImageHeader {
  const h: ImageHeader = { kind: 'webp' };
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) {
    h.width = u16(b, 26, true) & 0x3fff;
    h.height = u16(b, 28, true) & 0x3fff;
  } else if (chunk === 'VP8L' && b.length >= 25) {
    const bits = u32(b, 21, true);
    h.width = (bits & 0x3fff) + 1;
    h.height = ((bits >> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8X' && b.length >= 30) {
    h.width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    h.height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
  }
  return h;
}

/** Format, stored size and orientation from the first bytes of an image file. */
export function sniffImage(b: Uint8Array): ImageHeader {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return sniffJpeg(b);
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    return { kind: 'png', width: u32(b, 16, false), height: u32(b, 20, false) };
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) {
    return { kind: 'gif', width: u16(b, 6, true), height: u16(b, 8, true) };
  }
  if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return sniffWebp(b);
  const heif = heifKind(b);
  if (heif) return { kind: heif };
  return { kind: 'unknown' };
}

/** The displayed (EXIF-oriented) size from a header, or null when the header had no size. */
export function orientedSize(h: ImageHeader): { width: number; height: number } | null {
  if (!h.width || !h.height) return null;
  const swap = h.orientation !== undefined && h.orientation >= 5;
  return swap ? { width: h.height, height: h.width } : { width: h.width, height: h.height };
}

/** Size with the long side at most `maxSide` (never enlarged), aspect ratio kept. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const s = Math.min(1, maxSide / Math.max(width, height));
  if (s >= 1) return { width, height };
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}
