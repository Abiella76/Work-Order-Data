import { asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client';
import type { NormalizedRow } from './csv/normalize';
import { parseMoney } from './kpi/money';
import { makeDayData, type DayData } from './kpi/period';
import type { Activity } from './csv/column-map';

/**
 * Server-side reads.
 *
 * Everything here converts stored rows back into the same `NormalizedRow` shape
 * the CSV normalizer produces, so the KPI layer has exactly one input type and
 * the fixture tests exercise the same code path the dashboard renders.
 */

function toNormalizedRow(row: typeof schema.workOrderEvents.$inferSelect, customer: string | null): NormalizedRow {
  return {
    rowNumber: 0,
    statusRaw: row.statusRaw,
    activity: row.activity as Activity,
    woNumber: row.woPoNumber,
    type: row.type,
    receivedDate: row.receivedDate,
    source: row.source,
    customer,
    projectId: row.projectId,
    project: row.project,
    projectStatus: row.projectStatus,
    businessUnit: row.businessUnit,
    tasks: row.tasks,
    tasksComplete: row.tasksComplete,
    // Multi-value children live in their own tables; the raw payload keeps the
    // original strings, so nothing is lost by not re-joining them here.
    vendors: [],
    invoiceNumbers: [],
    invoiceTotal: parseMoney(row.invoiceTotal),
    vendorCost: parseMoney(row.vendorCost),
    vendorDne: parseMoney(row.vendorDne),
    grossMargin: parseMoney(row.grossMargin),
    grossMarginPct: row.grossMarginPct == null ? null : Number(row.grossMarginPct),
    authorization: parseMoney(row.authorization),
    authorizationRemaining: parseMoney(row.authorizationRemaining),
    raw: (row.raw ?? {}) as Record<string, string>,
  };
}

/** Every imported day, oldest first, ready for `buildPeriodView`. */
export async function loadDays(): Promise<DayData[]> {
  const db = getDb();

  const reports = await db
    .select({
      id: schema.reports.id,
      reportDate: schema.reports.reportDate,
      filename: schema.reports.filename,
    })
    .from(schema.reports)
    .orderBy(asc(schema.reports.reportDate));

  if (reports.length === 0) return [];

  const events = await db
    .select({ event: schema.workOrderEvents, customer: schema.customers.name })
    .from(schema.workOrderEvents)
    .leftJoin(schema.customers, eq(schema.workOrderEvents.customerId, schema.customers.id));

  const byReport = new Map<number, NormalizedRow[]>();
  for (const { event, customer } of events) {
    const list = byReport.get(event.reportId) ?? [];
    list.push(toNormalizedRow(event, customer));
    byReport.set(event.reportId, list);
  }

  return reports.map((r) =>
    makeDayData({
      reportDate: r.reportDate,
      filename: r.filename,
      rows: byReport.get(r.id) ?? [],
    }),
  );
}

export interface ImportLogRow {
  id: number;
  reportDate: string;
  filename: string;
  rowCount: number;
  newCount: number;
  invoicedCount: number;
  checksum: string;
  importStatus: string;
  importedAt: Date;
  errorCount: number;
}

/** The import audit trail, newest first. */
export async function loadImportLog(): Promise<ImportLogRow[]> {
  const db = getDb();

  const reports = await db
    .select()
    .from(schema.reports)
    .orderBy(desc(schema.reports.reportDate), desc(schema.reports.importedAt));

  const events = await db
    .select({
      reportId: schema.workOrderEvents.reportId,
      activity: schema.workOrderEvents.activity,
    })
    .from(schema.workOrderEvents);

  const errors = await db
    .select({ reportId: schema.importErrors.reportId })
    .from(schema.importErrors)
    .where(eq(schema.importErrors.severity, 'error'));

  const counts = new Map<number, { newCount: number; invoicedCount: number }>();
  for (const e of events) {
    const c = counts.get(e.reportId) ?? { newCount: 0, invoicedCount: 0 };
    if (e.activity === 'new') c.newCount += 1;
    if (e.activity === 'invoiced') c.invoicedCount += 1;
    counts.set(e.reportId, c);
  }

  const errorCounts = new Map<number, number>();
  for (const e of errors) {
    if (e.reportId == null) continue;
    errorCounts.set(e.reportId, (errorCounts.get(e.reportId) ?? 0) + 1);
  }

  return reports.map((r) => ({
    id: r.id,
    reportDate: r.reportDate,
    filename: r.filename,
    rowCount: r.rowCount,
    newCount: counts.get(r.id)?.newCount ?? 0,
    invoicedCount: counts.get(r.id)?.invoicedCount ?? 0,
    checksum: r.checksum,
    importStatus: r.importStatus,
    importedAt: r.importedAt,
    errorCount: errorCounts.get(r.id) ?? 0,
  }));
}

/**
 * The most recent opening backlog count, or 0 when none has been loaded.
 * Zero is the signal the trend chart uses to label itself movement rather than
 * a backlog level.
 */
export async function loadOpeningBacklog(): Promise<number> {
  const db = getDb();
  const [snapshot] = await db
    .select()
    .from(schema.backlogSnapshots)
    .orderBy(desc(schema.backlogSnapshots.asOf))
    .limit(1);
  return snapshot?.openWorkOrders ?? 0;
}
