// Number, money and date formatting. Strings around the numbers come from i18n.

const LOCALE = 'en-GB';

const intFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const eurWhole = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const eurCents = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** 3072 -> "3,072" */
export function fmtInt(n: number): string {
  return intFmt.format(Math.round(n));
}

/** 38.4 -> "38.4", 51 -> "51" */
export function fmtOne(n: number): string {
  return oneFmt.format(n);
}

/** Rounded euros for estimates: "€100"; under €10 with cents: "€7.40". */
export function fmtEur(n: number): string {
  return Math.abs(n) < 10 ? eurCents.format(n) : eurWhole.format(n);
}

/** Danish kroner number without the unit: "1,140". */
export function fmtKr(n: number): string {
  return intFmt.format(Math.round(n));
}

/** "2026-09-24" -> "24 September 2026" (the ISO date as given, no time zone shift). */
export function fmtIsoDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

/** Signed with one decimal: 0.3 -> "+0.3", -1 -> "−1.0" (typographic minus). */
export function fmtSigned(n: number): string {
  const s = Math.abs(n).toFixed(1);
  if (Math.abs(n) < 0.05) return '0.0';
  return n > 0 ? `+${s}` : `−${s}`;
}

/** 0.5 -> "50%" */
export function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
