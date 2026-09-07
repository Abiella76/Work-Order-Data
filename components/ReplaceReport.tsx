'use client';

import { useState } from 'react';
import { ClientRevenueImport } from './ClientRevenueImport';

/**
 * Re-import the finance report over an already-loaded one.
 *
 * The report is a full restatement each time it is produced — figures for
 * earlier periods get restated as the books close — so importing replaces the
 * client data wholesale rather than merging. Merging would leave accounts that
 * have since been removed or renamed sitting in the totals with no way to tell
 * they are stale.
 *
 * Kept behind a toggle: this is an occasional action, and a drop zone standing
 * permanently above the numbers invites an accidental replacement.
 */
export function ReplaceReport() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Replace report
      </button>
    );
  }

  return (
    <div className="replace-panel">
      <div className="replace-head">
        <div>
          <div className="filter-label">Replacing the loaded report</div>
          <div className="card-sub">
            Importing removes the current accounts and periods and stores the new file in their
            place. Work orders and daily reports are a separate source and are not touched.
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ClientRevenueImport />
    </div>
  );
}
