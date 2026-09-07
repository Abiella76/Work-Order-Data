import { describe, expect, it } from 'vitest';
import {
  annualisedRunRate,
  concentration,
  corporateInsights,
  duplicateCandidates,
  periodMonths,
  periodTotals,
  statusSplit,
  summariseClients,
  type ClientRow,
  type Period,
} from '../lib/kpi/corporate';
import { formatMoney } from '../lib/kpi/money';
import { parseClientRevenueCsv } from '../lib/import/client-revenue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dollars } from './helpers';

/**
 * Corporate snapshot maths, over a synthetic client set shaped like the real
 * finance report: a full fiscal year, a second year in which some accounts go
 * quiet, and a current statement that covers only part of a year — plus a
 * credit, an explicit zero, an absent period, and two names that differ only by
 * a suffix.
 */

const PERIODS: Period[] = [
  {
    key: 'FY2024',
    label: 'FY2024',
    startsOn: '2024-01-01',
    endsOn: '2024-12-31',
    isPartial: false,
    sourceTotal: dollars(200000),
    sortOrder: 1,
  },
  {
    key: 'FY2025',
    label: 'FY2025',
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    isPartial: false,
    sourceTotal: null,
    sortOrder: 2,
  },
  {
    key: 'STATEMENT',
    label: 'Nov 2025 – Sep 2026',
    startsOn: '2025-11-01',
    endsOn: '2026-09-03',
    isPartial: true,
    sourceTotal: dollars(1000000),
    sortOrder: 3,
  },
];

const CLIENTS: ClientRow[] = [
  { name: 'Northwind Facilities', status: 'active', revenue: { STATEMENT: dollars(500000) } },
  { name: 'Cascade Retail Group', status: 'active', revenue: { STATEMENT: dollars(250000) } },
  { name: 'Summit Health Partners', status: 'active', revenue: { STATEMENT: dollars(250000) } },
  // Had a year, then nothing: the absent FY2025 key is "no activity".
  { name: 'Lakeshore Logistics', status: 'inactive', revenue: { FY2024: dollars(120000) } },
  // An explicit zero is a different fact from an absent period.
  { name: 'Vantage Financial Group', status: 'inactive', revenue: { FY2024: dollars(80000), FY2025: 0 } },
  { name: 'Harbor Point Services', status: 'inactive', revenue: { FY2024: dollars(-40000) } },
  { name: 'Northwind Facilities Inc', status: 'inactive', revenue: { FY2024: dollars(10000) } },
];

const summaries = summariseClients(CLIENTS, PERIODS);
const totals = periodTotals(CLIENTS, PERIODS);

describe('period totals', () => {
  it('nets credits against billed revenue and reports both', () => {
    const fy24 = totals.find((t) => t.period.key === 'FY2024')!;
    expect(formatMoney(fy24.gross)).toBe('$210,000.00');
    expect(formatMoney(fy24.credits)).toBe('-$40,000.00');
    expect(formatMoney(fy24.total)).toBe('$170,000.00');
  });

  it('counts an explicit zero as activity but an absent period as none', () => {
    const fy25 = totals.find((t) => t.period.key === 'FY2025')!;
    // Only Vantage has an FY2025 row, and it is $0.00.
    expect(fy25.clientCount).toBe(1);
    expect(fy25.total).toBe(0);
  });

  it('reports the gap against the source report rather than hiding it', () => {
    const fy24 = totals.find((t) => t.period.key === 'FY2024')!;
    // Stated $200,000 against $170,000 of loaded rows.
    expect(formatMoney(fy24.reconciliationGap!)).toBe('$30,000.00');
    const statement = totals.find((t) => t.period.key === 'STATEMENT')!;
    expect(statement.reconciliationGap).toBe(0);
  });

  it('leaves the gap null when the source stated no total', () => {
    expect(totals.find((t) => t.period.key === 'FY2025')!.reconciliationGap).toBeNull();
  });

  it('orders periods oldest first regardless of input order', () => {
    expect(totals.map((t) => t.period.key)).toEqual(['FY2024', 'FY2025', 'STATEMENT']);
  });
});

