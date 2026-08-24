import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPeriodView, DEFAULT_FILTERS } from '../lib/kpi/period';
import { formatMoney, formatPct } from '../lib/kpi/money';
import { loadFixtureDays } from './helpers';

/**
 * The reconciled validation table from the design handoff, asserted against the
 * four real daily reports.
 *
 * Neither the reports nor their expected figures are committed: the CSVs carry
 * customer names, vendor names and invoice numbers, and the expected values are
 * the business's own revenue and margin. This repository is public, so both
 * live in the gitignored `tests/fixtures-real/` and this file holds only the
 * assertion structure.
 *
 * To run these locally, put the four CSVs and `expected.json` in that
 * directory — see README.md, "Validating against the real reports". The suite
 * skips rather than fails when they are absent, so CI stays green without ever
 * seeing customer data. The synthetic fixtures in `tests/fixtures/` cover the
 * same code paths and always run.
 */

interface ExpectedDay {
  reportDate: string;
  zeroActivity?: boolean;
  newCount?: number;
  newProjects?: number;
  invoicedCount?: number;
  netMovement?: number;
  throughput?: string;
  revenue?: string;
  newAuthorized?: string;
  vendorCost?: string;
  grossProfit?: string;
  marginBase?: string;
  grossMarginPct?: string;
}

interface Expected {
  days: ExpectedDay[];
  combined: Required<Omit<ExpectedDay, 'reportDate' | 'zeroActivity'>>;
  calendarDays: number;
  businessDays: number;
  businessDayAverages: { new: string; invoiced: string; revenue: string };
  calendarDayAverages: { new: string; invoiced: string; revenue: string };
}

const dir = join(__dirname, 'fixtures-real');
const expectedPath = join(dir, 'expected.json');

const days = loadFixtureDays(dir);
const expected: Expected | null = existsSync(expectedPath)
  ? (JSON.parse(readFileSync(expectedPath, 'utf8')) as Expected)
  : null;

const ready = expected !== null && days.length === expected.days.length;

const SUITE = 'real daily reports — handoff validation table';

// The guard is an `if`, not `describe.skipIf`: a skipped suite still has its
// body evaluated during collection, so anything reading `expected` would throw
// on a checkout without the fixtures — which is every CI run.
if (!ready) {
  describe(SUITE, () => {
    it.skip('tests/fixtures-real/ has no reports and expected.json (see README)', () => {});
  });
}

if (ready) describeRealReports(expected!);

function describeRealReports(e: Expected) {
  describe(SUITE, () => {
    const view = buildPeriodView(days, DEFAULT_FILTERS);

    it('loads the reports named in the expectations, in order', () => {
      expect(days.map((d) => d.reportDate)).toEqual(e.days.map((d) => d.reportDate));
    });

    it.each(e.days.filter((d) => !d.zeroActivity).map((d) => [d.reportDate, d] as const))(
      'matches every metric for %s',
      (reportDate, want) => {
        const day = days.find((d) => d.reportDate === reportDate);
        expect(day, `no report loaded for ${reportDate}`).toBeDefined();
        const m = day!.metrics;

        expect(m.newCount).toBe(want.newCount);
        expect(m.newProjects).toBe(want.newProjects);
        expect(m.invoicedCount).toBe(want.invoicedCount);
        expect(m.netMovement).toBe(want.netMovement);
        expect(formatPct(m.throughput)).toBe(want.throughput);
        expect(formatMoney(m.revenue)).toBe(want.revenue);
        expect(formatMoney(m.newAuthorized)).toBe(want.newAuthorized);
        expect(formatMoney(m.vendorCost)).toBe(want.vendorCost);
        expect(formatMoney(m.grossProfit)).toBe(want.grossProfit);
        expect(formatMoney(m.marginBase)).toBe(want.marginBase);
        expect(formatPct(m.grossMarginPct)).toBe(want.grossMarginPct);
      },
    );

    it.each(e.days.filter((d) => d.zeroActivity).map((d) => [d.reportDate] as const))(
      'treats %s as a valid zero-activity report',
      (reportDate) => {
        const day = days.find((d) => d.reportDate === reportDate)!;
        expect(day.rows).toHaveLength(0);
        expect(day.isWeekend).toBe(true);
        expect(day.metrics.newCount).toBe(0);
        expect(day.metrics.invoicedCount).toBe(0);
        // A zero-received day has no throughput — an em dash, never 0% or NaN.
        expect(day.metrics.throughput).toBeNull();
        expect(day.metrics.grossMarginPct).toBeNull();
        expect(formatMoney(day.metrics.revenue)).toBe('$0.00');
      },
    );

    it('matches every combined metric', () => {
      const m = view.aggregate;
      const want = e.combined;

      expect(m.newCount).toBe(want.newCount);
      expect(m.newProjects).toBe(want.newProjects);
      expect(m.invoicedCount).toBe(want.invoicedCount);
      expect(m.netMovement).toBe(want.netMovement);
      expect(formatPct(m.throughput)).toBe(want.throughput);
      expect(formatMoney(m.revenue)).toBe(want.revenue);
      expect(formatMoney(m.newAuthorized)).toBe(want.newAuthorized);
      expect(formatMoney(m.vendorCost)).toBe(want.vendorCost);
      expect(formatMoney(m.grossProfit)).toBe(want.grossProfit);
      expect(formatMoney(m.marginBase)).toBe(want.marginBase);
      expect(formatPct(m.grossMarginPct)).toBe(want.grossMarginPct);
    });

    it('weights the combined margin rather than averaging the daily rates', () => {
      const daily = e.days
        .filter((d) => d.grossMarginPct)
        .map((d) => Number.parseFloat(d.grossMarginPct!));
      const unweightedMean = daily.reduce((a, b) => a + b, 0) / daily.length;

      expect(formatPct(view.aggregate.grossMarginPct)).toBe(e.combined.grossMarginPct);
      expect(formatPct(view.aggregate.grossMarginPct)).not.toBe(`${unweightedMean.toFixed(1)}%`);
    });

    it('separates business days from calendar days', () => {
      expect(view.calendarDays).toBe(e.calendarDays);
      expect(view.businessDays).toBe(e.businessDays);
    });

    it('computes business-day averages excluding the zero-activity weekend', () => {
      const m = view.aggregate;
      expect((m.newCount / view.businessDays).toFixed(1)).toBe(e.businessDayAverages.new);
      expect((m.invoicedCount / view.businessDays).toFixed(1)).toBe(e.businessDayAverages.invoiced);
      expect(formatMoney(Math.round(m.revenue / view.businessDays))).toBe(
        e.businessDayAverages.revenue,
      );
    });

    it('computes calendar-day averages over every day in the period', () => {
      const m = view.aggregate;
      expect((m.newCount / view.calendarDays).toFixed(1)).toBe(e.calendarDayAverages.new);
      expect((m.invoicedCount / view.calendarDays).toFixed(1)).toBe(e.calendarDayAverages.invoiced);
      expect(formatMoney(Math.round(m.revenue / view.calendarDays))).toBe(
        e.calendarDayAverages.revenue,
      );
    });

    it('finds only the two documented status values', () => {
      const statuses = new Set(days.flatMap((d) => d.rows).map((r) => r.statusRaw));
      expect([...statuses].sort()).toEqual(['Invoiced', 'Received']);
      expect(view.aggregate.otherCount).toBe(0);
    });
  });
}
