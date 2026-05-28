CREATE TABLE IF NOT EXISTS "hr_benchmark_targets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "dimension_key" varchar NOT NULL,
  "dimension_name" varchar NOT NULL DEFAULT '',
  "target_score" double precision NOT NULL DEFAULT 3.5,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_hr_benchmark_targets_org_id" ON "hr_benchmark_targets" ("org_id");
