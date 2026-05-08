ALTER TABLE "feedbacks" ADD COLUMN IF NOT EXISTS "score_adjustments" jsonb;
ALTER TABLE "evaluation_criteria_sets" ADD COLUMN IF NOT EXISTS "owner_operator_id" varchar;
