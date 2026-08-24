import type { DbErrorInfo } from '@/lib/db-error';

/**
 * Shown in place of the dashboard when the database is configured but failing.
 * The detail line is already redacted upstream — no connection string reaches
 * the browser.
 */
export function DbError({ info }: { info: DbErrorInfo }) {
  return (
    <div className="empty" style={{ textAlign: 'left', maxWidth: 680, margin: '18px auto 0' }}>
      <div className="empty-title">{info.title}</div>
      <ol style={{ margin: '10px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
        {info.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--color-neutral-600)' }}>
        Reported by the database: <code>{info.detail}</code>
      </p>
    </div>
  );
}
