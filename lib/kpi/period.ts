import type { NormalizedRow } from '../csv/normalize';
import { computeMetrics, type Metrics } from './metrics';
import type { Cents } from './money';

/** One imported daily report, with its rows and the metrics over them. */
export interface DayData {
  reportDate: string;
  filename: string;
  weekday: string;
  isWeekend: boolean;
  /** `Thu 20` — the compact axis label. */
  label: string;
  rows: NormalizedRow[];
  metrics: Metrics;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Weekday of an ISO date, computed in UTC.
 *
 * Report dates are calendar days, not instants: constructing them in local time
 * shifts the date by one west of UTC and silently reclassifies a Monday as a
 * weekend day, which would corrupt every business-day average.
 */
export function weekdayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return WEEKDAYS[d.getUTCDay()];
}

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function makeDayData(input: {
  reportDate: string;
  filename: string;
  rows: NormalizedRow[];
}): DayData {
  const weekday = weekdayOf(input.reportDate);
  return {
    reportDate: input.reportDate,
    filename: input.filename,
    weekday,
    isWeekend: isWeekend(input.reportDate),
    label: `${weekday} ${input.reportDate.slice(8)}`,
    rows: input.rows,
    metrics: computeMetrics(input.rows),
  };
}

export interface PeriodFilters {
  /** 'all' | 'business' | a single ISO report date. */
  range: string;
  /** 'all' or an exact customer name. */
  customer: string;
  /** 'all' | 'WO' | 'PO'. */
  type: string;
}

export const DEFAULT_FILTERS: PeriodFilters = { range: 'all', customer: 'all', type: 'all' };

function matchesDimensions(row: NormalizedRow, filters: PeriodFilters): boolean {
  if (filters.customer !== 'all' && row.customer !== filters.customer) return false;
  if (filters.type !== 'all' && row.type !== filters.type) return false;
  return true;
}

/** Everything the dashboard renders, derived in one pass from days + filters. */
export interface PeriodView {
  /** Days inside the selected range, each with dimension-filtered metrics. */
  days: DayData[];
  /** Every day, filtered by dimension but not by range — the charts show full context. */
  allDays: DayData[];
  /** Aggregate over the union of the in-range, dimension-filtered rows. */
  aggregate: Metrics;
  calendarDays: number;
  businessDays: number;
  rowsInScope: number;
  /** Distinct customers across all loaded rows, for the filter control. */
  customers: string[];
  /** Distinct types across all loaded rows, for the filter control. */
  types: string[];
}

/**
 * Apply filters and compute every derived value.
 *
 * Dimension filters (customer, type) apply to the per-day metrics too, so a
 * filtered chart and a filtered KPI card always agree.
 */
export function buildPeriodView(source: readonly DayData[], filters: PeriodFilters): PeriodView {
  const filteredDays = source.map((day) => {
    const rows = day.rows.filter((r) => matchesDimensions(r, filters));
    return { ...day, rows, metrics: computeMetrics(rows) };
  });

  const inRange = filteredDays.filter((day) => {
    if (filters.range === 'all') return true;
    if (filters.range === 'business') return !day.isWeekend;
    return day.reportDate === filters.range;
  });

  const aggregate = computeMetrics(inRange.flatMap((d) => d.rows));

  const allRows = source.flatMap((d) => d.rows);
  const customers = [...new Set(allRows.map((r) => r.customer).filter((c): c is string => !!c))].sort();
  const types = [...new Set(allRows.map((r) => r.type).filter((t): t is string => !!t))].sort();

  return {
    days: inRange,
    allDays: filteredDays,
    aggregate,
    calendarDays: inRange.length,
    businessDays: inRange.filter((d) => !d.isWeekend).length,
    rowsInScope: inRange.reduce((n, d) => n + d.rows.length, 0),
    customers,
    types,
  };
}

/**
 * Cumulative backlog movement across the period, seeded with an opening count
 * when one has been loaded.
 *
 * Without an opening snapshot this is movement, not current backlog, and the
 * chart says so — an unseeded running sum presented as a backlog level would be
 * wrong by exactly the opening count.
 */
export interface BacklogPoint {
  label: string;
  reportDate: string;
  value: number;
}

export function backlogSeries(days: readonly DayData[], openingBacklog = 0): BacklogPoint[] {
  let running = openingBacklog;
  return days.map((day) => {
    running += day.metrics.netMovement;
    return { label: day.label, reportDate: day.reportDate, value: running };
  });
}

/** Per-business-day and per-calendar-day rates for a money metric. */
export function averages(value: Cents, view: PeriodView) {
  return {
    perCalendarDay: view.calendarDays > 0 ? value / view.calendarDays : null,
    perBusinessDay: view.businessDays > 0 ? value / view.businessDays : null,
  };
}
