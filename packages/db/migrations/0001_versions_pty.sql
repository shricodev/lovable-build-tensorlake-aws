CREATE TABLE "pty_sessions" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"session_id" text NOT NULL,
	"token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"commit_sha" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" uuid,
	"restored_from" integer,
	"screenshot_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "git_repo" text;--> statement-breakpoint
ALTER TABLE "pty_sessions" ADD CONSTRAINT "pty_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "versions_project_number_idx" ON "versions" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_run_idx" ON "versions" USING btree ("run_id");