import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import { EXPECTED_HEADERS } from '../csv/column-map';
import { parseReportCsv } from '../csv/parse';
import { normalizeRows, type NormalizedRow, type ValidationIssue } from '../csv/normalize';
import { computeMetrics } from '../kpi/metrics';
import { centsToNumeric } from '../kpi/money';

/** sha256 of the raw file bytes — the identity a re-import is checked against. */
export function checksumOf(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const FILENAME_DATE = /(\d{4}-\d{2}-\d{2})/;

/**
 * Read the report date from the filename (`work-orders-2026-08-20.csv`).
 *
 * The `Received` column is the work order's own receipt date — often months
 * earlier, and blank on some rows — so it can never stand in for the report
 * date. When the filename carries no date the caller must supply one.
 */
export function reportDateFromFilename(filename: string): string | null {
  return filename.match(FILENAME_DATE)?.[1] ?? null;
}

export interface DryRunResult {
  reportDate: string | null;
  filename: string;
  checksum: string;
  rowCount: number;
  columnsMapped: number;
  columnsExpected: number;
  unknownHeaders: string[];
  missingHeaders: string[];
  rows: NormalizedRow[];
  issues: ValidationIssue[];
  newCount: number;
  invoicedCount: number;
  /** True when a report with this date already holds this checksum or filename. */
  alreadyImported: boolean;
  duplicateReason: string | null;
  /** A zero-row file is valid — weekend reports look exactly like this. */
  zeroActivity: boolean;
}

/**
 * Parse and validate a file without writing anything.
 *
 * The import screen shows this before the user commits, so a bad file is caught
 * at upload rather than discovered in the numbers a week later.
 */
export async function dryRunImport(input: {
  filename: string;
  content: string;
  reportDate?: string;
  checkDuplicates?: boolean;
}): Promise<DryRunResult> {
  const { filename, content } = input;
  const checksum = checksumOf(content);
  const reportDate = input.reportDate ?? reportDateFromFilename(filename);

  const parsed = parseReportCsv(content);
  const { rows, issues } = normalizeRows(parsed.rows);
  const metrics = computeMetrics(rows);

  const allIssues = [...issues];
  for (const header of parsed.unknownHeaders) {
    allIssues.push({
      rowNumber: null,
      severity: 'warning',
      message: `Unknown column ${JSON.stringify(header)} — preserved in the raw payload, mapped to no field.`,
    });
  }
  for (const header of parsed.missingHeaders) {
    allIssues.push({
      rowNumber: null,
      severity: 'error',
      message: `Expected column ${JSON.stringify(header)} is missing from this file.`,
    });
  }
  if (!reportDate) {
    allIssues.push({
      rowNumber: null,
      severity: 'error',
      message: `Could not read a report date from the filename ${JSON.stringify(filename)} — supply one explicitly.`,
    });
  }

  let alreadyImported = false;
  let duplicateReason: string | null = null;
  if (input.checkDuplicates !== false && reportDate) {
    const existing = await findExistingReport(reportDate, filename, checksum);
    if (existing) {
      alreadyImported = true;
      duplicateReason = existing.reason;
    }
  }

  return {
    reportDate,
    filename,
    checksum,
    rowCount: rows.length,
    columnsMapped: EXPECTED_HEADERS.length - parsed.missingHeaders.length,
    columnsExpected: EXPECTED_HEADERS.length,
    unknownHeaders: parsed.unknownHeaders,
    missingHeaders: parsed.missingHeaders,
    rows,
    issues: allIssues,
    newCount: metrics.newCount,
    invoicedCount: metrics.invoicedCount,
    alreadyImported,
    duplicateReason,
    zeroActivity: rows.length === 0,
  };
}

async function findExistingReport(reportDate: string, filename: string, checksum: string) {
  const db = getDb();
  const [byChecksum] = await db
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(and(eq(schema.reports.reportDate, reportDate), eq(schema.reports.checksum, checksum)))
    .limit(1);
  if (byChecksum) {
    return { id: byChecksum.id, reason: 'A file with this date and identical contents is already imported.' };
  }

  const [byFilename] = await db
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(and(eq(schema.reports.reportDate, reportDate), eq(schema.reports.filename, filename)))
    .limit(1);
  if (byFilename) {
    return {
      id: byFilename.id,
      reason: 'A different file with this date and filename is already imported — resolve the conflict before re-importing.',
    };
  }
  return null;
}

export interface CommitResult {
  reportId: number;
  reportDate: string;
  rowCount: number;
  importStatus: 'imported' | 'zero_activity' | 'failed';
  issues: ValidationIssue[];
}

export class DuplicateImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateImportError';
  }
}

