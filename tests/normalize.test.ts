import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReportCsv } from '../lib/csv/parse';
import { normalizeRows, splitMultiValue } from '../lib/csv/normalize';
import { toActivity, EXPECTED_HEADERS } from '../lib/csv/column-map';
import { parseMoney, formatMoney, formatMoneyCompact, sumCents } from '../lib/kpi/money';
import { reportDateFromFilename, checksumOf } from '../lib/import/ingest';
import { weekdayOf, isWeekend } from '../lib/kpi/period';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('column map', () => {
  it('covers all 21 verified source columns', () => {
    expect(EXPECTED_HEADERS).toHaveLength(21);
    expect(EXPECTED_HEADERS[0]).toBe('Status');
    expect(EXPECTED_HEADERS.at(-1)).toBe('Authorization Remaining');
  });

  it('maps every header in a real report header row', () => {
    const parsed = parseReportCsv(fixture('synthetic-2026-09-17.csv'));
    expect(parsed.unknownHeaders).toEqual([]);
    expect(parsed.missingHeaders).toEqual([]);
  });
});

describe('status map', () => {
  it('recognises the two statuses present in the source', () => {
    expect(toActivity('Received')).toBe('new');
    expect(toActivity('Invoiced')).toBe('invoiced');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(toActivity('  invoiced ')).toBe('invoiced');
    expect(toActivity('RECEIVED')).toBe('new');
  });

  it('falls back to `other` rather than guessing', () => {
    expect(toActivity('Cancelled')).toBe('other');
    expect(toActivity('')).toBe('other');
  });
});

describe('CSV parsing', () => {
  it('keeps quoted fields containing commas intact', () => {
    const parsed = parseReportCsv(fixture('synthetic-2026-09-17.csv'));
    const row = parsed.rows[0];
    expect(row.fields.vendors).toBe('Acme Plumbing & Heating Co., Inc., Borealis Energy');
    expect(row.fields.customer).toBe('Northwind Facilities');
  });

  it('treats a header-only file as zero rows, not an error', () => {
    const parsed = parseReportCsv(fixture('synthetic-2026-09-19.csv'));
    expect(parsed.headers).toHaveLength(21);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.missingHeaders).toEqual([]);
  });

  it('preserves every original cell in the raw payload', () => {
    const parsed = parseReportCsv(fixture('synthetic-2026-09-17.csv'));
    expect(Object.keys(parsed.rows[0].raw)).toHaveLength(21);
    // Untrimmed, exactly as exported.
    expect(parsed.rows[3].raw['Project']).toBe(' Pest Control > Quarterly Service');
  });

  it('reports unknown and missing columns instead of dropping them', () => {
    const parsed = parseReportCsv('Status,Surprise\nReceived,x\n');
    expect(parsed.unknownHeaders).toEqual(['Surprise']);
    expect(parsed.missingHeaders).toContain('Invoice Total');
    expect(parsed.rows[0].raw['Surprise']).toBe('x');
  });
});

describe('multi-value cells', () => {
  it('splits a list without shredding comma-bearing company names', () => {
    expect(splitMultiValue('Acme Plumbing & Heating Co., Inc., Borealis Energy')).toEqual([
      'Acme Plumbing & Heating Co., Inc.',
      'Borealis Energy',
    ]);
  });

  it('keeps a single comma-bearing name as one entry', () => {
    expect(splitMultiValue('Harbor Point Plumbing & Heating Co., Inc.')).toEqual([
      'Harbor Point Plumbing & Heating Co., Inc.',
    ]);
  });

  it('splits plain invoice lists', () => {
    expect(splitMultiValue('INV-900093, INV-900094')).toEqual(['INV-900093', 'INV-900094']);
  });

  it('returns an empty list for a blank cell', () => {
    expect(splitMultiValue('')).toEqual([]);
    expect(splitMultiValue(undefined)).toEqual([]);
  });
});

describe('money parsing', () => {
  it('parses to exact cents', () => {
    expect(parseMoney('1272.5')).toBe(127250);
    expect(parseMoney('$1,272.50')).toBe(127250);
    expect(parseMoney('588')).toBe(58800);
    expect(parseMoney('0')).toBe(0);
  });

  it('distinguishes a blank cell from zero', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney('0')).toBe(0);
  });

  it('handles negatives in both notations', () => {
    expect(parseMoney('-500.00')).toBe(-50000);
    expect(parseMoney('(500.00)')).toBe(-50000);
  });

  it('sums without float drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floats; in cents it is exact.
    expect(sumCents([parseMoney('0.10'), parseMoney('0.20')])).toBe(30);
    const many = Array.from({ length: 1000 }, () => parseMoney('1272.53'));
    expect(sumCents(many)).toBe(127253000);
    expect(formatMoney(sumCents(many))).toBe('$1,272,530.00');
  });

  it('skips nulls when summing', () => {
    expect(sumCents([100, null, 200])).toBe(300);
  });

  it('formats with a sign outside the currency symbol', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-50000)).toBe('-$500.00');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoneyCompact(729953)).toBe('$7.3k');
    expect(formatMoneyCompact(58800)).toBe('$588');
  });
});

