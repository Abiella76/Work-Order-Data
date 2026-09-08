import { formatMoney, type Cents } from './money';

/**
 * The corporate snapshot: client activity and revenue across reporting periods.
 *
 * Pure functions over already-loaded rows, like the daily KPI layer — no
 * database, no clock. Money is integer cents throughout.
 *
 * Two facts from the source report shape everything here:
 *
 *   - Periods are the finance report's own, not rolling windows. The current
 *     statement covers roughly ten months, so it is marked partial and is never
 *     silently compared against a full fiscal year.
 *   - A missing amount means no activity in that period, which is not the same
 *     as zero. Absent stays absent; it is never coerced to 0.
 */

export interface Period {
  key: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isPartial: boolean;
  /** The source report's stated total for the period, when it gave one. */
  sourceTotal: Cents | null;
  sortOrder: number;
}

export type ClientStatus = 'active' | 'inactive';

export interface ClientRow {
  name: string;
  status: ClientStatus;
  /** period key -> amount in cents. A key absent means no activity. */
  revenue: Record<string, Cents>;
}

/** Months a period spans, to the nearest tenth — used to annualise a partial. */
export function periodMonths(period: Period): number {
  const start = new Date(`${period.startsOn}T00:00:00Z`);
  const end = new Date(`${period.endsOn}T00:00:00Z`);
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  return Math.round((days / 30.4375) * 10) / 10;
}

/**
 * A partial period scaled to a full year, so it can sit beside complete years.
 *
 * Presented as an estimate and never mixed into an actual: a ten-month figure
 * shown next to twelve-month ones invites a false read of decline, and silently
 * grossing it up invents revenue. The chart shows both, labelled.
 */
export function annualisedRunRate(total: Cents, period: Period): Cents | null {
  if (!period.isPartial) return null;
  const months = periodMonths(period);
  if (months <= 0) return null;
  return Math.round((total / months) * 12);
}

export interface PeriodTotals {
  period: Period;
  /** Sum of the client rows loaded for this period. */
  total: Cents;
  /** Positive amounts only — what was billed before credits. */
  gross: Cents;
  /** Negative amounts only, as a negative number — credits and reversals. */
  credits: Cents;
  clientCount: number;
  /** Difference between the source report's stated total and the rows we hold. */
  reconciliationGap: Cents | null;
}

export function periodTotals(clients: readonly ClientRow[], periods: readonly Period[]): PeriodTotals[] {
  return [...periods]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((period) => {
      let total = 0;
      let gross = 0;
      let credits = 0;
      let clientCount = 0;

      for (const client of clients) {
        const amount = client.revenue[period.key];
        if (amount === undefined) continue;
        clientCount += 1;
        total += amount;
        if (amount >= 0) gross += amount;
        else credits += amount;
      }

      return {
        period,
        total,
        gross,
        credits,
        clientCount,
        reconciliationGap: period.sourceTotal == null ? null : period.sourceTotal - total,
      };
    });
}

export interface ClientSummary extends ClientRow {
  /** Total across every period we hold for this client. */
  lifetime: Cents;
  /** The most recent period with any activity. */
  lastActivePeriod: Period | null;
  /** Revenue in the newest period, or null when it had no activity there. */
  current: Cents | null;
  /** Share of the newest period's total, 0..1. Null when it had no activity. */
  currentShare: number | null;
  /** True when any period holds a negative amount. */
  hasCredits: boolean;
}

export function summariseClients(
  clients: readonly ClientRow[],
  periods: readonly Period[],
): ClientSummary[] {
  const ordered = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const newest = ordered[ordered.length - 1];
  const newestTotal = newest
    ? clients.reduce((n, c) => n + (c.revenue[newest.key] ?? 0), 0)
    : 0;

  return clients
    .map((client) => {
      const amounts = Object.values(client.revenue);
      const lifetime = amounts.reduce((n, v) => n + v, 0);
      const lastActive =
        [...ordered].reverse().find((p) => client.revenue[p.key] !== undefined) ?? null;
      const current = newest ? (client.revenue[newest.key] ?? null) : null;

      return {
        ...client,
        lifetime,
        lastActivePeriod: lastActive,
        current,
        currentShare: current != null && newestTotal > 0 ? current / newestTotal : null,
        hasCredits: amounts.some((v) => v < 0),
      };
    })
    .sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity) || b.lifetime - a.lifetime);
}

export interface StatusSplit {
  active: number;
  inactive: number;
  total: number;
  /** Revenue the inactive group produced across all periods — what lapsed. */
  inactiveLifetime: Cents;
  /** Revenue the active group is producing in the newest period. */
  activeCurrent: Cents;
}

