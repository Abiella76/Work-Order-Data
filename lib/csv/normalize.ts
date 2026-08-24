import { toActivity, type Activity } from './column-map';
import { parseMoney, parseInt0, parsePct, type Cents } from '../kpi/money';
import type { RawRow } from './parse';

/**
 * A source row after normalization: typed, trimmed, with multi-value cells
 * split and the original preserved.
 *
 * Every money field is integer cents or null. Null means "not captured in the
 * source" and is excluded from the denominators it would otherwise distort; it
 * is never silently read as zero.
 */
export interface NormalizedRow {
  rowNumber: number;
  statusRaw: string;
  activity: Activity;

  woNumber: string | null;
  type: string | null;
  /** The work order's original receipt date — NOT the report date, and blank on some rows. */
  receivedDate: string | null;
  source: string | null;
  customer: string | null;
  projectId: string | null;
  /** Trimmed; the untrimmed original stays in `raw`. */
  project: string | null;
  projectStatus: string | null;
  businessUnit: string | null;

  tasks: number | null;
  tasksComplete: number | null;

  /** Split from the comma-separated cell; the original string stays in `raw`. */
  vendors: string[];
  invoiceNumbers: string[];

  invoiceTotal: Cents | null;
  vendorCost: Cents | null;
  vendorDne: Cents | null;
  grossMargin: Cents | null;
  /** The source's own per-row percentage. Stored, never averaged into a period figure. */
  grossMarginPct: number | null;
  authorization: Cents | null;
  authorizationRemaining: Cents | null;

  raw: Record<string, string>;
}

export type Severity = 'warning' | 'error';

export interface ValidationIssue {
  rowNumber: number | null;
  severity: Severity;
  message: string;
}

export interface NormalizeResult {
  rows: NormalizedRow[];
  issues: ValidationIssue[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce a date cell to ISO `YYYY-MM-DD`, or null when blank/unparseable.
 * Accepts the ISO the source emits and the `M/D/YYYY` a spreadsheet round-trip
 * can introduce.
 */
function normalizeDate(value: string | undefined): string | null {
  const s = (value ?? '').trim();
  if (s === '') return null;
  if (ISO_DATE.test(s)) return s;

  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Split a multi-value cell. `Vendors` and `Invoice #` can each hold a
 * comma-separated list inside quotes, but the entries themselves contain
 * commas — both a corporate suffix (`Harbor Point Plumbing & Heating
 * Co., Inc.`) and a city/state tail (`Ridgeline Security Solutions Fairview ,
 * AL`) — so a bare split on "," shreds them into fragments.
 *
 * The rule: a comma separates entries unless what follows it is a continuation
 * of the name just seen. Two continuations appear in this source, and both are
 * closed sets rather than guesses — a corporate suffix, or a US state code.
 */
const CORPORATE_SUFFIX = /^(inc|llc|l\.l\.c|ltd|co|corp|incorporated|company|pllc|lp|llp|pc|pa)\b\.?$/i;

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

/** True when `token` continues the preceding name rather than starting a new entry. */
function continuesName(token: string): boolean {
  // `PA` is both a state code and a corporate suffix; either reading keeps the
  // comma, so the overlap is harmless.
  if (US_STATE_CODES.has(token)) return true;
  return CORPORATE_SUFFIX.test(token);
}

export function splitMultiValue(value: string | undefined): string[] {
  const s = (value ?? '').trim();
  if (s === '') return [];

  const parts: string[] = [];
  let current = '';
  const tokens = s.split(',');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1]?.trim() ?? '';
    current = current === '' ? token : `${current},${token}`;
    if (i < tokens.length - 1 && continuesName(next)) continue;
    // Collapse the stray space some names carry before the comma.
    const trimmed = current.trim().replace(/\s+,/g, ',');
    if (trimmed !== '') parts.push(trimmed);
    current = '';
  }
  const tail = current.trim().replace(/\s+,/g, ',');
  if (tail !== '') parts.push(tail);
  return parts;
}

function text(value: string | undefined): string | null {
  const s = (value ?? '').trim();
  return s === '' ? null : s;
}

/**
 * Normalize parsed rows and collect validation issues.
 *
 * Issues never drop a row: an unrecognised status still produces a row (with
 * activity `other`, which no KPI counts) and a warning. Nothing is discarded
 * silently.
 */
export function normalizeRows(rows: readonly RawRow[]): NormalizeResult {
  const issues: ValidationIssue[] = [];
  const normalized: NormalizedRow[] = [];

  for (const row of rows) {
    const f = row.fields;
    const statusRaw = (f.status ?? '').trim();
    const activity = toActivity(statusRaw);

    if (activity === 'other') {
      issues.push({
        rowNumber: row.rowNumber,
        severity: 'warning',
        message: `Unrecognised Status ${JSON.stringify(statusRaw)} — row stored but counted in no KPI.`,
      });
    }

    const receivedRaw = (f.received ?? '').trim();
    const receivedDate = normalizeDate(f.received);
    if (receivedRaw !== '' && receivedDate === null) {
      issues.push({
        rowNumber: row.rowNumber,
        severity: 'warning',
        message: `Unparseable Received date ${JSON.stringify(receivedRaw)} — stored as null.`,
      });
    }

    const invoiceTotal = parseMoney(f.invoiceTotal);
    const grossMargin = parseMoney(f.grossMargin);
    if (activity === 'invoiced' && invoiceTotal != null && grossMargin == null) {
      issues.push({
        rowNumber: row.rowNumber,
        severity: 'warning',
        message:
          `Invoiced row ${f.woNumber ?? '(no WO)'} has invoice total but no Gross Margin — ` +
          `excluded from the margin denominator.`,
      });
    }

    normalized.push({
      rowNumber: row.rowNumber,
      statusRaw,
      activity,
      woNumber: text(f.woNumber),
      type: text(f.type),
      receivedDate,
      source: text(f.source),
      customer: text(f.customer),
      projectId: text(f.projectId),
      project: text(f.project),
      projectStatus: text(f.projectStatus),
      businessUnit: text(f.businessUnit),
      tasks: parseInt0(f.tasks),
      tasksComplete: parseInt0(f.tasksComplete),
      vendors: splitMultiValue(f.vendors),
      invoiceNumbers: splitMultiValue(f.invoiceNo),
      invoiceTotal,
      vendorCost: parseMoney(f.vendorCost),
      vendorDne: parseMoney(f.vendorDne),
      grossMargin,
      grossMarginPct: parsePct(f.grossMarginPct),
      authorization: parseMoney(f.authorization),
      authorizationRemaining: parseMoney(f.authRemaining),
      raw: row.raw,
    });
  }

  return { rows: normalized, issues };
}