describe('normalization', () => {
  const parsed = parseReportCsv(fixture('synthetic-2026-09-17.csv'));
  const { rows, issues } = normalizeRows(parsed.rows);

  it('trims a leading space from Project but keeps the original', () => {
    const row = rows[3];
    expect(row.project).toBe('Pest Control > Quarterly Service');
    expect(row.raw['Project']).toBe(' Pest Control > Quarterly Service');
  });

  it('stores a blank Received date as null', () => {
    expect(rows[2].receivedDate).toBeNull();
  });

  it('keeps a Received date that predates the report date', () => {
    // The column is the work order's own receipt date, not the report date.
    expect(rows[0].receivedDate).toBe('2026-07-02');
  });

  it('stores missing vendor cost and margin as null, never 0', () => {
    const row = rows[2];
    expect(row.invoiceTotal).toBe(50000);
    expect(row.vendorCost).toBeNull();
    expect(row.grossMargin).toBeNull();
  });

  it('warns about an invoiced row with revenue but no margin', () => {
    const warning = issues.find((i) => i.message.includes('no Gross Margin'));
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('margin denominator');
  });

  it('keeps a row with an unrecognised status and warns', () => {
    const friday = normalizeRows(parseReportCsv(fixture('synthetic-2026-09-18.csv')).rows);
    const other = friday.rows.find((r) => r.activity === 'other');
    expect(other?.statusRaw).toBe('Cancelled');
    expect(friday.issues.some((i) => i.message.includes('Unrecognised Status'))).toBe(true);
  });
});

describe('report dates', () => {
  it('reads the report date from the filename', () => {
    expect(reportDateFromFilename('work-orders-2026-08-20.csv')).toBe('2026-08-20');
    expect(reportDateFromFilename('no-date-here.csv')).toBeNull();
  });

  it('computes the weekday in UTC so a calendar day never shifts', () => {
    expect(weekdayOf('2026-08-20')).toBe('Thu');
    expect(weekdayOf('2026-08-22')).toBe('Sat');
    expect(isWeekend('2026-08-22')).toBe(true);
    expect(isWeekend('2026-08-23')).toBe(true);
    expect(isWeekend('2026-08-24')).toBe(false);
  });
});

describe('checksums', () => {
  it('is stable for identical bytes and differs on any change', () => {
    const a = fixture('synthetic-2026-09-19.csv');
    expect(checksumOf(a)).toBe(checksumOf(a));
    expect(checksumOf(a)).toHaveLength(64);
    expect(checksumOf(a)).not.toBe(checksumOf(`${a}Received,WO,1,,,,,,,,,,,,,,,,,,\n`));
  });

  it('distinguishes the two zero-row weekend files only by content, not name', () => {
    // Both weekend files hold the same header row, so their checksums match —
    // which is why duplicate protection keys on report date *and* checksum.
    expect(checksumOf(fixture('synthetic-2026-09-19.csv'))).toBe(
      checksumOf(fixture('synthetic-2026-09-20.csv')),
    );
  });
});

describe('multi-value cells — name continuations', () => {
  it('keeps a city/state tail attached to the vendor name', () => {
    // The source writes this with a stray space before the comma.
    expect(splitMultiValue('Ridgeline Security Solutions Fairview , AL')).toEqual([
      'Ridgeline Security Solutions Fairview, AL',
    ]);
  });

  it('still splits two vendors whose names end in a suffix', () => {
    expect(
      splitMultiValue('Appliance Recovery of Lakeside LLC., Mr. Appliance of Lakeside'),
    ).toEqual(['Appliance Recovery of Lakeside LLC.', 'Mr. Appliance of Lakeside']);
  });

  it('splits a list whose entries carry state codes', () => {
    expect(splitMultiValue('Acme Services Austin, TX, Borealis Energy Denver, CO')).toEqual([
      'Acme Services Austin, TX',
      'Borealis Energy Denver, CO',
    ]);
  });
});
