/**
 * Money is carried as integer cents everywhere between parsing and formatting.
 *
 * Revenue and margin are summed across many rows; doing that in binary floats
 * drifts (0.1 + 0.2 famously). Cents are exact under addition, so every total
 * the dashboard shows is reproducible to the penny. Division happens once, at
 * the end, when a ratio is actually needed.
 *
 * Postgres stores the same values as numeric(14,2); `db/schema.ts` reads them
 * back as strings and they re-enter this module through `parseMoney`.
 */

/** A money amount in integer cents. */
export type Cents = number;

/**
 * Parse a money cell into cents. Returns null for a blank cell — blanks are
 * meaningful in this source (an invoiced row with no vendor cost captured) and
 * must never collapse to 0.
 *
 * Accepts `$1,272.50`, `1272.5`, `(500.00)` and `-500.00`.
 */
export function parseMoney(raw: string | null | undefined): Cents | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  // Accounting negatives: (1,234.56)
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s === '' || !/^\d*(\.\d*)?$/.test(s)) return null;

  const [whole = '0', frac = ''] = s.split('.');
  // Round to the cent rather than truncating, so 0.005 does not vanish.
  const padded = (frac + '00').slice(0, 3);
  const thousandths = Number(whole) * 1000 + Number(padded || '0');
  const cents = Math.round(thousandths / 10);
  return negative ? -cents : cents;
}

/** Parse a plain integer cell (Tasks, Tasks Complete). Blank -> null. */
export function parseInt0(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Parse a percentage cell (`41.1`) into a number. Blank -> null. */
export function parsePct(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[%\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Sum cents, skipping nulls. Returns 0 for an all-null list. */
export function sumCents(values: readonly (Cents | null)[]): Cents {
  let total = 0;
  for (const v of values) if (v != null) total += v;
  return total;
}

/** `$1,234.56`, with the sign outside the symbol. */
export function formatMoney(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars.toLocaleString('en-US')}.${rem}`;
}

/** `$7.3k` for chart labels; exact dollars below $1,000. */
export function formatMoneyCompact(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  if (abs >= 100_000) return `${sign}$${(abs / 100_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs / 100)}`;
}

/** `46.1%`, or an em dash when the ratio is undefined. */
export function formatPct(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Cents -> the `numeric(14,2)` string Postgres wants. */
export function centsToNumeric(cents: Cents | null): string | null {
  if (cents == null) return null;
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
