# Deploying to Vercel

The app needs two things: somewhere to run (Vercel) and a Postgres database
(Neon). Both have free tiers that comfortably fit one CSV report per day.

Total time: about fifteen minutes, most of it waiting for builds.

---

## 1. Create the database

1. Sign up at **https://neon.tech** and create a project. Any region near you is
   fine; the app is not latency-sensitive.
2. On the project dashboard, copy the connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-something-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

3. **Use the pooled string** — the one with `-pooler` in the hostname. Neon
   shows both; the pooled one routes through PgBouncer, which is what keeps a
   serverless app from exhausting the connection limit. If you only see the
   direct string, look for a "Pooled connection" toggle.

Keep this string somewhere safe for the next two steps. It is a password —
don't paste it into a file that gets committed. `.env` is gitignored.

## 2. Create the tables

Migrations do not run themselves. From a local checkout, run them once against
the Neon database:

```bash
git clone https://github.com/Abiella76/Work-Order-Data
cd Work-Order-Data
git checkout claude/work-order-data-repo-7jzolp
npm install

# Paste your Neon string here — note the quotes, the URL contains characters
# the shell would otherwise interpret.
export DATABASE_URL="postgresql://...?sslmode=require"
npm run db:migrate
```

You should see `migrations applied successfully`. Verify with
`npm run db:studio`, which opens a browser view of the empty tables.

Re-run `npm run db:migrate` after any future schema change. It is safe to run
repeatedly — already-applied migrations are skipped.

## 3. Deploy

1. Go to **https://vercel.com** and click **Sign Up**. Choose **Continue with
   GitHub** and authorize it — this creates the account using your existing
   GitHub login, so there is no separate password to set. Pick the **Hobby**
   (free) plan when asked, and skip the team-name step if it offers one.

   Vercel will ask which repositories it may access. Granting it just
   `Work-Order-Data` is enough.
2. On the dashboard, **Add New → Project**, and import
   `Abiella76/Work-Order-Data`.
3. Under **Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | your pooled Neon connection string |

   Add it for Production, Preview and Development.
4. Leave every other setting alone — Vercel detects Next.js and configures the
   build itself.
5. **Deploy.**

The first build takes two or three minutes. When it finishes you get a URL like
`work-order-data.vercel.app`. Opening it shows the dashboard's empty state,
because no reports have been imported yet.

### If you deploy a branch

Vercel deploys the repository's default branch (`main`) as production. Until
this work is merged, either merge the branch first, or open the project's
Settings → Git and set the production branch to
`claude/work-order-data-repo-7jzolp`.

## 4. Import your first report

Open `/imports` on the deployed URL, drop in a daily CSV, and check the
pre-import panel before confirming:

- **Detected report date** — read from the filename, so it must contain
  `YYYY-MM-DD` (e.g. `work-orders-2026-08-20.csv`).
- **Columns mapped** — should read `21 / 21`.
- **Already imported** — should read `No — safe to import`.

Then **Import report**. The dashboard will have numbers in it.

To load a backlog of past reports all at once, use the seed script locally
against the same database instead of uploading them one at a time:

```bash
export DATABASE_URL="postgresql://...?sslmode=require"
npm run seed -- /path/to/folder-of-csvs
```

It skips anything already imported, so it is safe to re-run.

---

## Notes

**Cost.** Neon's free tier and Vercel's Hobby plan both cover this comfortably —
one report a day is a trivial workload. Vercel's Hobby plan is for
non-commercial use; a dashboard for a business needs a Pro plan, which is a
per-user monthly fee.

**Access.** A Vercel deployment is public by default — anyone with the URL sees
your operational and financial data. Before putting real reports in it, turn on
**Settings → Deployment Protection → Vercel Authentication**, which requires a
Vercel login to view. Password protection is another option on paid plans.

**Secrets.** `DATABASE_URL` lives only in Vercel's environment variables and
your local `.env`. Never commit it. If it leaks, rotate the password in Neon and
update it in both places.

**Connection pooling.** The app opens one database connection per serverless
invocation and closes idle ones after 20 seconds (`db/client.ts`). Combined with
Neon's pooled connection string, this keeps a burst of traffic from exhausting
the database. Override with `DB_POOL_MAX` if you ever need to.

## Troubleshooting

**"No database configured"** — `DATABASE_URL` is missing from the Vercel
environment, or it was added after the last build. Add it, then redeploy from
the Deployments tab.

**`ECONNREFUSED` or a connection timeout** — usually the direct Neon string
rather than the pooled one. Check for `-pooler` in the hostname.

**`relation "reports" does not exist`** — step 2 was skipped or ran against a
different database. Re-run `npm run db:migrate` with the same string you gave
Vercel.

**Build fails on a type error** — run `npm run typecheck` and `npm test` locally
first; Vercel runs the same build.

**The import screen rejects a file** — the pre-import panel says why. A missing
report date means the filename has no `YYYY-MM-DD` in it; fewer than 21 mapped
columns means the export format changed, and `lib/csv/column-map.ts` is the one
file to update.