describe('partial periods', () => {
  const statement = PERIODS[2];

  it('measures the span rather than assuming a year', () => {
    expect(periodMonths(statement)).toBeCloseTo(10.1, 1);
  });

  it('annualises a partial period as a separate estimate', () => {
    const actual = totals.find((t) => t.period.key === 'STATEMENT')!.total;
    expect(formatMoney(actual)).toBe('$1,000,000.00');
    const runRate = annualisedRunRate(actual, statement);
    // Ten months of $1.0M projects to about $1.19M over twelve.
    expect(formatMoney(runRate!)).toBe('$1,188,118.81');
    expect(runRate).toBeGreaterThan(actual);
  });

  it('never annualises a complete period', () => {
    expect(annualisedRunRate(dollars(100000), PERIODS[0])).toBeNull();
  });
});

describe('client summaries', () => {
  it('ranks by current-period revenue', () => {
    expect(summaries.slice(0, 3).map((c) => c.name)).toEqual([
      'Northwind Facilities',
      'Cascade Retail Group',
      'Summit Health Partners',
    ]);
  });

  it('reports the last period in which an account had activity', () => {
    const lakeshore = summaries.find((c) => c.name === 'Lakeshore Logistics')!;
    expect(lakeshore.lastActivePeriod?.key).toBe('FY2024');
    const vantage = summaries.find((c) => c.name === 'Vantage Financial Group')!;
    // A $0.00 row is still activity — it was reported on.
    expect(vantage.lastActivePeriod?.key).toBe('FY2025');
  });

  it('gives no current-period share to an account absent from it', () => {
    const lakeshore = summaries.find((c) => c.name === 'Lakeshore Logistics')!;
    expect(lakeshore.current).toBeNull();
    expect(lakeshore.currentShare).toBeNull();
  });

  it('computes share of the current period for active accounts', () => {
    const northwind = summaries.find((c) => c.name === 'Northwind Facilities')!;
    expect(northwind.currentShare).toBeCloseTo(0.5, 10);
  });

  it('flags accounts carrying credits', () => {
    expect(summaries.find((c) => c.name === 'Harbor Point Services')!.hasCredits).toBe(true);
    expect(summaries.find((c) => c.name === 'Northwind Facilities')!.hasCredits).toBe(false);
  });
});

describe('status split', () => {
  const split = statusSplit(summaries);

  it('counts active against inactive', () => {
    expect(split.active).toBe(3);
    expect(split.inactive).toBe(4);
    expect(split.total).toBe(7);
  });

  it('totals what the inactive group historically produced', () => {
    // 120,000 + 80,000 + 0 − 40,000 + 10,000
    expect(formatMoney(split.inactiveLifetime)).toBe('$170,000.00');
  });

  it('totals what the active group is producing now', () => {
    expect(formatMoney(split.activeCurrent)).toBe('$1,000,000.00');
  });
});

describe('concentration', () => {
  it('measures the share resting on the largest accounts', () => {
    const c = concentration(summaries, 2);
    expect(c.names).toEqual(['Northwind Facilities', 'Cascade Retail Group']);
    expect(c.share).toBeCloseTo(0.75, 10);
    expect(formatMoney(c.amount)).toBe('$750,000.00');
  });

  it('ignores accounts with no current-period revenue', () => {
    const c = concentration(summaries, 10);
    expect(c.names).toHaveLength(3);
    expect(c.share).toBeCloseTo(1, 10);
  });

  it('returns a zero share rather than NaN when nothing is current', () => {
    const c = concentration(
      summariseClients([{ name: 'X', status: 'inactive', revenue: { FY2024: 100 } }], PERIODS),
      5,
    );
    expect(c.share).toBe(0);
    expect(Number.isNaN(c.share)).toBe(false);
  });
});

describe('duplicate candidates', () => {
  it('groups names that differ only by a corporate suffix', () => {
    const dupes = duplicateCandidates(summaries);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].names.sort()).toEqual(['Northwind Facilities', 'Northwind Facilities Inc']);
  });

  it('reports what the pair would be worth combined, without merging it', () => {
    const dupes = duplicateCandidates(summaries);
    expect(formatMoney(dupes[0].combined)).toBe('$510,000.00');
    // The accounts stay separate in the summaries themselves.
    expect(summaries.filter((c) => c.name.startsWith('Northwind'))).toHaveLength(2);
  });
});

