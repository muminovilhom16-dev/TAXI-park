CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('success', 'failure', 'denied');--> statement-breakpoint
CREATE TYPE "public"."commission_base_type" AS ENUM('gross_earnings', 'after_aggregator_commission', 'eligible_driver_earnings', 'custom');--> statement-breakpoint
CREATE TYPE "public"."crm_status" AS ENUM('new', 'documents_review', 'active', 'suspended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'validated', 'committed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('file_import', 'api', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('unknown', 'valid', 'expired', 'missing');--> statement-breakpoint
CREATE TYPE "public"."money_flow_model" AS ENUM('park_collects', 'driver_collects', 'mixed', 'unconfirmed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'card', 'aggregator_balance', 'other');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."rounding_mode" AS ENUM('half_up', 'half_even', 'down');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('draft', 'needs_review', 'approved', 'partially_paid', 'paid', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."statement_line_status" AS ENUM('valid', 'invalid', 'unknown_driver', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('aggregator_payout_in', 'driver_payout_out', 'commission_in', 'park_expense', 'driver_other_payment_in', 'refund', 'adjustment');--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"login" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggregator_driver_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregator_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"external_driver_id" text NOT NULL,
	"external_status" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggregators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"money_flow_model" "money_flow_model" DEFAULT 'unconfirmed' NOT NULL,
	"integration_status" "integration_status" DEFAULT 'file_import' NOT NULL,
	"import_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregators_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "driver_status_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "driver_status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"driver_id" uuid NOT NULL,
	"from_status" "crm_status",
	"to_status" "crm_status" NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_vehicle_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"assigned_from" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_to" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text NOT NULL,
	"extra_contact" text,
	"passport_number" text,
	"license_number" text,
	"license_status" "license_status" DEFAULT 'unknown' NOT NULL,
	"license_expires_on" date,
	"registered_on" date DEFAULT (now() at time zone 'Asia/Tashkent')::date NOT NULL,
	"manager_id" uuid,
	"crm_status" "crm_status" DEFAULT 'new' NOT NULL,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plate_number" text NOT NULL,
	"make" text,
	"model" text NOT NULL,
	"year" integer,
	"color" text,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggregator_statement_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "aggregator_statement_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_batch_id" uuid NOT NULL,
	"aggregator_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"line_fingerprint" text NOT NULL,
	"external_line_id" text,
	"external_driver_id" text,
	"driver_id" uuid,
	"occurred_at" timestamp with time zone,
	"gross_amount" numeric(18, 2),
	"aggregator_commission_amount" numeric(18, 2),
	"bonus_amount" numeric(18, 2),
	"penalty_amount" numeric(18, 2),
	"refund_amount" numeric(18, 2),
	"cash_amount" numeric(18, 2),
	"net_amount" numeric(18, 2),
	"status" "statement_line_status" NOT NULL,
	"validation_errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_percent" numeric(7, 4) NOT NULL,
	"base_type" "commission_base_type" NOT NULL,
	"base_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rounding_mode" "rounding_mode" DEFAULT 'half_up' NOT NULL,
	"rounding_scale" integer DEFAULT 0 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rate_range" CHECK ("commission_policies"."rate_percent" >= 0 and "commission_policies"."rate_percent" <= 100),
	CONSTRAINT "commission_rounding_scale" CHECK ("commission_policies"."rounding_scale" between 0 and 2),
	CONSTRAINT "commission_valid_range" CHECK ("commission_policies"."valid_to" is null or "commission_policies"."valid_to" > "commission_policies"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "transaction_type" NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"driver_id" uuid,
	"aggregator_id" uuid,
	"expense_category" text,
	"external_id" text,
	"idempotency_key" text NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"reverses_transaction_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_transactions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "financial_transactions_reverses_transaction_id_unique" UNIQUE("reverses_transaction_id"),
	CONSTRAINT "transaction_amount_positive" CHECK ("financial_transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregator_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"column_mapping" jsonb,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_valid" integer DEFAULT 0 NOT NULL,
	"rows_invalid" integer DEFAULT 0 NOT NULL,
	"rows_duplicate" integer DEFAULT 0 NOT NULL,
	"rows_unknown_driver" integer DEFAULT 0 NOT NULL,
	"error_summary" jsonb,
	"uploaded_by" uuid NOT NULL,
	"committed_by" uuid,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_amount_positive" CHECK ("payment_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregator_id" uuid NOT NULL,
	"period_type" "period_type" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "settlement_status" DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_range" CHECK ("settlement_periods"."ends_on" >= "settlement_periods"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"aggregator_id" uuid NOT NULL,
	"status" "settlement_status" DEFAULT 'draft' NOT NULL,
	"money_flow_model" "money_flow_model" NOT NULL,
	"commission_policy_id" uuid,
	"commission_rate_percent" numeric(7, 4) NOT NULL,
	"commission_base_type" "commission_base_type" NOT NULL,
	"formula_snapshot" jsonb NOT NULL,
	"source_totals" jsonb NOT NULL,
	"commission_base" numeric(18, 2) NOT NULL,
	"commission_amount" numeric(18, 2) NOT NULL,
	"driver_payable_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"driver_receivable_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reverses_settlement_id" uuid,
	"prepared_by" uuid,
	"prepared_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_amounts_non_negative" CHECK ("settlements"."driver_payable_amount" >= 0 and "settlements"."driver_receivable_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"result" "audit_result" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"permission_code" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" text,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_driver_accounts" ADD CONSTRAINT "aggregator_driver_accounts_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_driver_accounts" ADD CONSTRAINT "aggregator_driver_accounts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_status_history" ADD CONSTRAINT "driver_status_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_status_history" ADD CONSTRAINT "driver_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_vehicle_assignments" ADD CONSTRAINT "driver_vehicle_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_statement_lines" ADD CONSTRAINT "aggregator_statement_lines_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_statement_lines" ADD CONSTRAINT "aggregator_statement_lines_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregator_statement_lines" ADD CONSTRAINT "aggregator_statement_lines_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_policies" ADD CONSTRAINT "commission_policies_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_policies" ADD CONSTRAINT "commission_policies_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_policies" ADD CONSTRAINT "commission_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_periods" ADD CONSTRAINT "settlement_periods_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_periods" ADD CONSTRAINT "settlement_periods_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_period_id_settlement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."settlement_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_aggregator_id_aggregators_id_fk" FOREIGN KEY ("aggregator_id") REFERENCES "public"."aggregators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_commission_policy_id_commission_policies_id_fk" FOREIGN KEY ("commission_policy_id") REFERENCES "public"."commission_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_lower_uq" ON "users" USING btree (lower("login"));--> statement-breakpoint
CREATE UNIQUE INDEX "ada_external_uq" ON "aggregator_driver_accounts" USING btree ("aggregator_id","external_driver_id");--> statement-breakpoint
CREATE INDEX "ada_driver_idx" ON "aggregator_driver_accounts" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "driver_status_history_driver_idx" ON "driver_status_history" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX "dva_driver_idx" ON "driver_vehicle_assignments" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "dva_vehicle_idx" ON "driver_vehicle_assignments" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_phone_active_uq" ON "drivers" USING btree ("phone") WHERE "drivers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "drivers_manager_idx" ON "drivers" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "drivers_status_idx" ON "drivers" USING btree ("crm_status");--> statement-breakpoint
CREATE INDEX "drivers_name_idx" ON "drivers" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_active_uq" ON "vehicles" USING btree ("plate_number") WHERE "vehicles"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "statement_lines_fingerprint_uq" ON "aggregator_statement_lines" USING btree ("aggregator_id","line_fingerprint") WHERE "aggregator_statement_lines"."status" in ('valid', 'unknown_driver');--> statement-breakpoint
CREATE INDEX "statement_lines_batch_idx" ON "aggregator_statement_lines" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "statement_lines_driver_idx" ON "aggregator_statement_lines" USING btree ("driver_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external_uq" ON "financial_transactions" USING btree ("aggregator_id","external_id") WHERE "financial_transactions"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_driver_idx" ON "financial_transactions" USING btree ("driver_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_type_idx" ON "financial_transactions" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_file_uq" ON "import_batches" USING btree ("aggregator_id","file_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_tx_settlement_uq" ON "payment_allocations" USING btree ("transaction_id","settlement_id");--> statement-breakpoint
CREATE INDEX "allocations_settlement_idx" ON "payment_allocations" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_periods_uq" ON "settlement_periods" USING btree ("aggregator_id","period_type","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_one_live_uq" ON "settlements" USING btree ("period_id","driver_id") WHERE "settlements"."status" <> 'reversed' and "settlements"."reverses_settlement_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_reversal_uq" ON "settlements" USING btree ("reverses_settlement_id");--> statement-breakpoint
CREATE INDEX "settlements_driver_idx" ON "settlements" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");