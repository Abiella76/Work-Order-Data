import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { computeMetrics, customerMix } from '../lib/kpi/metrics';
import { buildPeriodView, backlogSeries, DEFAULT_FILTERS } from '../lib/kpi/period';
import { buildInsights } from '../lib/kpi/insights';
import { formatMoney, formatPct } from '../lib/kpi/money';
import { dollars, loadFixtureDays } from './helpers';

/**
 * KPI fixtures over the synthetic report set.
 *
 * The synthetic files deliberately reproduce every data-quality fact observed
 * in the real source: a Project ID used by several work orders, invoiced rows
 * with no vendor cost or margin captured, a blank Received date, a leading
 * space in Project, comma-bearing vendor names inside a multi-value cell, an
 * unrecognised status, and two zero-row weekend reports.
 */
const days = loadFixtureDays(join(__dirname, 'fixtures'));

const [thu, fri, sat, sun] = days;

describe('fixture set', () => {
  it('loads four consecutive daily reports', () => {
    expect(days.map((d) => d.reportDate)).toEqual([
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('classifies the weekend files as weekend days', () => {
    expect(days.map((d) => d.isWeekend)).toEqual([false, false, true, true]);
  });

  it('accepts a header-only file as a valid zero-row report', () => {
    expect(sat.rows).toHaveLength(0);
    expect(sun.rows).toHaveLength(0);
  });
});

describe('Thursday 2026-09-17', () => {
  const m = thu.metrics;

  it('counts receipts and distinct projects separately', () => {
    expect(m.newCount).toBe(5);
    // Five receipt rows across three Project IDs — Project ID is not a key.
    expect(m.newProjects).toBe(3);
  });

  it('counts invoiced rows and net movement', () => {
    expect(m.invoicedCount).toBe(4);
    expect(m.netMovement).toBe(1);
  });

  it('computes throughput as invoiced over received', () => {
    expect(m.throughput).toBeCloseTo(0.8, 10);
    expect(formatPct(m.throughput)).toBe('80.0%');
  });

  it('sums revenue and vendor cost to the penny', () => {
    expect(m.revenue).toBe(dollars(5000));
    expect(formatMoney(m.revenue)).toBe('$5,000.00');
    // The row with a blank Vendor Cost contributes nothing, and is not read as 0.
    expect(m.vendorCost).toBe(dollars(2700));
  });

  it('excludes rows with no gross margin from both sides of the margin ratio', () => {
    expect(m.grossProfit).toBe(dollars(1800));
    expect(m.marginBase).toBe(dollars(4500));
    expect(m.grossMarginPct).toBeCloseTo(0.4, 10);
    // The $500 invoice with no margin captured is revenue but not margin base.
    expect(m.unpricedRevenue).toBe(dollars(500));
  });

  it('sums authorization over receipt rows without deduping by project', () => {
    expect(m.newAuthorized).toBe(dollars(15000));
    expect(m.authorizationRemaining).toBe(dollars(1500));
  });
});

describe('Friday 2026-09-18', () => {
  const m = fri.metrics;

  it('reports a negative net movement when invoicing outpaces receipts', () => {
    expect(m.newCount).toBe(2);
    expect(m.newProjects).toBe(1);
    expect(m.invoicedCount).toBe(3);
    expect(m.netMovement).toBe(-1);
    expect(formatPct(m.throughput)).toBe('150.0%');
  });

  it('computes a different margin rate from Thursday', () => {
    expect(m.revenue).toBe(dollars(2400));
    expect(m.grossProfit).toBe(dollars(500));
    expect(m.marginBase).toBe(dollars(2000));
    expect(formatPct(m.grossMarginPct)).toBe('25.0%');
  });

  it('counts an unrecognised status in no KPI', () => {
    expect(m.otherCount).toBe(1);
    // The cancelled row carries $9,999 of authorization that must not appear.
    expect(m.newAuthorized).toBe(dollars(5000));
    expect(m.newCount).toBe(2);
  });
});

describe('zero-activity weekend reports', () => {
  it('renders undefined ratios as an em dash, never 0% or NaN', () => {
    for (const day of [sat, sun]) {
      expect(day.metrics.newCount).toBe(0);
      expect(day.metrics.throughput).toBeNull();
      expect(day.metrics.grossMarginPct).toBeNull();
      expect(formatPct(day.metrics.throughput)).toBe('—');
    }
  });
});

describe('combined period', () => {
  const view = buildPeriodView(days, DEFAULT_FILTERS);
  const m = view.aggregate;

  it('aggregates counts over the union of the period rows', () => {
    expect(m.newCount).toBe(7);
    expect(m.newProjects).toBe(4);
    expect(m.invoicedCount).toBe(7);
    expect(m.netMovement).toBe(0);
    expect(formatPct(m.throughput)).toBe('100.0%');
  });

  it('aggregates money to the penny', () => {
    expect(formatMoney(m.revenue)).toBe('$7,400.00');
    expect(formatMoney(m.vendorCost)).toBe('$3,900.00');
    expect(formatMoney(m.grossProfit)).toBe('$2,300.00');
    expect(formatMoney(m.marginBase)).toBe('$6,500.00');
    expect(formatMoney(m.newAuthorized)).toBe('$20,000.00');
    expect(formatMoney(m.authorizationRemaining)).toBe('$1,750.00');
    expect(formatMoney(m.unpricedRevenue)).toBe('$900.00');
  });

  it('weights gross margin rather than averaging the daily rates', () => {
    // 2300 / 6500 = 35.4%. The unweighted mean of 40.0% and 25.0% is 32.5%.
    expect(formatPct(m.grossMarginPct)).toBe('35.4%');
    expect(formatPct(m.grossMarginPct)).not.toBe('32.5%');
  });

  it('separates calendar days from business days', () => {
    expect(view.calendarDays).toBe(4);
    expect(view.businessDays).toBe(2);
    // Weekend zero-activity days must not drag the business-day rate down.
    expect(m.newCount / view.businessDays).toBe(3.5);
    expect(m.newCount / view.calendarDays).toBe(1.75);
  });
});

describe('period filters', () => {
  it('restricts to business days', () => {
    const view = buildPeriodView(days, { ...DEFAULT_FILTERS, range: 'business' });
    expect(view.calendarDays).toBe(2);
    expect(view.businessDays).toBe(2);
    expect(view.aggregate.newCount).toBe(7);
  });

  it('restricts to a single report date', () => {
    const view = buildPeriodView(days, { ...DEFAULT_FILTERS, range: '2026-09-17' });
    expect(view.aggregate.newCount).toBe(5);
    expect(view.aggregate.invoicedCount).toBe(4);
  });

  it('filters by customer across both cards and per-day metrics', () => {
    const view = buildPeriodView(days, { ...DEFAULT_FILTERS, customer: 'Northwind Facilities' });
    expect(view.aggregate.newCount).toBe(4);
    expect(view.aggregate.revenue).toBe(dollars(2700));
    // The per-day series agrees with the aggregate.
    const summed = view.days.reduce((n, d) => n + d.metrics.newCount, 0);
    expect(summed).toBe(view.aggregate.newCount);
  });

  it('filters by type', () => {
    const view = buildPeriodView(days, { ...DEFAULT_FILTERS, type: 'PO' });
    expect(view.aggregate.newCount).toBe(1);
    expect(view.aggregate.invoicedCount).toBe(2);
  });

  it('offers the distinct customers and types found in the data', () => {
    const view = buildPeriodView(days, DEFAULT_FILTERS);
    expect(view.customers).toEqual([
      'Cascade Retail Group',
      'Northwind Facilities',
      'Summit Health Partners',
    ]);
    expect(view.types).toEqual(['PO', 'WO']);
  });
});

describe('customer mix', () => {
  const view = buildPeriodView(days, DEFAULT_FILTERS);
  const mix = customerMix(view.aggregate);

  it('sorts by invoiced revenue and shares sum to one', () => {
    expect(mix[0].customer).toBe('Cascade Retail Group');
    expect(mix[0].revenue).toBe(dollars(2800));
    const total = mix.reduce((n, m) => n + m.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('includes a customer that has receipts but no invoicing', () => {
    expect(mix.map((m) => m.customer)).toContain('Summit Health Partners');
  });
});

describe('backlog series', () => {
  it('is a running sum of net movement when no opening count exists', () => {
    const series = backlogSeries(days, 0);
    expect(series.map((p) => p.value)).toEqual([1, 0, 0, 0]);
  });

  it('is seeded by the opening backlog when one is loaded', () => {
    const series = backlogSeries(days, 40);
    expect(series.map((p) => p.value)).toEqual([41, 40, 40, 40]);
  });
});

describe('insights', () => {
  const view = buildPeriodView(days, DEFAULT_FILTERS);

  it('names the weekend files as confirmed zero activity', () => {
    const zero = buildInsights({ view, openingBacklog: 0 }).find((i) => i.id === 'zero-activity');
    expect(zero?.text).toContain('Sat 19');
    expect(zero?.text).toContain('Sun 20');
  });

  it('explains the margin denominator when revenue carries no cost', () => {
    const unpriced = buildInsights({ view, openingBacklog: 0 }).find(
      (i) => i.id === 'unpriced-revenue',
    );
    expect(unpriced?.text).toContain('$900.00');
    expect(unpriced?.text).toContain('$6,500.00');
  });

  it('warns that Project ID is not a unique key', () => {
    const insights = buildInsights({ view, openingBacklog: 0 });
    expect(insights.find((i) => i.id === 'project-id-not-key')?.text).toContain(
      '7 receipt rows resolve to 4 distinct Project IDs',
    );
  });

  it('flags the unrecognised status', () => {
    const insights = buildInsights({ view, openingBacklog: 0 });
    expect(insights.find((i) => i.id === 'unknown-status')?.text).toContain('counted in no KPI');
  });

  it('drops the opening-backlog caveat once a snapshot exists', () => {
    const without = buildInsights({ view, openingBacklog: 0 });
    const withSnapshot = buildInsights({ view, openingBacklog: 40 });
    expect(without.some((i) => i.id === 'no-opening-backlog')).toBe(true);
    expect(withSnapshot.some((i) => i.id === 'no-opening-backlog')).toBe(false);
  });
});

describe('empty period', () => {
  it('produces no NaN and no divide-by-zero', () => {
    const m = computeMetrics([]);
    expect(m.throughput).toBeNull();
    expect(m.grossMarginPct).toBeNull();
    expect(m.revenue).toBe(0);
    expect(formatPct(m.throughput)).toBe('—');
    expect(formatMoney(m.revenue)).toBe('$0.00');
  });
});
