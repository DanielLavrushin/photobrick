// Pure palette construction: aggregated Rebrickable data + snapshots -> Palette (engine types).

import type { Palette, PaletteColor, Rgb } from '../../../packages/engine/src/types.ts';
import { assignCodes, type CodeBook, type NewCode } from './codes.ts';
import { ATTRIBUTION, type PaletteRules, type PartConfig } from './config.ts';
import { finishesOf } from './finish.ts';
import type { ColorUsage, Dataset, ElementRow, RbColor } from './rebrickable.ts';
import {
  PAB_SOLD_STATUS,
  type BrickLinkSnapshot,
  type ColorsExternal,
  type PabElement,
  type PabSnapshot,
} from './snapshots.ts';

export type Tier = PaletteColor['tier'];

export interface SelectedColor {
  color: RbColor;
  usage: ColorUsage;
  elements: readonly ElementRow[];
  tier: Tier;
}

export interface RejectedColor {
  id: number;
  name: string;
  reason: string;
}

export function tierOf(qty: number, rules: PaletteRules): Tier {
  if (qty < rules.rareBelowQty) return 'rare';
  return qty >= rules.coreMinQty ? 'core' : 'extended';
}

/**
 * The palette colours of a part: plain opaque colours that exist as an element of the part and
 * appear in a set released in rules.minYear or later. Sorted by quantity in sets (descending),
 * then colour id.
 */
export function selectColors(
  dataset: Dataset,
  part: string,
  rules: PaletteRules,
): { selected: SelectedColor[]; rejected: RejectedColor[] } {
  const data = dataset.parts.get(part);
  if (data === undefined) throw new Error(`part ${part} was not loaded`);
  const ids = [...new Set([...data.usage.keys(), ...data.elements.keys()])].sort((a, b) => a - b);
  const selected: SelectedColor[] = [];
  const rejected: RejectedColor[] = [];
  for (const id of ids) {
    const color = dataset.colors.get(id);
    if (color === undefined) {
      rejected.push({ id, name: '?', reason: 'colour id missing from colors.csv' });
      continue;
    }
    const reject = (reason: string): void => {
      rejected.push({ id, name: color.name, reason });
    };
    const finishes = finishesOf(id, color.name, color.isTrans);
    const usage = data.usage.get(id);
    const elements = data.elements.get(id) ?? [];
    if (finishes.length > 0) reject(`special finish (${finishes.join(', ')})`);
    else if (elements.length === 0) reject('no element id');
    else if (usage === undefined) reject('in no set inventory');
    else if (usage.lastYear < rules.minYear) reject(`last in a set from ${usage.lastYear}`);
    else selected.push({ color, usage, elements, tier: tierOf(usage.qty, rules) });
  }
  selected.sort((a, b) => b.usage.qty - a.usage.qty || a.color.id - b.color.id);
  return { selected, rejected };
}

function elementNumber(elementId: string): number {
  return /^\d+$/.test(elementId) ? Number(elementId) : 0;
}

/**
 * Best-guess element id for ordering a colour: an element of a preferred design first, then the
 * highest element id (newer elements have higher ids). The first listed wins a tie.
 */
export function preferredElement(elements: readonly ElementRow[], preferredDesigns: readonly string[]): string | null {
  let best: ElementRow | null = null;
  let bestPref = false;
  let bestNum = -1;
  for (const e of elements) {
    const pref = e.designId !== null && preferredDesigns.includes(e.designId);
    const n = elementNumber(e.elementId);
    if (best === null || (pref && !bestPref) || (pref === bestPref && n > bestNum)) {
      best = e;
      bestPref = pref;
      bestNum = n;
    }
  }
  return best === null ? null : best.elementId;
}

/** The Pick a Brick element to order a colour by: the preferred element if sold, else the highest id. */
function pickPabElement(offers: readonly PabElement[], preferred: string | null): PabElement {
  const same = offers.find((o) => o.elementId === preferred);
  if (same !== undefined) return same;
  return offers.reduce((a, b) => (elementNumber(b.elementId) > elementNumber(a.elementId) ? b : a));
}

