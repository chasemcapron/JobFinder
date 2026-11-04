CREATE TABLE "dismissed_roles" (
	"user_id" text NOT NULL,
	"role_key" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dismissed_roles_user_id_role_key_pk" PRIMARY KEY("user_id","role_key")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "hidden_companies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dismissed_roles" ADD CONSTRAINT "dismissed_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;