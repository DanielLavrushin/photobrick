// Share links carry the grid in the URL fragment: <origin><path>#g=<base64url>. The fragment never
// reaches a server, so neither our access log nor a proxy ever sees the mosaic.

export const SHARE_PREFIX = '#g=';
/** Telegram and some chat apps cut or refuse longer links. */
export const LONG_LINK_CHARS = 4000;

/** The share data in a location hash, or null when the hash isn't a share link. */
export function shareDataFromHash(hash: string): string | null {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  const data = hash.slice(SHARE_PREFIX.length).trim();
  return data.length > 0 ? data : '';
}

export function shareUrl(origin: string, pathname: string, data: string): string {
  return `${origin}${pathname}${SHARE_PREFIX}${data}`;
}

/** Removes a share hash from the address bar without a navigation or history entry. */
export function clearShareHash(): void {
  try {
    if (location.hash.startsWith(SHARE_PREFIX)) history.replaceState(history.state, '', location.pathname + location.search);
  } catch {
    // Not fatal: the next load would show the shared mosaic again.
  }
}
