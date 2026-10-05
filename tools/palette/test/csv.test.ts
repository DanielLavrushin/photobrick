import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CsvParser, parseCsv, readCsvGz, tableRows } from '../src/csv.ts';

function parseChunks(chunks: readonly string[]): string[][] {
  const rows: string[][] = [];
  const parser = new CsvParser((row) => rows.push(row));
  for (const c of chunks) parser.push(c);
  parser.end();
  return rows;
}

const TRICKY =
  '﻿id,name,note\r\n' +
  '1,"Art, Big","say ""hi"""\r\n' +
  '2,plain,\r\n' +
  '\r\n' +
  '3,"multi\nline\r\nfield",x\r' +
  '4,"",""\n' +
  '5,Ünïcødé 🧱,end';

const TRICKY_ROWS = [
  ['id', 'name', 'note'],
  ['1', 'Art, Big', 'say "hi"'],
  ['2', 'plain', ''],
  ['3', 'multi\nline\r\nfield', 'x'],
  ['4', '', ''],
  ['5', 'Ünïcødé 🧱', 'end'],
];

describe('CsvParser', () => {
  it('parses plain rows with and without a final line break', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quotes, escaped quotes, embedded delimiters and line breaks, BOM, CRLF and lone CR', () => {
    expect(parseCsv(TRICKY)).toEqual(TRICKY_ROWS);
  });

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsv('a,,b,\n,\n')).toEqual([
      ['a', '', 'b', ''],
      ['', ''],
    ]);
  });

  it('skips blank lines but keeps a line holding one quoted empty field', () => {
    expect(parseCsv('\n\na\n\r\n""\n\n')).toEqual([['a'], ['']]);
  });

  it('is lenient about stray quotes, like Python csv', () => {
    expect(parseCsv('ab"c,"de"f\n')).toEqual([['ab"c', 'def']]);
  });

  it('gives the same rows however the text is split into chunks', () => {
    for (let cut = 0; cut <= TRICKY.length; cut++) {
      expect(parseChunks([TRICKY.slice(0, cut), TRICKY.slice(cut)])).toEqual(TRICKY_ROWS);
    }
    expect(parseChunks([...TRICKY])).toEqual(TRICKY_ROWS);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('a,"open\nstill open')).toThrow(/unterminated/);
  });

  it('counts emitted rows', () => {
    const parser = new CsvParser(() => {});
    parser.push('a\nb\n\nc');
    parser.end();
    expect(parser.rowCount).toBe(3);
  });
});

describe('tableRows', () => {
  it('maps columns by header name regardless of order and ignores extra columns', () => {
    const got: string[] = [];
    const parser = new CsvParser(
      tableRows('t.csv', ['name', 'id'], (row, c) => got.push(`${row[c.id]}=${row[c.name]}`)),
    );
    parser.push('extra,name,id\nx,Black,0\ny,White,15\n');
    parser.end();
    expect(got).toEqual(['0=Black', '15=White']);
  });

  it('rejects a missing column and a row of the wrong width', () => {
    expect(() => parseCsvTable('id,rgb\n1,2\n', ['id', 'name'])).toThrow(/missing column 'name'/);
    expect(() => parseCsvTable('id,name\n1,a\n2,b,c\n', ['id', 'name'])).toThrow(/row 3 has 3 fields/);
  });
});

function parseCsvTable(text: string, columns: readonly string[]): number {
  let n = 0;
  const parser = new CsvParser(tableRows('t.csv', columns, () => n++));
  parser.push(text);
  parser.end();
  return n;
}

describe('readCsvGz', () => {
  it('decompresses gzip chunks and decodes UTF-8 split across chunk boundaries', async () => {
    const text = 'id,name\n' + Array.from({ length: 500 }, (_, i) => `${i},"Farve ø ${i}, 🧱"`).join('\n') + '\n';
    const gz = gzipSync(text);
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < gz.length; i += 7) pieces.push(gz.subarray(i, i + 7));
    const names: string[] = [];
    const n = await readCsvGz(pieces, 'x.csv', ['name'], (row, c) => names.push(row[c.name]));
    expect(n).toBe(500);
    expect(names[0]).toBe('Farve ø 0, 🧱');
    expect(names[499]).toBe('Farve ø 499, 🧱');
  });

  it('fails on corrupt gzip data', async () => {
    const gz = gzipSync('id\n1\n');
    await expect(readCsvGz([gz.subarray(0, gz.length - 6)], 'x.csv', ['id'], () => {})).rejects.toThrow();
  });
});
