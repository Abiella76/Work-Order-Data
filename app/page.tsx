import { Masthead } from '@/components/Masthead';
import { FilterBar } from '@/components/FilterBar';
import { KpiGrid } from '@/components/KpiGrid';
import {
  FlowChart,
  BacklogTrend,
  RevenueChart,
  AuthorizationChart,
  CustomerMix,
} from '@/components/Charts';
import { Scorecard, Insights } from '@/components/Scorecard';
import { buildPeriodView, backlogSeries } from '@/lib/kpi/period';
import { buildInsights } from '@/lib/kpi/insights';
import { loadDays, loadOpeningBacklog } from '@/lib/queries';
import { isDatabaseConfigured } from '@/db/client';

export const dynamic = 'force-dynamic';

/**
 * The dashboard.
 *
 * A server component: KPIs are computed and rendered on the server, so the page
 * arrives with its numbers rather than fetching and computing them in the
 * browser. Filters come from the query string, which makes any view shareable.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = {
    range: single('range') ?? 'all',
    customer: single('customer') ?? 'all',
    type: single('type') ?? 'all',
  };

  if (!isDatabaseConfigured()) {
    return (
      <main className="page">
        <div className="page-inner">
          <Masthead view="dashboard" />
          <NotConfigured />
        </div>
      </main>
    );
  }

  const [days, openingBacklog] = await Promise.all([loadDays(), loadOpeningBacklog()]);

  if (days.length === 0) {
    return (
      <main className="page">
        <div className="page-inner">
          <Masthead view="dashboard" />
          <NoReports />
        </div>
      </main>
    );
  }

  const view = buildPeriodView(days, filters);
  const insights = buildInsights({ view, openingBacklog });
  const series = backlogSeries(view.days, openingBacklog);

  const note =
    `${view.calendarDays} calendar day${view.calendarDays === 1 ? '' : 's'} · ` +
    `${view.businessDays} business day${view.businessDays === 1 ? '' : 's'} · ` +
    `${view.rowsInScope} row${view.rowsInScope === 1 ? '' : 's'} in scope`;

  return (
    <main className="page">
      <div className="page-inner">
        <Masthead view="dashboard" />

        <FilterBar days={view.allDays} customers={view.customers} types={view.types} note={note} />

        <KpiGrid view={view} />

        <div className="row-flow">
          <FlowChart days={view.days} />
          <BacklogTrend series={series} openingBacklog={openingBacklog} />
        </div>

        <div className="row-three">
          <RevenueChart days={view.days} />
          <AuthorizationChart days={view.days} />
          <CustomerMix view={view} />
        </div>

        <div className="row-score">
          <Scorecard view={view} />
          <Insights insights={insights} />
        </div>
      </div>
    </main>
  );
}

function NotConfigured() {
  return (
    <div className="empty">
      <div className="empty-title">No database configured</div>
      <p>
        Copy <code>.env.example</code> to <code>.env</code> and point <code>DATABASE_URL</code> at a
        Postgres instance, then run <code>npm run db:push</code>.
      </p>
      <p>
        <code>docker compose up -d</code> starts one locally.
      </p>
    </div>
  );
}

function NoReports() {
  return (
    <div className="empty">
      <div className="empty-title">No reports imported yet</div>
      <p>
        Import a daily CSV from the <a href="/imports">Import log</a>, or run{' '}
        <code>npm run seed</code> to load a directory of reports.
      </p>
    </div>
  );
}
