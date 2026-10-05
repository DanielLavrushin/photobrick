// Saving generated files. Uses an object URL and a temporary <a download>; never fetch() of a blob:
// URL (the server's CSP blocks it).

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** "IMG_2041 (1).JPG" -> "img-2041-1"; empty -> fallback. */
export function fileStem(name: string | null | undefined, fallback = 'mosaic'): string {
  const stem = (name ?? '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return stem || fallback;
}
