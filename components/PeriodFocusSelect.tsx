'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Which window the summary cards and the concentration pie are measured over.
 *
 * It sits in the section head rather than on one card because it governs
 * several: a control that changed figures above it would be a trap. The
 * multi-period views below — the revenue bars, the credits table, the account
 * tables — deliberately ignore it, since comparing periods is their whole job.
 *
 * A select rather than a button row: the list grows by one entry every year.
 * The choice lives in the query string like every other filter here, so a view
 * of one year is a shareable link and the server recomputes from it.
 */
export function PeriodFocusSelect({
  periods,
  value,
  defaultValue,
}: {
  periods: { key: string; label: string }[];
  value: string;
  /** The period shown when the query string says nothing — kept out of the URL. */
  defaultValue: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const query = new URLSearchParams(params.toString());
    if (next === defaultValue) query.delete('period');
    else query.set('period', next);
    const qs = query.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className="scope-select" data-pending={isPending || undefined}>
      <label className="filter-label" htmlFor="period-focus">
        Period
      </label>
      <select
        id="period-focus"
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="all">All time</option>
        {periods.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
