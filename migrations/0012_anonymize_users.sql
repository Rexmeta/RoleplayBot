ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_anonymized" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "anonymized_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "anonymized_by" varchar;
