ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_status" varchar;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_job_started_at" timestamp;
