import {
  bigserial,
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Each CSV file ingested. The audit trail: one row per file, never mutated.
 *
 * Duplicate protection keys on (report_date, checksum) and (report_date,
 * filename) — deliberately not on Project ID, which is not unique in this
 * source. Re-importing an identical file is rejected, not merged.
 */
export const reports = pgTable(
  'reports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reportDate: date('report_date').notNull(),
    filename: text('filename').notNull(),
    /** 'manual_upload' | 'gmail' */
    source: text('source').notNull(),
    /** sha256 of the raw file bytes. */
    checksum: text('checksum').notNull(),
    rowCount: integer('row_count').notNull(),
    gmailMessageId: text('gmail_message_id'),
    gmailAttachmentId: text('gmail_attachment_id'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    /** 'imported' | 'zero_activity' | 'failed' */
    importStatus: text('import_status').notNull(),
    /** The file verbatim, or an object-storage key once files grow. */
    rawFile: text('raw_file'),
  },
  (t) => ({
    dateChecksum: unique('reports_date_checksum_key').on(t.reportDate, t.checksum),
    dateFilename: unique('reports_date_filename_key').on(t.reportDate, t.filename),
    byDate: index('reports_report_date_idx').on(t.reportDate),
  }),
);

export const customers = pgTable('customers', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull().unique(),
});

export const vendors = pgTable('vendors', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull().unique(),
});

/**
 * One row per CSV data row: an immutable daily event.
 *
 * Money is numeric(14,2), never a float. A null money column means the source
 * did not capture the value; it is excluded from denominators rather than read
 * as zero, so `vendor_cost` and `gross_margin` stay nullable on purpose.
 *
 * Rows sharing a Project ID with different WO/PO numbers are separate events —
 * that is why the unique key spans all four columns.
 */
export const workOrderEvents = pgTable(
  'work_order_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reportId: bigint('report_id', { mode: 'number' })
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    reportDate: date('report_date').notNull(),

    statusRaw: text('status_raw').notNull(),
    /** 'new' | 'invoiced' | 'other' */
    activity: text('activity').notNull(),

    woPoNumber: text('wo_po_number'),
    type: text('type'),
    /** The work order's original receipt date, not the report date. Blank on some rows. */
    receivedDate: date('received_date'),
    source: text('source'),
    customerId: bigint('customer_id', { mode: 'number' }).references(() => customers.id),
    projectId: text('project_id'),
    project: text('project'),
    projectStatus: text('project_status'),
    businessUnit: text('business_unit'),

    tasks: integer('tasks'),
    tasksComplete: integer('tasks_complete'),

    invoiceTotal: numeric('invoice_total', { precision: 14, scale: 2 }),
    vendorCost: numeric('vendor_cost', { precision: 14, scale: 2 }),
    vendorDne: numeric('vendor_dne', { precision: 14, scale: 2 }),
    grossMargin: numeric('gross_margin', { precision: 14, scale: 2 }),
    grossMarginPct: numeric('gross_margin_pct', { precision: 6, scale: 2 }),
    authorization: numeric('authorization', { precision: 14, scale: 2 }),
    authorizationRemaining: numeric('authorization_remaining', { precision: 14, scale: 2 }),

    /** The original row verbatim, including any column the map does not know. */
    raw: jsonb('raw').notNull(),
  },
  (t) => ({
    eventKey: unique('work_order_events_key').on(t.reportId, t.activity, t.projectId, t.woPoNumber),
    byDate: index('work_order_events_report_date_idx').on(t.reportDate),
    byActivity: index('work_order_events_activity_idx').on(t.activity),
    byCustomer: index('work_order_events_customer_idx').on(t.customerId),
  }),
);

export const eventVendors = pgTable(
  'event_vendors',
  {
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => workOrderEvents.id, { onDelete: 'cascade' }),
    vendorId: bigint('vendor_id', { mode: 'number' })
      .notNull()
      .references(() => vendors.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eventId, t.vendorId] }) }),
);

export const eventInvoices = pgTable(
  'event_invoices',
  {
    eventId: bigint('event_id', { mode: 'number' })
      .notNull()
      .references(() => workOrderEvents.id, { onDelete: 'cascade' }),
    invoiceNo: text('invoice_no').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eventId, t.invoiceNo] }) }),
);

/** Row-level import problems. A failed import is recorded, never dropped. */
export const importErrors = pgTable('import_errors', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  reportId: bigint('report_id', { mode: 'number' }).references(() => reports.id, {
    onDelete: 'cascade',
  }),
  rowNumber: integer('row_number'),
  /** 'warning' | 'error' */
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  raw: jsonb('raw'),
});

/**
 * Opening backlog, so cumulative movement can become current backlog.
 * Until a snapshot exists the trend chart is explicitly labelled as movement.
 */
export const backlogSnapshots = pgTable('backlog_snapshots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  asOf: date('as_of').notNull().unique(),
  openWorkOrders: integer('open_work_orders').notNull(),
  source: text('source'),
});
