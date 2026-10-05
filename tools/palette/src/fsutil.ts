import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Writes a file atomically: a temporary file in the same directory, then a rename. Readers (the
 * engine's tests and dev server read the palette while this tool runs) never see a partial file.
 */
export function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Writes only when the content differs, so an unchanged file keeps its mtime. Returns whether it wrote. */
export function writeIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  writeFileAtomic(path, content);
  return true;
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`, { cause: err });
  }
}
