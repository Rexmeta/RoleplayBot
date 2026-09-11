ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_queued_at" timestamp;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_completed_at" timestamp;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_error" text;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_expires_at" timestamp;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_job_token" varchar;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_worker_token" varchar;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_job_payload" jsonb;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_postprocess_status" varchar;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_postprocess_started_at" timestamp;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_postprocess_token" varchar;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_postprocess_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "feedback_postprocess_next_retry_at" timestamp;
UPDATE "persona_runs" SET "feedback_status" = 'expired',
  "feedback_error" = 'legacy_generating_job_missing_deadline'
WHERE "feedback_status" = 'generating' AND "feedback_expires_at" IS NULL;
DELETE FROM "feedbacks" a USING "feedbacks" b
WHERE a."persona_run_id" IS NOT NULL
  AND a."persona_run_id" = b."persona_run_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_feedbacks_persona_run_id_unique" ON "feedbacks" ("persona_run_id");
DO $$ BEGIN
  IF to_regclass('public.agent_webhook_deliveries') IS NOT NULL THEN
    DELETE FROM "agent_webhook_deliveries" a USING "agent_webhook_deliveries" b
    WHERE a."webhook_id" = b."webhook_id"
      AND a."delivery_id" = b."delivery_id"
      AND a."attempt" = b."attempt"
      AND (a."created_at", a."id") > (b."created_at", b."id");
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_webhook_deliveries_claim"
      ON "agent_webhook_deliveries" ("webhook_id", "delivery_id", "attempt");
  END IF;
END $$;