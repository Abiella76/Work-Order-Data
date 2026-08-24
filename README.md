# Work Order Operations

Internal operations dashboard for **Noontide Service Corporation USA Inc.**

One CSV work-order report arrives per day. This app ingests each file as an
immutable historical snapshot, computes operational and financial KPIs
deterministically, and presents them as an executive dashboard plus a CSV
import screen.

Built to `docs/design/handoff.md`, which remains the source of truth for layout,
wording, and every metric's definition.

---

## ⚠️ This repository is public

The daily reports contain customer names, vendor names, invoice numbers and
dollar values. **They are not in this repository and must not be committed while
it is public.** `.gitignore` excludes `tests/fixtures-real/` and `reports/` for
exactly this reason.

The design handoff asks for the repository to be private. Until that happens:

- Real CSVs stay local only.
- The committed test fixtures under `tests/fixtures/` are **synthetic** — invented
  customers, vendors and amounts that reproduce every data-quality quirk of the
  real source.
- `.env` is gitignored; secrets live in environment variables only.

---

## Setup

```bash
npm install

cp .env.example .env          # then point DATABASE_URL at Postgres
docker compose up -d          # or use a managed instance (Neon / Supabase)

npm run db:migrate            # apply schema migrations
npm run dev                   # http://localhost:3000
```

Load a directory of daily reports:

```bash
npm run seed -- ./reports
```

