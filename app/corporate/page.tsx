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
  corporateInsights,
} from '@/lib/kpi/corporate';
import { loadCorporateSnapshot } from '@/lib/queries';
import { isDatabaseConfigured } from '@/db/client';
import { describeDbError } from '@/lib/db-error';
import { collectDbDiagnostics } from '@/lib/db-diagnostics';
import { DbError } from '@/components/DbError';

export const dynamic = 'force-dynamic';

/**
 * Corporate snapshot: which accounts are still trading, what lapsed, and how
 * concentrated the current book is.
 */
export default async function CorporatePage() {
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
          <div className="empty">
            <div className="empty-title">No client revenue imported yet</div>
            <p>
              Run <code>npm run seed:clients -- ./client-revenue.csv</code> to load the finance
              report.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const summaries = summariseClients(clients, periods);
  const totals = periodTotals(clients, periods);
  const split = statusSplit(summaries);
  const insights = corporateInsights({ summaries, totals, split });

  return (
    <main className="page">
      <div className="page-inner">
        <Masthead view="corporate" />

        <div className="section-head">
          <h2 className="section-title">Corporate snapshot</h2>
          <div className="section-sub">
            {split.total} classified accounts across {periods.length} reporting periods ·{' '}
            {periods[0].label} to {periods[periods.length - 1].label}
          </div>
        </div>

        <CorporateKpis split={split} totals={totals} />

        <div className="row-flow" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <RevenueByPeriod totals={totals} />
          <ConcentrationPanel summaries={summaries} />
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
