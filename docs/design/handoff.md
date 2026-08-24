# Handoff: Work Order Operations Dashboard

> **Redacted for a public repository.** This copy of the handoff has the
> reconciled financial figures and the source WO/invoice identifiers removed.
> Everything structural — the schema, every KPI formula, the screen specs and
> the design tokens — is intact and unchanged.
>
> The expected values are asserted in `tests/real-reports.test.ts`, which runs
> against the real reports in the gitignored `tests/fixtures-real/`. Restore the
> full document from the original design bundle once this repository is private.

## Overview

An internal operations dashboard for Noontide Service Corporation USA Inc. It ingests one CSV work-order report per day (currently emailed, eventually pulled from Gmail), stores each day as an immutable historical snapshot, computes operational and financial KPIs deterministically, and presents them in an executive dashboard plus a CSV import screen.

Target repository: `Abiella76/Work-Order-Data` (branch `main`, currently empty apart from `README.md`).

## About the design files

The files in this bundle are **design references created in HTML** — a prototype of the intended look and behavior, not production code to copy. `Work Order Operations.dc.html` is a single-file HTML prototype that parses the four real CSVs at runtime and computes every KPI shown; it is the source of truth for **layout, hierarchy, wording, and every number's definition**, not for the implementation.

Recreate it in the chosen production stack. No app environment exists yet, so the recommendation below stands unless there is a reason to deviate.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and the full metric set are final. Recreate the UI faithfully using the target stack's component and styling conventions. Design tokens are listed at the bottom and also live verbatim in `styles.css` (copied into this bundle).

---

## 1. Recommended stack

| Concern | Choice | Why |
| --- | --- | --- |
| App | Next.js (App Router) + TypeScript | One deployable unit for UI, import endpoint, and future cron/Gmail worker |
| DB | PostgreSQL (Supabase or Neon) | Relational, managed, migrations, row-level security available later |
| ORM / migrations | Prisma or Drizzle | Schema in repo, versioned migrations |
| CSV parsing | `papaparse` (or `csv-parse`) | Handles quoted fields containing commas — the source data has many |
| Money | `decimal.js` or Postgres `numeric(14,2)` | No float drift in revenue/margin |
| Charts | Recharts or ECharts | Bar, line, stacked bar all needed |
| Styling | Tailwind CSS with the tokens below mapped into `theme.extend` | Matches the prototype's dark, dense look |
| Tests | Vitest | KPI fixtures from the four sample CSVs |
| Deploy | Vercel + managed Postgres | Cron jobs available for Phase 4 |

Secrets in environment variables only; `.env` gitignored, `.env.example` with names only. **Do not commit customer CSVs** — the four samples belong in `tests/fixtures/`, and that is a business decision to confirm before merging, since they contain customer names and dollar values. Keep the repo private.

## 2. Source CSV — verified structure

21 columns, header row present, quoted fields containing commas. Exact header strings, in order:

```
Status, Type, WO / PO Number, Received, Source, Customer, Project ID, Project,
Project Status, Business Unit, Tasks, Tasks Complete, Vendors, Invoice #,
Invoice Total, Vendor Cost, Vendor DNE, Gross Margin, Gross Margin %,
Customer Authorization, Authorization Remaining
```

Keep this as an editable **column map** (header string → internal field), not inline string literals, so a renamed column is a config change. Unknown columns should be preserved in a raw JSON payload rather than dropped.

### Status values — authoritative

Only two values appear in the samples:

- `Received` → a **new work order received that day**
- `Invoiced` → a **work order invoiced that day**

Put these in a central status map (`{"received": "new", "invoiced": "invoiced"}`) with an `other` fallback that is counted nowhere but logged as a validation warning. Never infer new-vs-invoiced by diffing consecutive CSVs.

### Data-quality facts observed in the samples

