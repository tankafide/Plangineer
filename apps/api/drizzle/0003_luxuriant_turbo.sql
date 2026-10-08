CREATE TYPE "public"."runner_login_status" AS ENUM('pending', 'approved', 'denied', 'completed');--> statement-breakpoint
CREATE TABLE "runner_logins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_secret_hash" text NOT NULL,
	"user_code_hash" text NOT NULL,
	"name" text NOT NULL,
	"platform" "runner_platform" NOT NULL,
	"status" "runner_login_status" DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"runner_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_logins_device_secret_hash_key" UNIQUE("device_secret_hash"),
	CONSTRAINT "runner_logins_user_code_hash_key" UNIQUE("user_code_hash"),
	CONSTRAINT "runner_logins_runner_id_key" UNIQUE("runner_id"),
	CONSTRAINT "runner_logins_name_length_check" CHECK (char_length("runner_logins"."name") BETWEEN 1 AND 100),
	CONSTRAINT "runner_logins_user_id_check" CHECK (("runner_logins"."user_id" IS NOT NULL) = ("runner_logins"."status" IN ('approved', 'completed'))),
	CONSTRAINT "runner_logins_runner_id_check" CHECK (("runner_logins"."runner_id" IS NOT NULL) = ("runner_logins"."status" = 'completed'))
);
--> statement-breakpoint
DROP TABLE "runner_pairing_codes" CASCADE;--> statement-breakpoint
ALTER TABLE "runner_logins" ADD CONSTRAINT "runner_logins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_logins" ADD CONSTRAINT "runner_logins_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runner_logins_user_id_idx" ON "runner_logins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runner_logins_expires_at_idx" ON "runner_logins" USING btree ("expires_at");