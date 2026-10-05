// build-palette: builds packages/engine/src/palette/<part>.json from the Rebrickable CSV downloads
// and the snapshots in tools/palette/data. See tools/palette/README.md.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCodeBook, serializeCodeBook } from './codes.ts';
import { DEFAULT_PART, DEFAULT_RULES, PARTS, type PaletteRules } from './config.ts';
import { csvPath, csvRevision, ensureCsvCache, fetchApiColors } from './download.ts';
import { readJson, writeIfChanged } from './fsutil.ts';
import { buildPalette, serializePalette, type PaletteBuild } from './palette.ts';
import { CSV_FILES, loadDataset } from './rebrickable.ts';
import {
  externalFromApi,
  parseBrickLinkSnapshot,
  parseColorsExternal,
  parsePabSnapshot,
  serializeColorsExternal,
  type BrickLinkSnapshot,
  type PabSnapshot,
} from './snapshots.ts';

const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(TOOL_DIR, '../..');
const DATA_DIR = join(TOOL_DIR, 'data');
const PALETTE_DIR = join(REPO_ROOT, 'packages/engine/src/palette');
const CODES_FILE = join(DATA_DIR, 'codes.json');
const EXTERNAL_FILE = join(DATA_DIR, 'colors-external.json');

const USAGE = `Usage: build-palette [options]

  --part <p>             Rebrickable part to build (repeatable or comma-separated;
                         known: ${Object.keys(PARTS).join(', ')}; default ${DEFAULT_PART})
  --offline              use the cached CSV files only, never touch the network
  --min-year <year>      a colour is current if it is in a set from this year on (default ${DEFAULT_RULES.minYear})
  --out <file>           output file (one part only; default packages/engine/src/palette/<part>.json)
  --cache <dir>          CSV cache directory (default tools/palette/.cache)
  --external-from <file> rebuild data/colors-external.json from a saved /api/v3/lego/colors/ response
  -h, --help             show this help

Set REBRICKABLE_API_KEY to refresh data/colors-external.json from the Rebrickable API
(skipped with --offline).`;

interface CliOptions {
  parts: string[];
  offline: boolean;
  minYear: number;
  out: string | null;
  cacheDir: string;
  externalFrom: string | null;
  help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[], cwd: string): CliOptions {
  const opts: CliOptions = {
    parts: [],
    offline: false,
    minYear: DEFAULT_RULES.minYear,
    out: null,
    cacheDir: join(TOOL_DIR, '.cache'),
    externalFrom: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const value = (): string => {
      if (eq > 0) return arg.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--part':
        opts.parts.push(...value().split(',').filter((p) => p !== ''));
        break;
      case '--offline':
        opts.offline = true;
        break;
      case '--min-year': {
        const v = value();
        const year = Number(v);
        if (!/^\d{4}$/.test(v) || year < 1949 || year > 2100) throw new UsageError(`bad --min-year ${v}`);
        opts.minYear = year;
        break;
      }
      case '--out':
        opts.out = resolve(cwd, value());
        break;
      case '--cache':
        opts.cacheDir = resolve(cwd, value());
        break;
      case '--external-from':
        opts.externalFrom = resolve(cwd, value());
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new UsageError(`unknown option ${arg}`);
    }
  }
  if (opts.parts.length === 0) opts.parts.push(DEFAULT_PART);
  opts.parts = [...new Set(opts.parts)];
  for (const p of opts.parts) {
    if (PARTS[p] === undefined) throw new UsageError(`unknown part ${p} (known: ${Object.keys(PARTS).join(', ')})`);
  }
  if (opts.out !== null && opts.parts.length > 1) throw new UsageError('--out needs exactly one --part');
  return opts;
}

function log(message: string): void {
  process.stderr.write(message + '\n');
}

function show(path: string): string {
  return relative(REPO_ROOT, path) || path;
}

async function updateExternalIds(opts: CliOptions): Promise<void> {
  let results: unknown[] | null = null;
  if (opts.externalFrom !== null) {
    const json = readJson(opts.externalFrom);
    const list = Array.isArray(json) ? json : (json as { results?: unknown } | null)?.results;
    if (!Array.isArray(list)) throw new Error(`${opts.externalFrom}: expected an API colors response`);
    results = list;
  } else {
    const key = process.env.REBRICKABLE_API_KEY;
    if (key !== undefined && key !== '' && !opts.offline) results = await fetchApiColors(key, log);
  }
  if (results === null) return;
  const changed = writeIfChanged(EXTERNAL_FILE, serializeColorsExternal(externalFromApi(results)));
  log(`${show(EXTERNAL_FILE)}: ${results.length} colours, ${changed ? 'updated' : 'unchanged'}`);
}

