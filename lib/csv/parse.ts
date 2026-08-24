import Papa from 'papaparse';
import { COLUMN_MAP, EXPECTED_HEADERS, type SourceField } from './column-map';

/** A source row keyed by internal field, plus every original cell. */
export interface RawRow {
  /** Mapped cells, trimmed. Missing columns are absent. */
  fields: Partial<Record<SourceField, string>>;
  /** Every cell as exported, keyed by the original header. Stored verbatim. */
  raw: Record<string, string>;
  /** 1-based row number in the file, header excluded — used in error messages. */
  rowNumber: number;
}

export interface ParsedCsv {
  headers: string[];
  rows: RawRow[];
  /** Headers present in the file that the column map does not know. */
  unknownHeaders: string[];
  /** Headers the column map expects that the file does not have. */
  missingHeaders: string[];
}

/**
 * Parse a daily report.
 *
 * papaparse handles the quoted fields containing commas that this source is
 * full of (`"Harbor Point Plumbing & Heating Co., Inc., Borealis Energy"`).
 * A file holding only a header row is valid and yields zero rows — weekend
 * reports look exactly like that.
 */
export function parseReportCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    // Header handling is ours: we need the raw header strings to diff against
    // the column map and to keep unmapped columns.
    header: false,
  });

  const table = result.data.filter((r) => Array.isArray(r));
  const headers = (table[0] ?? []).map((h) => String(h ?? '').trim());

  const unknownHeaders = headers.filter((h) => h !== '' && !(h in COLUMN_MAP));
  const missingHeaders = EXPECTED_HEADERS.filter((h) => !headers.includes(h));

  const rows: RawRow[] = table.slice(1).map((cells, i) => {
    const fields: Partial<Record<SourceField, string>> = {};
    const raw: Record<string, string> = {};
    headers.forEach((header, col) => {
      const value = String(cells[col] ?? '');
      raw[header] = value;
      const field = COLUMN_MAP[header];
      if (field) fields[field] = value.trim();
    });
    return { fields, raw, rowNumber: i + 1 };
  });

  return { headers, rows, unknownHeaders, missingHeaders };
}
