CREATE TABLE IF NOT EXISTS "conversation_ledger_runs" (
  "persona_run_id" varchar PRIMARY KEY REFERENCES "persona_runs"("id") ON DELETE CASCADE,
  "version" integer NOT NULL DEFAULT 1 CHECK (version = 1),
  "cursor" integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  "generation" integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  "status" text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  "recognition_required" boolean NOT NULL,
  "persona_id" text NOT NULL,
  "capture_generation" integer,
  "capture_sequence" integer,
  "capture_gaps" integer NOT NULL DEFAULT 0,
  "bound_context" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "conversation_ledger_utterances" (
  "persona_run_id" varchar NOT NULL REFERENCES "conversation_ledger_runs"("persona_run_id") ON DELETE CASCADE,
  "id" varchar NOT NULL,
  "sequence" integer NOT NULL,
  "updated_sequence" integer NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "generation" integer NOT NULL,
  "speaker" text NOT NULL CHECK (speaker IN ('user', 'ai')),
  "mode" text NOT NULL CHECK (mode IN ('text', 'voice')),
  "persona_id" text NOT NULL,
  "response_to" varchar,
  "provider" text NOT NULL,
  "provider_response_id" varchar,
  "provider_event_id" varchar,
  "capture_generation" integer,
  "capture_sequence" integer,
  "capture_state" text NOT NULL,
  "capture_reason" text,
  "provider_state" text NOT NULL,
  "recognition_state" text NOT NULL,
  "recognition_source" text,
  "playback_state" text NOT NULL,
  "provider_text" text NOT NULL DEFAULT '',
  "candidate_text" text,
  "canonical_text" text,
  "reason" text,
  PRIMARY KEY ("persona_run_id", "id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_utterance_sequence" ON "conversation_ledger_utterances"("persona_run_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_provider_event" ON "conversation_ledger_utterances"("persona_run_id", "provider", "provider_event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_provider_response" ON "conversation_ledger_utterances"("persona_run_id", "provider", "provider_response_id");
CREATE TABLE IF NOT EXISTS "conversation_ledger_events" (
  "persona_run_id" varchar NOT NULL REFERENCES "conversation_ledger_runs"("persona_run_id") ON DELETE CASCADE,
  "event_id" varchar NOT NULL,
  "sequence" integer NOT NULL,
  "payload_hash" varchar(64) NOT NULL,
  "command" jsonb NOT NULL,
  "ack" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("persona_run_id", "event_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_event_sequence" ON "conversation_ledger_events"("persona_run_id", "sequence");
CREATE TABLE IF NOT EXISTS "conversation_ledger_snapshots" (
  "id" varchar PRIMARY KEY,
  "persona_run_id" varchar NOT NULL REFERENCES "conversation_ledger_runs"("persona_run_id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "hash" varchar(64) NOT NULL,
  "content" jsonb NOT NULL,
  "blocked_reasons" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_snapshot_revision" ON "conversation_ledger_snapshots"("persona_run_id", "revision");
