import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db/client';
import { SETUP_STATEMENTS } from '@/lib/setup-sql';
import { collectDbDiagnostics } from '@/lib/db-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Create any missing tables, using the app's own connection.
 *
 * The alternative — pasting migrations into the database provider's console —
 * silently depends on that console and the app pointing at the same database.
 * When they do not, both ends report something reassuring and neither reports
 * the mismatch. Applying the schema through the connection the app actually
 * uses makes that failure impossible.
 *
 * Every statement is additive: create-if-not-exists and constraint additions
 * that tolerate already existing. Nothing drops, truncates or rewrites data, so
 * the worst outcome of an unwanted call is no change at all. That is what makes
 * it safe to expose without an auth layer this app does not yet have.
 */
export async function POST() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });
  }

  const before = await collectDbDiagnostics();
  const applied: string[] = [];
  const failures: { statement: string; message: string }[] = [];

  const db = getDb();
  for (const statement of SETUP_STATEMENTS) {
    try {
      await db.execute(sql.raw(statement));
      applied.push(statement.slice(0, 60));
    } catch (error) {
      // Keep going: one failing statement should not block the rest, and the
      // report below is more useful than a single aborted run.
      failures.push({
        statement: statement.slice(0, 120),
        message: error instanceof Error ? error.message.split('\n')[0] : String(error),
      });
    }
  }

  const after = await collectDbDiagnostics();

  return NextResponse.json({
    host: after.host,
    database: after.database,
    tablesBefore: before.tables?.length ?? null,
    tablesAfter: after.tables?.length ?? null,
    created: (after.tables ?? []).filter((t) => !(before.tables ?? []).includes(t)),
    applied: applied.length,
    failures,
  });
}
