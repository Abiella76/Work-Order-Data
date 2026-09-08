'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Which window the concentration pie is measured over.
 *
 * A select rather than a button row: the list grows by one entry every year,
 * and it sits inside a half-width card where four buttons already wrap.
 *
 * The choice lives in the query string like every other filter here, so a view
 * of one year is a shareable link and the server recomputes the slices from it.
 */
export function ConcentrationScopeSelect({
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
    if (next === defaultValue) query.delete('concentration');
    else query.set('concentration', next);
    const qs = query.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className="scope-select" data-pending={isPending || undefined}>
      <label className="filter-label" htmlFor="concentration-scope">
        Period
      </label>
      <select
        id="concentration-scope"
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
