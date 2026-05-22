-- Add flowGraph and personaSwitchRules state machine fields to scenarios
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "flow_graph" jsonb;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "persona_switch_rules" jsonb;
