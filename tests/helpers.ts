import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseReportCsv } from '../lib/csv/parse';
import { normalizeRows } from '../lib/csv/normalize';
import { makeDayData, type DayData } from '../lib/kpi/period';

/** Read the report date out of `…-YYYY-MM-DD.csv`. */
function dateFromFilename(filename: string): string | null {
  return filename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/** Load a directory of daily report CSVs into `DayData`, oldest first. */
export function loadFixtureDays(dir: string): DayData[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .sort()
    .map((filename) => {
      const content = readFileSync(join(dir, filename), 'utf8');
      const parsed = parseReportCsv(content);
      const { rows } = normalizeRows(parsed.rows);
      const reportDate = dateFromFilename(filename);
      if (!reportDate) throw new Error(`Fixture ${filename} has no date in its name.`);
      return makeDayData({ reportDate, filename, rows });
    });
}

/** Dollars as a number -> integer cents, for readable expectations in tests. */
export function dollars(amount: number): number {
  return Math.round(amount * 100);
}
