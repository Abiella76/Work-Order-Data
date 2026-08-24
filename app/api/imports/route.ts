import { NextResponse } from 'next/server';
import { dryRunImport, commitImport, DuplicateImportError } from '@/lib/import/ingest';
import { formatMoney } from '@/lib/kpi/money';
import { isDatabaseConfigured } from '@/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREVIEW_ROWS = 10;

/**
 * Import endpoint.
 *
 * `?dryRun=1` parses, validates and checks for a duplicate without writing —
 * that is what the import screen shows before the user commits. Without it the
 * file is written in a single transaction.
 */
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not set — see README.md, "Setup".' },
      { status: 503 },
    );
  }

  let body: { filename?: unknown; content?: unknown; reportDate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const filename = typeof body.filename === 'string' ? body.filename : null;
  const content = typeof body.content === 'string' ? body.content : null;
  const reportDate = typeof body.reportDate === 'string' ? body.reportDate : undefined;

  if (!filename || content == null) {
    return NextResponse.json({ error: 'filename and content are required.' }, { status: 400 });
  }

  const isDryRun = new URL(request.url).searchParams.get('dryRun') === '1';

  try {
    if (isDryRun) {
      const result = await dryRunImport({ filename, content, reportDate });
      return NextResponse.json({
        reportDate: result.reportDate,
        filename: result.filename,
        checksum: result.checksum,
        rowCount: result.rowCount,
        columnsMapped: result.columnsMapped,
        columnsExpected: result.columnsExpected,
        newCount: result.newCount,
        invoicedCount: result.invoicedCount,
        alreadyImported: result.alreadyImported,
        duplicateReason: result.duplicateReason,
        zeroActivity: result.zeroActivity,
        issues: result.issues,
        // A preview of the normalized rows, so the user checks what will be
        // stored rather than what the file happens to look like.
        preview: result.rows.slice(0, PREVIEW_ROWS).map((row) => ({
          activity: row.activity,
          woNumber: row.woNumber,
          customer: row.customer,
          projectId: row.projectId,
          invoiceTotal: row.invoiceTotal == null ? null : formatMoney(row.invoiceTotal),
          grossMargin: row.grossMargin == null ? null : formatMoney(row.grossMargin),
        })),
      });
    }

    const result = await commitImport({ filename, content, reportDate, source: 'manual_upload' });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateImportError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Import failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
