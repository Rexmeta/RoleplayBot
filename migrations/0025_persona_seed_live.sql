-- Nullable draft metadata only. No data backfill, provider calls or activation.
ALTER TABLE mbti_personas ADD COLUMN IF NOT EXISTS live_avatar_seed jsonb;
