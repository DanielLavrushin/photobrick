// Shopping exports: BrickLink wanted list, LEGO Pick a Brick upload, Rebrickable parts list.

import type { BomLine, Palette } from './types.ts';

/** Pick a Brick list upload limits (lego.com da-dk / en-gb, 2026-09): per element and per list. */
export const PAB_MAX_QTY = 999;
export const PAB_MAX_ELEMENTS = 200;

// XML 1.0 forbids most control characters even when escaped, so they are dropped.
function isXmlChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c !== 0xfffe && c !== 0xffff);
}

function xmlText(s: string): string {
  return Array.from(s)
    .filter(isXmlChar)
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * BrickLink wanted-list XML (https://www.bricklink.com/help.asp?helpID=207). There is no XML
 * declaration because BrickLink rejects one. Lines without a BrickLink colour id cannot be expressed
 * and are left out; check BomLine.blId to tell the user.
 */
export function toBrickLinkXml(lines: BomLine[], palette: Palette): string {
  let xml = '<INVENTORY>\n';
  for (const l of lines) {
    if (l.blId === null || l.total <= 0) continue;
    xml +=
      '<ITEM>\n' +
      '<ITEMTYPE>P</ITEMTYPE>\n' +
      `<ITEMID>${xmlText(palette.blPart)}</ITEMID>\n` +
      `<COLOR>${l.blId}</COLOR>\n` +
      `<MINQTY>${l.total}</MINQTY>\n` +
      '<CONDITION>N</CONDITION>\n' +
      `<REMARKS>${xmlText(`PhotoBrick ${l.code} ${l.name}`)}</REMARKS>\n` +
      '</ITEM>\n';
  }
  return xml + '</INVENTORY>\n';
}

/**
 * LEGO Pick a Brick upload CSV: "elementId,quantity". Quantities are capped at 999 per element and
 * lines without an element id are left out, each with a warning; another warning fires above 200
 * distinct elements (the Denmark / UK limit) and for colours not sold on Pick a Brick.
 */
export function toPickABrickCsv(lines: BomLine[]): { csv: string; warnings: string[] } {
  const warnings: string[] = [];
  let csv = 'elementId,quantity\n';
  let rows = 0;
  for (const l of lines) {
    if (l.total <= 0) continue;
    const label = `${l.name} (${l.code})`;
    if (!l.elementId) {
      warnings.push(`${label} has no LEGO element id and is not in the list.`);
      continue;
    }
    if (!l.pab) warnings.push(`${label} was not sold on Pick a Brick when prices were checked.`);
    let qty = l.total;
    if (qty > PAB_MAX_QTY) {
      warnings.push(`${label}: ${qty} needed, but Pick a Brick accepts at most ${PAB_MAX_QTY} per element; the list asks for ${PAB_MAX_QTY}.`);
      qty = PAB_MAX_QTY;
    }
    csv += `${l.elementId},${qty}\n`;
    rows++;
  }
  if (rows > PAB_MAX_ELEMENTS) {
    warnings.push(`The list has ${rows} different elements; Pick a Brick in Denmark and the UK accepts at most ${PAB_MAX_ELEMENTS} per upload.`);
  }
  return { csv, warnings };
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rebrickable parts-list CSV: "Part,Color,Quantity" with Rebrickable part and colour ids. */
export function toRebrickableCsv(lines: BomLine[], palette: Palette): string {
  let csv = 'Part,Color,Quantity\n';
  const part = csvField(palette.part);
  for (const l of lines) if (l.total > 0) csv += `${part},${l.colorId},${l.total}\n`;
  return csv;
}
