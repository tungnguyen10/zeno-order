CREATE TYPE "public"."entity_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('OWNER');--> statement-breakpoint
CREATE TYPE "public"."store_role" AS ENUM('OWNER', 'STAFF');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "org_role" NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_org_user_uq" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "store_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "store_role" DEFAULT 'STAFF' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "store_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "store_role" NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_members_store_user_uq" UNIQUE("store_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "entity_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_accepting_orders" boolean DEFAULT false NOT NULL,
	"dine_in_enabled" boolean DEFAULT true NOT NULL,
	"pickup_enabled" boolean DEFAULT true NOT NULL,
	"delivery_enabled" boolean DEFAULT false NOT NULL,
	"logo_key" text,
	"payment_ttl_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug"),
	CONSTRAINT "stores_org_id_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_accepted_by_user_profiles_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_created_by_user_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_invitations" ADD CONSTRAINT "store_invitations_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_user_id_user_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_fk" FOREIGN KEY ("org_id","store_id") REFERENCES "public"."stores"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "store_invitations_store_idx" ON "store_invitations" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_members_user_idx" ON "store_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stores_org_idx" ON "stores" USING btree ("org_id");