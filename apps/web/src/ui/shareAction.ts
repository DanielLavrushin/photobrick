// "Copy share link": the grid (never the photo) encoded into the URL fragment.

import type { TFunction } from 'i18next';
import type { MosaicResult } from '@photobrick/engine';
import { fmtInt } from '../lib/format.ts';
import { PALETTE } from '../lib/palette.ts';
import { LONG_LINK_CHARS } from '../share/hash.ts';
import { useUi } from '../state/ui.ts';

function prefersNativeShare(): boolean {
  try {
    return typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Builds the link, then shares it (phones) or copies it, with a toast. Never throws. */
export async function shareMosaic(result: MosaicResult, baseId: string, t: TFunction): Promise<string | null> {
  const { notify, setManualShareUrl } = useUi.getState();
  let url: string;
  try {
    const { buildShareUrl } = await import('../share/codec.ts');
    url = await buildShareUrl(result, { part: PALETTE.part, base: baseId });
  } catch (err) {
    console.error('[photobrick] share link failed', err);
    notify(t('share.failed'), 'error');
    return null;
  }
  const long = url.length > LONG_LINK_CHARS;
  const longNote = long ? ` ${t('share.longWarning', { n: fmtInt(url.length) })}` : '';

  if (prefersNativeShare()) {
    try {
      await navigator.share({ title: t('share.title'), text: t('share.text'), url });
      if (long) notify(t('share.longWarning', { n: fmtInt(url.length) }), 'warning');
      return url;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return url;
      // Fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    notify(`${t('share.copied')}${longNote}`, long ? 'warning' : 'success');
  } catch {
    setManualShareUrl(url);
  }
  return url;
}
