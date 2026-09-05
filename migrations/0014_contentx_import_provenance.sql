ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "organization_id" varchar;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "contentx_package_id" varchar;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "contentx_version" varchar;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "contentx_scenario_key" varchar;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "contentx_published_at" timestamp;
ALTER TABLE "scenarios" ADD COLUMN IF NOT EXISTS "contentx_content_hash" varchar(128);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "scenarios"
    ADD CONSTRAINT "scenarios_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scenarios_contentx_lookup"
  ON "scenarios" ("organization_id", "contentx_package_id", "contentx_version");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_scenarios_contentx_identity"
  ON "scenarios" ("organization_id", "contentx_package_id", "contentx_version", "contentx_scenario_key");