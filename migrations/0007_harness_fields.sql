-- Add playerConstraints and difficultyProfile to scenarios
-- npcBehaviorHarness is stored inside the existing personas JSONB array (no column needed)
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "player_constraints" jsonb;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "difficulty_profile" jsonb;
