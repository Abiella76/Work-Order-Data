import { formatMoney, formatMoneyCompact } from '@/lib/kpi/money';
import {
  annualisedRunRate,
  concentration,
  concentrationSlices,
  duplicateCandidates,
  periodMonths,
  type ClientSummary,
  type ConcentrationScope,
  type CorporateInsight,
  type Period,
  type PeriodTotals,
  type StatusSplit,
} from '@/lib/kpi/corporate';

/**
 * The three headline figures, measured over whichever period is in focus.
 *
 * Every card names its own window, because the same three numbers mean
 * different things across them: read against one year, "active" is who billed
 * that year; read across all of them, it is the file's own classification of
 * who is a customer now. A card that did not say which it was showing would be
 * the most quietly wrong thing on the page.
 */
export function CorporateKpis({
  split,
  totals,
  selected,
}: {
  split: StatusSplit;
  totals: PeriodTotals[];
  /** 'all', or a period key. */
  selected: string;
}) {
  const activeShare = split.total > 0 ? Math.round((split.active / split.total) * 100) : 0;
  const focused = totals.find((t) => t.period.key === selected);
  const first = totals[0];
  const last = totals[totals.length - 1];

  const revenueCard = focused
    ? {
        label: focused.period.label,
        value: formatMoney(focused.total),
        sub: focused.period.isPartial
          ? `${periodMonths(focused.period)} months — partial period`
          : 'full period',
      }
    : {
        label: 'All periods',
        value: formatMoney(totals.reduce((n, t) => n + t.total, 0)),
        sub:
          first && last
            ? `${totals.length} periods · ${first.period.label} to ${last.period.label}`
            : 'no periods loaded',
      };

  const cards: { label: string; value: string; sub: string; accent?: boolean; warm?: boolean }[] = [
    {
      label: focused ? `Active in ${focused.period.label}` : 'Active accounts',
      value: String(split.active),
      sub: focused
        ? `${activeShare}% of ${split.total} accounts on record`
        : `${activeShare}% of ${split.total} classified`,
    },
    {
      label: focused ? `Inactive in ${focused.period.label}` : 'Inactive accounts',
      value: String(split.inactive),
      sub: `${formatMoney(split.inactiveLifetime)} ${focused ? 'lifetime' : 'historical'} revenue`,
      accent: true,
    },
    { ...revenueCard, warm: true },
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

/**
 * Share of one window's revenue resting on the largest accounts.
 *
 * A donut rather than a bar: this is a part-to-whole question with six slices,
 * which is what a pie is actually good at, and the hole gives the headline
 * number somewhere to live.
 *
 * Identity never rests on colour alone — every slice is named in the legend
 * with its own figure, and the slices are separated by a visible gap. The
 * palette's worst pair sits at CVD ΔE 7.8, which is only defensible with that
 * second encoding present.
 *
 * The window is selectable because the answer moves with it, and a reader who
 * cannot see which window is in force cannot tell a concentrated book from a
 * short reporting period. Whatever is selected is named under the title and
 * again in the hole's label.
 */
export function ConcentrationPanel({
  summaries,
  periods,
  selected,
}: {
  summaries: ClientSummary[];
  periods: Period[];
  /** 'all', or a period key. */
  selected: string;
}) {
  const scope: ConcentrationScope =
    selected === 'all' ? { kind: 'all' } : { kind: 'period', key: selected };
  const scopeLabel =
    selected === 'all'
      ? 'all periods combined'
      : (periods.find((p) => p.key === selected)?.label ?? selected);

  const top = concentration(summaries, 5, scope);
  const { slices } = concentrationSlices(summaries, 5, scope);

  // Donut geometry: one dasharray arc per slice on a shared circle, which needs
  // no path maths and no charting library.
  const RADIUS = 56;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const GAP = 2; // px of surface between slices, so adjacent hues never touch

  const colorFor = (index: number) =>
    index < 0 ? 'var(--cat-rest)' : `var(--cat-${index + 1})`;

  return (
    <section className="card">
      <h2 className="card-title">Revenue concentration</h2>
      <div className="card-sub">Share of revenue by account — {scopeLabel}</div>

      {slices.length === 0 ? (
        <div className="card-sub" style={{ marginTop: 14 }}>
          No account has positive revenue in {scopeLabel}.
        </div>
      ) : (
        <div className="pie-wrap">
          <svg className="pie-svg" viewBox="0 0 140 140" role="img"
               aria-label={`Revenue concentration: ${slices.map((s) => `${s.name} ${Math.round(s.share * 100)}%`).join(', ')}`}>
            <g transform="rotate(-90 70 70)">
              {slices.map((slice) => {
                const length = Math.max(slice.share * CIRCUMFERENCE - GAP, 0.5);
                return (
                  <circle
                    key={slice.name}
                    cx="70"
                    cy="70"
                    r={RADIUS}
                    fill="none"
                    stroke={colorFor(slice.colorIndex)}
                    strokeWidth="22"
                    strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                    strokeDashoffset={-slice.offset * CIRCUMFERENCE}
                  />
                );
              })}
            </g>
            <text x="70" y="68" textAnchor="middle" className="pie-centre-value">
              {Math.round(top.share * 100)}%
            </text>
            <text x="70" y="82" textAnchor="middle" className="pie-centre-label">
              top 5
            </text>
          </svg>

          <div className="pie-legend">
            {slices.map((slice) => (
              <div className="pie-legend-row" key={slice.name}>
                <span
                  className="pie-swatch"
                  style={{ background: colorFor(slice.colorIndex) }}
                />
                <span className="pie-name" title={slice.name}>
                  {slice.name}
                </span>
                <span className="pie-figure">
                  {formatMoneyCompact(slice.amount)} · {Math.round(slice.share * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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
