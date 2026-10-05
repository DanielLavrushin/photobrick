// Two-character colour codes printed on the building instructions. A code belongs to one
// Rebrickable colour id forever: codes.json is append-only, so a code is never reused even when
// its colour leaves every palette.

/** Code alphabet: capital letters and digits, without 0 and 1 (they read as O and I on paper). */
export const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const CODE_RX = /^[A-Z2-9]{2}$/;

export type CodeBook = ReadonlyMap<number, string>;

export interface NewCode {
  id: number;
  name: string;
  code: string;
}

export function isValidCode(code: string): boolean {
  return CODE_RX.test(code);
}

/** Checks a code book: every code well-formed and unique. */
export function validateCodeBook(book: CodeBook): void {
  const owner = new Map<string, number>();
  for (const [id, code] of book) {
    if (!Number.isInteger(id)) throw new Error(`codes: invalid colour id ${id}`);
    if (!isValidCode(code)) throw new Error(`codes: invalid code '${code}' for colour ${id}`);
    const other = owner.get(code);
    if (other !== undefined) throw new Error(`codes: '${code}' is used by colours ${other} and ${id}`);
    owner.set(code, id);
  }
}

/**
 * Candidate codes for a colour name, best first: initials of the first and last word ("Sand
 * Green" -> SG), initials of the first and each other word, the first letter with each later
 * letter of the name, the first letter with a digit, and finally every code of the alphabet.
 */
export function candidateCodes(name: string): string[] {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);
  const letters = words.join('').replace(/[^A-Z2-9]/g, '');
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (code: string): void => {
    if (isValidCode(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  };
  if (letters.length > 0) {
    const first = letters[0];
    if (words.length >= 2) {
      add(words[0][0] + words[words.length - 1][0]);
      for (let w = 1; w < words.length - 1; w++) add(words[0][0] + words[w][0]);
    }
    for (let k = 1; k < letters.length; k++) add(first + letters[k]);
    for (const d of '23456789') add(first + d);
  }
  for (const a of CODE_ALPHABET) for (const b of CODE_ALPHABET) add(a + b);
  return out;
}

/**
 * Gives every colour without a code the first free candidate code. New colours are handled in
 * ascending id order so the result does not depend on the input order. Returns the extended book
 * (the input is not modified) and the codes that were added.
 */
export function assignCodes(
  book: CodeBook,
  colors: readonly { id: number; name: string }[],
): { book: Map<number, string>; added: NewCode[] } {
  validateCodeBook(book);
  const out = new Map(book);
  const taken = new Set(book.values());
  const added: NewCode[] = [];
  const missing = colors.filter((c) => !out.has(c.id)).sort((a, b) => a.id - b.id);
  for (const { id, name } of missing) {
    if (out.has(id)) continue; // the same colour listed twice
    const code = candidateCodes(name).find((c) => !taken.has(c));
    if (code === undefined) throw new Error(`codes: no free code left for colour ${id} ${name}`);
    out.set(id, code);
    taken.add(code);
    added.push({ id, name, code });
  }
  return { book: out, added };
}

/** Parses codes.json: { "<rebrickable colour id>": "<code>" }. */
export function parseCodeBook(json: unknown): Map<number, string> {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('codes.json: expected an object of colour id -> code');
  }
  const book = new Map<number, string>();
  for (const [key, value] of Object.entries(json)) {
    const id = Number(key);
    if (!/^-?\d+$/.test(key) || typeof value !== 'string') {
      throw new Error(`codes.json: bad entry ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    }
    book.set(id, value);
  }
  validateCodeBook(book);
  return book;
}

/** Serialises a code book with ids in ascending numeric order (2-space JSON, trailing newline). */
export function serializeCodeBook(book: CodeBook): string {
  const ids = [...book.keys()].sort((a, b) => a - b);
  const lines = ids.map((id) => `  ${JSON.stringify(String(id))}: ${JSON.stringify(book.get(id))}`);
  return lines.length === 0 ? '{}\n' : `{\n${lines.join(',\n')}\n}\n`;
}
