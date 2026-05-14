-- Add simulation_state column to persona_runs (stores in-session NPC simulation state as JSONB)
ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "simulation_state" jsonb;

-- Create simulation_events audit table for the NPC Simulation Engine
CREATE TABLE IF NOT EXISTS "simulation_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_run_id" varchar NOT NULL REFERENCES "persona_runs"("id") ON DELETE CASCADE,
  "scenario_run_id" varchar,
  "turn_index" integer NOT NULL DEFAULT 0,
  "turn_id" varchar,
  "event_type" varchar NOT NULL,
  "tool_name" varchar,
  "args" jsonb,
  "result" jsonb,
  "state_before" jsonb,
  "state_after" jsonb,
  "state_version_before" integer,
  "state_version_after" integer,
  "include_in_report" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_simulation_events_persona_run_id" ON "simulation_events" ("persona_run_id");
CREATE INDEX IF NOT EXISTS "idx_simulation_events_turn_index" ON "simulation_events" ("turn_index");
