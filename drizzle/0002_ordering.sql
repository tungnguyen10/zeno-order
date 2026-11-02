CREATE TYPE "public"."fulfillment_type" AS ENUM('DINE_IN', 'PICKUP', 'DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('AWAITING_PAYMENT', 'NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('BANK_QR', 'PAY_ON_RECEIPT');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('UNPAID', 'PENDING', 'PAID', 'REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_store_id_id_uq" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"position" integer NOT NULL,
	"name_snapshot" text NOT NULL,
	"options_snapshot_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"line_total_vnd" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "order_items_qty_check" CHECK ("order_items"."qty" between 1 and 50),
	CONSTRAINT "order_items_money_check" CHECK ("order_items"."unit_price_vnd" >= 0 and "order_items"."line_total_vnd" = "order_items"."unit_price_vnd" * "order_items"."qty")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"public_code" text NOT NULL,
	"guest_token_hash" text NOT NULL,
	"guest_token_encrypted" text NOT NULL,
	"fulfillment_type" "fulfillment_type" NOT NULL,
	"table_id" uuid,
	"table_label" text,
	"customer_name" text,
	"customer_phone" text,
	"delivery_zone_id" uuid,
	"delivery_zone_name" text,
	"address_snapshot" text,
	"notes" text,
	"subtotal_vnd" bigint NOT NULL,
	"delivery_fee_vnd" bigint NOT NULL,
	"total_vnd" bigint NOT NULL,
	"status" "order_status" NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"late_payment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_guest_token_hash_uq" UNIQUE("guest_token_hash"),
	CONSTRAINT "orders_store_idem_uq" UNIQUE("store_id","idempotency_key"),
	CONSTRAINT "orders_store_public_code_uq" UNIQUE("store_id","public_code"),
	CONSTRAINT "orders_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "orders_money_check" CHECK ("orders"."subtotal_vnd" >= 0 and "orders"."delivery_fee_vnd" >= 0 and "orders"."total_vnd" = "orders"."subtotal_vnd" + "orders"."delivery_fee_vnd")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_user_profiles_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "public"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "public"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_fk" FOREIGN KEY ("store_id","table_id") REFERENCES "public"."store_tables"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_zone_fk" FOREIGN KEY ("store_id","delivery_zone_id") REFERENCES "public"."delivery_zones"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("store_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("store_id","order_id","position");