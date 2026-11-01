CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_store_id_id_uq" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fee_vnd" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "delivery_zones_fee_nonneg" CHECK ("delivery_zones"."fee_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_groups_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "option_groups_min_max_valid" CHECK ("product_option_groups"."min_select" >= 0 and "product_option_groups"."max_select" >= "product_option_groups"."min_select")
);
--> statement-breakpoint
CREATE TABLE "product_option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta_vnd" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_values_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "option_values_price_delta_nonneg" CHECK ("product_option_values"."price_delta_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"base_price_vnd" bigint NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"image_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "products_base_price_nonneg" CHECK ("products"."base_price_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_tables_store_id_id_uq" UNIQUE("store_id","id"),
	CONSTRAINT "store_tables_store_code_uq" UNIQUE("store_id","code"),
	CONSTRAINT "store_tables_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "option_groups_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "option_groups_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "option_values_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "option_values_group_fk" FOREIGN KEY ("store_id","group_id") REFERENCES "public"."product_option_groups"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("store_id","category_id") REFERENCES "public"."categories"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_tables" ADD CONSTRAINT "store_tables_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_store_position_idx" ON "categories" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "delivery_zones_store_idx" ON "delivery_zones" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "option_groups_product_idx" ON "product_option_groups" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "option_values_group_idx" ON "product_option_values" USING btree ("store_id","group_id");--> statement-breakpoint
CREATE INDEX "products_store_position_idx" ON "products" USING btree ("store_id","position");