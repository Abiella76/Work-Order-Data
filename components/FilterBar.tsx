'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import type { DayData } from '@/lib/kpi/period';

/**
 * Period, customer and type controls.
 *
 * Filter state lives in the URL query string, not component state, so a view is
 * shareable and the server re-renders the KPIs from it. Changing any control
 * recomputes every card, chart and table in one pass on the server.
 */
export function FilterBar({
  days,
  customers,
  types,
  note,
}: {
  days: DayData[];
  customers: string[];
  types: string[];
  note: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const range = params.get('range') ?? 'all';
  const customer = params.get('customer') ?? 'all';
  const type = params.get('type') ?? 'all';

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      // Keep the default out of the URL so a shared link stays readable.
      if (value === 'all') next.delete(key);
      else next.set(key, value);
      const query = next.toString();
      startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
    },
    [params, pathname, router],
  );

  const rangeOptions = [
    { id: 'all', label: `All ${days.length} days` },
    { id: 'business', label: 'Business days' },
    ...days.map((d) => ({ id: d.reportDate, label: d.label })),
  ];

  return (
    <div className="filters" data-pending={isPending || undefined}>
      <div className="filter-group">
        <div className="filter-label">Period</div>
        <div className="filter-buttons">
          {rangeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`btn ${range === option.id ? 'btn-active' : 'btn-ghost'}`}
              aria-pressed={range === option.id}
              onClick={() => setParam('range', option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor="filter-customer">
          Customer
        </label>
        <select
          id="filter-customer"
          className="select"
          style={{ minWidth: 210 }}
          value={customer}
          onChange={(e) => setParam('customer', e.target.value)}
        >
          <option value="all">All customers</option>
          {customers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor="filter-type">
          Type
        </label>
        <select
          id="filter-type"
          className="select"
          style={{ minWidth: 110 }}
          value={type}
          onChange={(e) => setParam('type', e.target.value)}
        >
          <option value="all">All</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-note">{note}</div>
    </div>
  );
}
