import { formatMoney, formatPct } from '@/lib/kpi/money';
import type { PeriodView } from '@/lib/kpi/period';

interface Kpi {
  label: string;
  value: string;
  sub: string;
  /** The accent tint marks the two cards that signal rather than report. */
  accent?: boolean;
}

/**
 * The ten KPI cards, in the order the handoff specifies.
 *
 * Each sub-line carries the secondary fact that keeps the headline honest — the
 * distinct-project count behind a receipt count, the ratio behind a percentage,
 * the denominator behind a weighted margin.
 */
export function KpiGrid({ view }: { view: PeriodView }) {
  const m = view.aggregate;
  const { businessDays, calendarDays } = view;

  const perDay = (value: number, days: number) => (days > 0 ? value / days : null);
  const rate = (value: number, days: number) => {
    const r = perDay(value, days);
    return r == null ? '—' : r.toFixed(1);
  };

  const revenuePerBusinessDay = perDay(m.revenue, businessDays);

  const kpis: Kpi[] = [
    {
      label: 'New work orders',
      value: String(m.newCount),
      sub: `${m.newProjects} distinct project${m.newProjects === 1 ? '' : 's'}`,
    },
    {
      label: 'Invoiced',
      value: String(m.invoicedCount),
      sub: `${rate(m.invoicedCount, calendarDays)}/cal day · ${rate(m.invoicedCount, businessDays)}/biz day`,
    },
    {
      label: 'Net backlog movement',
      value: `${m.netMovement > 0 ? '+' : ''}${m.netMovement}`,
      sub: m.netMovement > 0 ? 'backlog grew' : m.netMovement < 0 ? 'backlog reduced' : 'held flat',
      accent: m.netMovement > 0,
    },
    {
      label: 'Throughput',
      value: formatPct(m.throughput),
      sub: `${m.invoicedCount} invoiced / ${m.newCount} received`,
    },
    {
      label: 'Invoice revenue',
      value: formatMoney(m.revenue),
      sub:
        revenuePerBusinessDay == null
          ? 'no business days in period'
          : `${formatMoney(Math.round(revenuePerBusinessDay))} per business day`,
    },
    {
      label: 'New authorized value',
      value: formatMoney(m.newAuthorized),
      sub: `on ${m.newCount} receipt${m.newCount === 1 ? '' : 's'}`,
    },
    {
      label: 'Vendor cost',
      value: formatMoney(m.vendorCost),
      sub: 'recorded on invoiced rows',
    },
    {
      label: 'Gross profit',
      value: formatMoney(m.grossProfit),
      sub: 'where margin populated',
    },
    {
      label: 'Gross margin',
      value: formatPct(m.grossMarginPct),
      sub: `weighted on ${formatMoney(m.marginBase)}`,
      accent: true,
    },
    {
      label: 'Authorization remaining',
      value: formatMoney(m.authorizationRemaining),
      sub: 'headroom on new receipts',
    },
  ];

  return (
    <div className="kpi-grid">
      {kpis.map((kpi) => (
        <div className="kpi" key={kpi.label}>
          <div className="kpi-label">{kpi.label}</div>
          <div className={`kpi-value${kpi.accent ? ' kpi-value-accent' : ''}`}>{kpi.value}</div>
          <div className="kpi-sub">{kpi.sub}</div>
        </div>
      ))}
    </div>
  );
}
