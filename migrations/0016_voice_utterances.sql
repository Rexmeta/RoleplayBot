ALTER TABLE persona_runs ADD COLUMN IF NOT EXISTS voice_recognition_required boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS voice_utterances (
  id varchar PRIMARY KEY,
  persona_run_id varchar NOT NULL REFERENCES persona_runs(id) ON DELETE CASCADE,
  language varchar NOT NULL,
  provider varchar NOT NULL,
  provider_text text,
  provider_final boolean NOT NULL DEFAULT false,
  candidate_text text,
  canonical_text text,
  source varchar,
  status varchar NOT NULL DEFAULT 'processing',
  reason varchar,
  revision integer NOT NULL DEFAULT 0,
  capture_generation integer NOT NULL,
  speech_seq integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_voice_utterances_run ON voice_utterances(persona_run_id);