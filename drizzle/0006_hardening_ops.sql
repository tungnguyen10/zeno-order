CREATE TABLE "payment_job_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"last_started_at" timestamp with time zone NOT NULL,
	"last_succeeded_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "payment_job_runs_job_check" CHECK ("payment_job_runs"."job" in ('expire', 'reconcile'))
);
