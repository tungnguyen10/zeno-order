CREATE TYPE "public"."payment_attempt_status" AS ENUM('PENDING', 'PAID', 'EXPIRED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."sepay_environment" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."sepay_integration_status" AS ENUM('DRAFT', 'TESTING', 'ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"org_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_accounts_pk" PRIMARY KEY("integration_id","payment_account_id")
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"va_number" text,
	"account_holder" text NOT NULL,
	"payment_code" text NOT NULL,
	"transfer_content" text NOT NULL,
	"expected_amount_vnd" bigint NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_payment_code_uq" UNIQUE("payment_code"),
	CONSTRAINT "payment_attempts_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "payment_attempts_amount_positive" CHECK ("payment_attempts"."expected_amount_vnd" > 0)
);
--> statement-breakpoint
CREATE TABLE "sepay_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"environment" "sepay_environment" DEFAULT 'live' NOT NULL,
	"webhook_endpoint_key" text NOT NULL,
	"encrypted_hmac_secret" text,
	"encrypted_api_token" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" "sepay_integration_status" DEFAULT 'DRAFT' NOT NULL,
	"secret_updated_at" timestamp with time zone,
	"last_valid_webhook_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepay_integrations_endpoint_key_uq" UNIQUE("webhook_endpoint_key"),
	CONSTRAINT "sepay_integrations_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "sepay_integrations_secret_required" CHECK ("sepay_integrations"."status" in ('DRAFT', 'DISABLED') or "sepay_integrations"."encrypted_hmac_secret" is not null)
);
--> statement-breakpoint
CREATE TABLE "store_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"va_number" text,
	"account_holder" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"qr_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_payment_accounts_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "store_payment_accounts_org_id_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "store_payment_accounts_verified_requires_check" CHECK ("store_payment_accounts"."verified_at" is null or "store_payment_accounts"."qr_checked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_integration_fk" FOREIGN KEY ("org_id","integration_id") REFERENCES "public"."sepay_integrations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_account_fk" FOREIGN KEY ("org_id","payment_account_id") REFERENCES "public"."store_payment_accounts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "public"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_account_fk" FOREIGN KEY ("store_id","account_id") REFERENCES "public"."store_payment_accounts"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepay_integrations" ADD CONSTRAINT "sepay_integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_payment_accounts" ADD CONSTRAINT "store_payment_accounts_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_accounts_account_idx" ON "integration_accounts" USING btree ("payment_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_pending_uq" ON "payment_attempts" USING btree ("order_id") WHERE "payment_attempts"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "payment_attempts_order_idx" ON "payment_attempts" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_attempts_expiry_idx" ON "payment_attempts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sepay_integrations_org_env_open_uq" ON "sepay_integrations" USING btree ("org_id","environment") WHERE "sepay_integrations"."status" <> 'DISABLED';--> statement-breakpoint
CREATE UNIQUE INDEX "store_payment_accounts_one_active_uq" ON "store_payment_accounts" USING btree ("store_id") WHERE "store_payment_accounts"."is_active";