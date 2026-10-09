CREATE TABLE "github_apps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"app_id" bigint NOT NULL,
	"slug" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"private_key_encrypted" text NOT NULL,
	"owner_login" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_apps_singleton_key" UNIQUE("singleton"),
	CONSTRAINT "github_apps_singleton_check" CHECK ("github_apps"."singleton")
);