/**
 * Accounts split by whether they traded in one named period.
 *
 * The stored status is the source file's own classification: it answers "is
 * this a customer now", and cannot answer "was this a customer in FY2024".
 * Asked about a period, the split is derived from that period's figures
 * instead.
 *
 * Active means a positive amount billed in the period. An explicit $0.00 is
 * not activity — the source lists such accounts and its own report excludes
 * them from the active count — and neither is a lone credit, which adjusts
 * past work rather than recording new work.
 */
export function periodStatusSplit(
  summaries: readonly ClientSummary[],
  periodKey: string,
): StatusSplit {
  const billed = (c: ClientSummary) => (c.revenue[periodKey] ?? 0) > 0;
  const active = summaries.filter(billed);
  const inactive = summaries.filter((c) => !billed(c));
  return {
    active: active.length,
    inactive: inactive.length,
    total: summaries.length,
    inactiveLifetime: inactive.reduce((n, c) => n + c.lifetime, 0),
    activeCurrent: active.reduce((n, c) => n + (c.revenue[periodKey] ?? 0), 0),
  };
}

export function statusSplit(summaries: readonly ClientSummary[]): StatusSplit {
  const active = summaries.filter((c) => c.status === 'active');
  const inactive = summaries.filter((c) => c.status === 'inactive');
  return {
    active: active.length,
    inactive: inactive.length,
    total: summaries.length,
    inactiveLifetime: inactive.reduce((n, c) => n + c.lifetime, 0),
    activeCurrent: active.reduce((n, c) => n + (c.current ?? 0), 0),
  };
}

/**
 * How much of the newest period rests on the largest few accounts.
 *
 * Concentration is the question a client list is usually being asked, and it is
 * the one number here that changes decisions.
 */
export interface Concentration {
  topN: number;
  share: number;
  amount: Cents;
  names: string[];
}

/**
 * Which revenue a concentration figure is measured over.
 *
 * The answer moves a great deal with the window, so the window is always
 * stated rather than assumed: a book that looks concentrated this year can look
 * diversified across three, because the accounts carrying it changed. `current`
 * exists so a caller that only wants "the latest period" need not know which
 * period that is.
 */
export type ConcentrationScope =
  | { kind: 'current' }
  | { kind: 'all' }
  | { kind: 'period'; key: string };

export const CURRENT_SCOPE: ConcentrationScope = { kind: 'current' };

/** The figure a scope sizes an account by, or null where it has no activity. */
function scopeAmount(client: ClientSummary, scope: ConcentrationScope): Cents | null {
  switch (scope.kind) {
    case 'current':
      return client.current;
    case 'all':
      return client.lifetime;
    case 'period':
      return client.revenue[scope.key] ?? null;
  }
}

/**
 * Accounts with positive revenue in the scope, largest first.
 *
 * Non-positive accounts are dropped rather than ranked: a share of a whole is
 * what both callers are computing, and a credit has no share of one.
 */
