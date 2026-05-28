import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, doublePrecision, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations } from "./users";

export const storePacks = pgTable("store_packs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description").notNull().default(""),
  coverImageKey: text("cover_image_key"),
  priceUsd: doublePrecision("price_usd").notNull().default(0),
  planTierMinimum: varchar("plan_tier_minimum", { length: 20 }),
  isActive: boolean("is_active").notNull().default(true),
  scenarioCount: integer("scenario_count").notNull().default(0),
  personaCount: integer("persona_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const storeEntitlements = pgTable("store_entitlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  packId: varchar("pack_id").notNull().references(() => storePacks.id, { onDelete: "cascade" }),
  unlockedAt: timestamp("unlocked_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  unlockedBy: varchar("unlocked_by"),
  stripeChargeId: text("stripe_charge_id"),
  stripeSessionId: text("stripe_session_id"),
}, (table) => [
  index("idx_store_entitlements_org_id").on(table.orgId),
  index("idx_store_entitlements_pack_id").on(table.packId),
  uniqueIndex("uniq_store_entitlements_org_pack").on(table.orgId, table.packId),
]);

export const storeEntitlementAuditLog = pgTable("store_entitlement_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entitlementId: varchar("entitlement_id").notNull(),
  orgId: varchar("org_id").notNull(),
  packId: varchar("pack_id").notNull(),
  packName: varchar("pack_name").notNull().default(""),
  action: varchar("action", { length: 50 }).notNull().default("revoke"),
  revokedBy: varchar("revoked_by"),
  stripeRefundId: text("stripe_refund_id"),
  reason: text("reason"),
  revokedAt: timestamp("revoked_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_entitlement_audit_org_id").on(table.orgId),
  index("idx_entitlement_audit_pack_id").on(table.packId),
  index("idx_entitlement_audit_revoked_at").on(table.revokedAt),
]);

export type StoreEntitlementAuditEntry = typeof storeEntitlementAuditLog.$inferSelect;

export const insertStorePackSchema = createInsertSchema(storePacks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStorePack = z.infer<typeof insertStorePackSchema>;
export type StorePack = typeof storePacks.$inferSelect;

export const insertStoreEntitlementSchema = createInsertSchema(storeEntitlements).omit({
  id: true,
  unlockedAt: true,
});
export type InsertStoreEntitlement = z.infer<typeof insertStoreEntitlementSchema>;
export type StoreEntitlement = typeof storeEntitlements.$inferSelect;
