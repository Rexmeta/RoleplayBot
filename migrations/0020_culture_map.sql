CREATE TABLE IF NOT EXISTS "culture_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" varchar NOT NULL,
  "version" integer DEFAULT 1 NOT NULL CHECK ("version" > 0),
  "content" jsonb NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "culture_profile_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "profile_id" uuid NOT NULL REFERENCES "culture_profiles"("id"),
  "version" integer NOT NULL CHECK ("version" > 0),
  "content" jsonb NOT NULL,
  "created_by" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "culture_profile_version_unique" ON "culture_profile_versions" ("profile_id", "version");
