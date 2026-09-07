import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';

/**
 * What the app can say about the database it is actually talking to.
 *
 * A "table does not exist" message is only half an answer: the other half is
 * which database was asked. Without it, a wrong DATABASE_URL and an unapplied
 * migration look identical from the browser, and the only way to tell them
 * apart is to run queries by hand against a database the reader has to guess.
 *
 * Nothing here exposes a credential. The user and password are parsed out and
 * discarded; only the host and database name — which the connection's owner
 * already knows and which identify nothing on their own — reach the page.
 */

export interface DbDiagnostics {
  /** e.g. `ep-cool-name-12345.us-east-2.aws.neon.tech` — no credentials. */
  host: string | null;
  /** e.g. `neondb`. */
  database: string | null;
  /** Public tables the connection can actually see, or null if unreadable. */
  tables: string[] | null;
}

/** Host and database from DATABASE_URL, with user and password dropped. */
export function describeConnection(): Pick<DbDiagnostics, 'host' | 'database'> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return { host: null, database: null };
  try {
    const url = new URL(raw);
    return {
      host: url.hostname || null,
      database: url.pathname.replace(/^\//, '') || null,
    };
  } catch {
    // An unparseable URL is its own diagnosis, reported elsewhere.
    return { host: null, database: null };
  }
}

/**
 * Collect diagnostics for an error page.
 *
 * Every step is allowed to fail: this runs because something already went
 * wrong, and a diagnostic that throws would replace a useful message with a
 * blank server error.
 */
export async function collectDbDiagnostics(): Promise<DbDiagnostics> {
  const connection = describeConnection();

  let tables: string[] | null = null;
  try {
    const result = await getDb().execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    // postgres-js returns the rows as an array; other drivers wrap them in
    // `.rows`. Accept both, so a driver change does not silently blank the
    // one panel whose job is to explain a failure.
    const raw = result as unknown as
      | { table_name: string }[]
      | { rows?: { table_name: string }[] };
    const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
    tables = rows.map((r) => r.table_name);
  } catch {
    tables = null;
  }

  return { ...connection, tables };
}
