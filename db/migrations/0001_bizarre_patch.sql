CREATE TABLE "client_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"alias_of" bigint,
	CONSTRAINT "client_accounts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "client_period_revenue" (
	"client_id" bigint NOT NULL,
	"period_id" bigint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "client_period_revenue_client_id_period_id_pk" PRIMARY KEY("client_id","period_id")
);
--> statement-breakpoint
CREATE TABLE "revenue_periods" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_partial" text DEFAULT 'false' NOT NULL,
	"source_total" numeric(14, 2),
	"sort_order" integer NOT NULL,
	CONSTRAINT "revenue_periods_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "client_period_revenue" ADD CONSTRAINT "client_period_revenue_client_id_client_accounts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_period_revenue" ADD CONSTRAINT "client_period_revenue_period_id_revenue_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."revenue_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_accounts_status_idx" ON "client_accounts" USING btree ("status");