1. **Project ID is not unique.** Aug 20 has 8 `Received` rows across only 4 distinct Project IDs (21846 appears 3×, 21851 3×), each with a different WO/PO number. Aug 21 has 6 rows across 2 Project IDs. The unique key for an event is (report_date, status, WO/PO number, project_id) — not project_id.
2. **Blank numerics are meaningful.** `Vendor Cost` and `Gross Margin` are empty on some invoiced rows (examples redacted). Store as NULL, never 0, and exclude from margin denominators.
3. **`Received` date is empty on some rows** (example redacted) and is often far earlier than the report date — it is the work order's original receipt date, not the report date. Derive report date from the filename / ingestion, not from this column.
4. **Leading whitespace** appears in some `Project` values (`" HVAC Preventive Maintenance > …"`). Trim on normalize, keep the raw value.
5. **Multi-value fields.** `Vendors` and `Invoice #` can hold comma-separated lists inside quotes (a quoted, comma-separated list). Split on normalize into child rows; keep the raw string.
6. **Weekend files are valid and empty.** Aug 22 and Aug 23 contain the header row and zero data rows.

## 3. Proposed schema

```sql
-- one row per CSV file ingested; the audit trail
reports (
  id              bigserial primary key,
  report_date     date not null,
  filename        text not null,
  source          text not null,        -- 'manual_upload' | 'gmail'
  checksum        text not null,        -- sha256 of file bytes
  row_count       int  not null,
  gmail_message_id text,                -- phase 4
  gmail_attachment_id text,             -- phase 4
  imported_at     timestamptz not null default now(),
  import_status   text not null,        -- 'imported' | 'zero_activity' | 'failed'
  raw_file        text,                 -- or object-storage key
  unique (report_date, checksum),
  unique (report_date, filename)
);

-- one row per CSV data row; immutable daily event
work_order_events (
  id              bigserial primary key,
  report_id       bigint not null references reports(id) on delete cascade,
  report_date     date not null,
  status_raw      text not null,
  activity        text not null,        -- 'new' | 'invoiced' | 'other'
  wo_po_number    text,
  type            text,
  received_date   date,
  source          text,
  customer_id     bigint references customers(id),
  project_id      text,
  project         text,
  project_status  text,
  business_unit   text,
  tasks           int,
  tasks_complete  int,
  invoice_total   numeric(14,2),
  vendor_cost     numeric(14,2),
  vendor_dne      numeric(14,2),
  gross_margin    numeric(14,2),
  gross_margin_pct numeric(6,2),
  authorization   numeric(14,2),
  authorization_remaining numeric(14,2),
  raw             jsonb not null,       -- the original row, verbatim
  unique (report_id, activity, project_id, wo_po_number)
);

customers (id bigserial pk, name text unique not null);
vendors   (id bigserial pk, name text unique not null);
event_vendors (event_id bigint, vendor_id bigint, primary key (event_id, vendor_id));
event_invoices (event_id bigint, invoice_no text, primary key (event_id, invoice_no));
import_errors (id bigserial pk, report_id bigint, row_number int, severity text, message text, raw jsonb);

-- phase 3: opening backlog so cumulative movement can become current backlog
backlog_snapshots (id bigserial pk, as_of date unique not null, open_work_orders int not null, source text);
```

`work_orders` (the current-state rollup keyed on wo_po_number) can be added later as a materialized view over `work_order_events`; the initial build does not need it. Never update or delete an event row on re-import — reject the duplicate instead.

## 4. KPI definitions — implement exactly these

Per day, and per selected period over the union of that period's rows. `new` = rows whose activity is `new`; `inv` = rows whose activity is `invoiced`.

| KPI | Formula |
| --- | --- |
| New work orders | `count(new)` |
| Distinct new projects | `count(distinct project_id in new)` |
| Invoiced | `count(inv)` |
| Net backlog movement | `count(new) - count(inv)`; positive = backlog grew |
| Cumulative backlog movement | running sum of net movement over the period, seeded with `backlog_snapshots.open_work_orders` when one exists |
| Throughput | `count(inv) / count(new)`; **null when new = 0** — render `—`, never NaN or Infinity |
| Invoice revenue | — |
| New authorized value | — |
| Vendor cost | — |
| Gross profit | — |
| Gross margin % | `gross profit / sum(invoice_total) over inv where gross_margin is not null` — weighted, on the revenue that actually carries margin. Never average the per-row `Gross Margin %` column. |
| Authorization remaining | `sum(authorization_remaining)` over `new` |
| Calendar-day average | metric ÷ number of calendar days in period |
| Business-day average | metric ÷ number of Mon–Fri days in period; weekend zero-activity days must not drag it down |
| Unpriced revenue | `invoice revenue - margin denominator` — surfaced as an insight, it is the revenue with no cost captured |

