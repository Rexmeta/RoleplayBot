-- Nullable for historical runs: their original language cannot be reconstructed.
-- The first access pins the ledger language, or the owner's current preference.
ALTER TABLE persona_runs ADD COLUMN IF NOT EXISTS language varchar;
