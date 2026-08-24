import { formatMoneyCompact } from '@/lib/kpi/money';
import { customerMix } from '@/lib/kpi/metrics';
import type { BacklogPoint, DayData, PeriodView } from '@/lib/kpi/period';

/**
 * The four charts.
 *
 * These are hand-drawn in flexbox and SVG rather than built on a charting
 * library: the handoff specifies the geometry to the pixel (26px bars, a 158px
 * plot, a 320×132 viewBox), the shapes are simple, and a chart library would
 * need to be overridden at every one of those points to land in the same place.
 * The trade is no zoom/tooltip machinery, which this dashboard does not use.
 */

const PLOT_HEIGHT = 118;

/** Received vs invoiced counts per day, two bars per column. */
export function FlowChart({ days }: { days: DayData[] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.metrics.newCount, d.metrics.invoicedCount)));
  // A zero day still gets a 2px stub so the column reads as a reported zero
  // rather than as a missing bar.
  const barHeight = (value: number) => Math.max(value > 0 ? 4 : 2, Math.round((value / max) * PLOT_HEIGHT));

  return (
    <section className="card">
      <div className="chart-head">
        <h2 className="card-title">Received vs invoiced</h2>
        <div className="legend">
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: 'var(--color-accent-500)' }} />
            Received
          </span>
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: 'var(--color-neutral-600)' }} />
            Invoiced
          </span>
        </div>
      </div>

      <div className="flow-plot">
        {days.map((day) => (
          <div
            key={day.reportDate}
            className={`flow-col${day.isWeekend ? ' flow-col-weekend' : ''}`}
          >
            <div className="flow-bars">
              <div
                className="flow-bar flow-bar-received"
                style={{ height: barHeight(day.metrics.newCount) }}
              >
                <span className="flow-bar-label" style={{ color: 'var(--color-accent-300)' }}>
                  {day.metrics.newCount}
                </span>
              </div>
              <div
                className="flow-bar flow-bar-invoiced"
                style={{ height: barHeight(day.metrics.invoicedCount) }}
              >
                <span className="flow-bar-label" style={{ color: 'var(--color-neutral-400)' }}>
                  {day.metrics.invoicedCount}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="axis">
        {days.map((day) => (
          <div className="axis-cell" key={day.reportDate}>
            <div className={`axis-label${day.isWeekend ? ' axis-label-muted' : ''}`}>{day.label}</div>
            <div className="axis-note">
              {day.isWeekend && day.metrics.newCount + day.metrics.invoicedCount === 0
                ? 'zero activity'
                : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Cumulative backlog movement, or current backlog once an opening count exists.
 *
 * The title is conditional on purpose: without an opening snapshot this line is
 * movement, and presenting it as a backlog level would be wrong by exactly the
 * unknown opening count.
 */
export function BacklogTrend({
  series,
  openingBacklog,
}: {
  series: BacklogPoint[];
  openingBacklog: number;
}) {
  const values = [...series.map((p) => p.value), openingBacklog];
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 1);
  const span = hi - lo || 1;

  const y = (value: number) => 116 - ((value - lo) / span) * 96;
  const x = (i: number) => (series.length > 1 ? 16 + i * (288 / (series.length - 1)) : 160);

  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const area =
    points.length > 0
      ? [
          ...points,
          `${x(series.length - 1).toFixed(1)},${y(lo).toFixed(1)}`,
          `${x(0).toFixed(1)},${y(lo).toFixed(1)}`,
        ].join(' ')
      : '';

  const hasOpening = openingBacklog > 0;

  return (
    <section className="card backlog-card">
      <h2 className="card-title">{hasOpening ? 'Current backlog' : 'Cumulative backlog movement'}</h2>
      <div className="card-sub">
        {hasOpening
          ? `Opening count ${openingBacklog} plus daily movement`
          : 'Not current backlog — no opening count loaded'}
      </div>

      <svg
        className="backlog-svg"
        viewBox="0 0 320 132"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          hasOpening
            ? 'Current backlog over the period'
            : 'Cumulative backlog movement over the period'
        }
      >
        <line
          x1="14"
          y1={y(0).toFixed(1)}
          x2="306"
          y2={y(0).toFixed(1)}
          stroke="var(--color-neutral-700)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        {area && <polyline points={area} fill="var(--color-accent-900)" opacity="0.75" />}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {series.map((p, i) => (
          <circle
            key={p.reportDate}
            cx={x(i).toFixed(1)}
            cy={y(p.value).toFixed(1)}
            r="3.5"
            fill="var(--color-bg)"
            stroke="var(--color-accent)"
            strokeWidth="2"
          />
        ))}
      </svg>

      <div className="backlog-axis">
        {series.map((p) => (
          <div className="backlog-axis-cell" key={p.reportDate}>
            {p.value > 0 ? '+' : ''}
            {p.value}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Invoiced revenue with the recorded gross profit stacked on top. */
export function RevenueChart({ days }: { days: DayData[] }) {
  const max = Math.max(1, ...days.map((d) => d.metrics.revenue));

  return (
    <section className="card">
      <h2 className="card-title">Invoiced revenue &amp; gross profit</h2>
      <div className="card-sub">Accent segment is recorded gross profit</div>

      <div className="bars-plot">
        {days.map((day) => {
          const total = Math.round((day.metrics.revenue / max) * 96);
          const profit =
            day.metrics.revenue > 0
              ? Math.round((day.metrics.grossProfit / day.metrics.revenue) * total)
              : 0;
          return (
            <div className="bars-col" key={day.reportDate}>
              <div className="bars-value">
                {day.metrics.revenue > 0 ? formatMoneyCompact(day.metrics.revenue) : '—'}
              </div>
              <div className="bars-stack">
                <div className="bars-profit" style={{ height: profit }} />
                <div className="bars-rest" style={{ height: Math.max(total - profit, 2) }} />
              </div>
            </div>
          );
        })}
      </div>

      <DayAxis days={days} />
    </section>
  );
}

/** Customer authorization on receipts, one bar per day. */
export function AuthorizationChart({ days }: { days: DayData[] }) {
  const max = Math.max(1, ...days.map((d) => d.metrics.newAuthorized));

  return (
    <section className="card">
      <h2 className="card-title">New authorized work</h2>
      <div className="card-sub">Customer authorization on receipts</div>

      <div className="bars-plot">
        {days.map((day) => (
          <div className="bars-col" key={day.reportDate}>
            <div className="bars-value">
              {day.metrics.newAuthorized > 0 ? formatMoneyCompact(day.metrics.newAuthorized) : '—'}
            </div>
            <div
              className="bars-auth"
              style={{ height: Math.max(2, Math.round((day.metrics.newAuthorized / max) * 96)) }}
            />
          </div>
        ))}
      </div>

      <DayAxis days={days} />
    </section>
  );
}

function DayAxis({ days }: { days: DayData[] }) {
  return (
    <div className="bars-axis">
      {days.map((day) => (
        <div
          className="bars-axis-cell"
          key={day.reportDate}
          style={day.isWeekend ? { color: 'var(--color-neutral-600)' } : undefined}
        >
          {day.label}
        </div>
      ))}
    </div>
  );
}

/** Share of invoiced revenue per customer, sorted descending. */
export function CustomerMix({ view }: { view: PeriodView }) {
  const mix = customerMix(view.aggregate);

  return (
    <section className="card">
      <h2 className="card-title">Customer mix</h2>
      <div className="card-sub">Share of invoiced revenue</div>

      <div className="mix">
        {mix.length === 0 && <div className="card-sub">No rows in scope.</div>}
        {mix.map((entry) => (
          <div className="mix-row" key={entry.customer}>
            <div className="mix-head">
              <span className="mix-name" title={entry.customer}>
                {entry.customer}
              </span>
              <span className="mix-value">
                {entry.revenue > 0
                  ? `${formatMoneyCompact(entry.revenue)} · ${Math.round(entry.share * 100)}%`
                  : 'no invoicing'}
                {entry.newCount > 0 ? ` · ${entry.newCount} new` : ''}
              </span>
            </div>
            <div className="mix-track">
              {/* A floor of 0.8% keeps a customer with receipts but no invoicing visible. */}
              <div className="mix-fill" style={{ width: `${Math.max(entry.share * 100, 0.8).toFixed(1)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
