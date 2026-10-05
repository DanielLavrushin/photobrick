import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const QUOTE = 0x22;
const COMMA = 0x2c;
const LF = 0x0a;
const CR = 0x0d;
const BOM = 0xfeff;

// Parser states (plain constants: enums are not erasable by --experimental-strip-types).
const FIELD_START = 0;
const UNQUOTED = 1;
const QUOTED = 2;
/** Saw a '"' inside a quoted field: either the closing quote or the first half of a '""' escape. */
const QUOTE_SEEN = 3;
/** Saw a CR that ended a row; a directly following LF belongs to the same line break. */
const AFTER_CR = 4;

/**
 * Streaming RFC 4180 CSV parser. Text may arrive in arbitrary chunks: a quoted field, a '""'
 * escape or a CRLF can span two chunks. Accepts LF, CRLF and lone CR line breaks, skips blank
 * lines and a leading UTF-8 BOM. Like Python's csv module it is lenient about stray quotes: a
 * quote inside an unquoted field is literal, and text after a closing quote is appended.
 */
export class CsvParser {
  private readonly onRow: (row: string[]) => void;
  private state = FIELD_START;
  private field = '';
  private row: string[] = [];
  private lineHasContent = false;
  private bomChecked = false;
  private rows = 0;

  constructor(onRow: (row: string[]) => void) {
    this.onRow = onRow;
  }

  /** Number of rows emitted so far (the header included). */
  get rowCount(): number {
    return this.rows;
  }

  push(chunk: string): void {
    const n = chunk.length;
    let i = 0;
    if (!this.bomChecked && n > 0) {
      this.bomChecked = true;
      if (chunk.charCodeAt(0) === BOM) i = 1;
    }
    while (i < n) {
      const state = this.state;
      if (state === QUOTED) {
        const q = chunk.indexOf('"', i);
        if (q < 0) {
          this.field += chunk.slice(i);
          return;
        }
        this.field += chunk.slice(i, q);
        i = q + 1;
        this.state = QUOTE_SEEN;
        continue;
      }
      if (state === QUOTE_SEEN) {
        if (chunk.charCodeAt(i) === QUOTE) {
          this.field += '"';
          i++;
          this.state = QUOTED;
        } else {
          this.state = UNQUOTED;
        }
        continue;
      }
      if (state === AFTER_CR) {
        this.state = FIELD_START;
        if (chunk.charCodeAt(i) === LF) i++;
        continue;
      }
      if (state === FIELD_START && chunk.charCodeAt(i) === QUOTE) {
        this.lineHasContent = true;
        this.state = QUOTED;
        i++;
        continue;
      }
      // FIELD_START or UNQUOTED: take everything up to the next delimiter in one slice.
      let j = i;
      while (j < n) {
        const c = chunk.charCodeAt(j);
        if (c === COMMA || c === LF || c === CR) break;
        j++;
      }
      if (j > i) {
        this.field += chunk.slice(i, j);
        this.lineHasContent = true;
      }
      if (j === n) {
        this.state = UNQUOTED;
        return;
      }
      const c = chunk.charCodeAt(j);
      i = j + 1;
      if (c === COMMA) {
        this.row.push(this.field);
        this.field = '';
        this.lineHasContent = true;
        this.state = FIELD_START;
      } else {
        this.endRow();
        this.state = c === CR ? AFTER_CR : FIELD_START;
      }
    }
  }

  /** Flushes the last row (a final line break is optional). Throws on an unterminated quote. */
  end(): void {
    if (this.state === QUOTED) {
      throw new Error(`CSV: unterminated quoted field in row ${this.rows + 1}`);
    }
    this.endRow();
    this.state = FIELD_START;
  }

  private endRow(): void {
    if (!this.lineHasContent) return; // blank line
    this.row.push(this.field);
    const row = this.row;
    this.field = '';
    this.row = [];
    this.lineHasContent = false;
    this.rows++;
    this.onRow(row);
  }
}

/** Parses a whole CSV text into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const parser = new CsvParser((row) => rows.push(row));
  parser.push(text);
  parser.end();
  return rows;
}

export type ColumnIndex<K extends string> = Readonly<Record<K, number>>;
export type RecordHandler<K extends string> = (row: readonly string[], col: ColumnIndex<K>) => void;

/**
 * Wraps a record handler so that the first row is treated as the header: the named columns must
 * all be present (in any order, extra columns are ignored) and every data row must have as many
 * fields as the header.
 */
export function tableRows<K extends string>(
  label: string,
  columns: readonly K[],
  onRecord: RecordHandler<K>,
): (row: string[]) => void {
  let col: ColumnIndex<K> | null = null;
  let width = 0;
  let line = 1;
  return (row) => {
    if (col === null) {
      const index = {} as Record<K, number>;
      for (const name of columns) {
        const at = row.indexOf(name);
        if (at < 0) throw new Error(`${label}: missing column '${name}' (header: ${row.join(',')})`);
        index[name] = at;
      }
      col = index;
      width = row.length;
      return;
    }
    line++;
    if (row.length !== width) {
      throw new Error(`${label}: row ${line} has ${row.length} fields, the header has ${width}`);
    }
    onRecord(row, col);
  };
}

export type GzipSource = string | Iterable<Uint8Array> | AsyncIterable<Uint8Array>;

/**
 * Streams a gzip-compressed CSV (a file path, or the compressed bytes in chunks) through the
 * parser. Returns the number of data rows.
 */
export async function readCsvGz<K extends string>(
  source: GzipSource,
  label: string,
  columns: readonly K[],
  onRecord: RecordHandler<K>,
): Promise<number> {
  const parser = new CsvParser(tableRows(label, columns, onRecord));
  const gunzip = createGunzip();
  gunzip.setEncoding('utf8');
  await pipeline(typeof source === 'string' ? createReadStream(source) : source, gunzip, async (chunks) => {
    for await (const chunk of chunks) parser.push(chunk as string);
  });
  parser.end();
  return Math.max(0, parser.rowCount - 1);
}
