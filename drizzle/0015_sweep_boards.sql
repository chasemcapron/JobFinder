CREATE TABLE "sweep_boards" (
	"ats" text NOT NULL,
	"slug" text NOT NULL,
	"listed_at" timestamp DEFAULT now() NOT NULL,
	"last_swept_at" timestamp,
	"last_jobs" integer DEFAULT 0 NOT NULL,
	"misses" integer DEFAULT 0 NOT NULL,
	"has_stored" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sweep_boards_ats_slug_pk" PRIMARY KEY("ats","slug")
);
--> statement-breakpoint
CREATE INDEX "sweep_boards_swept_idx" ON "sweep_boards" USING btree ("ats","last_swept_at");