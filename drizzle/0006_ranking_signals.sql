ALTER TABLE "jobs" ADD COLUMN "min_years" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "clearance" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "has_clearance" boolean DEFAULT false NOT NULL;