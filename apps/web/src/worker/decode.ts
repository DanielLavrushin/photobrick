// Decoding an image file to an EXIF-oriented ImageBitmap no larger than the working size.
// Uses only APIs that exist both in workers and on the main thread (no DOM).

import { fitWithin, looksLikeHeic, orientedSize, sniffImage, SNIFF_BYTES } from './sniff.ts';

/** Long side of the working image the engine resamples from (docs/ARCHITECTURE.md, "Ingest"). */
export const MAX_WORKING_SIDE = 2048;
/** Smaller images can't make a meaningful mosaic. */
export const MIN_IMAGE_SIDE = 16;

export type DecodeErrorCode = 'heic' | 'decode' | 'too-small';

export class DecodeError extends Error {
  override name = 'DecodeError';
  readonly code: DecodeErrorCode;

  constructor(code: DecodeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export async function readHead(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
}

/**
 * createImageBitmap resized to exactly width x height in displayed (oriented) pixels. A browser that
 * resizes before applying the EXIF rotation hands back the size swapped; then ask the other way round.
 */
async function resizedBitmap(source: ImageBitmapSource, width: number, height: number): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions = { imageOrientation: 'from-image', resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' };
  const bmp = await createImageBitmap(source, opts);
  if (bmp.width === width && bmp.height === height) return bmp;
  if (bmp.width === height && bmp.height === width) {
    bmp.close();
    return createImageBitmap(source, { ...opts, resizeWidth: height, resizeHeight: width });
  }
  return bmp;
}

/**
 * Decodes `blob` into an EXIF-oriented bitmap whose long side is at most `maxSide`. When the header
 * gives the size, the browser decodes straight to the target size (resizeQuality 'medium': 'high' is
 * worse than 'low' in WebKit). Throws DecodeError: 'heic' for HEIC/HEIF files the browser can't
 * decode, 'decode' for anything else it can't read, 'too-small' below MIN_IMAGE_SIDE.
 */
export async function decodeToBitmap(blob: Blob, maxSide = MAX_WORKING_SIDE): Promise<ImageBitmap> {
  const head = await readHead(blob);
  const known = orientedSize(sniffImage(head));
  let bmp: ImageBitmap;
  try {
    const target = known ? fitWithin(known.width, known.height, maxSide) : null;
    bmp = known && target && target.width < known.width
      ? await resizedBitmap(blob, target.width, target.height)
      : await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (err) {
    if (looksLikeHeic(head)) throw new DecodeError('heic', 'this browser cannot decode HEIC/HEIF images', { cause: err });
    throw new DecodeError('decode', 'the file could not be decoded as an image', { cause: err });
  }
  if (Math.max(bmp.width, bmp.height) > maxSide) {
    // Unknown or wrong header size: resize the decoded bitmap instead.
    const t = fitWithin(bmp.width, bmp.height, maxSide);
    const big = bmp;
    try {
      bmp = await createImageBitmap(big, { resizeWidth: t.width, resizeHeight: t.height, resizeQuality: 'medium' });
    } finally {
      big.close();
    }
  }
  if (Math.min(bmp.width, bmp.height) < MIN_IMAGE_SIDE) {
    const { width, height } = bmp;
    bmp.close();
    throw new DecodeError('too-small', `the image is only ${width} x ${height} pixels`);
  }
  return bmp;
}
