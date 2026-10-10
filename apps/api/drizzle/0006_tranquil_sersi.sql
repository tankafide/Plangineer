CREATE TYPE "public"."attachment_media_type" AS ENUM('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown');--> statement-breakpoint
CREATE TYPE "public"."feature_state" AS ENUM('pre_planning', 'plan_ready', 'planning');--> statement-breakpoint
CREATE TYPE "public"."pre_planning_task_kind" AS ENUM('intake', 'exploration', 'research');--> statement-breakpoint
CREATE TYPE "public"."run_mode" AS ENUM('manual', 'manual_plan', 'auto_loop');--> statement-breakpoint
CREATE TABLE "context_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"ticked" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_files_task_id_key" UNIQUE("task_id"),
	CONSTRAINT "context_files_title_length_check" CHECK (char_length("context_files"."title") BETWEEN 1 AND 200),
	CONSTRAINT "context_files_content_length_check" CHECK (char_length("context_files"."content") BETWEEN 1 AND 65536)
);
--> statement-breakpoint
CREATE TABLE "feature_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"feature_id" uuid NOT NULL,
	"name" text NOT NULL,
	"media_type" "attachment_media_type" NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_attachments_name_length_check" CHECK (char_length("feature_attachments"."name") BETWEEN 1 AND 200),
	CONSTRAINT "feature_attachments_size_bytes_check" CHECK ("feature_attachments"."size_bytes" = octet_length("feature_attachments"."content") AND "feature_attachments"."size_bytes" BETWEEN 1 AND 10485760)
);
--> statement-breakpoint
CREATE TABLE "feature_repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"feature_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_repositories_feature_id_repository_id_key" UNIQUE("feature_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"ticket_url" text,
	"explore_codebase" boolean NOT NULL,
	"run_mode" "run_mode" NOT NULL,
	"state" "feature_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "features_title_length_check" CHECK (char_length("features"."title") BETWEEN 1 AND 81),
	CONSTRAINT "features_description_length_check" CHECK (char_length("features"."description") BETWEEN 1 AND 50000)
);
--> statement-breakpoint
CREATE TABLE "pre_planning_tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"feature_id" uuid NOT NULL,
	"kind" "pre_planning_task_kind" NOT NULL,
	"repository_id" uuid NOT NULL,
	"topic" text,
	"job" jsonb NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_planning_tasks_run_id_key" UNIQUE("run_id"),
	CONSTRAINT "pre_planning_tasks_topic_length_check" CHECK (char_length("pre_planning_tasks"."topic") BETWEEN 1 AND 190),
	CONSTRAINT "pre_planning_tasks_topic_check" CHECK (("pre_planning_tasks"."kind" = 'research') = ("pre_planning_tasks"."topic" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "default_run_mode" "run_mode" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "default_branch" text NOT NULL;--> statement-breakpoint
ALTER TABLE "context_files" ADD CONSTRAINT "context_files_task_id_pre_planning_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."pre_planning_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_attachments" ADD CONSTRAINT "feature_attachments_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_repositories" ADD CONSTRAINT "feature_repositories_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_repositories" ADD CONSTRAINT "feature_repositories_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_planning_tasks" ADD CONSTRAINT "pre_planning_tasks_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_planning_tasks" ADD CONSTRAINT "pre_planning_tasks_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_planning_tasks" ADD CONSTRAINT "pre_planning_tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_planning_tasks" ADD CONSTRAINT "pre_planning_tasks_feature_repository_fk" FOREIGN KEY ("feature_id","repository_id") REFERENCES "public"."feature_repositories"("feature_id","repository_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_attachments_feature_id_idx" ON "feature_attachments" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "feature_repositories_repository_id_idx" ON "feature_repositories" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "features_author_id_id_idx" ON "features" USING btree ("author_id","id");--> statement-breakpoint
CREATE INDEX "features_pre_planning_idx" ON "features" USING btree ("id") WHERE "features"."state" = 'pre_planning';--> statement-breakpoint
CREATE INDEX "pre_planning_tasks_feature_id_idx" ON "pre_planning_tasks" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "pre_planning_tasks_repository_id_idx" ON "pre_planning_tasks" USING btree ("repository_id");--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_default_branch_length_check" CHECK (char_length("repositories"."default_branch") BETWEEN 1 AND 255);