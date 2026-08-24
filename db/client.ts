import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Lazily-created Drizzle client.
 *
 * The connection is built on first use rather than at import time so that the
 * pure KPI layer, its tests, and a build without DATABASE_URL never open a
 * socket. In dev the client is cached on globalThis to survive HMR.
 */
declare global {
  // eslint-disable-next-line no-var
  var __woSql: ReturnType<typeof postgres> | undefined;
}

let cached: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres instance ' +
        '(`docker compose up -d` starts a local one).',
    );
  }

  // On a serverless host each concurrent invocation gets its own process, so a
  // generous per-process pool multiplies into hundreds of connections and
  // exhausts the database. One connection per invocation is the right shape
  // there; a long-lived local server can afford a real pool.
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const max = Number(process.env.DB_POOL_MAX) || (isServerless ? 1 : 5);

  const sql =
    globalThis.__woSql ??
    postgres(url, {
      max,
      // Don't hold a connection open across invocations that will never reuse it.
      idle_timeout: isServerless ? 20 : 0,
      connect_timeout: 10,
    });
  if (process.env.NODE_ENV !== 'production') globalThis.__woSql = sql;

  cached = drizzle(sql, { schema });
  return cached;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
