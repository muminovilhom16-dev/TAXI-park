CREATE TYPE "public"."charge_kind" AS ENUM('subscription', 'commission', 'other');--> statement-breakpoint
CREATE TYPE "public"."earning_source" AS ENUM('manual', 'csv');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('active', 'voided');--> statement-breakpoint
CREATE TABLE "daily_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"aggregator_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"gross_amount" numeric(18, 2) NOT NULL,
	"commission_policy_id" uuid NOT NULL,
	"commission_rate_percent" numeric(7, 4) NOT NULL,
	"commission_amount" numeric(18, 2) NOT NULL,
	"source" "earning_source" NOT NULL,
	"import_batch_id" uuid,
	"note" text,
	"status" "entry_status" DEFAULT 'active' NOT NULL,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earning_amounts_non_negative" CHECK ("daily_earnings"."gross_amount" >= 0 and "daily_earnings"."commission_amount" >= 0),
	CONSTRAINT "earning_commission_le_gross" CHECK ("daily_earnings"."commission_amount" <= "daily_earnings"."gross_amount"),
	CONSTRAINT "earning_void_complete" CHECK (("daily_earnings"."status" = 'active') = ("daily_earnings"."voided_at" is null) and ("daily_earnings"."status" = 'active' or "daily_earnings"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "driver_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"kind" charge_kind NOT NULL,
	"charge_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"earning_id" uuid,
	"note" text,
	"status" "entry_status" DEFAULT 'active' NOT NULL,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_amount_positive" CHECK ("driver_charges"."amount" > 0),
	CONSTRAINT "charge_void_complete" CHECK (("driver_charges"."status" = 'active') = ("driver_charges"."voided_at" is null) and ("driver_charges"."status" = 'active' or "driver_charges"."void_reason" is not null)),
	CONSTRAINT "charge_commission_has_earning" CHECK (("driver_charges"."kind" = 'commission') = ("driver_charges"."earning_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "daily_earnings" ADD CONSTRAINT "daily_earnings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_earnings" ADD CONSTRAINT "daily_earnings_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_earnings" ADD CONSTRAINT "daily_earnings_commission_policy_id_commission_policies_id_fk" FOREIGN KEY ("commission_policy_id") REFERENCES "public"."commission_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_earnings" ADD CONSTRAINT "daily_earnings_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_earnings" ADD CONSTRAINT "daily_earnings_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_earnings" ADD CONSTRAINT "daily_earnings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_charges" ADD CONSTRAINT "driver_charges_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_charges" ADD CONSTRAINT "driver_charges_earning_id_daily_earnings_id_fk" FOREIGN KEY ("earning_id") REFERENCES "public"."daily_earnings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_charges" ADD CONSTRAINT "driver_charges_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_charges" ADD CONSTRAINT "driver_charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "earnings_one_active_uq" ON "daily_earnings" USING btree ("driver_id","aggregator_id","work_date") WHERE "daily_earnings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "earnings_date_idx" ON "daily_earnings" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "earnings_driver_idx" ON "daily_earnings" USING btree ("driver_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_subscription_daily_uq" ON "driver_charges" USING btree ("driver_id","charge_date") WHERE "driver_charges"."kind" = 'subscription' and "driver_charges"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "charges_earning_uq" ON "driver_charges" USING btree ("earning_id") WHERE "driver_charges"."status" = 'active';--> statement-breakpoint
CREATE INDEX "charges_driver_idx" ON "driver_charges" USING btree ("driver_id","charge_date");--> statement-breakpoint
CREATE INDEX "charges_date_idx" ON "driver_charges" USING btree ("charge_date");