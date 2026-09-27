CREATE TABLE "published_sites" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"version_id" uuid,
	"s3_prefix" text NOT NULL,
	"file_count" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "remixed_from" uuid;--> statement-breakpoint
ALTER TABLE "published_sites" ADD CONSTRAINT "published_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_sites" ADD CONSTRAINT "published_sites_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;