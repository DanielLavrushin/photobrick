// The committed data snapshots in tools/palette/data/: their types, validation and serialisation.

export interface ExternalIds {
  /** BrickLink colour id. */
  blId: number | null;
  /** BrickLink colour name (e.g. 'Neon Yellow' for Rebrickable 'Vibrant Yellow'). */
  blName: string | null;
  /** LEGO's own colour id. */
  legoId: number | null;
}

/** Rebrickable colour id -> external ids (data/colors-external.json). */
export type ColorsExternal = ReadonlyMap<number, ExternalIds>;

/** Status of a Pick a Brick element that can be bought. Any other status counts as not sold. */
export const PAB_SOLD_STATUS = 'AVAILABLE';

export interface PabElement {
  /** LEGO element id. */
  elementId: string;
  /** Rebrickable colour id. */
  colorId: number;
  /** Rebrickable colour name, for readability. */
  name: string;
  priceDkk: number;
  status: string;
  note?: string;
}

/** A Pick a Brick price list for one part (data/pab-dk-<part>.json). */
export interface PabSnapshot {
  source: string;
  /** ISO date the prices were read. */
  date: string;
  /** Pick a Brick country, e.g. 'DK'. */
  market: string;
  currency: 'DKK';
  /** Rebrickable part number. */
  part: string;
  /** LEGO design id searched on Pick a Brick. */
  designId: string;
  elements: PabElement[];
}

export interface BrickLinkRow {
  blColorId: number;
  blColorName: string;
  /** Last 6 months, new: number of sales, pieces sold and quantity-weighted average price. */
  soldNewTimes: number;
  soldNewQty: number;
  soldNewQtyAvgDkk: number;
  /** Current listings, new: lots, pieces, minimum and quantity-weighted average price. */
  stockNewLots: number;
  stockNewQty: number;
  stockNewMinDkk: number;
  stockNewQtyAvgDkk: number;
}

/** A BrickLink price-guide sample for one part (data/bricklink-prices-<part>.json). */
export interface BrickLinkSnapshot {
  source: string;
  date: string;
  currency: 'DKK';
  /** BrickLink item number. */
  blPart: string;
  rows: BrickLinkRow[];
}

// ---------------------------------------------------------------------------------------------
// Validation

type Json = Record<string, unknown>;

function obj(v: unknown, what: string): Json {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: expected an object`);
  return v as Json;
}

function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${what}: expected an array`);
  return v;
}

function str(o: Json, key: string, what: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new Error(`${what}.${key}: expected a non-empty string`);
  return v;
}

