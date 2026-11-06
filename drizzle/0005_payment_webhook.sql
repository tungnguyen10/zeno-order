CREATE TYPE "public"."bank_tx_action" AS ENUM('RECEIVED', 'ALIAS_ADDED', 'MATCHED', 'REVIEW_REQUIRED', 'ASSIGNED', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."bank_tx_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."bank_tx_resolution" AS ENUM('REFUNDED_OUTSIDE', 'NOT_ORDER', 'DUPLICATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."bank_tx_review_reason" AS ENUM('NO_CODE', 'UNKNOWN_CODE', 'ACCOUNT_MISMATCH', 'AMOUNT_UNDER', 'AMOUNT_OVER', 'ORDER_CANCELLED', 'ORDER_ALREADY_PAID', 'ORDER_NOT_PAYABLE');--> statement-breakpoint
CREATE TYPE "public"."bank_tx_source" AS ENUM('WEBHOOK', 'RECONCILE');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('RECEIVED', 'MATCHED', 'REVIEW_REQUIRED', 'IGNORED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."webhook_auth_mode" AS ENUM('HMAC', 'APIKEY');--> statement-breakpoint
CREATE TABLE "bank_transaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"action" "bank_tx_action" NOT NULL,
	"from_status" "reconciliation_status",
	"to_status" "reconciliation_status",
	"order_id" uuid,
	"actor_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transaction_identities" (
	"integration_id" uuid NOT NULL,
	"source" "bank_tx_source" NOT NULL,
	"provider_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	CONSTRAINT "bank_transaction_identity_uq" UNIQUE("integration_id","source","provider_id")
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"bank_code" text,
	"provider_transaction_id" text NOT NULL,
	"provider_alt_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "bank_tx_source" NOT NULL,
	"direction" "bank_tx_direction" NOT NULL,
	"bank_account_number" text NOT NULL,
	"sub_account" text,
	"amount_vnd" bigint NOT NULL,
	"payment_code" text,
	"content" text,
	"reference_code" text,
	"transaction_date" timestamp with time zone NOT NULL,
	"raw_payload_json" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciliation_status" "reconciliation_status" DEFAULT 'RECEIVED' NOT NULL,
	"review_reason" "bank_tx_review_reason",
	"matched_store_id" uuid,
	"matched_order_id" uuid,
	"resolution" "bank_tx_resolution",
	"resolution_note" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "bank_transactions_integration_provider_uq" UNIQUE("integration_id","provider_transaction_id"),
	CONSTRAINT "bank_transactions_amount_positive" CHECK ("bank_transactions"."amount_vnd" > 0 and "bank_transactions"."amount_vnd" <= 9007199254740991),
	CONSTRAINT "bank_transactions_match_pair" CHECK (("bank_transactions"."matched_store_id" is null) = ("bank_transactions"."matched_order_id" is null))
);
--> statement-breakpoint
CREATE TABLE "payment_job_leases" (
	"key" text PRIMARY KEY NOT NULL,
	"owner" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconcile_checkpoints" (
	"integration_id" uuid PRIMARY KEY NOT NULL,
	"covered_from" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "sepay_webhook_auth" (
	"integration_id" uuid PRIMARY KEY NOT NULL,
	"mode" "webhook_auth_mode" DEFAULT 'HMAC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_payments" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_transaction_events" ADD CONSTRAINT "bank_transaction_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_events" ADD CONSTRAINT "bank_transaction_events_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_events" ADD CONSTRAINT "bank_transaction_events_tx_org_fk" FOREIGN KEY ("org_id","bank_transaction_id") REFERENCES "public"."bank_transactions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_identities" ADD CONSTRAINT "bank_transaction_identities_org_id_integration_id_sepay_integrations_org_id_id_fk" FOREIGN KEY ("org_id","integration_id") REFERENCES "public"."sepay_integrations"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction_identities" ADD CONSTRAINT "bank_transaction_identities_org_id_transaction_id_bank_transactions_org_id_id_fk" FOREIGN KEY ("org_id","transaction_id") REFERENCES "public"."bank_transactions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_integration_id_sepay_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."sepay_integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_integration_org_fk" FOREIGN KEY ("org_id","integration_id") REFERENCES "public"."sepay_integrations"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_order_fk" FOREIGN KEY ("matched_store_id","matched_order_id") REFERENCES "public"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_store_fk" FOREIGN KEY ("org_id","matched_store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_checkpoints" ADD CONSTRAINT "reconcile_checkpoints_integration_id_sepay_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."sepay_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepay_webhook_auth" ADD CONSTRAINT "sepay_webhook_auth_integration_id_sepay_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."sepay_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_transaction_events_tx_idx" ON "bank_transaction_events" USING btree ("bank_transaction_id","created_at");--> statement-breakpoint
CREATE INDEX "bank_transactions_queue_idx" ON "bank_transactions" USING btree ("org_id","reconciliation_status","received_at");--> statement-breakpoint
CREATE INDEX "bank_transactions_payment_code_idx" ON "bank_transactions" USING btree ("payment_code");--> statement-breakpoint
CREATE INDEX "bank_transactions_twin_idx" ON "bank_transactions" USING btree ("integration_id","reference_code","amount_vnd");--> statement-breakpoint
CREATE INDEX "bank_transactions_alt_ids_idx" ON "bank_transactions" USING gin ("provider_alt_ids");--> statement-breakpoint
CREATE INDEX "bank_transactions_matched_order_idx" ON "bank_transactions" USING btree ("matched_order_id");--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_bank_tx_org_fk" FOREIGN KEY ("org_id","bank_transaction_id") REFERENCES "public"."bank_transactions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_payments_bank_tx_uq" ON "order_payments" USING btree ("bank_transaction_id") WHERE "order_payments"."bank_transaction_id" is not null;