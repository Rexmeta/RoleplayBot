import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, boolean, timestamp, jsonb, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

export const plans = pgTable("plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  tokenQuotaMonthly: integer("token_quota_monthly").notNull(),
  priceUsdMonthly: doublePrecision("price_usd_monthly").notNull().default(0),
  features: jsonb("features").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id"),
  planId: varchar("plan_id").notNull().references(() => plans.id),
  cycleStart: timestamp("cycle_start").notNull().default(sql`CURRENT_TIMESTAMP`),
  tokensUsedThisCycle: integer("tokens_used_this_cycle").notNull().default(0),
  status: varchar("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_subscriptions_user_id").on(table.userId),
  index("idx_subscriptions_plan_id").on(table.planId),
  index("idx_subscriptions_org_id").on(table.orgId),
]);

export const insertPlanSchema = createInsertSchema(plans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plans.$inferSelect;

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

export const UNLIMITED_QUOTA = -1;

export const DEFAULT_PLANS = [
  {
    name: "Starter",
    tokenQuotaMonthly: 1_000_000,
    priceUsdMonthly: 0,
    features: { maxScenarios: 10, voiceEnabled: false, analyticsEnabled: false },
  },
  {
    name: "Pro",
    tokenQuotaMonthly: 5_000_000,
    priceUsdMonthly: 49,
    features: { maxScenarios: 100, voiceEnabled: true, analyticsEnabled: true },
  },
  {
    name: "Enterprise",
    tokenQuotaMonthly: UNLIMITED_QUOTA,
    priceUsdMonthly: 299,
    features: { maxScenarios: -1, voiceEnabled: true, analyticsEnabled: true, customIntegrations: true },
  },
] as const;
