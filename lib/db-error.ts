/**
 * Turn a database failure into something the person looking at the screen can
 * act on.
 *
 * A page that throws renders as a blank "server-side exception" with a digest
 * and nothing else, which sends the reader to the platform logs to learn that
 * a table is missing. Since the handful of ways this connection actually fails
 * are known and each has a specific fix, the page says which one happened.
 */

export interface DbErrorInfo {
  /** Short headline for the empty state. */
  title: string;
  /** What to do about it, in order. */
  steps: string[];
  /** The underlying message, redacted. Shown as supporting detail. */
  detail: string;
}

/**
 * Strip anything credential-shaped out of a message before it reaches the page.
 *
 * Driver errors can quote the connection string, and this text is rendered in a
 * browser and pasted into chats and screenshots — the password must not travel
 * with it.
 */
export function redact(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"]*/gi, 'postgresql://[redacted]')
    .replace(/password=[^\s&'"]*/gi, 'password=[redacted]');
}

const MISSING_TABLE = /relation "(\w+)" does not exist/i;

export function describeDbError(error: unknown): DbErrorInfo {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = redact(raw.split('\n')[0]);
  const code = (error as { code?: string } | null)?.code;

  const missing = raw.match(MISSING_TABLE);
  if (missing) {
    const table = missing[1];
    // Naming one migration file was wrong once the schema grew past it: a
    // database missing only the newest tables was told to re-run the first
    // migration, which it had already applied. Name the missing table instead
    // and point at the whole directory, so the message stays correct as more
    // migrations are added.
    return {
      title: `The database is missing the "${table}" table`,
      steps: [
        'Open your database provider\'s SQL editor (in Neon: Postgres database → SQL Editor).',
        'Run the migrations in db/migrations/ that have not been applied yet, in filename order — each file is plain SQL you can paste and run.',
        'Reload this page — no redeploy needed, since only the database changed.',
      ],
      detail,
    };
  }

  // The driver rejects the value before any network call — so the variable is
  // not a connection string at all. Usually the site's own URL, or a value that
  // kept its `DATABASE_URL=` prefix or a wrapping `psql '...'`.
  if (/invalid url/i.test(raw)) {
    return {
      title: 'DATABASE_URL is not a valid connection string',
      steps: [
        'The value must begin with postgresql:// — a site address such as https://…vercel.app is not a database.',
        'Copy it from your provider with its copy button, not by retyping: the password is masked on screen.',
        'Paste only the connection string itself — no DATABASE_URL= prefix, no surrounding quotes, and no psql command around it.',
        'Save, then redeploy so the new value is read.',
      ],
      detail,
    };
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(raw)) {
    return {
      title: 'The database host could not be found',
      steps: [
        'Check DATABASE_URL for a typo in the hostname — a truncated paste is the usual cause.',
        'Copy the connection string again from your provider and replace the value.',
        'Redeploy, so the new value is picked up.',
      ],
      detail,
    };
  }

  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'CONNECT_TIMEOUT') {
    return {
      title: 'The database refused the connection',
      steps: [
        'Confirm the database is running and accepts connections from the internet.',
        'Confirm the connection string ends with ?sslmode=require.',
        'If your provider offers a pooled connection string, prefer it.',
      ],
      detail,
    };
  }

  if (/password authentication failed|role .* does not exist/i.test(raw)) {
    return {
      title: 'The database rejected the credentials',
      steps: [
        'The username or password in DATABASE_URL is wrong — often from pasting a masked value with dots in place of the password.',
        'Copy the full connection string from your provider and replace the value.',
        'Redeploy.',
      ],
      detail,
    };
  }

  return {
    title: 'The database could not be reached',
    steps: [
      'Check that DATABASE_URL is set correctly and the database is reachable.',
      'Redeploy after changing it — the value is read when the app starts.',
    ],
    detail,
  };
}
