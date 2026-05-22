-- Add evaluationHarness and terminationRules fields to scenarios
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "evaluation_harness" jsonb;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "termination_rules" jsonb;