### Validation fixtures — assert these exactly

| | Thu 8/20 | Fri 8/21 | Sat 8/22 | Sun 8/23 | Combined |
| --- | --- | --- | --- | --- | --- |
| New WOs | 8 | 6 | 0 | 0 | 14 |
| Distinct new projects | 4 | 2 | 0 | 0 | 5 |
| Invoiced | 8 | 4 | 0 | 0 | 12 |
| Net backlog movement | 0 | +2 | 0 | 0 | +2 |
| Throughput | 100.0% | 66.7% | — | — | 85.7% |
| Invoice revenue | — | — | — | — | — |
| New authorized value | — | — | — | — | — |
| Vendor cost | — | — | — | — | — |
| Gross profit | — | — | — | — | — |
| Margin denominator | — | — | — | — | — |
| Weighted gross margin | — | — | — | — | — |
All of these were computed from the CSVs and reconciled against the stated targets; they agree. The money rows and the per-day averages are redacted here — see `tests/real-reports.test.ts` for the asserted values.

Note the combined gross margin is **not** the average of the two daily rates — that is the point of weighting.

## 5. Screens

### 5.1 Dashboard

Single scrolling page, max content width ~1440px, page padding 22px 28px 56px, base font size 13px, line-height 1.45, background `radial-gradient(120% 80% at 12% -10%, #1d2033 0%, #161826 55%)`.

**Header** — one row, `space-between`, 14px bottom padding, 1px bottom border `rgba(233,233,237,0.16)`.
Left: title "Work Order Operations" (17px, weight 500, letter-spacing -0.01em), a 20×1px `#9184d9` rule, then "Noontide Service Corporation USA Inc." (12px, `#8a8b94`-range neutral). Right: two view buttons — Dashboard / Import log — active one uses the accent-outline button, inactive the ghost button (12px, padding 5px 12px).

**Filter bar** — flex row, 18px gap, 16px top / 18px bottom padding. Three labelled groups, each with a 10px uppercase 0.1em-tracked label above the control:
- *Period*: button group — All 4 days · Business days · Thu 20 · Fri 21 · Sat 22 · Sun 23. In production replace with the fuller set: Today, Yesterday, Last 7 days, Last 30 days, WTD, MTD, QTD, YTD, Custom range, plus a "business days only" toggle.
- *Customer*: select, min-width 210px, options = distinct customers in the data + "All customers".
- *Type*: select, min-width 110px (`WO` / `PO` / All).
Right-aligned, 11px muted: "N calendar days · N business days · N rows in scope".

Filters recompute every card, chart, and table.

**KPI grid** — `grid-template-columns: repeat(5, 1fr)`, 10px gap, two rows of five cards, in this order: New work orders, Invoiced, Net backlog movement, Throughput, Invoice revenue, New authorized value, Vendor cost, Gross profit, Gross margin, Authorization remaining.

Card: `linear-gradient(180deg, #232532 0%, #1e2030 100%)`, 1px border `#292b31`, radius 8px, padding 11px 13px 12px, min-height 84px, column flex, 6px gap. Inside: 10px uppercase 0.08em label (`#6f7079`-range neutral 500); 25px value, weight 500, letter-spacing -0.02em, line-height 1; 11px sub-line pushed to the bottom with `margin-top: auto`. Net backlog movement and Gross margin values take the accent tint `#d2cefd` when signalling; everything else uses `#e9e9ed`. Sub-lines carry the secondary fact (distinct projects, per-business-day rate, the ratio behind a percentage, the margin denominator). Once a prior comparable period exists, add a delta indicator here — direction arrow plus percentage, accent for deterioration, neutral for improvement; do not introduce red/green.

