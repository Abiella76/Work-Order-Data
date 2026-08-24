import { formatMoney, formatPct } from '@/lib/kpi/money';
import type { PeriodView } from '@/lib/kpi/period';
import type { Insight } from '@/lib/kpi/insights';

/**
 * One row per calendar day plus a period total.
 *
 * Weekend rows are tinted and muted but never hidden: a zero-activity day is a
 * reported fact, and dropping it would make the day count in the averages
 * impossible to reconcile against the table.
 */
export function Scorecard({ view }: { view: PeriodView }) {
  const m = view.aggregate;
  const dash = (cents: number) => (cents !== 0 ? formatMoney(cents) : '—');

  return (
    <section className="card" style={{ padding: '14px 16px 8px' }}>
      <h2 className="card-title" style={{ marginBottom: 10 }}>
        Daily executive scorecard
      </h2>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">New</th>
              <th className="num">Inv.</th>
              <th className="num">Net</th>
              <th className="num">Thru</th>
              <th className="num">Revenue</th>
              <th className="num">New auth.</th>
              <th className="num">Vendor cost</th>
              <th className="num">Gross profit</th>
              <th className="num">GM%</th>
            </tr>
          </thead>
          <tbody>
            {view.days.map((day) => (
              <tr key={day.reportDate} className={day.isWeekend ? 'row-weekend' : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {day.weekday} {day.reportDate.slice(5).replace('-', '/')}
                </td>
                <td className="num">{day.metrics.newCount}</td>
                <td className="num">{day.metrics.invoicedCount}</td>
                <td className={`num${day.metrics.netMovement > 0 ? ' cell-accent' : ''}`}>
                  {day.metrics.netMovement > 0 ? '+' : ''}
                  {day.metrics.netMovement}
                </td>
                <td className="num">{formatPct(day.metrics.throughput)}</td>
                <td className="num">{dash(day.metrics.revenue)}</td>
                <td className="num">{dash(day.metrics.newAuthorized)}</td>
                <td className="num">{dash(day.metrics.vendorCost)}</td>
                <td className="num">{dash(day.metrics.grossProfit)}</td>
                <td className="num">{formatPct(day.metrics.grossMarginPct)}</td>
              </tr>
            ))}

            {view.days.length > 0 && (
              <tr className="row-total">
                <td style={{ whiteSpace: 'nowrap' }}>Period total</td>
                <td className="num">{m.newCount}</td>
                <td className="num">{m.invoicedCount}</td>
                <td className="num">
                  {m.netMovement > 0 ? '+' : ''}
                  {m.netMovement}
                </td>
                <td className="num">{formatPct(m.throughput)}</td>
                <td className="num">{formatMoney(m.revenue)}</td>
                <td className="num">{formatMoney(m.newAuthorized)}</td>
                <td className="num">{formatMoney(m.vendorCost)}</td>
                <td className="num">{formatMoney(m.grossProfit)}</td>
                <td className="num">{formatPct(m.grossMarginPct)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Insights({ insights }: { insights: Insight[] }) {
  return (
    <section className="insights-card">
      <h2 className="card-title">Executive insights</h2>
      <div className="card-kicker">Deterministic — computed from imported rows</div>

      <div className="insights">
        {insights.map((insight) => (
          <div className="insight" key={insight.id}>
            <span className={`insight-dot${insight.tone === 'accent' ? ' insight-dot-accent' : ''}`} />
            <div className="insight-text">{insight.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
