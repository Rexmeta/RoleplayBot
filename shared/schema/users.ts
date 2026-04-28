import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  code: varchar("code", { length: 50 }).unique(),
  description: text("description"),
  logo: text("logo"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar("name").notNull(),
  code: varchar("code", { length: 50 }),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_organizations_company_id").on(table.companyId),
]);

export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar("name").notNull(),
  description: text("description"),
  order: integer("order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_categories_organization_id").on(table.organizationId),
]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  password: varchar("password").notNull(),
  name: varchar("name").notNull(),
  role: varchar("role").notNull().default("user"),
  profileImage: varchar("profile_image"),
  tier: varchar("tier").notNull().default("bronze"),
  preferredLanguage: varchar("preferred_language").notNull().default("ko"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at"),
  companyId: varchar("company_id").references(() => companies.id),
  organizationId: varchar("organization_id").references(() => organizations.id),
  assignedCompanyId: varchar("assigned_company_id").references(() => companies.id),
  assignedOrganizationId: varchar("assigned_organization_id").references(() => organizations.id),
  assignedCategoryId: varchar("assigned_category_id").references(() => categories.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_users_company_id").on(table.companyId),
  index("idx_users_organization_id").on(table.organizationId),
]);

export const operatorAssignments = pgTable("operator_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: 'cascade' }),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_operator_assignments_user_id").on(table.userId),
  index("idx_operator_assignments_company_id").on(table.companyId),
  index("idx_operator_assignments_organization_id").on(table.organizationId),
]);

export const userBookmarks = pgTable("user_bookmarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  scenarioId: text("scenario_id").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_user_bookmarks_user_id").on(table.userId),
  index("idx_user_bookmarks_scenario_id").on(table.scenarioId),
]);

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

export const insertOperatorAssignmentSchema = createInsertSchema(operatorAssignments).omit({
  id: true,
  createdAt: true,
});
export type InsertOperatorAssignment = z.infer<typeof insertOperatorAssignmentSchema>;
export type OperatorAssignment = typeof operatorAssignments.$inferSelect;

export const insertUserBookmarkSchema = createInsertSchema(userBookmarks).omit({
  id: true,
  createdAt: true,
});
export type InsertUserBookmark = z.infer<typeof insertUserBookmarkSchema>;
export type UserBookmark = typeof userBookmarks.$inferSelect;

export type CreateUser = {
  email: string;
  password: string;
  name: string;
  assignedCategoryId?: string;
};
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