function report(build: PaletteBuild): void {
  const { palette, selected } = build;
  const byTier = { core: 0, extended: 0, rare: 0 };
  for (const c of palette.colors) byTier[c.tier]++;
  const onPab = palette.colors.filter((c) => c.pab).length;
  const enabled = palette.colors.filter((c) => c.defaultEnabled).length;
  log(
    `\n${palette.part} ${palette.partName}: ${palette.colors.length} colours ` +
      `(core ${byTier.core}, extended ${byTier.extended}, rare ${byTier.rare}), ` +
      `${enabled} enabled by default, ${onPab} on Pick a Brick, rev ${palette.rev}`,
  );
  for (let i = 0; i < palette.colors.length; i++) {
    const c = palette.colors[i];
    const u = selected[i].usage;
    log(
      `  ${c.code}  ${String(c.id).padStart(4)}  ${c.name.padEnd(22)} ${String(u.qty).padStart(6)} pcs ` +
        `${String(u.sets).padStart(4)} sets  last ${u.lastYear}  ${c.tier.padEnd(8)} ` +
        `${c.pab ? 'PaB' : '   '} ${c.defaultEnabled ? 'on ' : 'off'} ${c.elementId ?? '-'}`,
    );
  }
  for (const r of build.rejected) log(`  skipped ${String(r.id).padStart(4)} ${r.name}: ${r.reason}`);
  for (const a of build.added) log(`  new code ${a.code} for ${a.id} ${a.name}`);
  for (const w of build.warnings) log(`  warning: ${w}`);
}

async function main(argv: readonly string[]): Promise<void> {
  const opts = parseArgs(argv, process.env.INIT_CWD ?? process.cwd());
  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }
  const rules: PaletteRules = { ...DEFAULT_RULES, minYear: opts.minYear };

  await updateExternalIds(opts);
  await ensureCsvCache(opts.cacheDir, CSV_FILES, { offline: opts.offline, now: Date.now(), log });
  const rev = csvRevision(opts.cacheDir);
  const started = Date.now();
  const dataset = await loadDataset((name) => csvPath(opts.cacheDir, name), opts.parts);
  log(`read the Rebrickable CSV files (rev ${rev}) in ${Date.now() - started} ms`);

  const external = parseColorsExternal(readJson(EXTERNAL_FILE));
  const pabCache = new Map<string, PabSnapshot>();
  const blCache = new Map<string, BrickLinkSnapshot>();
  const pabSnapshot = (file: string): PabSnapshot => {
    let s = pabCache.get(file);
    if (s === undefined) pabCache.set(file, (s = parsePabSnapshot(readJson(join(DATA_DIR, file)), file)));
    return s;
  };
  const blSnapshot = (file: string): BrickLinkSnapshot => {
    let s = blCache.get(file);
    if (s === undefined) blCache.set(file, (s = parseBrickLinkSnapshot(readJson(join(DATA_DIR, file)), file)));
    return s;
  };

  const initialCodes = parseCodeBook(readJson(CODES_FILE));
  let codes = initialCodes;
  const builds: PaletteBuild[] = [];
  for (const part of opts.parts) {
    const config = PARTS[part];
    const build = buildPalette({
      config,
      rules,
      dataset,
      external,
      codes,
      rev,
      pab: config.pab === null ? null : pabSnapshot(config.pab),
      brickLink: config.brickLink === null ? null : blSnapshot(config.brickLink),
      blDefault: blSnapshot(config.blDefault),
    });
    codes = build.codes;
    builds.push(build);
    report(build);
  }

  // Codes first: a palette must never reference a code that codes.json does not reserve.
  if (codes.size !== initialCodes.size) {
    writeIfChanged(CODES_FILE, serializeCodeBook(codes));
    log(`\n${show(CODES_FILE)}: ${codes.size - initialCodes.size} new code(s)`);
  }
  for (const build of builds) {
    const out = opts.out ?? join(PALETTE_DIR, `${build.palette.part}.json`);
    const changed = writeIfChanged(out, serializePalette(build.palette));
    log(`${show(out)}: ${changed ? 'written' : 'unchanged'}`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof UsageError) log(`build-palette: ${err.message}\n\n${USAGE}`);
  else log(`build-palette: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