function rankedByScope(
  summaries: readonly ClientSummary[],
  scope: ConcentrationScope,
): { client: ClientSummary; amount: Cents }[] {
  return summaries
    .map((client) => ({ client, amount: scopeAmount(client, scope) }))
    .filter((row): row is { client: ClientSummary; amount: Cents } => row.amount != null && row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

export function concentration(
  summaries: readonly ClientSummary[],
  topN = 5,
  scope: ConcentrationScope = CURRENT_SCOPE,
): Concentration {
  const ranked = rankedByScope(summaries, scope);
  const total = ranked.reduce((n, r) => n + r.amount, 0);
  const top = ranked.slice(0, topN);
  const amount = top.reduce((n, r) => n + r.amount, 0);
  return {
    topN,
    share: total > 0 ? amount / total : 0,
    amount,
    names: top.map((r) => r.client.name),
  };
}

/**
 * Account names that differ only by punctuation, spacing or case.
 *
 * The source warns that it lists such names separately rather than merging
 * them, so the same commercial relationship can appear more than once and
 * quietly halve its apparent size. Surfacing candidates is useful; merging them
 * is a business decision the importer must not make on its own.
 */
export interface DuplicateCandidate {
  normalised: string;
  names: string[];
  combined: Cents;
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|usa|company)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function duplicateCandidates(summaries: readonly ClientSummary[]): DuplicateCandidate[] {
  const groups = new Map<string, ClientSummary[]>();
  for (const client of summaries) {
    const key = normaliseName(client.name);
    if (key === '') continue;
    groups.set(key, [...(groups.get(key) ?? []), client]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([normalised, list]) => ({
      normalised,
      names: list.map((c) => c.name),
      combined: list.reduce((n, c) => n + c.lifetime, 0),
    }))
    .sort((a, b) => b.combined - a.combined);
}

/** Deterministic observations for the snapshot, same pattern as the daily insights. */
export interface CorporateInsight {
  id: string;
  text: string;
  tone: 'accent' | 'neutral';
}

export function corporateInsights(input: {
  summaries: ClientSummary[];
  totals: PeriodTotals[];
  split: StatusSplit;
}): CorporateInsight[] {
  const { summaries, totals, split } = input;
  const out: CorporateInsight[] = [];
  const newest = totals[totals.length - 1];

  if (split.total > 0) {
    out.push({
      id: 'status-split',
      tone: 'accent',
      text:
        `${split.active} of ${split.total} accounts are active — ${Math.round((split.active / split.total) * 100)}% — ` +
        `and the ${split.inactive} inactive accounts represent ${formatMoney(split.inactiveLifetime)} of historical revenue.`,
    });
  }

  const conc = concentration(summaries, 5);
  if (conc.share > 0) {
    out.push({
      id: 'concentration',
      tone: conc.share >= 0.5 ? 'accent' : 'neutral',
      text:
        `The largest ${conc.topN} accounts are ${Math.round(conc.share * 100)}% of current-period revenue ` +
        `(${formatMoney(conc.amount)}). ${conc.names[0]} alone is the largest.`,
    });
  }

  if (newest?.period.isPartial) {
    const months = periodMonths(newest.period);
    const runRate = annualisedRunRate(newest.total, newest.period);
    out.push({
      id: 'partial-period',
      tone: 'accent',
      text:
        `${newest.period.label} covers about ${months} months, not a full year. At this pace a full year ` +
        `would be ${runRate == null ? '—' : formatMoney(runRate)}; the bar chart shows the actual, not the estimate.`,
    });
  }

  const credits = totals.filter((t) => t.credits < 0);
  if (credits.length > 0) {
    const worst = credits.reduce((a, b) => (a.credits < b.credits ? a : b));
    out.push({
      id: 'credits',
      tone: 'neutral',
      text:
        `Credits and reversals total ${formatMoney(worst.credits)} in ${worst.period.label}, against ` +
        `${formatMoney(worst.gross)} billed. Net revenue is the figure shown.`,
    });
  }

  const gaps = totals.filter((t) => t.reconciliationGap != null && Math.abs(t.reconciliationGap) > 100);
  if (gaps.length > 0) {
    out.push({
      id: 'reconciliation',
      tone: 'accent',
      text:
        `${gaps.map((g) => g.period.label).join(' and ')} ${gaps.length === 1 ? 'does' : 'do'} not reconcile to the ` +
        `source report's stated total — the loaded rows fall short by ` +
        `${gaps.map((g) => formatMoney(Math.abs(g.reconciliationGap!))).join(' and ')}. Per-client history is ` +
        `incomplete for those periods.`,
    });
  }

  const dupes = duplicateCandidates(summaries);
  if (dupes.length > 0) {
    out.push({
      id: 'duplicates',
      tone: 'neutral',
      text:
        `${dupes.length} ${dupes.length === 1 ? 'pair of names differs' : 'sets of names differ'} only by ` +
        `spacing or punctuation (${dupes[0].names.join(' / ')}). They are kept separate — merging accounts is a ` +
        `business decision, not an import rule.`,
    });
  }

  return out;
}

/** One slice of the concentration pie. */
export interface PieSlice {
  name: string;
  amount: Cents;
  share: number;
  /** Cumulative share before this slice, 0..1 — the slice's start angle. */
  offset: number;
  /** Index into the categorical palette; -1 marks the neutral remainder. */
  colorIndex: number;
}

/**
 * Top accounts as pie slices, with everything else gathered into one remainder.
 *
 * Capped at five named slices because the categorical palette has five hues
 * that are measurably distinguishable on this surface. A sixth would have to
 * repeat a hue or invent one that fails the colour checks, and a pie with
 * twenty near-identical wedges answers no question at all.
 *
 * Negative amounts are excluded rather than drawn: a pie shows parts of a
 * whole, and a negative part has no angle. Credits are reported in their own
 * panel, where they can be read as what they are.
 */
export function concentrationSlices(
  summaries: readonly ClientSummary[],
  topN = 5,
  scope: ConcentrationScope = CURRENT_SCOPE,
): { slices: PieSlice[]; total: Cents; othersCount: number } {
  const ranked = rankedByScope(summaries, scope);

  const total = ranked.reduce((n, r) => n + r.amount, 0);
  if (total <= 0) return { slices: [], total: 0, othersCount: 0 };

  const top = ranked.slice(0, topN);
  const rest = ranked.slice(topN);
  const restAmount = rest.reduce((n, r) => n + r.amount, 0);

  const slices: PieSlice[] = [];
  let offset = 0;

  top.forEach(({ client, amount }, i) => {
    const share = amount / total;
    slices.push({
      name: client.name,
      amount,
      share,
      offset,
      colorIndex: i,
    });
    offset += share;
  });

  if (restAmount > 0) {
    slices.push({
      name: `${rest.length} other account${rest.length === 1 ? '' : 's'}`,
      amount: restAmount,
      share: restAmount / total,
      offset,
      colorIndex: -1,
    });
  }

  return { slices, total, othersCount: rest.length };
}
