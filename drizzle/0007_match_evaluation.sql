ALTER TABLE "job_matches" ADD COLUMN "verdict" text;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "evaluation" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avoid_military" boolean DEFAULT false NOT NULL;