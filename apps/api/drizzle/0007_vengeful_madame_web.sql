CREATE TYPE "public"."plan_revision_source" AS ENUM('agent', 'engineer');--> statement-breakpoint
CREATE TYPE "public"."plan_section" AS ENUM('goal', 'prerequisites', 'steps', 'decisions', 'constraints', 'test_plan', 'verification');--> statement-breakpoint
CREATE TYPE "public"."planning_turn_kind" AS ENUM('guided', 'section_action', 'revise_step');--> statement-breakpoint
CREATE TYPE "public"."section_action" AS ENUM('expand', 'simplify', 'regenerate');--> statement-breakpoint
ALTER TYPE "public"."feature_state" ADD VALUE 'ready_for_review';--> statement-breakpoint
ALTER TYPE "public"."run_event_type" ADD VALUE 'planning.output' BEFORE 'run.succeeded';--> statement-breakpoint
ALTER TYPE "public"."run_kind" ADD VALUE 'planning';--> statement-breakpoint
CREATE TABLE "plan_questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"turn_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"section" "plan_section" NOT NULL,
	"prompt" text NOT NULL,
	"choices" jsonb NOT NULL,
	"recommended" integer NOT NULL,
	"answer_choice" integer,
	"answer_text" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_questions_turn_id_position_key" UNIQUE("turn_id","position"),
	CONSTRAINT "plan_questions_position_check" CHECK ("plan_questions"."position" BETWEEN 0 AND 4),
	CONSTRAINT "plan_questions_prompt_length_check" CHECK (char_length("plan_questions"."prompt") BETWEEN 1 AND 2000),
	CONSTRAINT "plan_questions_recommended_check" CHECK ("plan_questions"."recommended" BETWEEN 0 AND 3),
	CONSTRAINT "plan_questions_answer_choice_check" CHECK ("plan_questions"."answer_choice" BETWEEN 0 AND 3),
	CONSTRAINT "plan_questions_answer_text_length_check" CHECK (char_length("plan_questions"."answer_text") BETWEEN 1 AND 4000),
	CONSTRAINT "plan_questions_answer_check" CHECK (num_nonnulls("plan_questions"."answer_choice", "plan_questions"."answer_text") <= 1),
	CONSTRAINT "plan_questions_answered_at_check" CHECK (("plan_questions"."answered_at" IS NULL) = ("plan_questions"."answer_choice" IS NULL AND "plan_questions"."answer_text" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "plan_revision_context_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"context_file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_revision_context_files_revision_id_context_file_id_key" UNIQUE("revision_id","context_file_id"),
	CONSTRAINT "plan_revision_context_files_title_length_check" CHECK (char_length("plan_revision_context_files"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "plan_revision_repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"base_commit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_revision_repositories_revision_id_repository_id_key" UNIQUE("revision_id","repository_id"),
	CONSTRAINT "plan_revision_repositories_base_commit_check" CHECK ("plan_revision_repositories"."base_commit" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"feature_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"body" jsonb NOT NULL,
	"source" "plan_revision_source" NOT NULL,
	"turn_id" uuid,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_revisions_feature_id_number_key" UNIQUE("feature_id","number"),
	CONSTRAINT "plan_revisions_number_check" CHECK ("plan_revisions"."number" >= 1),
	CONSTRAINT "plan_revisions_turn_id_check" CHECK (("plan_revisions"."source" = 'agent') = ("plan_revisions"."turn_id" IS NOT NULL)),
	CONSTRAINT "plan_revisions_author_id_check" CHECK (("plan_revisions"."source" = 'engineer') = ("plan_revisions"."author_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "planning_turn_context_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"turn_id" uuid NOT NULL,
	"context_file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_turn_context_files_turn_id_context_file_id_key" UNIQUE("turn_id","context_file_id"),
	CONSTRAINT "planning_turn_context_files_title_length_check" CHECK (char_length("planning_turn_context_files"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "planning_turns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"feature_id" uuid NOT NULL,
	"kind" "planning_turn_kind" NOT NULL,
	"section" "plan_section",
	"action" "section_action",
	"step_id" uuid,
	"instruction" text,
	"job" jsonb NOT NULL,
	"inputs" text NOT NULL,
	"decisions" jsonb,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_turns_run_id_key" UNIQUE("run_id"),
	CONSTRAINT "planning_turns_section_check" CHECK (("planning_turns"."kind" = 'section_action') = ("planning_turns"."section" IS NOT NULL)),
	CONSTRAINT "planning_turns_action_check" CHECK (("planning_turns"."section" IS NULL) = ("planning_turns"."action" IS NULL)),
	CONSTRAINT "planning_turns_step_id_check" CHECK (("planning_turns"."kind" = 'revise_step') = ("planning_turns"."step_id" IS NOT NULL)),
	CONSTRAINT "planning_turns_instruction_check" CHECK (("planning_turns"."kind" = 'revise_step') = ("planning_turns"."instruction" IS NOT NULL)),
	CONSTRAINT "planning_turns_instruction_length_check" CHECK (char_length("planning_turns"."instruction") BETWEEN 1 AND 2000),
	CONSTRAINT "planning_turns_inputs_length_check" CHECK (char_length("planning_turns"."inputs") BETWEEN 1 AND 2000000),
	CONSTRAINT "planning_turns_decisions_check" CHECK ("planning_turns"."kind" = 'guided' OR "planning_turns"."decisions" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "plan_questions" ADD CONSTRAINT "plan_questions_turn_id_planning_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."planning_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revision_context_files" ADD CONSTRAINT "plan_revision_context_files_revision_id_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revision_context_files" ADD CONSTRAINT "plan_revision_context_files_context_file_id_context_files_id_fk" FOREIGN KEY ("context_file_id") REFERENCES "public"."context_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revision_repositories" ADD CONSTRAINT "plan_revision_repositories_revision_id_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revision_repositories" ADD CONSTRAINT "plan_revision_repositories_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_turn_id_planning_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."planning_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_turn_context_files" ADD CONSTRAINT "planning_turn_context_files_turn_id_planning_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."planning_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_turn_context_files" ADD CONSTRAINT "planning_turn_context_files_context_file_id_context_files_id_fk" FOREIGN KEY ("context_file_id") REFERENCES "public"."context_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_turns" ADD CONSTRAINT "planning_turns_feature_id_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planning_turns" ADD CONSTRAINT "planning_turns_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_revision_context_files_context_file_id_idx" ON "plan_revision_context_files" USING btree ("context_file_id");--> statement-breakpoint
CREATE INDEX "plan_revision_repositories_repository_id_idx" ON "plan_revision_repositories" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "plan_revisions_feature_id_id_idx" ON "plan_revisions" USING btree ("feature_id","id");--> statement-breakpoint
CREATE INDEX "plan_revisions_turn_id_idx" ON "plan_revisions" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "plan_revisions_author_id_idx" ON "plan_revisions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "planning_turn_context_files_context_file_id_idx" ON "planning_turn_context_files" USING btree ("context_file_id");--> statement-breakpoint
CREATE INDEX "planning_turns_feature_id_id_idx" ON "planning_turns" USING btree ("feature_id","id");--> statement-breakpoint
CREATE INDEX "features_auto_plan_ready_idx" ON "features" USING btree ("id") WHERE "features"."state" = 'plan_ready' AND "features"."run_mode" = 'auto_loop';