/**
 * Write a report and its events in one transaction.
 *
 * Events are never updated or deleted on re-import — a duplicate is rejected
 * instead, which is what keeps each day an immutable historical snapshot.
 */
export async function commitImport(input: {
  filename: string;
  content: string;
  reportDate?: string;
  source?: 'manual_upload' | 'gmail';
  gmailMessageId?: string;
  gmailAttachmentId?: string;
}): Promise<CommitResult> {
  const dry = await dryRunImport({ ...input, checkDuplicates: true });

  if (!dry.reportDate) {
    throw new Error(dry.issues.find((i) => i.severity === 'error')?.message ?? 'No report date.');
  }
  if (dry.alreadyImported) {
    throw new DuplicateImportError(dry.duplicateReason ?? 'Already imported.');
  }

  const blocking = dry.issues.filter((i) => i.severity === 'error');
  const reportDate = dry.reportDate;
  const db = getDb();

  return db.transaction(async (tx) => {
    const [report] = await tx
      .insert(schema.reports)
      .values({
        reportDate,
        filename: dry.filename,
        source: input.source ?? 'manual_upload',
        checksum: dry.checksum,
        rowCount: dry.rowCount,
        gmailMessageId: input.gmailMessageId ?? null,
        gmailAttachmentId: input.gmailAttachmentId ?? null,
        importStatus: blocking.length > 0 ? 'failed' : dry.zeroActivity ? 'zero_activity' : 'imported',
        rawFile: input.content,
      })
      .returning({ id: schema.reports.id });

    // Record every issue against the report, including on a failed import —
    // the file is visible in the audit trail either way.
    if (dry.issues.length > 0) {
      await tx.insert(schema.importErrors).values(
        dry.issues.map((issue) => ({
          reportId: report.id,
          rowNumber: issue.rowNumber,
          severity: issue.severity,
          message: issue.message,
          raw: null,
        })),
      );
    }

    if (blocking.length === 0) {
      for (const row of dry.rows) {
        const customerId = row.customer ? await upsertName(tx, schema.customers, row.customer) : null;

        const [event] = await tx
          .insert(schema.workOrderEvents)
          .values({
            reportId: report.id,
            reportDate,
            statusRaw: row.statusRaw,
            activity: row.activity,
            woPoNumber: row.woNumber,
            type: row.type,
            receivedDate: row.receivedDate,
            source: row.source,
            customerId,
            projectId: row.projectId,
            project: row.project,
            projectStatus: row.projectStatus,
            businessUnit: row.businessUnit,
            tasks: row.tasks,
            tasksComplete: row.tasksComplete,
            invoiceTotal: centsToNumeric(row.invoiceTotal),
            vendorCost: centsToNumeric(row.vendorCost),
            vendorDne: centsToNumeric(row.vendorDne),
            grossMargin: centsToNumeric(row.grossMargin),
            grossMarginPct: row.grossMarginPct?.toFixed(2) ?? null,
            authorization: centsToNumeric(row.authorization),
            authorizationRemaining: centsToNumeric(row.authorizationRemaining),
            raw: row.raw,
          })
          .returning({ id: schema.workOrderEvents.id });

        for (const vendorName of row.vendors) {
          const vendorId = await upsertName(tx, schema.vendors, vendorName);
          await tx
            .insert(schema.eventVendors)
            .values({ eventId: event.id, vendorId })
            .onConflictDoNothing();
        }
        for (const invoiceNo of row.invoiceNumbers) {
          await tx
            .insert(schema.eventInvoices)
            .values({ eventId: event.id, invoiceNo })
            .onConflictDoNothing();
        }
      }
    }

    return {
      reportId: report.id,
      reportDate,
      rowCount: dry.rowCount,
      importStatus: blocking.length > 0 ? 'failed' : dry.zeroActivity ? 'zero_activity' : 'imported',
      issues: dry.issues,
    };
  });
}

type NameTable = typeof schema.customers | typeof schema.vendors;

/** Get-or-create by name, safe under concurrent imports. */
async function upsertName(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  table: NameTable,
  name: string,
): Promise<number> {
  const [inserted] = await tx
    .insert(table)
    .values({ name })
    .onConflictDoNothing({ target: table.name })
    .returning({ id: table.id });
  if (inserted) return inserted.id;

  const [existing] = await tx.select({ id: table.id }).from(table).where(eq(table.name, name)).limit(1);
  return existing.id;
}
