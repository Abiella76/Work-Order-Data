import { formatMoney, formatMoneyCompact } from '@/lib/kpi/money';
import {
  annualisedRunRate,
  concentration,
  duplicateCandidates,
  periodMonths,
  type ClientSummary,
  type CorporateInsight,
  type Period,
  type PeriodTotals,
  type StatusSplit,
} from '@/lib/kpi/corporate';

/** The four headline figures for the snapshot. */
export function CorporateKpis({
  split,
  totals,
}: {
  split: StatusSplit;
  totals: PeriodTotals[];
}) {
  const newest = totals[totals.length - 1];
  const activeShare = split.total > 0 ? Math.round((split.active / split.total) * 100) : 0;

  const cards = [
    {
      label: 'Active accounts',
      value: String(split.active),
      sub: `${activeShare}% of ${split.total} classified`,
    },
    {
      label: 'Inactive accounts',
      value: String(split.inactive),
      sub: `${formatMoney(split.inactiveLifetime)} historical revenue`,
      accent: true,
    },
    {
      label: newest ? newest.period.label : 'Current period',
      value: newest ? formatMoney(newest.total) : '—',
      sub: newest?.period.isPartial
        ? `${periodMonths(newest.period)} months — partial period`
        : 'full period',
      warm: true,
    },
  ];

  return (
    <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
      {cards.map((c) => (
        <div className="kpi" key={c.label}>
          <div className="kpi-label">{c.label}</div>
          <div
            className={`kpi-value${c.accent ? ' kpi-value-accent' : ''}${c.warm ? ' kpi-value-warm' : ''}`}
          >
            {c.value}
          </div>
          <div className="kpi-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Revenue by period.
 *
 * A partial period is drawn at its actual value with its annualised run rate
 * ghosted above it, rather than being scaled up silently. Showing ten months
 * beside twelve without saying so reads as a decline that did not happen;
 * replacing it with the projection invents revenue that has not been billed.
 */
export function RevenueByPeriod({ totals }: { totals: PeriodTotals[] }) {
  const values = totals.flatMap((t) => {
    const rr = annualisedRunRate(t.total, t.period);
    return rr == null ? [t.total] : [t.total, rr];
  });
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const PLOT = 150;

  return (
    <section className="card">
      <div className="chart-head">
        <h2 className="card-title">Company revenue by period</h2>
        <div className="legend">
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: 'var(--color-warm-500)' }} />
            Billed
          </span>
          <span className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: 'transparent', border: '1px dashed var(--color-warm-600)' }}
            />
            Annualised
          </span>
        </div>
      </div>
      <div className="card-sub">Net of credits and reversals</div>

      <div className="period-plot">
        {totals.map((t) => {
          const runRate = annualisedRunRate(t.total, t.period);
          const h = (v: number) => Math.max(2, Math.round((Math.abs(v) / max) * PLOT));
          const negative = t.total < 0;
          return (
            <div className="period-col" key={t.period.key}>
              <div className="period-value">{formatMoneyCompact(t.total)}</div>
              <div className="period-stack">
                {runRate != null && (
                  <div className="period-ghost" style={{ height: h(runRate) - h(t.total) }}>
                    <span className="period-ghost-label">{formatMoneyCompact(runRate)}</span>
                  </div>
                )}
                <div
                  className={`period-bar${negative ? ' period-bar-negative' : ''}`}
                  style={{ height: h(t.total) }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bars-axis">
        {totals.map((t) => (
          <div className="bars-axis-cell" key={t.period.key}>
            {t.period.label}
            {t.period.isPartial && <div className="axis-note">partial</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Billed against credits per period — where a negative net comes from. */
export function CreditsPanel({ totals }: { totals: PeriodTotals[] }) {
  return (
    <section className="card">
      <h2 className="card-title">Billed vs credits</h2>
      <div className="card-sub">Reversals are shown, not netted away silently</div>
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Billed</th>
              <th className="num">Credits</th>
              <th className="num">Net</th>
              <th className="num">Accounts</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.period.key}>
                <td style={{ whiteSpace: 'nowrap' }}>{t.period.label}</td>
                <td className="num">{formatMoney(t.gross)}</td>
                <td className={`num${t.credits < 0 ? ' cell-warm' : ''}`}>
                  {t.credits < 0 ? formatMoney(t.credits) : '—'}
                </td>
                <td className="num">{formatMoney(t.total)}</td>
                <td className="num">{t.clientCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Share of the current period resting on the largest accounts. */
export function ConcentrationPanel({ summaries }: { summaries: ClientSummary[] }) {
  const top = concentration(summaries, 5);
  const rest = 1 - top.share;

  return (
    <section className="card">
      <h2 className="card-title">Revenue concentration</h2>
      <div className="card-sub">Current period, largest accounts first</div>

      <div className="conc-value">{Math.round(top.share * 100)}%</div>
      <div className="conc-caption">
        of current revenue sits with {top.topN} account{top.topN === 1 ? '' : 's'} —{' '}
        {formatMoney(top.amount)}
      </div>

      <div className="conc-track">
        <div className="conc-fill" style={{ width: `${(top.share * 100).toFixed(1)}%` }} />
        <div className="conc-rest" style={{ width: `${(rest * 100).toFixed(1)}%` }} />
      </div>

      <div className="mix" style={{ marginTop: 14 }}>
        {top.names.map((name, i) => {
          const client = summaries.find((c) => c.name === name)!;
          return (
            <div className="mix-row" key={name}>
              <div className="mix-head">
                <span className="mix-name" title={name}>
                  {i + 1}. {name}
                </span>
                <span className="mix-value">
                  {formatMoneyCompact(client.current ?? 0)} ·{' '}
                  {Math.round((client.currentShare ?? 0) * 100)}%
                </span>
              </div>
              <div className="mix-track">
                <div
                  className="mix-fill mix-fill-warm"
                  style={{ width: `${Math.max((client.currentShare ?? 0) * 100, 0.8).toFixed(1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Every account, its period figures, and when it was last seen. */
export function ClientTable({
  summaries,
  periods,
  status,
  title,
  sub,
}: {
  summaries: ClientSummary[];
  periods: Period[];
  status: 'active' | 'inactive';
  title: string;
  sub: string;
}) {
  const rows = summaries.filter((c) => c.status === status);
  const cell = (v: number | undefined) => (v === undefined ? '—' : formatMoney(v));

  return (
    <section className="card" style={{ padding: '14px 16px 8px' }}>
      <h2 className="card-title">{title}</h2>
      <div className="card-sub" style={{ marginBottom: 10 }}>
        {sub}
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              {periods.map((p) => (
                <th className="num" key={p.key}>
                  {p.label}
                  {p.isPartial ? ' *' : ''}
                </th>
              ))}
              <th className="num">Total</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={periods.length + 3} className="cell-muted">
                  No accounts in this group.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.name}>
                <td>
                  {c.name}
                  {c.hasCredits && <span className="chip chip-warm">credit</span>}
                </td>
                {periods.map((p) => (
                  <td className="num" key={p.key}>
                    {cell(c.revenue[p.key])}
                  </td>
                ))}
                <td className="num">{formatMoney(c.lifetime)}</td>
                <td className="cell-muted" style={{ whiteSpace: 'nowrap' }}>
                  {c.lastActivePeriod?.label ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {periods.some((p) => p.isPartial) && (
        <div className="note" style={{ padding: '10px 0 6px', color: 'var(--color-neutral-500)' }}>
          * partial period — see the revenue chart for the annualised comparison.
        </div>
      )}
    </section>
  );
}

/** Names differing only by punctuation or a suffix. Reported, never merged. */
export function DuplicatesPanel({ summaries }: { summaries: ClientSummary[] }) {
  const dupes = duplicateCandidates(summaries);
  if (dupes.length === 0) return null;

  return (
    <section className="card">
      <h2 className="card-title">Possible duplicate accounts</h2>
      <div className="card-sub">
        Kept separate — merging accounts is a business decision, not an import rule
      </div>
      <div className="issue-list" style={{ marginTop: 12 }}>
        {dupes.map((d) => (
          <div className="issue" key={d.normalised}>
            {d.names.join('  ·  ')} — {formatMoney(d.combined)} combined
          </div>
        ))}
      </div>
    </section>
  );
}

export function CorporateInsights({ insights }: { insights: CorporateInsight[] }) {
  return (
    <section className="insights-card">
      <h2 className="card-title">Snapshot insights</h2>
      <div className="card-kicker">Deterministic — computed from imported rows</div>
      <div className="insights">
        {insights.map((i) => (
          <div className="insight" key={i.id}>
            <span className={`insight-dot${i.tone === 'accent' ? ' insight-dot-accent' : ''}`} />
            <div className="insight-text">{i.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
