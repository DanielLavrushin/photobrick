// Main-thread decoding: the fallback when the worker can't decode (no OffscreenCanvas in workers,
// SVG, or a format only <img> understands such as HEIC in Safari), and the compare photo.

import { decodeToBitmap, DecodeError, MAX_WORKING_SIDE, MIN_IMAGE_SIDE, readHead } from './decode.ts';
import { fitWithin, looksLikeHeic } from './sniff.ts';

async function decodeWithImg(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('image has no intrinsic size');
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Any decodable source, as a bitmap (preferred) or an <img>. */
async function decodeAny(blob: Blob, maxSide: number): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await decodeToBitmap(blob, maxSide);
  } catch (err) {
    if (err instanceof DecodeError && err.code === 'too-small') throw err;
    try {
      return await decodeWithImg(blob);
    } catch {
      throw err;
    }
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return src instanceof HTMLImageElement ? { width: src.naturalWidth, height: src.naturalHeight } : { width: src.width, height: src.height };
}

/** Decodes to RGBA pixels (long side <= maxSide) for the worker's 'loadPixels' request. */
export async function decodePixels(blob: Blob, maxSide = MAX_WORKING_SIDE): Promise<{ width: number; height: number; data: ArrayBuffer }> {
  const src = await decodeAny(blob, maxSide);
  try {
    const natural = sizeOf(src);
    const { width, height } = fitWithin(natural.width, natural.height, maxSide);
    if (Math.min(width, height) < MIN_IMAGE_SIDE) throw new DecodeError('too-small', `the image is only ${width} x ${height} pixels`);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new DecodeError('decode', 'no 2D canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    canvas.width = 0;
    canvas.height = 0;
    return { width, height, data: data.buffer as ArrayBuffer };
  } finally {
    if (!(src instanceof HTMLImageElement)) src.close();
  }
}

/**
 * The photo for hold-to-compare: EXIF-oriented, long side at most `maxSide`. Same aspect ratio as the
 * working image (both come from the same oriented size), so crop rectangles map by a plain scale.
 */
export async function decodeCompareBitmap(blob: Blob, maxSide: number): Promise<ImageBitmap> {
  const src = await decodeAny(blob, maxSide);
  if (!(src instanceof HTMLImageElement)) return src;
  const t = fitWithin(src.naturalWidth, src.naturalHeight, maxSide);
  return createImageBitmap(src, { resizeWidth: t.width, resizeHeight: t.height, resizeQuality: 'medium' });
}

/** True when the first bytes of the file are a HEIC/HEIF photo. */
export async function isHeicFile(blob: Blob): Promise<boolean> {
  try {
    return looksLikeHeic(await readHead(blob));
  } catch {
    return false;
  }
}
