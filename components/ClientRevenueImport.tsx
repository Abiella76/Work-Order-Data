'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Browser upload for the finance report's client revenue.
 *
 * The seed script needs a checkout, Node and a terminal — reasonable for a
 * developer, and a wall for the person who actually has the report. Everything
 * here runs against the deployed app's own connection, so it also cannot load
 * into a different database than the one the dashboard reads.
 *
 * Period boundaries are asked for rather than inferred, except where a key
 * states them outright: `FY2024` is unambiguous, but a statement's dates are
 * not recoverable from its name, and guessing them would mis-scale the
 * annualised figure without anyone noticing.
 */

interface DetectedPeriod {
  key: string;
  label: string;
  startsOn: string;
  endsOn: string;
  rows: number;
  withAmount: number;
}

interface DryRun {
  clients: number;
  rows: number;
  periods: DetectedPeriod[];
  issues: string[];
  preview: { client: string; period: string; status: string; amount: string | null }[];
}

interface PeriodForm extends DetectedPeriod {
  isPartial: boolean;
  sourceTotal: string;
}

export function ClientRevenueImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [periods, setPeriods] = useState<PeriodForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inspect = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const text = await file.text();
      setContent(text);
      const response = await fetch('/api/client-revenue?dryRun=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not read that file.');
      setDryRun(body);
      setPeriods(
        (body.periods as DetectedPeriod[]).map((p) => ({ ...p, isPartial: false, sourceTotal: '' })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const update = (key: string, patch: Partial<PeriodForm>) =>
    setPeriods((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const commit = useCallback(async () => {
    if (!content) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/client-revenue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          periods: periods.map((p, i) => ({ ...p, sortOrder: i + 1 })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Import failed.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }, [content, periods, router]);

  const missingDates = periods.some((p) => !p.startsOn || !p.endsOn);

  return (
    <section className="card" style={{ padding: 16, maxWidth: 900, margin: '18px auto 0' }}>
      <h2 className="card-title">Load the finance report</h2>
      <div className="card-sub">
        A CSV with the columns Client, Period, Amount, Status — one row per account per period
      </div>

      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void inspect(file);
        }}
      >
        <div className="dropzone-title">Drop client-revenue.csv here</div>
        <div className="dropzone-hint">
          An em dash or blank amount means no activity in that period, and is stored as such
        </div>
        <button
          type="button"
          className="btn btn-active"
          style={{ marginTop: 14 }}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Reading…' : 'Choose file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void inspect(file);
          }}
        />
      </div>

      {error && (
        <div className="issue-list">
          <div className="issue issue-error">{error}</div>
        </div>
      )}

      {dryRun && (
        <>
          <div className="checks">
            <div className="filter-label">What the file contains</div>
            <div className="check">
              <span className="check-label">Accounts</span>
              <span className="check-value">{dryRun.clients}</span>
            </div>
            <div className="check">
              <span className="check-label">Rows</span>
              <span className="check-value">{dryRun.rows}</span>
            </div>
            <div className="check">
              <span className="check-label">Periods</span>
              <span className="check-value">{dryRun.periods.length}</span>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="filter-label">Confirm each period</div>
            <div className="card-sub" style={{ marginBottom: 10 }}>
              Dates set the ordering and the partial-period maths. A stated total is optional — it
              is only used to reconcile against the source report.
            </div>

            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Label</th>
                    <th>Starts</th>
                    <th>Ends</th>
                    <th>Partial</th>
                    <th>Stated total</th>
                    <th className="num">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => (
                    <tr key={p.key}>
                      <td className="mono">{p.key}</td>
                      <td>
                        <input
                          className="select"
                          style={{ width: 150 }}
                          value={p.label}
                          onChange={(e) => update(p.key, { label: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="select"
                          type="date"
                          value={p.startsOn}
                          onChange={(e) => update(p.key, { startsOn: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="select"
                          type="date"
                          value={p.endsOn}
                          onChange={(e) => update(p.key, { endsOn: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={p.isPartial}
                          onChange={(e) => update(p.key, { isPartial: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          className="select"
                          style={{ width: 130 }}
                          placeholder="optional"
                          value={p.sourceTotal}
                          onChange={(e) => update(p.key, { sourceTotal: e.target.value })}
                        />
                      </td>
                      <td className="num">{p.withAmount} / {p.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {dryRun.issues.length > 0 && (
            <div className="issue-list">
              {dryRun.issues.slice(0, 6).map((issue) => (
                <div className="issue" key={issue}>
                  {issue}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-active"
              disabled={busy || missingDates}
              onClick={() => void commit()}
            >
              {busy ? 'Importing…' : `Import ${dryRun.clients} accounts`}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setDryRun(null);
                setContent(null);
                setPeriods([]);
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Cancel
            </button>
            {missingDates && (
              <span style={{ fontSize: 11, color: 'var(--color-warm-300)' }}>
                Every period needs a start and end date.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
