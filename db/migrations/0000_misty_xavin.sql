CREATE TABLE "backlog_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"as_of" date NOT NULL,
	"open_work_orders" integer NOT NULL,
	"source" text,
	CONSTRAINT "backlog_snapshots_as_of_unique" UNIQUE("as_of")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "customers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "event_invoices" (
	"event_id" bigint NOT NULL,
	"invoice_no" text NOT NULL,
	CONSTRAINT "event_invoices_event_id_invoice_no_pk" PRIMARY KEY("event_id","invoice_no")
);
--> statement-breakpoint
CREATE TABLE "event_vendors" (
	"event_id" bigint NOT NULL,
	"vendor_id" bigint NOT NULL,
	CONSTRAINT "event_vendors_event_id_vendor_id_pk" PRIMARY KEY("event_id","vendor_id")
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" bigint,
	"row_number" integer,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_date" date NOT NULL,
	"filename" text NOT NULL,
	"source" text NOT NULL,
	"checksum" text NOT NULL,
	"row_count" integer NOT NULL,
	"gmail_message_id" text,
	"gmail_attachment_id" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_status" text NOT NULL,
	"raw_file" text,
	CONSTRAINT "reports_date_checksum_key" UNIQUE("report_date","checksum"),
	CONSTRAINT "reports_date_filename_key" UNIQUE("report_date","filename")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "vendors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "work_order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" bigint NOT NULL,
	"report_date" date NOT NULL,
	"status_raw" text NOT NULL,
	"activity" text NOT NULL,
	"wo_po_number" text,
	"type" text,
	"received_date" date,
	"source" text,
	"customer_id" bigint,
	"project_id" text,
	"project" text,
	"project_status" text,
	"business_unit" text,
	"tasks" integer,
	"tasks_complete" integer,
	"invoice_total" numeric(14, 2),
	"vendor_cost" numeric(14, 2),
	"vendor_dne" numeric(14, 2),
	"gross_margin" numeric(14, 2),
	"gross_margin_pct" numeric(6, 2),
	"authorization" numeric(14, 2),
	"authorization_remaining" numeric(14, 2),
	"raw" jsonb NOT NULL,
	CONSTRAINT "work_order_events_key" UNIQUE("report_id","activity","project_id","wo_po_number")
);
--> statement-breakpoint
ALTER TABLE "event_invoices" ADD CONSTRAINT "event_invoices_event_id_work_order_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."work_order_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_vendors" ADD CONSTRAINT "event_vendors_event_id_work_order_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."work_order_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_vendors" ADD CONSTRAINT "event_vendors_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_report_date_idx" ON "reports" USING btree ("report_date");--> statement-breakpoint
CREATE INDEX "work_order_events_report_date_idx" ON "work_order_events" USING btree ("report_date");--> statement-breakpoint
CREATE INDEX "work_order_events_activity_idx" ON "work_order_events" USING btree ("activity");--> statement-breakpoint
CREATE INDEX "work_order_events_customer_idx" ON "work_order_events" USING btree ("customer_id");