function num(o: Json, key: string, what: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what}.${key}: expected a number`);
  return v;
}

function int(o: Json, key: string, what: string): number {
  const v = num(o, key, what);
  if (!Number.isInteger(v)) throw new Error(`${what}.${key}: expected an integer`);
  return v;
}

function nullable<T>(o: Json, key: string, what: string, read: (o: Json, key: string, what: string) => T): T | null {
  return o[key] === null ? null : read(o, key, what);
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function date(o: Json, key: string, what: string): string {
  const v = str(o, key, what);
  if (!isIsoDate(v)) throw new Error(`${what}.${key}: expected an ISO date (YYYY-MM-DD), got ${v}`);
  return v;
}

function dkk(o: Json, what: string): 'DKK' {
  if (o.currency !== 'DKK') throw new Error(`${what}.currency: only DKK snapshots are supported`);
  return 'DKK';
}

export function parseColorsExternal(json: unknown): Map<number, ExternalIds> {
  const o = obj(json, 'colors-external.json');
  const out = new Map<number, ExternalIds>();
  for (const [key, value] of Object.entries(o)) {
    const what = `colors-external.json[${key}]`;
    if (!/^-?\d+$/.test(key)) throw new Error(`${what}: key must be a Rebrickable colour id`);
    const e = obj(value, what);
    out.set(Number(key), {
      blId: nullable(e, 'blId', what, int),
      blName: nullable(e, 'blName', what, str),
      legoId: nullable(e, 'legoId', what, int),
    });
  }
  return out;
}

export function parsePabSnapshot(json: unknown, what: string): PabSnapshot {
  const o = obj(json, what);
  const seen = new Set<string>();
  const elements = arr(o.elements, `${what}.elements`).map((v, i): PabElement => {
    const w = `${what}.elements[${i}]`;
    const e = obj(v, w);
    const elementId = str(e, 'elementId', w);
    if (!/^\d+$/.test(elementId)) throw new Error(`${w}.elementId: expected digits`);
    if (seen.has(elementId)) throw new Error(`${w}: element ${elementId} is listed twice`);
    seen.add(elementId);
    const priceDkk = num(e, 'priceDkk', w);
    if (priceDkk <= 0) throw new Error(`${w}.priceDkk: must be positive`);
    const row: PabElement = {
      elementId,
      colorId: int(e, 'colorId', w),
      name: str(e, 'name', w),
      priceDkk,
      status: str(e, 'status', w),
    };
    if (e.note !== undefined) row.note = str(e, 'note', w);
    return row;
  });
  return {
    source: str(o, 'source', what),
    date: date(o, 'date', what),
    market: str(o, 'market', what),
    currency: dkk(o, what),
    part: str(o, 'part', what),
    designId: str(o, 'designId', what),
    elements,
  };
}

export function parseBrickLinkSnapshot(json: unknown, what: string): BrickLinkSnapshot {
  const o = obj(json, what);
  const seen = new Set<number>();
  const rows = arr(o.rows, `${what}.rows`).map((v, i): BrickLinkRow => {
    const w = `${what}.rows[${i}]`;
    const r = obj(v, w);
    const blColorId = int(r, 'blColorId', w);
    if (seen.has(blColorId)) throw new Error(`${w}: BrickLink colour ${blColorId} is listed twice`);
    seen.add(blColorId);
    const soldNewQtyAvgDkk = num(r, 'soldNewQtyAvgDkk', w);
    if (soldNewQtyAvgDkk <= 0) throw new Error(`${w}.soldNewQtyAvgDkk: must be positive`);
    return {
      blColorId,
      blColorName: str(r, 'blColorName', w),
      soldNewTimes: int(r, 'soldNewTimes', w),
      soldNewQty: int(r, 'soldNewQty', w),
      soldNewQtyAvgDkk,
      stockNewLots: int(r, 'stockNewLots', w),
      stockNewQty: int(r, 'stockNewQty', w),
      stockNewMinDkk: num(r, 'stockNewMinDkk', w),
      stockNewQtyAvgDkk: num(r, 'stockNewQtyAvgDkk', w),
    };
  });
  if (rows.length === 0) throw new Error(`${what}.rows: empty`);
  return {
    source: str(o, 'source', what),
    date: date(o, 'date', what),
    currency: dkk(o, what),
    blPart: str(o, 'blPart', what),
    rows,
  };
}

// ---------------------------------------------------------------------------------------------
// Rebrickable API colours -> colors-external.json

/** Index of the first usable (numeric) external id, or -1. */
function firstId(ids: unknown): number {
  if (!Array.isArray(ids)) return -1;
  return ids.findIndex((x) => typeof x === 'number' && Number.isInteger(x));
}

/**
 * Keeps only the BrickLink id and name and the LEGO id of each colour of a
 * /api/v3/lego/colors/ response (its `results`). Everything else is dropped.
 */
export function externalFromApi(results: readonly unknown[]): Map<number, ExternalIds> {
  const out = new Map<number, ExternalIds>();
  results.forEach((v, i) => {
    const what = `api colors[${i}]`;
    const c = obj(v, what);
    const id = int(c, 'id', what);
    const ext = c.external_ids === undefined || c.external_ids === null ? {} : obj(c.external_ids, `${what}.external_ids`);
    const bl = ext.BrickLink === undefined ? null : obj(ext.BrickLink, `${what}.BrickLink`);
    const lego = ext.LEGO === undefined ? null : obj(ext.LEGO, `${what}.LEGO`);
    let blId: number | null = null;
    let blName: string | null = null;
    if (bl !== null) {
      const k = firstId(bl.ext_ids);
      if (k >= 0) {
        blId = (bl.ext_ids as number[])[k];
        const descrs = Array.isArray(bl.ext_descrs) ? (bl.ext_descrs[k] as unknown) : undefined;
        const name = Array.isArray(descrs) ? (descrs[0] as unknown) : undefined;
        blName = typeof name === 'string' && name !== '' ? name : null;
      }
    }
    let legoId: number | null = null;
    if (lego !== null) {
      const k = firstId(lego.ext_ids);
      if (k >= 0) legoId = (lego.ext_ids as number[])[k];
    }
    out.set(id, { blId, blName, legoId });
  });
  return out;
}

/** Serialises colors-external.json with ids in ascending numeric order. */
export function serializeColorsExternal(map: ColorsExternal): string {
  const ids = [...map.keys()].sort((a, b) => a - b);
  const lines = ids.map((id) => {
    const e = map.get(id)!;
    return `  ${JSON.stringify(String(id))}: ${JSON.stringify({ blId: e.blId, blName: e.blName, legoId: e.legoId })}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}
