import { Masthead } from '@/components/Masthead';
import {
  CorporateKpis,
  RevenueByPeriod,
  CreditsPanel,
  ConcentrationPanel,
  ClientTable,
  DuplicatesPanel,
  CorporateInsights,
} from '@/components/Corporate';
import {
  periodTotals,
  summariseClients,
  statusSplit,
  periodStatusSplit,
  corporateInsights,
} from '@/lib/kpi/corporate';
import { PeriodFocusSelect } from '@/components/PeriodFocusSelect';
import { loadCorporateSnapshot } from '@/lib/queries';
import { isDatabaseConfigured } from '@/db/client';
import { describeDbError } from '@/lib/db-error';
import { collectDbDiagnostics } from '@/lib/db-diagnostics';
import { DbError } from '@/components/DbError';
import { ClientRevenueImport } from '@/components/ClientRevenueImport';
import { ReplaceReport } from '@/components/ReplaceReport';

export const dynamic = 'force-dynamic';

/**
 * Corporate snapshot: which accounts are still trading, what lapsed, and how
 * concentrated the current book is.
 */
export default async function CorporatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedScope = Array.isArray(params.period) ? params.period[0] : params.period;

  if (!isDatabaseConfigured()) {
    return (
      <main className="page">
        <div className="page-inner">
          <Masthead view="corporate" />
          <div className="empty">
            <div className="empty-title">No database configured</div>
            <p>See README.md, &ldquo;Setup&rdquo;.</p>
          </div>
        </div>
      </main>
    );
  }

  let snapshot;
  try {
    snapshot = await loadCorporateSnapshot();
  } catch (error) {
    return (
      <main className="page">
        <div className="page-inner">
          <Masthead view="corporate" />
          <DbError info={describeDbError(error)} diagnostics={await collectDbDiagnostics()} />
        </div>
      </main>
    );
  }

  const { clients, periods } = snapshot;

  if (periods.length === 0 || clients.length === 0) {
    return (
      <main className="page">
        <div className="page-inner">
          <Masthead view="corporate" />
          <ClientRevenueImport />
        </div>
      </main>
    );
  }

  const summaries = summariseClients(clients, periods);
  const totals = periodTotals(clients, periods);

  // The newest period is the default focus, and is what the snapshot insight
  // quotes — so an unrecognised ?period= falls back to it rather than rendering
  // empty cards for a period we do not hold.
  const ordered = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const defaultScope = ordered[ordered.length - 1].key;
  const scope =
    requestedScope != null &&
    (requestedScope === 'all' || periods.some((p) => p.key === requestedScope))
      ? requestedScope
      : defaultScope;

  // Across all periods the split is the file's own Active/Inactive column —
  // who is a customer now. Focused on one period it is derived from that
  // period's billing, which is the only thing that can answer the question for
  // a year that has already closed.
  const split = scope === 'all' ? statusSplit(summaries) : periodStatusSplit(summaries, scope);

  // The insights read the whole book, not the focused window: they are the
  // page's standing commentary, and a filter must not silently rewrite them.
  const insights = corporateInsights({ summaries, totals, split: statusSplit(summaries) });

  return (
    <main className="page">
      <div className="page-inner">
        <Masthead view="corporate" />

        <div className="section-head">
          <div className="section-head-row">
            <div>
              <h2 className="section-title">Customers</h2>
              <div className="section-sub">
                {split.total} classified accounts across {periods.length} reporting periods ·{' '}
                {periods[0].label} to {periods[periods.length - 1].label}
              </div>
            </div>
            <div className="section-head-actions">
              <PeriodFocusSelect
                periods={ordered.map((p) => ({ key: p.key, label: p.label }))}
                value={scope}
                defaultValue={defaultScope}
              />
              <ReplaceReport />
            </div>
          </div>
        </div>

        <CorporateKpis split={split} totals={totals} selected={scope} />

        <div className="row-flow" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <RevenueByPeriod totals={totals} />
          <ConcentrationPanel summaries={summaries} periods={ordered} selected={scope} />
        </div>

        <div className="row-flow" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <CreditsPanel totals={totals} />
          <CorporateInsights insights={insights} />
        </div>

        <div style={{ marginTop: 12 }}>
          <ClientTable
            summaries={summaries}
            periods={periods}
            status="active"
            title="Active accounts"
            sub="Positive sales activity in the most recent statement"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <ClientTable
            summaries={summaries}
            periods={periods}
            status="inactive"
            title="Inactive accounts"
            sub="Historical activity, but none in the most recent statement"
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <DuplicatesPanel summaries={summaries} />
        </div>
      </div>
    </main>
  );
}