**Received vs invoiced** (left, 1.55fr of a 1.55fr/1fr pair, 12px gap). Card: `#232532`, 1px `#292b31`, radius 8px, padding 14px 16px 12px. Title 13px weight 500 with an inline legend on the right (9×9px 2px-radius swatches: accent `#968ae0` = Received, neutral `#5b5d66`-range = Invoiced). Plot area 158px tall, bottom-ruled, one equal-width column per day, two 26px bars per column with 5px gap, bar heights scaled to the period max, minimum 2px stub so a zero day still reads as a bar. Value labels sit 16px above each bar. Weekend columns get a `rgba(233,233,237,0.03)` wash, a muted axis label, and the sub-label "zero activity".

**Backlog trend** (right, 1fr). Title is conditional: "Cumulative backlog movement" with sub "Not current backlog — no opening count loaded" when no opening snapshot exists; "Current backlog" with "Opening count N plus daily movement" once one does. SVG line chart, viewBox `0 0 320 132`, height 148px: dashed `#3f4149`-range zero line, accent-900 `#2b2741` area fill at 0.75 opacity, 2px `#9184d9` line, 3.5px dots with `#161826` fill and accent stroke. Signed value under each dot.

**Three-across row** (12px gap, `repeat(3, 1fr)`):
- *Invoiced revenue & gross profit* — stacked bars, 118px plot, accent segment on top is recorded gross profit, `#292b31` segment below is the rest of the invoice. Compact value label above each bar ($7.3k).
- *New authorized work* — single bars in the accent-2 ramp (`#7972a9` → `#423e5d`), same geometry.
- *Customer mix* — one row per customer sorted by invoiced revenue desc: name (11px, ellipsised) left, "$5.1k · 36% · 3 new" right, then a 5px track (`#292b31`) with an accent `#968ae0` fill at the revenue share; minimum visible width 0.8% so a customer with receipts but no invoicing still shows.

**Daily executive scorecard** (1.9fr of a 1.9fr/1fr row). Columns: Date, New, Inv., Net, Thru, Revenue, New auth., Vendor cost, Gross profit, GM%. Date left-aligned, everything else right. One row per calendar day plus a "Period total" footer row tinted `rgba(145,132,217,0.07)` with accent-200 text. Weekend rows: `rgba(233,233,237,0.02)` background and muted text — visible, not hidden. Em dash for null metrics. Add column sorting in production.

**Executive insights** (1fr). Title plus the kicker "Deterministic — computed from imported rows". Bullet list, 5px accent or neutral dot per item, 12px text, `text-wrap: pretty`. The rules implemented, all deterministic:
1. Business days where incoming exceeded invoicing, and the period's net movement.
2. Throughput first business day vs last, with the direction of revenue alongside it.
3. Weekend files named as confirmed zero-activity reports, excluded from business-day averages.
4. Top customer's share of invoiced revenue.
5. Unpriced revenue and the margin denominator it forces.
6. Receipt rows vs distinct Project IDs — the reminder that Project ID is not a key.
7. When no opening backlog exists, that the chart is movement and not current backlog.
Structure this as an array of rule functions over the computed period metrics so an AI layer can later append richer items without touching KPI math.

### 5.2 Import log

Two columns, 1fr / 1.5fr, 12px gap.

Left card — "Import a daily report", sub "Manual until Gmail ingestion is live. Zero-row reports are valid." Drop zone: 1px dashed `#5d5294`, radius 8px, background `#2b2741`, padding 26px 18px, centred; "Drop CSV here" in `#e7e5fe`, then "or choose a file — report date is read from the filename and the Received column", then an accent-outline "Choose file" button. Below it a "Pre-import checks" list, one row per check with a bottom divider: detected report date, rows parsed, columns mapped (21/21), checksum, and already-imported verdict. On a real upload these populate from a dry-run parse before the user confirms, and a preview table of the first ~10 normalized rows should appear beneath.

Right card — "Import audit trail" table: Report date, File, Rows, New / Inv., Checksum (monospace), Status. Status reads "Imported" in accent-300, or "Confirmed zero activity" in neutral for the zero-row weekend files. Under it, "Validation notes": zero-row acceptance, the duplicate key (report date + filename + checksum, not Project ID), separate storage of rows sharing a Project ID, and the status values found in source.

