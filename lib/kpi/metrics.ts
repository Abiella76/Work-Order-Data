import type { NormalizedRow } from '../csv/normalize';
import { sumCents, type Cents } from './money';

/**
 * The KPI layer: pure functions from normalized rows to metrics.
 *
 * Nothing here touches a database, a request, or the clock. That is what makes
 * the numbers auditable and what the fixture tests assert against.
 *
 * Two rules run through all of it:
 *   - A ratio with a zero denominator is null, never 0 and never NaN/Infinity.
 *     The UI renders null as an em dash.
 *   - Gross margin is weighted — profit over the revenue that actually carries
 *     margin. The source's per-row `Gross Margin %` column is stored but never
 *     averaged into a period figure.
 */

export interface Metrics {
  /** Rows received that day/period. */
  newCount: number;
  /** Distinct Project IDs among received rows. Project ID is not a unique key. */
  newProjects: number;
  /** Rows invoiced that day/period. */
  invoicedCount: number;
  /** newCount - invoicedCount; positive means the backlog grew. */
  netMovement: number;
  /** invoicedCount / newCount, or null when nothing was received. */
  throughput: number | null;

  /** Sum of Invoice Total over invoiced rows. */
  revenue: Cents;
  /** Sum of Vendor Cost over invoiced rows, nulls skipped. */
  vendorCost: Cents;
  /** Sum of Gross Margin over invoiced rows where it is populated. */
  grossProfit: Cents;
  /** Revenue of exactly those rows that carry a gross margin — the weighting base. */
  marginBase: Cents;
  /** grossProfit / marginBase, or null when no row carries margin. */
  grossMarginPct: number | null;
  /** Revenue with no cost captured against it. */
  unpricedRevenue: Cents;

  /** Sum of Customer Authorization over received rows — row sum, not deduped by project. */
  newAuthorized: Cents;
  /** Sum of Authorization Remaining over received rows. */
  authorizationRemaining: Cents;

  /** Rows whose status the status map does not recognise. */
  otherCount: number;

  newRows: NormalizedRow[];
  invoicedRows: NormalizedRow[];
}

/** Compute every metric over an arbitrary set of rows (one day, or a period). */
export function computeMetrics(rows: readonly NormalizedRow[]): Metrics {
  const newRows = rows.filter((r) => r.activity === 'new');
  const invoicedRows = rows.filter((r) => r.activity === 'invoiced');
  const otherCount = rows.filter((r) => r.activity === 'other').length;

  const revenue = sumCents(invoicedRows.map((r) => r.invoiceTotal));
  const vendorCost = sumCents(invoicedRows.map((r) => r.vendorCost));

  // Only rows that actually carry a margin contribute to either side of the
  // margin ratio — that is what makes it weighted rather than an average.
  const withMargin = invoicedRows.filter((r) => r.grossMargin != null);
  const grossProfit = sumCents(withMargin.map((r) => r.grossMargin));
  const marginBase = sumCents(withMargin.map((r) => r.invoiceTotal));

  const newCount = newRows.length;
  const invoicedCount = invoicedRows.length;

  const projectIds = new Set(
    newRows.map((r) => r.projectId).filter((id): id is string => id != null),
  );

  return {
    newCount,
    newProjects: projectIds.size,
    invoicedCount,
    netMovement: newCount - invoicedCount,
    throughput: newCount > 0 ? invoicedCount / newCount : null,

    revenue,
    vendorCost,
    grossProfit,
    marginBase,
    grossMarginPct: marginBase > 0 ? grossProfit / marginBase : null,
    unpricedRevenue: revenue - marginBase,

    newAuthorized: sumCents(newRows.map((r) => r.authorization)),
    authorizationRemaining: sumCents(newRows.map((r) => r.authorizationRemaining)),

    otherCount,
    newRows,
    invoicedRows,
  };
}

/** Revenue and receipt counts per customer, for the customer-mix panel. */
export interface CustomerMixEntry {
  customer: string;
  revenue: Cents;
  invoicedCount: number;
  newCount: number;
  /** Share of the period's invoiced revenue, 0..1. */
  share: number;
}

export function customerMix(metrics: Metrics): CustomerMixEntry[] {
  const byCustomer = new Map<string, { revenue: Cents; invoicedCount: number; newCount: number }>();
  const bucket = (name: string) => {
    let entry = byCustomer.get(name);
    if (!entry) {
      entry = { revenue: 0, invoicedCount: 0, newCount: 0 };
      byCustomer.set(name, entry);
    }
    return entry;
  };

  for (const row of metrics.invoicedRows) {
    const entry = bucket(row.customer ?? 'Unattributed');
    entry.revenue += row.invoiceTotal ?? 0;
    entry.invoicedCount += 1;
  }
  // A customer with receipts but no invoicing still belongs in the mix.
  for (const row of metrics.newRows) bucket(row.customer ?? 'Unattributed').newCount += 1;

  const total = metrics.revenue;
  return [...byCustomer.entries()]
    .map(([customer, e]) => ({
      customer,
      revenue: e.revenue,
      invoicedCount: e.invoicedCount,
      newCount: e.newCount,
      share: total > 0 ? e.revenue / total : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.customer.localeCompare(b.customer));
}

/** Divide a metric by a day count, guarding the zero-day case. */
export function perDay(value: number, days: number): number | null {
  return days > 0 ? value / days : null;
}
