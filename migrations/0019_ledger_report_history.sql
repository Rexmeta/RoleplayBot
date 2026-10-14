CREATE TABLE IF NOT EXISTS "conversation_ledger_reports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "persona_run_id" varchar NOT NULL REFERENCES "persona_runs"("id") ON DELETE CASCADE,
  "snapshot_id" varchar NOT NULL REFERENCES "conversation_ledger_snapshots"("id") ON DELETE CASCADE,
  "payload" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_report_snapshot"
  ON "conversation_ledger_reports"("persona_run_id", "snapshot_id");
