import { Masthead } from '@/components/Masthead';
import { ImportPanel } from '@/components/ImportPanel';
import { loadImportLog } from '@/lib/queries';
import { isDatabaseConfigured } from '@/db/client';
import { describeDbError } from '@/lib/db-error';
import { DbError } from '@/components/DbError';

export const dynamic = 'force-dynamic';

const VALIDATION_NOTES = [
  'Zero-row reports are accepted as valid — a weekend file with only a header row is stored as confirmed zero activity, not as a failed import.',
  'Duplicate protection keys on report date + filename + content checksum, never on Project ID.',
  'Rows sharing a Project ID with different WO/PO numbers are stored as separate events.',
  'Status values recognised in source: Received, Invoiced. Anything else is stored, counted in no KPI, and reported here.',
];

export default async function ImportsPage() {
  if (!isDatabaseConfigured()) {
    return (
      <main className="page">
        <div className="page-inner">
          <Masthead view="imports" />
          <div className="empty">
            <div className="empty-title">No database configured</div>
            <p>
              Copy <code>.env.example</code> to <code>.env</code>, point <code>DATABASE_URL</code>{' '}
              at Postgres, then run <code>npm run db:push</code>.
            </p>
          </div>
        </div>
      </main>
    );
  }

  let log;
  try {
    log = await loadImportLog();
  } catch (error) {
    return (
      <main className="page">
        <div className="page-inner">
          <Masthead view="imports" />
          <DbError info={describeDbError(error)} />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-inner">
        <Masthead view="imports" />

        <div className="row-import">
          <ImportPanel />

          <section className="card" style={{ padding: '14px 16px 8px' }}>
            <h2 className="card-title" style={{ marginBottom: 10 }}>
              Import audit trail
            </h2>

            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Report date</th>
                    <th>File</th>
                    <th className="num">Rows</th>
                    <th className="num">New / Inv.</th>
                    <th>Checksum</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {log.length === 0 && (
                    <tr>
                      <td colSpan={6} className="cell-muted">
                        Nothing imported yet.
                      </td>
                    </tr>
                  )}
                  {log.map((row) => (
                    <tr key={row.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{row.reportDate}</td>
                      <td className="cell-muted">{row.filename}</td>
                      <td className="num">{row.rowCount}</td>
                      <td className="num">
                        {row.newCount} / {row.invoicedCount}
                      </td>
                      <td className="mono">{row.checksum.slice(0, 12)}…</td>
                      <td className={row.importStatus === 'imported' ? 'cell-accent' : 'cell-muted'}>
                        {row.importStatus === 'imported' && 'Imported'}
                        {row.importStatus === 'zero_activity' && 'Confirmed zero activity'}
                        {row.importStatus === 'failed' &&
                          `Failed — ${row.errorCount} error${row.errorCount === 1 ? '' : 's'}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="notes">
              <div className="filter-label">Validation notes</div>
              {VALIDATION_NOTES.map((note) => (
                <div className="note" key={note}>
                  {note}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
