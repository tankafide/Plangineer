CREATE TYPE "public"."run_kind" AS ENUM('test', 'setup');--> statement-breakpoint
CREATE TYPE "public"."setup_status" AS ENUM('scanned', 'generating', 'pr_open', 'complete', 'failed');--> statement-breakpoint
ALTER TYPE "public"."run_event_type" ADD VALUE 'setup.pushed' BEFORE 'run.succeeded';--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"github_repository_id" bigint NOT NULL,
	"github_installation_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"role_settings" jsonb NOT NULL,
	"workflow_settings" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_github_repository_id_key" UNIQUE("github_repository_id"),
	CONSTRAINT "repositories_description_length_check" CHECK (char_length("repositories"."description") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "repository_setups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"repository_id" uuid NOT NULL,
	"status" "setup_status" NOT NULL,
	"scan" jsonb NOT NULL,
	"selection" jsonb,
	"job" jsonb,
	"run_id" uuid,
	"pull_request_number" integer,
	"pull_request_url" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_setups_repository_id_key" UNIQUE("repository_id"),
	CONSTRAINT "repository_setups_run_id_key" UNIQUE("run_id"),
	CONSTRAINT "repository_setups_started_check" CHECK ("repository_setups"."status" = 'scanned' OR ("repository_setups"."selection" IS NOT NULL AND "repository_setups"."job" IS NOT NULL)),
	CONSTRAINT "repository_setups_pull_request_pair_check" CHECK (("repository_setups"."pull_request_number" IS NULL) = ("repository_setups"."pull_request_url" IS NULL)),
	CONSTRAINT "repository_setups_pull_request_check" CHECK ("repository_setups"."status" NOT IN ('pr_open', 'complete') OR "repository_setups"."pull_request_number" IS NOT NULL),
	CONSTRAINT "repository_setups_failure_message_check" CHECK (("repository_setups"."failure_message" IS NOT NULL) = ("repository_setups"."status" = 'failed')),
	CONSTRAINT "repository_setups_failure_message_length_check" CHECK (char_length("repository_setups"."failure_message") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "kind" "run_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_setups" ADD CONSTRAINT "repository_setups_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_setups" ADD CONSTRAINT "repository_setups_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repositories_created_by_idx" ON "repositories" USING btree ("created_by");