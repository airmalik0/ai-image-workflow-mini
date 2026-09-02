CREATE TYPE "public"."file_source" AS ENUM('seed', 'upload', 'generated');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('idle', 'queued', 'running', 'success', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source" "file_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"status" "job_status" DEFAULT 'idle' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"output" jsonb,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"main_prompt" text NOT NULL,
	"negative_prompt" text,
	"reference_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defaults" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" serial NOT NULL,
	"workflow_id" text,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"graph" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"graph" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_run_node_uq" ON "jobs" USING btree ("run_id","node_id");--> statement-breakpoint
CREATE INDEX "jobs_run_seq_idx" ON "jobs" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "runs_seq_idx" ON "runs" USING btree ("seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workflows_updated_at_idx" ON "workflows" USING btree ("updated_at" DESC NULLS LAST);