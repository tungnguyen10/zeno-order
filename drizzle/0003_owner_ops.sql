CREATE TYPE "public"."order_payment_method" AS ENUM('CASH', 'SEPAY', 'BANK_MANUAL');--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"bank_transaction_id" uuid,
	"method" "order_payment_method" NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"note" text,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_payments_order_uq" UNIQUE("order_id"),
	CONSTRAINT "order_payments_amount_nonneg" CHECK ("order_payments"."amount_vnd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_recorded_by_user_profiles_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "public"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_payments_store_recorded_idx" ON "order_payments" USING btree ("store_id","recorded_at");--> statement-breakpoint
CREATE INDEX "orders_board_idx" ON "orders" USING btree ("store_id","status","created_at" DESC NULLS LAST);