## 6. Interactions & behavior

- Period buttons, customer select, and type select are controlled state; changing any recomputes all derived values in one pass. In production these belong in the URL query string so a view is shareable.
- View switch (Dashboard / Import log) is local state; make them routes (`/` and `/imports`).
- Buttons: accent-outline when active, ghost when not; every interactive element gets a hover tint and a pressed state one step past the accent base, and `:focus-visible { outline: 2px solid #9184d9; outline-offset: 2px }`. No browser-default focus rings.
- Loading: the prototype fetches the CSVs asynchronously and renders "Loading daily reports…" in the period note with empty grids. Server-render the KPIs instead and skeleton the charts.
- Zero-received days must render `—` for throughput, not 0% and not NaN.
- Import errors surface as a per-row list from `import_errors`, with the report still recorded as `failed` rather than silently dropped.
- Responsive: below ~1100px the KPI grid drops to 3 columns then 2, the chart pairs stack, and the scorecard scrolls horizontally. Primary target is a laptop, checked a few times a day.

## 7. State

```
view: 'dashboard' | 'import'
range: 'all' | 'business' | <ISO date>     -> becomes a date-range object
customer: 'all' | <customer name>
type: 'all' | 'WO' | 'PO'
reports: ParsedReport[] | null              -> server data
```

Derived, all pure functions of the above: per-day metrics, period aggregate, chart geometry, scorecard rows, insight list. Keep the KPI layer as pure functions taking normalized rows and returning metrics — that is what the tests target, and it is what keeps the numbers auditable.

## 8. Design tokens

From the Nocturne design system; `styles.css` in this bundle is the authoritative copy.

Colors: background `#161826`; surface `#232532`; text `#e9e9ed`; divider `rgba(233,233,237,0.16)`; accent `#9184d9`; accent ramp 100–900 `#f5f4ff #e7e5fe #d2cefd #b5abfc #968ae0 #796cbf #5d5294 #423a6a #2b2741`; accent-2 ramp `#f5f4ff #e7e5fe #d2cefd #b5afe8 #9690c9 #7972a9 #5c5783 #423e5d #2b293a`; neutral 900 `#292b31` (borders, muted fills). No pure black, no pure white, no red/green status colors.

Type: Inter, weights 400/500/600 only — headings never go past 500. Sizes used: 25px KPI value, 17px page title, 13px card titles and body, 12px table and controls, 11px sub-lines, 10px uppercase labels at 0.1em tracking.

Radius 8px (cards, controls), 3px (bars), 2px (legend swatches). Spacing is the system's 0.7×-density scale — the gaps used are 4, 6, 8, 10, 12, 18, 22, 28px. Elevation is a 1px border plus the surface gradient, not stacked shadows.

## 9. Build phases

1. **Foundation** — scaffold, schema + migrations, CSV parser, column map, status map, normalizer, import with duplicate protection and audit trail, KPI functions, Vitest fixtures from the four CSVs asserting section 4's table.
2. **Dashboard** — KPI cards, date and dimension filters, the five charts, scorecard.
3. **Operational intelligence** — business vs calendar averages, customer and vendor drilldowns, insight rules, backlog snapshots and aging buckets.
4. **Gmail ingestion** — least-privilege Google auth (`gmail.readonly` scoped to a sender/subject filter), scheduled pull, attachment retrieval, message-id recorded on `reports`, failures logged not swallowed.
5. **AI layer** — natural-language questions and narrative summaries over the computed metrics. KPI math stays deterministic; the AI never calculates a number the dashboard displays.

## 10. Files in this bundle

- `Work Order Operations.dc.html` — the dashboard and import-log prototype. Open it in a browser next to `wo-data.js`.
- `wo-data.js` — the four daily reports as raw CSV text, exactly as received.
- `csv/work-orders-2026-08-2{0,1,2,3}.csv` — the original files; use as test fixtures.
- `styles.css` — the Nocturne token sheet and component layer the prototype styles against.
