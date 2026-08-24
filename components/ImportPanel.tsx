'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Manual CSV import.
 *
 * Every file is dry-run parsed first and the pre-import checks shown before the
 * user commits, so a malformed or already-imported file is caught at upload
 * rather than discovered in the numbers a week later.
 */

interface DryRun {
  reportDate: string | null;
  filename: string;
  checksum: string;
  rowCount: number;
  columnsMapped: number;
  columnsExpected: number;
  newCount: number;
  invoicedCount: number;
  alreadyImported: boolean;
  duplicateReason: string | null;
  zeroActivity: boolean;
  issues: { rowNumber: number | null; severity: string; message: string }[];
  preview: Record<string, string | number | null>[];
}

export function ImportPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const inspect = useCallback(async (selected: File) => {
    setError(null);
    setDryRun(null);
    setBusy(true);
    try {
      const content = await selected.text();
      setFile({ name: selected.name, content });

      const response = await fetch('/api/imports?dryRun=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: selected.name, content }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not read that file.');
      setDryRun(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const commit = useCallback(async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content: file.content }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Import failed.');
      setDryRun(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }, [file, router]);

  const blocking = dryRun?.issues.filter((i) => i.severity === 'error') ?? [];
  const canCommit = Boolean(dryRun && !dryRun.alreadyImported && blocking.length === 0);

  return (
    <section className="card" style={{ padding: 16 }}>
      <h2 className="card-title">Import a daily report</h2>
      <div className="card-sub">Manual until Gmail ingestion is live. Zero-row reports are valid.</div>

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
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) void inspect(dropped);
        }}
      >
        <div className="dropzone-title">Drop CSV here</div>
        <div className="dropzone-hint">
          or choose a file — the report date is read from the filename
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
            const selected = e.target.files?.[0];
            if (selected) void inspect(selected);
          }}
        />
      </div>

      {error && (
        <div className="issue-list">
          <div className="issue issue-error">{error}</div>
        </div>
      )}

      <div className="checks">
        <div className="filter-label">Pre-import checks</div>
        <Check label="Detected report date" value={dryRun?.reportDate ?? '—'} />
        <Check label="Rows parsed" value={dryRun ? String(dryRun.rowCount) : '—'} />
        <Check
          label="Columns mapped"
          value={dryRun ? `${dryRun.columnsMapped} / ${dryRun.columnsExpected}` : '—'}
        />
        <Check
          label="Checksum"
          value={dryRun ? `${dryRun.checksum.slice(0, 16)}…` : '—'}
          mono
        />
        <Check
          label="Already imported"
          value={
            !dryRun
              ? '—'
              : dryRun.alreadyImported
                ? 'Yes — matching date and checksum'
                : 'No — safe to import'
          }
          muted={dryRun?.alreadyImported}
        />
        {dryRun && (
          <Check label="New / invoiced" value={`${dryRun.newCount} / ${dryRun.invoicedCount}`} />
        )}
      </div>

      {dryRun && dryRun.issues.length > 0 && (
        <div className="issue-list">
          {dryRun.issues.map((issue, i) => (
            <div key={i} className={`issue${issue.severity === 'error' ? ' issue-error' : ''}`}>
              {issue.rowNumber != null ? `Row ${issue.rowNumber}: ` : ''}
              {issue.message}
            </div>
          ))}
        </div>
      )}

      {dryRun && dryRun.preview.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="filter-label">First {dryRun.preview.length} normalized rows</div>
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>WO / PO</th>
                  <th>Customer</th>
                  <th>Project ID</th>
                  <th className="num">Invoice total</th>
                  <th className="num">Gross margin</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.preview.map((row, i) => (
                  <tr key={i}>
                    <td>{row.activity}</td>
                    <td>{row.woNumber ?? '—'}</td>
                    <td>{row.customer ?? '—'}</td>
                    <td>{row.projectId ?? '—'}</td>
                    <td className="num">{row.invoiceTotal ?? '—'}</td>
                    <td className="num">{row.grossMargin ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dryRun && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-active"
            disabled={!canCommit || busy || isPending}
            onClick={() => void commit()}
          >
            {dryRun.zeroActivity ? 'Confirm zero activity' : 'Import report'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              setDryRun(null);
              setFile(null);
              setError(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {dryRun?.alreadyImported && (
        <div className="issue-list">
          <div className="issue">{dryRun.duplicateReason}</div>
        </div>
      )}
    </section>
  );
}

function Check({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="check">
      <span className="check-label">{label}</span>
      <span className={`check-value${muted ? ' check-value-muted' : ''}${mono ? ' mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
