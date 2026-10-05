// Lazy-loaded share-link encoding/decoding (keeps the codec and CompressionStream code out of the
// initial bundle).

import { decodeShare, encodeShare, type MosaicResult } from '@photobrick/engine';
import { shareUrl } from './hash.ts';

export async function buildShareUrl(result: MosaicResult, meta: { part: string; base: string }): Promise<string> {
  const data = await encodeShare(result, meta);
  return shareUrl(location.origin, location.pathname, data);
}

export { decodeShare };