The seed script imports each file through the same path an upload takes,
duplicate protection included — re-running it is safe and skips what is already
stored.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm test` | Vitest — the KPI fixture suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a migration from `db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run seed -- <dir>` | Import a directory of daily CSVs |

---

## Stack

| Concern | Choice |
| --- | --- |
| App | Next.js (App Router) + TypeScript |
| Database | PostgreSQL |
| ORM / migrations | Drizzle — schema in repo, versioned migrations |
| CSV parsing | papaparse — the source is full of quoted fields containing commas |
| Money | integer cents in app code, `numeric(14,2)` in Postgres |
| Charts | hand-drawn flexbox and SVG (see below) |
| Tests | Vitest, fixtures asserting the handoff's validation table |

Two deliberate departures from the handoff's recommended stack:

- **Charts are hand-drawn rather than Recharts.** The handoff specifies chart
  geometry to the pixel — 26px bars, a 158px plot, a `0 0 320 132` viewBox — and
  a chart library would have to be overridden at every one of those points to
  land in the same place. The shapes are simple and there is no zoom or tooltip
  behaviour to implement. See `components/Charts.tsx`.
- **Money is integer cents, not `decimal.js`.** Totals are sums, and cents are
  exact under addition, so a dependency is not needed to avoid float drift.
  Division happens once, at the end, when a ratio is actually required. See
  `lib/kpi/money.ts`.

---

## How it fits together

```
CSV file
  → lib/csv/parse.ts        papaparse + the column map
  → lib/csv/normalize.ts    typed rows, split multi-value cells, validation issues
  → lib/import/ingest.ts    checksum, duplicate check, one transaction
  → Postgres                reports + work_order_events (immutable)
  → lib/queries.ts          read back into the same normalized shape
  → lib/kpi/*.ts            pure functions → metrics, period view, insights
  → app/page.tsx            server-rendered dashboard
```

The KPI layer is pure: no database, no request, no clock. That is what makes the
numbers auditable, and it is what the tests target.

### Configuration, not string literals

- **`lib/csv/column-map.ts`** — header string → internal field, and the status
  map (`Received` → new, `Invoiced` → invoiced). A renamed column or a new
  status is a change to this file alone. Unknown columns are preserved in a raw
  JSON payload rather than dropped; unknown statuses are stored, counted in no
  KPI, and reported as a validation warning.
- **`lib/kpi/insights.ts`** — an array of rule functions over the computed period
  metrics, so a later AI layer can append richer items without touching KPI math.

---

## Data facts the code depends on

These were observed in the source and are enforced by tests:

1. **Project ID is not unique.** Several work orders share one Project ID. The
   unique key for an event is (report, activity, WO/PO number, project ID).
2. **Blank numerics are meaningful.** `Vendor Cost` and `Gross Margin` are empty
   on some invoiced rows. They are stored as NULL, never 0, and excluded from
   margin denominators.
3. **`Received` is the work order's own receipt date**, often months before the
   report date and sometimes blank. The report date comes from the filename.
4. **Leading whitespace** appears in some `Project` values — trimmed on
   normalize, raw value kept.
5. **`Vendors` and `Invoice #` hold comma-separated lists**, and the entries
   themselves contain commas (`Co., Inc.`, `Birmingham, AL`). The splitter keeps
   those attached; both continuation cases are closed sets, not guesses.
6. **Weekend files are valid and empty.** A header-only file is stored as
   confirmed zero activity, not as a failed import.

### Numbers that must never appear

- A ratio with a zero denominator renders `—`, never `0%`, `NaN`, or `Infinity`.
- Gross margin is **weighted** — gross profit over the revenue that actually
  carries margin. The source's per-row `Gross Margin %` column is stored but
  never averaged into a period figure. Over the four sample days the weighted
  figure is 43.5%; the mean of the daily rates is 42.4%, and it is wrong.
- Business-day averages divide by Mon–Fri days only, so a zero-activity weekend
  cannot drag them down.

---

## Testing

```bash
npm test
```

The committed suite runs against `tests/fixtures/` — four synthetic daily
reports built to exercise every quirk listed above, including a shared Project
ID, invoiced rows with no margin captured, an unrecognised status, and two
zero-row weekend files.

### Validating against the real reports

The handoff includes a reconciled validation table for the four real days
(8/20–8/23). `tests/real-reports.test.ts` asserts every cell of it — daily and
combined counts, revenue, vendor cost, gross profit, the margin denominator,
weighted margin, and both calendar- and business-day averages.

That file holds only the assertion *structure*. Both the reports and their
expected figures are gitignored, because the CSVs carry customer and vendor
names and the expected values are the business's own revenue and margin. The
suite **skips automatically** when they are absent, so CI never sees either.

To run them locally, put both in `tests/fixtures-real/`:

```
tests/fixtures-real/
  work-orders-2026-08-20.csv    ← the four daily reports
  work-orders-2026-08-21.csv
  work-orders-2026-08-22.csv
  work-orders-2026-08-23.csv
  expected.json                 ← the handoff's validation table
```

Then `npm test`. `expected.json` mirrors the handoff table:

```jsonc
{
  "days": [
    { "reportDate": "2026-08-20", "newCount": 8, "revenue": "$…", /* … */ },
    { "reportDate": "2026-08-22", "zeroActivity": true }
  ],
  "combined": { /* the same keys */ },
  "calendarDays": 4,
  "businessDays": 2,
  "businessDayAverages": { "new": "7.0", "invoiced": "6.0", "revenue": "$…" },
  "calendarDayAverages": { /* … */ }
}
```

---

## Roadmap

1. ~~**Foundation** — schema, migrations, CSV parser, column map, normalizer,
   import with duplicate protection and audit trail, KPI functions, fixtures.~~
2. ~~**Dashboard** — KPI cards, filters, charts, scorecard.~~
3. **Operational intelligence** — customer and vendor drilldowns, backlog
   snapshots and aging buckets, period-over-period deltas on the KPI cards.
4. **Gmail ingestion** — least-privilege `gmail.readonly` scoped to a
   sender/subject filter, scheduled pull, message id recorded on `reports`.
5. **AI layer** — natural-language questions and narrative summaries over the
   computed metrics. KPI math stays deterministic; the AI never calculates a
   number the dashboard displays.

Known gaps, deliberately left for phase 3: the KPI cards have no
period-over-period delta indicators yet (no prior comparable period is loaded),
the scorecard columns are not sortable, and the period filter offers the
handoff's prototype ranges rather than the fuller Today / WTD / MTD / QTD / YTD
set.

### Open question for the business

At least one subcontractor appears in the source under two spellings — an
all-caps form with a hyphenated city, and a mixed-case form with a `City, ST`
tail — and is therefore stored as two rows in `vendors`. Merging vendor aliases
is a business decision, not something the importer should guess at. Run
`select name from vendors order by name` after a seed to review the list.

---

## Design reference

- `docs/design/handoff.md` — the full specification.
- `docs/design/nocturne-tokens.css` — the design system's token sheet.
- `docs/design/prototype.dc.html` — the HTML prototype, for behaviour reference.
  Its `wo-data.js` companion is **not** included: it embeds the four real
  reports verbatim.