export function roundTo(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of an empty list');
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function joinAnd(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function minDate(dates: readonly string[]): string {
  return dates.reduce((a, b) => (b < a ? b : a));
}

export interface PaletteInputs {
  config: PartConfig;
  rules: PaletteRules;
  dataset: Dataset;
  external: ColorsExternal;
  codes: CodeBook;
  /** Palette revision: the date of the Rebrickable CSV files. */
  rev: string;
  pab: PabSnapshot | null;
  brickLink: BrickLinkSnapshot | null;
  /** The sample whose median price becomes blEurDefault. */
  blDefault: BrickLinkSnapshot;
}

export interface PaletteBuild {
  palette: Palette;
  /** The code book including codes added for new colours. */
  codes: Map<number, string>;
  added: NewCode[];
  selected: SelectedColor[];
  rejected: RejectedColor[];
  warnings: string[];
}

export function buildPalette(inputs: PaletteInputs): PaletteBuild {
  const { config, rules, dataset, external, pab, brickLink, blDefault } = inputs;
  if (pab !== null && pab.part !== config.part) {
    throw new Error(`Pick a Brick snapshot is for part ${pab.part}, not ${config.part}`);
  }
  if (brickLink !== null && brickLink.blPart !== config.blPart) {
    throw new Error(`BrickLink sample is for ${brickLink.blPart}, not BrickLink ${config.blPart}`);
  }
  const warnings: string[] = [];
  const { selected, rejected } = selectColors(dataset, config.part, rules);
  const { book, added } = assignCodes(
    inputs.codes,
    selected.map((s) => ({ id: s.color.id, name: s.color.name })),
  );

  // Pick a Brick offers per colour, checked against Rebrickable's element list.
  const elementColor = new Map<string, number>();
  for (const [colorId, list] of dataset.parts.get(config.part)!.elements) {
    for (const e of list) elementColor.set(e.elementId, colorId);
  }
  const offers = new Map<number, PabElement[]>();
  for (const e of pab?.elements ?? []) {
    const known = elementColor.get(e.elementId);
    if (known === undefined) {
      warnings.push(`Pick a Brick element ${e.elementId} (${e.name}) is not in Rebrickable's elements of ${config.part}`);
    } else if (known !== e.colorId) {
      throw new Error(
        `Pick a Brick element ${e.elementId} is colour ${e.colorId} in the snapshot but ${known} on Rebrickable`,
      );
    }
    if (e.status !== PAB_SOLD_STATUS) continue;
    const list = offers.get(e.colorId);
    if (list === undefined) offers.set(e.colorId, [e]);
    else list.push(e);
  }

  const blPrices = new Map<number, number>();
  for (const r of brickLink?.rows ?? []) blPrices.set(r.blColorId, r.soldNewQtyAvgDkk);

  const colors: PaletteColor[] = selected.map(({ color, elements, tier }) => {
    const ext = external.get(color.id);
    if (ext === undefined) warnings.push(`no BrickLink/LEGO ids for colour ${color.id} ${color.name}`);
    const blId = ext?.blId ?? null;
    const heuristic = preferredElement(elements, config.preferredDesigns);
    const colorOffers = offers.get(color.id);
    const offer = colorOffers === undefined ? null : pickPabElement(colorOffers, heuristic);
    const blDkk = blId === null ? undefined : blPrices.get(blId);
    const onPab = offer !== null;
    return {
      id: color.id,
      name: color.name,
      hex: color.hex,
      rgb: hexToRgb(color.hex),
      code: book.get(color.id)!,
      tier,
      defaultEnabled: pab !== null ? onPab : tier !== 'rare',
      blId,
      blName: ext?.blName ?? null,
      legoId: ext?.legoId ?? null,
      elementId: offer !== null ? offer.elementId : heuristic,
      pab: onPab,
      pabDkk: offer !== null ? offer.priceDkk : null,
      pabEur: offer !== null ? roundTo(offer.priceDkk / rules.dkkPerEur, 2) : null,
      blEur: blDkk === undefined ? null : roundTo(blDkk / rules.dkkPerEur, 4),
    };
  });

  const inPalette = new Set(colors.map((c) => c.id));
  for (const [colorId, list] of offers) {
    if (inPalette.has(colorId)) continue;
    const why = rejected.find((r) => r.id === colorId)?.reason ?? 'not an element of the part';
    warnings.push(`sold on Pick a Brick but not in the palette: ${list[0].name} (${colorId}): ${why}`);
  }
  const paletteBl = new Set(colors.map((c) => c.blId));
  for (const r of brickLink?.rows ?? []) {
    if (!paletteBl.has(r.blColorId)) {
      warnings.push(`BrickLink sample colour ${r.blColorId} ${r.blColorName} matches no palette colour`);
    }
  }

  const blDate = minDate(brickLink === null ? [blDefault.date] : [brickLink.date, blDefault.date]);
  const sources = [
    ...(pab === null ? [] : [{ label: `LEGO Pick a Brick (${pab.market})`, date: pab.date }]),
    { label: 'BrickLink', date: blDate },
  ];
  const sameDate = sources.every((s) => s.date === sources[0].date);
  const priceNote = sameDate
    ? `${joinAnd(sources.map((s) => s.label))}, ${sources[0].date}`
    : joinAnd(sources.map((s) => `${s.label} (${s.date})`));

  const palette: Palette = {
    part: config.part,
    partName: config.partName,
    blPart: config.blPart,
    rev: inputs.rev,
    pricesAsOf: minDate(sources.map((s) => s.date)),
    blEurDefault: roundTo(median(blDefault.rows.map((r) => r.soldNewQtyAvgDkk)) / rules.dkkPerEur, 4),
    attribution: `${ATTRIBUTION} Prices are snapshots from ${priceNote}.`,
    colors,
  };
  return { palette, codes: book, added, selected, rejected, warnings };
}

/** The palette file format: 2-space JSON with a trailing newline. */
export function serializePalette(palette: Palette): string {
  return JSON.stringify(palette, null, 2) + '\n';
}
