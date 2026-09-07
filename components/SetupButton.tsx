'use client';

import { useState } from 'react';

interface SetupResult {
  host: string | null;
  database: string | null;
  tablesBefore: number | null;
  tablesAfter: number | null;
  created: string[];
  failures: { statement: string; message: string }[];
}

/**
 * Applies the schema through the app's own connection.
 *
 * Offered on the error page because that is the moment it is needed, and
 * because the alternative — pasting SQL into a database console — cannot prove
 * it reached the database the app reads.
 */
export function SetupButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<SetupResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState('running');
    setMessage(null);
    try {
      const response = await fetch('/api/setup', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Setup failed.');
      setResult(body as SetupResult);
      setState('done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Setup failed.');
      setState('error');
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button type="button" className="btn btn-active" onClick={run} disabled={state === 'running'}>
        {state === 'running' ? 'Creating tables…' : 'Create the missing tables'}
      </button>

      {state === 'error' && (
        <div className="issue-list">
          <div className="issue issue-error">{message}</div>
        </div>
      )}

      {state === 'done' && result && (
        <div className="issue-list">
          <div className="issue">
            {result.created.length > 0
              ? `Created ${result.created.length}: ${result.created.join(', ')}. ` +
                `${result.tablesBefore} tables before, ${result.tablesAfter} after.`
              : `No tables were missing — ${result.tablesAfter} already present.`}
          </div>
          {result.failures.map((f) => (
            <div className="issue issue-error" key={f.statement}>
              {f.message}
            </div>
          ))}
          <div className="issue">Reload this page to continue.</div>
        </div>
      )}
    </div>
  );
}
