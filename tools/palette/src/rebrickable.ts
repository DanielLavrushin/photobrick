import { readCsvGz, type GzipSource } from './csv.ts';

/** The Rebrickable CSV downloads the tool reads. */
export const CSV_FILES = ['colors', 'elements', 'inventories', 'inventory_parts', 'sets'] as const;
export type CsvName = (typeof CSV_FILES)[number];

export interface RbColor {
  id: number;
  name: string;
  /** '#RRGGBB', upper case. */
  hex: string;
  isTrans: boolean;
}

export interface ElementRow {
  elementId: string;
  /** LEGO design (mould) id, null when Rebrickable has none. */
  designId: string | null;
}

/** How a colour of a part is used across set inventories. */
export interface ColorUsage {
  /** Total quantity over the newest inventory version of every set, spares excluded. */
  qty: number;
  /** Newest release year of a set containing it. */
  lastYear: number;
  /** Number of sets containing it. */
  sets: number;
}

export interface PartData {
  usage: Map<number, ColorUsage>;
  elements: Map<number, ElementRow[]>;
}

export interface Dataset {
  colors: Map<number, RbColor>;
  parts: Map<string, PartData>;
}

export function parseIntStrict(s: string, what: string): number {
  if (!/^-?\d+$/.test(s)) throw new Error(`${what}: expected an integer, got ${JSON.stringify(s)}`);
  return Number(s);
}

/** Rebrickable writes booleans as True/False (older dumps: t/f). */
export function parseBool(s: string, what: string): boolean {
  switch (s) {
    case 'True':
    case 'true':
    case 't':
      return true;
    case 'False':
    case 'false':
    case 'f':
      return false;
    default:
      throw new Error(`${what}: expected a boolean, got ${JSON.stringify(s)}`);
  }
}

/**
 * Reads the CSV downloads and aggregates what the palettes need for the given parts. Counting
 * rules (as in the research script): only the newest inventory version of each set, spare parts
 * excluded, and inventories that are not sets (minifigures) ignored.
 */
export async function loadDataset(
  source: (name: CsvName) => GzipSource,
  parts: readonly string[],
): Promise<Dataset> {
  const targets = new Set(parts);

  const colors = new Map<number, RbColor>();
  await readCsvGz(source('colors'), 'colors.csv', ['id', 'name', 'rgb', 'is_trans'], (row, c) => {
    const id = parseIntStrict(row[c.id], 'colors.csv id');
    const rgb = row[c.rgb];
    if (!/^[0-9A-Fa-f]{6}$/.test(rgb)) throw new Error(`colors.csv: bad rgb ${JSON.stringify(rgb)} for ${id}`);
    colors.set(id, {
      id,
      name: row[c.name],
      hex: '#' + rgb.toUpperCase(),
      isTrans: parseBool(row[c.is_trans], `colors.csv is_trans of ${id}`),
    });
  });

  const setYear = new Map<string, number>();
  await readCsvGz(source('sets'), 'sets.csv', ['set_num', 'year'], (row, c) => {
    setYear.set(row[c.set_num], parseIntStrict(row[c.year], 'sets.csv year'));
  });

  const newest = new Map<string, { version: number; id: number }>();
  await readCsvGz(source('inventories'), 'inventories.csv', ['id', 'version', 'set_num'], (row, c) => {
    const setNum = row[c.set_num];
    const version = parseIntStrict(row[c.version], 'inventories.csv version');
    const prev = newest.get(setNum);
    if (prev === undefined || version > prev.version) {
      newest.set(setNum, { version, id: parseIntStrict(row[c.id], 'inventories.csv id') });
    }
  });
  // inventory id -> year of its set, for the newest version of real sets only
  const inventoryYear = new Map<number, number>();
  for (const [setNum, { id }] of newest) {
    const year = setYear.get(setNum);
    if (year !== undefined) inventoryYear.set(id, year);
  }

  const partData = new Map<string, PartData>();
  for (const p of parts) partData.set(p, { usage: new Map(), elements: new Map() });
  // Per part and colour: the inventories (one per set) it appears in.
  const inventoriesOf = new Map<ColorUsage, Set<number>>();

  await readCsvGz(
    source('inventory_parts'),
    'inventory_parts.csv',
    ['inventory_id', 'part_num', 'color_id', 'quantity', 'is_spare'],
    (row, c) => {
      const part = row[c.part_num];
      if (!targets.has(part)) return;
      if (parseBool(row[c.is_spare], 'inventory_parts.csv is_spare')) return;
      const inventoryId = parseIntStrict(row[c.inventory_id], 'inventory_parts.csv inventory_id');
      const year = inventoryYear.get(inventoryId);
      if (year === undefined) return;
      const colorId = parseIntStrict(row[c.color_id], 'inventory_parts.csv color_id');
      const qty = parseIntStrict(row[c.quantity], 'inventory_parts.csv quantity');
      const usage = partData.get(part)!.usage;
      let u = usage.get(colorId);
      if (u === undefined) {
        usage.set(colorId, (u = { qty: 0, lastYear: year, sets: 0 }));
        inventoriesOf.set(u, new Set());
      }
      u.qty += qty;
      if (year > u.lastYear) u.lastYear = year;
      inventoriesOf.get(u)!.add(inventoryId);
    },
  );
  for (const [u, inventories] of inventoriesOf) u.sets = inventories.size;

  await readCsvGz(
    source('elements'),
    'elements.csv',
    ['element_id', 'part_num', 'color_id', 'design_id'],
    (row, c) => {
      const part = row[c.part_num];
      if (!targets.has(part)) return;
      const colorId = parseIntStrict(row[c.color_id], 'elements.csv color_id');
      const elements = partData.get(part)!.elements;
      let list = elements.get(colorId);
      if (list === undefined) elements.set(colorId, (list = []));
      list.push({ elementId: row[c.element_id], designId: row[c.design_id] === '' ? null : row[c.design_id] });
    },
  );

  return { colors, parts: partData };
}
