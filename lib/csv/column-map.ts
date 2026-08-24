/**
 * Column map and status map for the daily work-order report.
 *
 * Both are config, deliberately not inline string literals: when the upstream
 * report renames a column or introduces a status, this file is the only edit.
 * Unknown columns are never dropped — the normalizer keeps every source cell in
 * a raw payload, and unknown statuses are counted nowhere but reported as a
 * validation warning.
 */

/** Internal field names for the 21 verified source columns. */
export type SourceField =
  | 'status'
  | 'type'
  | 'woNumber'
  | 'received'
  | 'source'
  | 'customer'
  | 'projectId'
  | 'project'
  | 'projectStatus'
  | 'businessUnit'
  | 'tasks'
  | 'tasksComplete'
  | 'vendors'
  | 'invoiceNo'
  | 'invoiceTotal'
  | 'vendorCost'
  | 'vendorDne'
  | 'grossMargin'
  | 'grossMarginPct'
  | 'authorization'
  | 'authRemaining';

/**
 * Exact header string -> internal field. Order here is the verified source
 * order, but matching is by name, so a reordered export still imports.
 */
export const COLUMN_MAP: Readonly<Record<string, SourceField>> = {
  'Status': 'status',
  'Type': 'type',
  'WO / PO Number': 'woNumber',
  'Received': 'received',
  'Source': 'source',
  'Customer': 'customer',
  'Project ID': 'projectId',
  'Project': 'project',
  'Project Status': 'projectStatus',
  'Business Unit': 'businessUnit',
  'Tasks': 'tasks',
  'Tasks Complete': 'tasksComplete',
  'Vendors': 'vendors',
  'Invoice #': 'invoiceNo',
  'Invoice Total': 'invoiceTotal',
  'Vendor Cost': 'vendorCost',
  'Vendor DNE': 'vendorDne',
  'Gross Margin': 'grossMargin',
  'Gross Margin %': 'grossMarginPct',
  'Customer Authorization': 'authorization',
  'Authorization Remaining': 'authRemaining',
};

/** Every header the map knows about, in source order. */
export const EXPECTED_HEADERS = Object.keys(COLUMN_MAP);

/**
 * What a row's Status means operationally.
 *
 * `new`      — a work order received that day
 * `invoiced` — a work order invoiced that day
 * `other`    — an unrecognised status; counted in no KPI, surfaced as a warning
 *
 * New-vs-invoiced is read from this column and never inferred by diffing
 * consecutive daily reports.
 */
export type Activity = 'new' | 'invoiced' | 'other';

/** Lowercased status -> activity. */
export const STATUS_MAP: Readonly<Record<string, Activity>> = {
  received: 'new',
  invoiced: 'invoiced',
};

export function toActivity(statusRaw: string): Activity {
  return STATUS_MAP[statusRaw.trim().toLowerCase()] ?? 'other';
}