describe('insights', () => {
  const split = statusSplit(summaries);
  const insights = corporateInsights({ summaries, totals, split });
  const byId = (id: string) => insights.find((i) => i.id === id);

  it('leads with the active/inactive split and what lapsed', () => {
    expect(byId('status-split')?.text).toContain('3 of 7 accounts are active');
    expect(byId('status-split')?.text).toContain('$170,000.00');
  });

  it('warns when a partial period is being read as a year', () => {
    const text = byId('partial-period')?.text ?? '';
    expect(text).toContain('not a full year');
    expect(text).toContain('$1,188,118.81');
  });

  it('surfaces the reconciliation gap', () => {
    expect(byId('reconciliation')?.text).toContain('$30,000.00');
  });

  it('names the credits against the gross', () => {
    expect(byId('credits')?.text).toContain('-$40,000.00');
    expect(byId('credits')?.text).toContain('$210,000.00');
  });

  it('flags concentration as accent when it passes half the revenue', () => {
    expect(byId('concentration')?.tone).toBe('accent');
  });

  it('reports duplicate name candidates without merging them', () => {
    expect(byId('duplicates')?.text).toContain('business decision');
  });
});

describe('empty input', () => {
  it('produces no NaN and no crash', () => {
    const empty = summariseClients([], PERIODS);
    const split = statusSplit(empty);
    expect(split.total).toBe(0);
    expect(concentration(empty).share).toBe(0);
    expect(periodTotals([], PERIODS).every((t) => t.total === 0)).toBe(true);
    expect(corporateInsights({ summaries: empty, totals: periodTotals([], PERIODS), split })).toBeInstanceOf(Array);
  });
});

describe('client revenue CSV parsing', () => {
  const csv = readFileSync(
    join(__dirname, 'fixtures-clients', 'client-revenue-synthetic.csv'),
    'utf8',
  );
  const KEYS = ['FY2024', 'FY2025', 'STATEMENT'];

  it('reads every account and period', () => {
    const parsed = parseClientRevenueCsv(csv, KEYS);
    expect(parsed.clients).toBe(7);
    expect(parsed.periods.sort()).toEqual(['FY2024', 'FY2025', 'STATEMENT']);
    expect(parsed.issues).toEqual([]);
  });

  it('treats an em dash as no activity, not zero', () => {
    const parsed = parseClientRevenueCsv(csv, KEYS);
    const lakeshore = parsed.rows.filter((r) => r.client === 'Lakeshore Logistics');
    expect(lakeshore.find((r) => r.period === 'FY2024')?.amount).toBe(dollars(120000));
    // The FY2025 row exists in the file but carries no amount.
    expect(lakeshore.find((r) => r.period === 'FY2025')?.amount).toBeNull();
  });

  it('keeps an explicit zero as a real amount', () => {
    const parsed = parseClientRevenueCsv(csv, KEYS);
    const vantage = parsed.rows.find(
      (r) => r.client === 'Vantage Financial Group' && r.period === 'FY2025',
    );
    expect(vantage?.amount).toBe(0);
  });

  it('parses negative amounts as credits', () => {
    const parsed = parseClientRevenueCsv(csv, KEYS);
    const harbor = parsed.rows.find((r) => r.client === 'Harbor Point Services');
    expect(harbor?.amount).toBe(dollars(-40000));
  });

  it('skips and reports an unknown period rather than inventing one', () => {
    const parsed = parseClientRevenueCsv(
      'Client,Period,Amount,Status\nAcme,FY1999,"$1.00",Active\n',
      KEYS,
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues[0]).toContain('unknown period');
  });

  it('skips and reports an unrecognised status', () => {
    const parsed = parseClientRevenueCsv(
      'Client,Period,Amount,Status\nAcme,FY2024,"$1.00",Pending\n',
      KEYS,
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues[0]).toContain('unrecognised status');
  });
});
