CREATE TYPE "public"."run_event_type" AS ENUM('run.queued', 'run.leased', 'run.started', 'agent.session', 'agent.message', 'agent.tool_use', 'agent.tool_result', 'agent.rate_limit', 'agent.other', 'run.cancel_requested', 'run.lease_lost', 'run.succeeded', 'run.failed', 'run.cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."runner_platform" AS ENUM('win32', 'darwin', 'linux');--> statement-breakpoint
CREATE TYPE "public"."runner_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"attempt" integer NOT NULL,
	"runner_seq" integer,
	"type" "run_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_event_id_key" UNIQUE("run_id","event_id"),
	CONSTRAINT "run_events_run_id_attempt_runner_seq_key" UNIQUE("run_id","attempt","runner_seq"),
	CONSTRAINT "run_events_runner_seq_check" CHECK ("run_events"."runner_seq" IS NULL OR "run_events"."type" NOT IN ('run.queued', 'run.leased', 'run.cancel_requested', 'run.lease_lost'))
);
--> statement-breakpoint
CREATE TABLE "runner_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_pairing_codes_code_hash_key" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" "runner_platform" NOT NULL,
	"token_hash" text NOT NULL,
	"status" "runner_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"concurrency_limit" integer,
	"runner_version" text,
	"clis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan_limit_resets_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "runners_name_length_check" CHECK (char_length("runners"."name") BETWEEN 1 AND 100),
	CONSTRAINT "runners_revoked_at_check" CHECK (("runners"."revoked_at" IS NOT NULL) = ("runners"."status" = 'revoked')),
	CONSTRAINT "runners_concurrency_limit_check" CHECK ("runners"."concurrency_limit" IS NULL OR "runners"."concurrency_limit" BETWEEN 1 AND 16)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"runner_id" uuid NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"ref" text NOT NULL,
	"prompt" text NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"last_event_id" integer DEFAULT 0 NOT NULL,
	"commit" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_prompt_length_check" CHECK (char_length("runs"."prompt") BETWEEN 1 AND 20000),
	CONSTRAINT "runs_attempt_check" CHECK ("runs"."attempt" >= 0),
	CONSTRAINT "runs_lease_check" CHECK (("runs"."lease_expires_at" IS NOT NULL) = ("runs"."status" IN ('leased', 'running'))),
	CONSTRAINT "runs_started_at_check" CHECK ("runs"."status" IN ('failed', 'cancelled') OR ("runs"."started_at" IS NOT NULL) = ("runs"."status" IN ('running', 'succeeded'))),
	CONSTRAINT "runs_ended_at_check" CHECK (("runs"."ended_at" IS NOT NULL) = ("runs"."status" IN ('succeeded', 'failed', 'cancelled')))
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_pairing_codes" ADD CONSTRAINT "runner_pairing_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runner_pairing_codes_user_id_created_at_idx" ON "runner_pairing_codes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "runners_user_id_id_idx" ON "runners" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "runs_user_id_id_idx" ON "runs" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "runs_runner_id_idx" ON "runs" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "runs_runner_id_active_idx" ON "runs" USING btree ("runner_id") WHERE "runs"."status" IN ('leased', 'running');--> statement-breakpoint
CREATE INDEX "runs_claimable_idx" ON "runs" USING btree ("runner_id","id") WHERE "runs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "runs_lease_expires_at_idx" ON "runs" USING btree ("lease_expires_at") WHERE "runs"."status" IN ('leased', 'running');