import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  assignCodes,
  candidateCodes,
  isValidCode,
  parseCodeBook,
  serializeCodeBook,
  validateCodeBook,
} from '../src/codes.ts';

const BOOK = new Map<number, string>([
  [0, 'BK'],
  [15, 'WH'],
  [4, 'RD'],
  [379, 'SB'],
]);

describe('candidateCodes', () => {
  it('starts with word initials, then the first letter with later letters', () => {
    expect(candidateCodes('Sand Green').slice(0, 5)).toEqual(['SG', 'SA', 'SN', 'SD', 'SR']);
    expect(candidateCodes('Bright Light Orange').slice(0, 3)).toEqual(['BO', 'BL', 'BR']);
    expect(candidateCodes('Black').slice(0, 3)).toEqual(['BL', 'BA', 'BC']);
  });

  it('only yields valid, distinct codes and ends with the whole alphabet', () => {
    for (const name of ['Sand Green', 'Trans-Clear', '[Unknown]', '', '10 Year Anniversary']) {
      const list = candidateCodes(name);
      expect(new Set(list).size).toBe(list.length);
      expect(list.every(isValidCode)).toBe(true);
      expect(list.length).toBe(CODE_ALPHABET.length ** 2);
    }
  });

  it('never uses 0 or 1, which read as O and I', () => {
    expect(isValidCode('B0')).toBe(false);
    expect(isValidCode('I1')).toBe(false);
    expect(isValidCode('B2')).toBe(true);
    expect(isValidCode('bk')).toBe(false);
    expect(isValidCode('BKX')).toBe(false);
  });
});

describe('assignCodes', () => {
  it('keeps every existing code and gives new colours the first free candidate', () => {
    const { book, added } = assignCodes(BOOK, [
      { id: 0, name: 'Black' },
      { id: 378, name: 'Sand Green' },
      { id: 4, name: 'Red' },
    ]);
    for (const [id, code] of BOOK) expect(book.get(id)).toBe(code);
    expect(book.get(378)).toBe('SG');
    expect(added).toEqual([{ id: 378, name: 'Sand Green', code: 'SG' }]);
    expect(BOOK.has(378)).toBe(false); // input untouched
  });

  it('never reuses a code, even one whose colour is no longer in any palette', () => {
    const book = new Map(BOOK).set(9000, 'SG'); // a retired colour keeps SG reserved
    expect(assignCodes(book, [{ id: 378, name: 'Sand Green' }]).book.get(378)).toBe('SA');
  });

  it('does not depend on the order of the new colours', () => {
    const colors = [
      { id: 378, name: 'Sand Green' },
      { id: 1, name: 'Blue' },
      { id: 151, name: 'Sand Green' },
      { id: 2, name: 'Green' },
    ];
    const a = assignCodes(BOOK, colors).book;
    const b = assignCodes(BOOK, [...colors].reverse()).book;
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.get(151)).toBe('SG'); // lower id first
    expect(a.get(378)).toBe('SA');
    expect(new Set(a.values()).size).toBe(a.size);
  });

  it('is stable when run again on its own output', () => {
    const colors = [
      { id: 378, name: 'Sand Green' },
      { id: 1, name: 'Blue' },
    ];
    const first = assignCodes(BOOK, colors);
    const second = assignCodes(first.book, colors);
    expect(second.added).toEqual([]);
    expect([...second.book]).toEqual([...first.book]);
  });

  it('fails when the code space is exhausted', () => {
    const full = new Map<number, string>();
    let id = 0;
    for (const a of CODE_ALPHABET) for (const b of CODE_ALPHABET) full.set(id++, a + b);
    expect(() => assignCodes(full, [{ id: -5, name: 'One Too Many' }])).toThrow(/no free code/);
  });
});

describe('code book files', () => {
  it('rejects duplicate and malformed codes', () => {
    expect(() => validateCodeBook(new Map([[1, 'AA'], [2, 'AA']]))).toThrow(/used by colours 1 and 2/);
    expect(() => validateCodeBook(new Map([[1, 'A0']]))).toThrow(/invalid code/);
    expect(() => parseCodeBook({ x: 'AA' })).toThrow(/bad entry/);
    expect(() => parseCodeBook({ 1: 5 })).toThrow(/bad entry/);
    expect(() => parseCodeBook([])).toThrow(/expected an object/);
  });

  it('round-trips with ids in ascending numeric order', () => {
    const book = new Map<number, string>([
      [1050, 'CO'],
      [2, 'GR'],
      [-1, 'UN'],
      [15, 'WH'],
    ]);
    const text = serializeCodeBook(book);
    expect(text).toBe('{\n  "-1": "UN",\n  "2": "GR",\n  "15": "WH",\n  "1050": "CO"\n}\n');
    expect([...parseCodeBook(JSON.parse(text))].sort()).toEqual([...book].sort());
  });
});
