-- Add multi-persona tracking columns to persona_runs
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "active_persona_index" integer NOT NULL DEFAULT 0;
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "persona_switch_log" jsonb;
