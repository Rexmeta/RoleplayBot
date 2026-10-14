ALTER TABLE "persona_runs" ADD COLUMN IF NOT EXISTS "transcript_protocol" varchar NOT NULL DEFAULT 'legacy';
ALTER TABLE "conversation_ledger_utterances" ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "conversation_ledger_utterances" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;
