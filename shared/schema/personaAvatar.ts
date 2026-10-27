import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Provider resources are tenant-scoped and deduplicated by actual source-image
 * bytes. This is separate from persona bindings so one authorized resource can
 * be referenced by multiple personas within the same tenant.
 */
export const personaAvatarAssets = pgTable("persona_avatar_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantScope: varchar("tenant_scope", { length: 150 }).notNull(),
  providerId: varchar("provider_id", { length: 100 }).notNull(),
  sourceImageHash: varchar("source_image_hash", { length: 64 }).notNull(),
  routerAssetId: varchar("router_asset_id", { length: 200 }),
  providerAvatarId: varchar("provider_avatar_id", { length: 200 }),
  status: varchar("status", { length: 20 }).notNull().default("not_created"),
  failureCode: varchar("failure_code", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("persona_avatar_asset_scope_provider_hash_unique")
    .on(table.tenantScope, table.providerId, table.sourceImageHash),
  check("persona_avatar_assets_source_hash_check", sql`${table.sourceImageHash} ~ '^[a-f0-9]{64}$'`),
  check("persona_avatar_assets_status_check", sql`${table.status} IN ('not_created', 'pending', 'ready', 'failed')`),
  check("persona_avatar_assets_failure_code_check", sql`${table.failureCode} IS NULL OR ${table.failureCode} ~ '^[a-z0-9_]+$'`),
]);

/**
 * Versioned links preserve old provider IDs when a persona's image changes.
 * Rights review is deliberately unverified by default; callers must not treat
 * an existing RoleplayX image as permission to transfer it to another service.
 */
export const personaAvatarBindings = pgTable("persona_avatar_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantScope: varchar("tenant_scope", { length: 150 }).notNull(),
  personaType: varchar("persona_type", { length: 20 }).notNull(),
  personaId: varchar("persona_id", { length: 150 }).notNull(),
  providerId: varchar("provider_id", { length: 100 }).notNull(),
  assetId: uuid("asset_id").notNull().references(() => personaAvatarAssets.id, { onDelete: "restrict" }),
  sourceImageHash: varchar("source_image_hash", { length: 64 }).notNull(),
  sourceImageVersion: integer("source_image_version").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("not_created"),
  rightsStatus: varchar("rights_status", { length: 20 }).notNull().default("unverified"),
  likeness: varchar("likeness", { length: 20 }),
  consentReference: varchar("consent_reference", { length: 200 }),
  reviewedBy: varchar("reviewed_by", { length: 150 }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("persona_avatar_binding_version_unique")
    .on(table.tenantScope, table.personaType, table.personaId, table.providerId, table.sourceImageVersion),
  index("persona_avatar_binding_persona_lookup")
    .on(table.tenantScope, table.personaType, table.personaId, table.providerId),
  check("persona_avatar_bindings_persona_type_check", sql`${table.personaType} IN ('mbti', 'user')`),
  check("persona_avatar_bindings_source_hash_check", sql`${table.sourceImageHash} ~ '^[a-f0-9]{64}$'`),
  check("persona_avatar_bindings_version_check", sql`${table.sourceImageVersion} > 0`),
  check("persona_avatar_bindings_status_check", sql`${table.status} IN ('not_created', 'pending', 'ready', 'failed', 'stale')`),
  check("persona_avatar_bindings_rights_status_check", sql`${table.rightsStatus} IN ('unverified', 'pending_review', 'approved', 'rejected')`),
  check("persona_avatar_bindings_likeness_check", sql`${table.likeness} IS NULL OR ${table.likeness} IN ('synthetic', 'real_person')`),
  check(
    "persona_avatar_bindings_approved_rights_check",
    sql`${table.rightsStatus} <> 'approved' OR (
      ${table.likeness} IS NOT NULL
      AND ${table.reviewedBy} IS NOT NULL
      AND ${table.reviewedAt} IS NOT NULL
      AND (${table.likeness} <> 'real_person' OR ${table.consentReference} IS NOT NULL)
    )`,
  ),
]);

export type PersonaAvatarAsset = typeof personaAvatarAssets.$inferSelect;
export type PersonaAvatarBinding = typeof personaAvatarBindings.$inferSelect;
