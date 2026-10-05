// Network and cache: the Rebrickable CSV downloads (at most once a day, as the licence asks) and
// the optional Rebrickable API refresh of the external colour ids.

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { get } from 'node:https';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  API_COLORS_URL,
  API_INTERVAL_MS,
  CSV_BASE_URL,
  DOWNLOAD_INTERVAL_MS,
  USER_AGENT,
} from './config.ts';
import { writeFileAtomic } from './fsutil.ts';
import type { CsvName } from './rebrickable.ts';

export type Log = (message: string) => void;

/** Sidecar written next to each download: <name>.csv.gz.meta.json. */
export interface DownloadMeta {
  url: string;
  /** HTTP Last-Modified of the file (or an ISO date when the cache was seeded by hand). */
  lastModified: string | null;
  downloadedAt: string;
}

export function csvPath(cacheDir: string, name: CsvName): string {
  return join(cacheDir, `${name}.csv.gz`);
}

function metaPath(file: string): string {
  return `${file}.meta.json`;
}

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

function request(url: string, headers: Record<string, string>, redirects = MAX_REDIRECTS): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'User-Agent': USER_AGENT, ...headers } }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && typeof location === 'string') {
        res.resume();
        if (redirects === 0) reject(new Error(`GET ${url}: too many redirects`));
        else request(new URL(location, url).href, headers, redirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`GET ${url}: HTTP ${status}`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`GET ${url}: timed out`)));
    req.on('error', reject);
  });
}

function headerValue(v: string | string[] | undefined): string | null {
  return typeof v === 'string' ? v : Array.isArray(v) && v.length > 0 ? v[0] : null;
}

/** Downloads a URL to a file (atomically) and records its Last-Modified in a sidecar. */
export async function downloadFile(url: string, file: string, log: Log): Promise<void> {
  log(`downloading ${url}`);
  const tmp = `${file}.part-${process.pid}`;
  try {
    const res = await request(url, {});
    const lastModified = headerValue(res.headers['last-modified']);
    await pipeline(res, createWriteStream(tmp));
    // A stale sidecar must not outlive the file it describes.
    rmSync(metaPath(file), { force: true });
    renameSync(tmp, file);
    const meta: DownloadMeta = { url, lastModified, downloadedAt: new Date().toISOString() };
    writeFileAtomic(metaPath(file), JSON.stringify(meta, null, 2) + '\n');
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Makes sure every CSV is in the cache. A cached file younger than a day (by mtime) is used as
 * is; an older or missing one is downloaded. Offline, missing files are an error and age is
 * ignored.
 */
export async function ensureCsvCache(
  cacheDir: string,
  names: readonly CsvName[],
  opts: { offline: boolean; now: number; log: Log },
): Promise<void> {
  if (!opts.offline) mkdirSync(cacheDir, { recursive: true });
  for (const name of names) {
    const file = csvPath(cacheDir, name);
    const exists = existsSync(file);
    if (opts.offline) {
      if (!exists) throw new Error(`${file} is missing; run once without --offline to download it`);
      continue;
    }
    if (exists && opts.now - statSync(file).mtimeMs < DOWNLOAD_INTERVAL_MS) {
      opts.log(`using ${name}.csv.gz from the cache (less than a day old)`);
      continue;
    }
    await downloadFile(`${CSV_BASE_URL}${name}.csv.gz`, file, opts.log);
  }
}

/** YYYY-MM-DD (UTC) of an HTTP date or ISO date string, or null if it does not parse. */
export function isoDay(s: string): string | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * The data revision: the Last-Modified date of colors.csv.gz from its download sidecar, or the
 * file's modification date when there is no sidecar.
 */
export function csvRevision(cacheDir: string): string {
  const file = csvPath(cacheDir, 'colors');
  const meta = metaPath(file);
  if (existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, 'utf8')) as Partial<DownloadMeta>;
    const day = typeof m.lastModified === 'string' ? isoDay(m.lastModified) : null;
    if (day !== null) return day;
  }
  return new Date(statSync(file).mtimeMs).toISOString().slice(0, 10);
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await request(url, headers);
  res.setEncoding('utf8');
  let text = '';
  for await (const chunk of res) text += chunk as string;
  return JSON.parse(text) as unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches every colour from the Rebrickable API (paginated, at most one request per second).
 * The key is sent only in the Authorization header and never logged.
 */
export async function fetchApiColors(apiKey: string, log: Log, startUrl = API_COLORS_URL): Promise<unknown[]> {
  const results: unknown[] = [];
  let url: string | null = startUrl;
  for (let page = 0; url !== null; page++) {
    if (page > 0) await sleep(API_INTERVAL_MS);
    log(`fetching ${url}`);
    const body = await getJson(url, { Authorization: `key ${apiKey}`, Accept: 'application/json' });
    if (body === null || typeof body !== 'object' || !Array.isArray((body as { results?: unknown }).results)) {
      throw new Error(`GET ${url}: unexpected response (no results array)`);
    }
    const { results: pageResults, next } = body as { results: unknown[]; next?: unknown };
    results.push(...pageResults);
    url = typeof next === 'string' && next !== '' ? next : null;
  }
  return results;
}
