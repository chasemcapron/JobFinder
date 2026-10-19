CREATE TABLE "resume_files" (
	"user_id" text NOT NULL,
	"slot" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resume_files_user_id_slot_pk" PRIMARY KEY("user_id","slot")
);
--> statement-breakpoint
ALTER TABLE "resume_files" ADD CONSTRAINT "resume_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;