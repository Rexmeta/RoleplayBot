import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, categories } from "./users";
import { evaluationCriteriaSets, evaluationDimensions } from "./feedback";
import type { PersonaContextTranslation, ScoringRubric, TranslationStats } from "./types";

export const supportedLanguages = pgTable("supported_languages", {
  code: varchar("code", { length: 10 }).primaryKey(),
  name: varchar("name").notNull(),
  nativeName: varchar("native_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const scenarioTranslations = pgTable("scenario_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: text("scenario_id").notNull(),
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code),
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code),
  isOriginal: boolean("is_original").notNull().default(false),
  title: text("title").notNull(),
  description: text("description"),
  situation: text("situation"),
  timeline: text("timeline"),
  stakes: text("stakes"),
  playerRole: text("player_role"),
  objectives: text("objectives").array(),
  successCriteriaOptimal: text("success_criteria_optimal"),
  successCriteriaGood: text("success_criteria_good"),
  successCriteriaAcceptable: text("success_criteria_acceptable"),
  successCriteriaFailure: text("success_criteria_failure"),
  skills: text("skills").array(),
  personaContexts: jsonb("persona_contexts").$type<PersonaContextTranslation[]>(),
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_scenario_translations_scenario_id").on(table.scenarioId),
  index("idx_scenario_translations_locale").on(table.locale),
]);

export const personaTranslations = pgTable("persona_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personaId: text("persona_id").notNull(),
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code),
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code),
  name: varchar("name").notNull(),
  personalityTraits: text("personality_traits").array(),
  communicationStyle: text("communication_style"),
  motivation: text("motivation"),
  fears: text("fears").array(),
  personalityDescription: text("personality_description"),
  education: text("education"),
  previousExperience: text("previous_experience"),
  majorProjects: text("major_projects").array(),
  expertise: text("expertise").array(),
  background: text("background"),
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_persona_translations_persona_id").on(table.personaId),
  index("idx_persona_translations_locale").on(table.locale),
]);

export const categoryTranslations = pgTable("category_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").notNull().references(() => categories.id, { onDelete: 'cascade' }),
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code),
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code),
  name: varchar("name").notNull(),
  description: text("description"),
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_category_translations_category_id").on(table.categoryId),
  index("idx_category_translations_locale").on(table.locale),
]);

export const evaluationCriteriaSetTranslations = pgTable("evaluation_criteria_set_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  criteriaSetId: varchar("criteria_set_id").notNull().references(() => evaluationCriteriaSets.id, { onDelete: 'cascade' }),
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code),
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code),
  isOriginal: boolean("is_original").notNull().default(false),
  name: varchar("name").notNull(),
  description: text("description"),
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_criteria_set_translations_set_id").on(table.criteriaSetId),
  index("idx_criteria_set_translations_locale").on(table.locale),
]);

export const evaluationDimensionTranslations = pgTable("evaluation_dimension_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dimensionId: varchar("dimension_id").notNull().references(() => evaluationDimensions.id, { onDelete: 'cascade' }),
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code),
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code),
  isOriginal: boolean("is_original").notNull().default(false),
  name: varchar("name").notNull(),
  description: text("description"),
  scoringRubric: jsonb("scoring_rubric").$type<ScoringRubric[]>(),
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_dimension_translations_dimension_id").on(table.dimensionId),
  index("idx_dimension_translations_locale").on(table.locale),
]);

export const insertSupportedLanguageSchema = createInsertSchema(supportedLanguages);
export type InsertSupportedLanguage = z.infer<typeof insertSupportedLanguageSchema>;
export type SupportedLanguage = typeof supportedLanguages.$inferSelect;

export const insertScenarioTranslationSchema = createInsertSchema(scenarioTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScenarioTranslation = z.infer<typeof insertScenarioTranslationSchema>;
export type ScenarioTranslation = typeof scenarioTranslations.$inferSelect;

export const insertPersonaTranslationSchema = createInsertSchema(personaTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPersonaTranslation = z.infer<typeof insertPersonaTranslationSchema>;
export type PersonaTranslation = typeof personaTranslations.$inferSelect;

export const insertCategoryTranslationSchema = createInsertSchema(categoryTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCategoryTranslation = z.infer<typeof insertCategoryTranslationSchema>;
export type CategoryTranslation = typeof categoryTranslations.$inferSelect;

export const insertEvaluationCriteriaSetTranslationSchema = createInsertSchema(evaluationCriteriaSetTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEvaluationCriteriaSetTranslation = z.infer<typeof insertEvaluationCriteriaSetTranslationSchema>;
export type EvaluationCriteriaSetTranslation = typeof evaluationCriteriaSetTranslations.$inferSelect;

export const insertEvaluationDimensionTranslationSchema = createInsertSchema(evaluationDimensionTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEvaluationDimensionTranslation = z.infer<typeof insertEvaluationDimensionTranslationSchema>;
export type EvaluationDimensionTranslation = typeof evaluationDimensionTranslations.$inferSelect;

export type { PersonaContextTranslation, TranslationStats } from "./types";
