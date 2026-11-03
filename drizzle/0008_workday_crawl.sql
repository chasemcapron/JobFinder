CREATE TABLE "workday_crawl_state" (
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"last_crawled_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"listings_seen" integer DEFAULT 0 NOT NULL,
	"details_fetched" integer DEFAULT 0 NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "workday_crawl_state_user_id_slug_pk" PRIMARY KEY("user_id","slug")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "listing_key" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "workday_crawl_state" ADD CONSTRAINT "workday_crawl_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_listing_key_idx" ON "jobs" USING btree ("listing_key");