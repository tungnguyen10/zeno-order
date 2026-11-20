ALTER TABLE "stores" ADD COLUMN "opening_hours" jsonb;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "paused_until" timestamp with time zone;