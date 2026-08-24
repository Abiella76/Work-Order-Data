import { customerMix } from './metrics';
import { formatMoney } from './money';
import type { PeriodView } from './period';

/**
 * Executive insights.
 *
 * Every item is deterministic — a pure function of the computed period metrics.
 * The list is an array of rules rather than inline branches so a later AI layer
 * can append richer items without touching KPI math, and so an insight can be
 * unit-tested on its own. A rule returns null when it has nothing to say.
 *
 * `tone: 'accent'` marks the items that want attention. There is no red or
 * green here by design: the palette signals emphasis, not good-versus-bad.
 */
export interface Insight {
  id: string;
  text: string;
  tone: 'accent' | 'neutral';
}

export interface InsightContext {
  view: PeriodView;
  openingBacklog: number;
}

type InsightRule = (ctx: InsightContext) => Insight | null;

const netMovementRule: InsightRule = ({ view }) => {
  const business = view.days.filter((d) => !d.isWeekend);
  if (business.length === 0) return null;
  const growing = business.filter((d) => d.metrics.netMovement > 0).length;
  const net = view.aggregate.netMovement;
  return {
    id: 'net-movement',
    tone: 'accent',
    text:
      `Incoming work exceeded invoicing on ${growing} of ${business.length} business ` +
      `${business.length === 1 ? 'day' : 'days'}; net backlog movement for the period is ` +
      `${net > 0 ? '+' : ''}${net} work orders.`,
  };
};

const throughputTrendRule: InsightRule = ({ view }) => {
  const business = view.days.filter((d) => !d.isWeekend);
  const first = business[0];
  const last = business[business.length - 1];
  if (!first || !last || first === last) return null;
  if (first.metrics.throughput == null || last.metrics.throughput == null) return null;

  const declined = last.metrics.throughput < first.metrics.throughput;
  const revenueDirection = last.metrics.revenue > first.metrics.revenue ? 'higher' : 'lower';
  return {
    id: 'throughput-trend',
    tone: declined ? 'accent' : 'neutral',
    text:
      `Throughput moved from ${(first.metrics.throughput * 100).toFixed(0)}% on ${first.label} ` +
      `to ${(last.metrics.throughput * 100).toFixed(0)}% on ${last.label}, on ${revenueDirection} ` +
      `invoiced revenue.`,
  };
};

const zeroActivityRule: InsightRule = ({ view }) => {
  const zero = view.days.filter(
    (d) => d.isWeekend && d.metrics.newCount + d.metrics.invoicedCount === 0,
  );
  if (zero.length === 0) return null;
  return {
    id: 'zero-activity',
    tone: 'neutral',
    text:
      `${zero.map((d) => d.label).join(' and ')} ${zero.length === 1 ? 'is a' : 'are'} confirmed ` +
      `zero-activity ${zero.length === 1 ? 'report' : 'reports'} — received and processed, not ` +
      `missing imports. Business-day averages exclude them.`,
  };
};

const topCustomerRule: InsightRule = ({ view }) => {
  const top = customerMix(view.aggregate)[0];
  if (!top || top.revenue <= 0) return null;
  return {
    id: 'top-customer',
    tone: 'neutral',
    text: `${top.customer} accounts for ${Math.round(top.share * 100)}% of invoiced revenue in this period.`,
  };
};

const unpricedRevenueRule: InsightRule = ({ view }) => {
  const { unpricedRevenue, marginBase, revenue } = view.aggregate;
  if (unpricedRevenue <= 0) return null;
  return {
    id: 'unpriced-revenue',
    tone: 'accent',
    text:
      `${formatMoney(unpricedRevenue)} of invoiced revenue carries no vendor cost or margin, so ` +
      `gross margin is weighted on ${formatMoney(marginBase)} rather than the full ${formatMoney(revenue)}.`,
  };
};

const projectIdRule: InsightRule = ({ view }) => {
  const { newCount, newProjects } = view.aggregate;
  if (newCount - newProjects <= 0) return null;
  return {
    id: 'project-id-not-key',
    tone: 'neutral',
    text:
      `${newCount} receipt rows resolve to ${newProjects} distinct Project IDs — Project ID alone ` +
      `is not a unique work-order key.`,
  };
};

const openingBacklogRule: InsightRule = ({ openingBacklog }) => {
  if (openingBacklog > 0) return null;
  return {
    id: 'no-opening-backlog',
    tone: 'neutral',
    text:
      'No opening backlog count is loaded, so the trend chart shows cumulative movement, not ' +
      'current backlog.',
  };
};

const unknownStatusRule: InsightRule = ({ view }) => {
  const other = view.aggregate.otherCount;
  if (other === 0) return null;
  return {
    id: 'unknown-status',
    tone: 'accent',
    text:
      `${other} ${other === 1 ? 'row carries' : 'rows carry'} a status outside Received/Invoiced ` +
      `and ${other === 1 ? 'is' : 'are'} counted in no KPI. Check the import log.`,
  };
};

/** Evaluated in display order. */
export const INSIGHT_RULES: readonly InsightRule[] = [
  netMovementRule,
  throughputTrendRule,
  zeroActivityRule,
  topCustomerRule,
  unpricedRevenueRule,
  projectIdRule,
  unknownStatusRule,
  openingBacklogRule,
];

export function buildInsights(ctx: InsightContext): Insight[] {
  return INSIGHT_RULES.map((rule) => rule(ctx)).filter((i): i is Insight => i !== null);
}
