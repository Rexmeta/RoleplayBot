CREATE TABLE IF NOT EXISTS "store_entitlement_audit_log" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entitlement_id" varchar NOT NULL,
  "org_id" varchar NOT NULL,
  "pack_id" varchar NOT NULL,
  "pack_name" varchar NOT NULL DEFAULT '',
  "action" varchar(50) NOT NULL DEFAULT 'revoke',
  "revoked_by" varchar,
  "stripe_refund_id" text,
  "reason" text,
  "revoked_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_entitlement_audit_org_id" ON "store_entitlement_audit_log" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_entitlement_audit_pack_id" ON "store_entitlement_audit_log" ("pack_id");
CREATE INDEX IF NOT EXISTS "idx_entitlement_audit_revoked_at" ON "store_entitlement_audit_log" ("revoked_at");
