-- Additive only: no backfill of existing image/video personas.
ALTER TABLE mbti_personas
  ADD COLUMN IF NOT EXISTS avatar_mode varchar,
  ADD COLUMN IF NOT EXISTS live_avatar jsonb;
