import type { DbErrorInfo } from '@/lib/db-error';
import type { DbDiagnostics } from '@/lib/db-diagnostics';
import { SetupButton } from './SetupButton';

/**
 * Shown in place of a page when the database is configured but failing.
 *
 * The detail line is redacted upstream, and the diagnostics carry only a host
 * and database name — never a credential — because the usual way to be stuck
 * here is having two databases and looking at the wrong one.
 */
export function DbError({
  info,
  diagnostics,
}: {
  info: DbErrorInfo;
  diagnostics?: DbDiagnostics;
}) {
  const expected = [
    'reports',
    'work_order_events',
    'revenue_periods',
    'client_accounts',
    'client_period_revenue',
  ];
  const present = diagnostics?.tables ?? null;

  return (
    <div className="empty" style={{ textAlign: 'left', maxWidth: 760, margin: '18px auto 0' }}>
      <div className="empty-title">{info.title}</div>
      <ol style={{ margin: '10px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
        {info.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--color-neutral-600)' }}>
        Reported by the database: <code>{info.detail}</code>
      </p>

      {diagnostics && (
        <div className="diag">
          <div className="filter-label">This app is connected to</div>
          <div className="diag-row">
            <span className="diag-key">Host</span>
            <span className="mono">{diagnostics.host ?? '—'}</span>
          </div>
          <div className="diag-row">
            <span className="diag-key">Database</span>
            <span className="mono">{diagnostics.database ?? '—'}</span>
          </div>
          <div className="diag-row">
            <span className="diag-key">Tables found</span>
            <span className="mono">
              {present === null ? 'could not read' : present.length === 0 ? 'none' : present.length}
            </span>
          </div>

          {present !== null && (
            <div className="diag-tables">
              {expected.map((name) => (
                <span
                  key={name}
                  className={`diag-chip${present.includes(name) ? ' diag-chip-ok' : ''}`}
                >
                  {present.includes(name) ? '✓' : '✗'} {name}
                </span>
              ))}
            </div>
          )}

          <p style={{ marginTop: 12, fontSize: 11, color: 'var(--color-neutral-500)' }}>
            The button below applies the schema through this same connection, so it cannot land in
            a different database. It only adds missing tables — nothing is dropped or overwritten.
          </p>

          {present !== null && <SetupButton />}
        </div>
      )}
    </div>
  );
}
