import { type SupportedLanguage, type InsertSupportedLanguage, type ScenarioTranslation, type InsertScenarioTranslation, type PersonaTranslation, type InsertPersonaTranslation, type CategoryTranslation, type InsertCategoryTranslation, type EvaluationCriteriaSetTranslation, type InsertEvaluationCriteriaSetTranslation, type EvaluationDimensionTranslation, type InsertEvaluationDimensionTranslation, supportedLanguages, scenarioTranslations, personaTranslations, categoryTranslations, evaluationCriteriaSetTranslations, evaluationDimensionTranslations } from "@shared/schema";
import { db } from "./db";
import { eq, asc, and } from "drizzle-orm";

export interface ITranslationsStorage {
  getSupportedLanguages(): Promise<SupportedLanguage[]>;
  getActiveSupportedLanguages(): Promise<SupportedLanguage[]>;
  getSupportedLanguage(code: string): Promise<SupportedLanguage | undefined>;
  createSupportedLanguage(language: InsertSupportedLanguage): Promise<SupportedLanguage>;
  updateSupportedLanguage(code: string, updates: Partial<InsertSupportedLanguage>): Promise<SupportedLanguage>;
  deleteSupportedLanguage(code: string): Promise<void>;

  getScenarioTranslation(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined>;
  getScenarioTranslations(scenarioId: string): Promise<ScenarioTranslation[]>;
  getAllScenarioTranslations(locale: string): Promise<ScenarioTranslation[]>;
  getAllScenarioTranslationLocales(): Promise<Array<{ scenarioId: string; locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }>>;
  getOriginalScenarioTranslation(scenarioId: string): Promise<ScenarioTranslation | undefined>;
  getScenarioTranslationWithFallback(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined>;
  upsertScenarioTranslation(translation: InsertScenarioTranslation): Promise<ScenarioTranslation>;
  deleteScenarioTranslation(scenarioId: string, locale: string): Promise<void>;
  markScenarioTranslationReviewed(scenarioId: string, locale: string, reviewerId: string): Promise<ScenarioTranslation>;

  getPersonaTranslation(personaId: string, locale: string): Promise<PersonaTranslation | undefined>;
  getPersonaTranslations(personaId: string): Promise<PersonaTranslation[]>;
  getAllPersonaTranslations(locale: string): Promise<PersonaTranslation[]>;
  getAllPersonaTranslationLocales(): Promise<Array<{ personaId: string; locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }>>;
  upsertPersonaTranslation(translation: InsertPersonaTranslation): Promise<PersonaTranslation>;
  deletePersonaTranslation(personaId: string, locale: string): Promise<void>;
  markPersonaTranslationReviewed(personaId: string, locale: string, reviewerId: string): Promise<PersonaTranslation>;

  getCategoryTranslation(categoryId: string, locale: string): Promise<CategoryTranslation | undefined>;
  getCategoryTranslations(categoryId: string): Promise<CategoryTranslation[]>;
  upsertCategoryTranslation(translation: InsertCategoryTranslation): Promise<CategoryTranslation>;
  deleteCategoryTranslation(categoryId: string, locale: string): Promise<void>;

  getEvaluationCriteriaSetTranslation(criteriaSetId: string, locale: string): Promise<EvaluationCriteriaSetTranslation | undefined>;
  getEvaluationCriteriaSetTranslations(criteriaSetId: string): Promise<EvaluationCriteriaSetTranslation[]>;
  upsertEvaluationCriteriaSetTranslation(translation: InsertEvaluationCriteriaSetTranslation): Promise<EvaluationCriteriaSetTranslation>;
  deleteEvaluationCriteriaSetTranslation(criteriaSetId: string, locale: string): Promise<void>;

  getEvaluationDimensionTranslation(dimensionId: string, locale: string): Promise<EvaluationDimensionTranslation | undefined>;
  getEvaluationDimensionTranslations(dimensionId: string): Promise<EvaluationDimensionTranslation[]>;
  upsertEvaluationDimensionTranslation(translation: InsertEvaluationDimensionTranslation): Promise<EvaluationDimensionTranslation>;
  deleteEvaluationDimensionTranslation(dimensionId: string, locale: string): Promise<void>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function TranslationsMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements ITranslationsStorage {
    async getSupportedLanguages(): Promise<SupportedLanguage[]> {
      return await db.select().from(supportedLanguages).orderBy(asc(supportedLanguages.displayOrder));
    }

    async getActiveSupportedLanguages(): Promise<SupportedLanguage[]> {
      return await db.select().from(supportedLanguages).where(eq(supportedLanguages.isActive, true)).orderBy(asc(supportedLanguages.displayOrder));
    }

    async getSupportedLanguage(code: string): Promise<SupportedLanguage | undefined> {
      const results = await db.select().from(supportedLanguages).where(eq(supportedLanguages.code, code));
      return results[0];
    }

    async createSupportedLanguage(language: InsertSupportedLanguage): Promise<SupportedLanguage> {
      const [created] = await db.insert(supportedLanguages).values(language).returning();
      return created;
    }

    async updateSupportedLanguage(code: string, updates: Partial<InsertSupportedLanguage>): Promise<SupportedLanguage> {
      const [updated] = await db.update(supportedLanguages).set(updates).where(eq(supportedLanguages.code, code)).returning();
      return updated;
    }

    async deleteSupportedLanguage(code: string): Promise<void> {
      await db.delete(supportedLanguages).where(eq(supportedLanguages.code, code));
    }

    async getScenarioTranslation(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined> {
      const results = await db.select().from(scenarioTranslations).where(and(eq(scenarioTranslations.scenarioId, scenarioId), eq(scenarioTranslations.locale, locale)));
      return results[0];
    }

    async getScenarioTranslations(scenarioId: string): Promise<ScenarioTranslation[]> {
      return await db.select().from(scenarioTranslations).where(eq(scenarioTranslations.scenarioId, scenarioId));
    }

    async getAllScenarioTranslations(locale: string): Promise<ScenarioTranslation[]> {
      return await db.select().from(scenarioTranslations).where(eq(scenarioTranslations.locale, locale));
    }

    async getAllScenarioTranslationLocales(): Promise<Array<{ scenarioId: string; locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }>> {
      return await db
        .select({
          scenarioId: scenarioTranslations.scenarioId,
          locale: scenarioTranslations.locale,
          isMachineTranslated: scenarioTranslations.isMachineTranslated,
          isReviewed: scenarioTranslations.isReviewed,
          isOriginal: scenarioTranslations.isOriginal,
        })
        .from(scenarioTranslations);
    }

    async getOriginalScenarioTranslation(scenarioId: string): Promise<ScenarioTranslation | undefined> {
      const results = await db.select().from(scenarioTranslations).where(and(eq(scenarioTranslations.scenarioId, scenarioId), eq(scenarioTranslations.isOriginal, true)));
      return results[0];
    }

    async getScenarioTranslationWithFallback(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined> {
      const translation = await this.getScenarioTranslation(scenarioId, locale);
      if (translation) return translation;
      return await this.getOriginalScenarioTranslation(scenarioId);
    }

    async upsertScenarioTranslation(translation: InsertScenarioTranslation): Promise<ScenarioTranslation> {
      const existing = await this.getScenarioTranslation(translation.scenarioId, translation.locale);
      if (existing) {
        const [updated] = await db.update(scenarioTranslations).set({ ...translation as any, updatedAt: new Date() }).where(eq(scenarioTranslations.id, existing.id)).returning();
        return updated;
      }
      const [created] = await db.insert(scenarioTranslations).values(translation as any).returning();
      return created;
    }

    async deleteScenarioTranslation(scenarioId: string, locale: string): Promise<void> {
      await db.delete(scenarioTranslations).where(and(eq(scenarioTranslations.scenarioId, scenarioId), eq(scenarioTranslations.locale, locale)));
    }

    async markScenarioTranslationReviewed(scenarioId: string, locale: string, reviewerId: string): Promise<ScenarioTranslation> {
      const [updated] = await db.update(scenarioTranslations)
        .set({ isReviewed: true, reviewedBy: reviewerId, updatedAt: new Date() })
        .where(and(eq(scenarioTranslations.scenarioId, scenarioId), eq(scenarioTranslations.locale, locale)))
        .returning();
      return updated;
    }

    async getPersonaTranslation(personaId: string, locale: string): Promise<PersonaTranslation | undefined> {
      const results = await db.select().from(personaTranslations).where(and(eq(personaTranslations.personaId, personaId), eq(personaTranslations.locale, locale)));
      return results[0];
    }

    async getPersonaTranslations(personaId: string): Promise<PersonaTranslation[]> {
      return await db.select().from(personaTranslations).where(eq(personaTranslations.personaId, personaId));
    }

    async getAllPersonaTranslations(locale: string): Promise<PersonaTranslation[]> {
      return await db.select().from(personaTranslations).where(eq(personaTranslations.locale, locale));
    }

    async getAllPersonaTranslationLocales(): Promise<Array<{ personaId: string; locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }>> {
      return await db
        .select({
          personaId: personaTranslations.personaId,
          locale: personaTranslations.locale,
          isMachineTranslated: personaTranslations.isMachineTranslated,
          isReviewed: personaTranslations.isReviewed,
          isOriginal: personaTranslations.isOriginal,
        })
        .from(personaTranslations);
    }

    async upsertPersonaTranslation(translation: InsertPersonaTranslation): Promise<PersonaTranslation> {
      const existing = await this.getPersonaTranslation(translation.personaId, translation.locale);
      if (existing) {
        const [updated] = await db.update(personaTranslations).set({ ...translation, updatedAt: new Date() }).where(eq(personaTranslations.id, existing.id)).returning();
        return updated;
      }
      const [created] = await db.insert(personaTranslations).values(translation).returning();
      return created;
    }

    async deletePersonaTranslation(personaId: string, locale: string): Promise<void> {
      await db.delete(personaTranslations).where(and(eq(personaTranslations.personaId, personaId), eq(personaTranslations.locale, locale)));
    }

    async markPersonaTranslationReviewed(personaId: string, locale: string, reviewerId: string): Promise<PersonaTranslation> {
      const [updated] = await db.update(personaTranslations)
        .set({ isReviewed: true, reviewedBy: reviewerId, updatedAt: new Date() })
        .where(and(eq(personaTranslations.personaId, personaId), eq(personaTranslations.locale, locale)))
        .returning();
      return updated;
    }

    async getCategoryTranslation(categoryId: string, locale: string): Promise<CategoryTranslation | undefined> {
      const results = await db.select().from(categoryTranslations).where(and(eq(categoryTranslations.categoryId, categoryId), eq(categoryTranslations.locale, locale)));
      return results[0];
    }

    async getCategoryTranslations(categoryId: string): Promise<CategoryTranslation[]> {
      return await db.select().from(categoryTranslations).where(eq(categoryTranslations.categoryId, categoryId));
    }

    async upsertCategoryTranslation(translation: InsertCategoryTranslation): Promise<CategoryTranslation> {
      const existing = await this.getCategoryTranslation(translation.categoryId, translation.locale);
      if (existing) {
        const [updated] = await db.update(categoryTranslations).set({ ...translation, updatedAt: new Date() }).where(eq(categoryTranslations.id, existing.id)).returning();
        return updated;
      }
      const [created] = await db.insert(categoryTranslations).values(translation).returning();
      return created;
    }

    async deleteCategoryTranslation(categoryId: string, locale: string): Promise<void> {
      await db.delete(categoryTranslations).where(and(eq(categoryTranslations.categoryId, categoryId), eq(categoryTranslations.locale, locale)));
    }

    async getEvaluationCriteriaSetTranslation(criteriaSetId: string, locale: string): Promise<EvaluationCriteriaSetTranslation | undefined> {
      const results = await db.select().from(evaluationCriteriaSetTranslations).where(and(eq(evaluationCriteriaSetTranslations.criteriaSetId, criteriaSetId), eq(evaluationCriteriaSetTranslations.locale, locale)));
      return results[0];
    }

    async getEvaluationCriteriaSetTranslations(criteriaSetId: string): Promise<EvaluationCriteriaSetTranslation[]> {
      return await db.select().from(evaluationCriteriaSetTranslations).where(eq(evaluationCriteriaSetTranslations.criteriaSetId, criteriaSetId));
    }

    async upsertEvaluationCriteriaSetTranslation(translation: InsertEvaluationCriteriaSetTranslation): Promise<EvaluationCriteriaSetTranslation> {
      const existing = await this.getEvaluationCriteriaSetTranslation(translation.criteriaSetId, translation.locale);
      if (existing) {
        const [updated] = await db.update(evaluationCriteriaSetTranslations).set({ ...translation, updatedAt: new Date() }).where(eq(evaluationCriteriaSetTranslations.id, existing.id)).returning();
        return updated;
      }
      const [created] = await db.insert(evaluationCriteriaSetTranslations).values(translation).returning();
      return created;
    }

    async deleteEvaluationCriteriaSetTranslation(criteriaSetId: string, locale: string): Promise<void> {
      await db.delete(evaluationCriteriaSetTranslations).where(and(eq(evaluationCriteriaSetTranslations.criteriaSetId, criteriaSetId), eq(evaluationCriteriaSetTranslations.locale, locale)));
    }

    async getEvaluationDimensionTranslation(dimensionId: string, locale: string): Promise<EvaluationDimensionTranslation | undefined> {
      const results = await db.select().from(evaluationDimensionTranslations).where(and(eq(evaluationDimensionTranslations.dimensionId, dimensionId), eq(evaluationDimensionTranslations.locale, locale)));
      return results[0];
    }

    async getEvaluationDimensionTranslations(dimensionId: string): Promise<EvaluationDimensionTranslation[]> {
      return await db.select().from(evaluationDimensionTranslations).where(eq(evaluationDimensionTranslations.dimensionId, dimensionId));
    }

    async upsertEvaluationDimensionTranslation(translation: InsertEvaluationDimensionTranslation): Promise<EvaluationDimensionTranslation> {
      const existing = await this.getEvaluationDimensionTranslation(translation.dimensionId, translation.locale);
      if (existing) {
        const [updated] = await db.update(evaluationDimensionTranslations).set({ ...translation as any, updatedAt: new Date() }).where(eq(evaluationDimensionTranslations.id, existing.id)).returning();
        return updated;
      }
      const [created] = await db.insert(evaluationDimensionTranslations).values(translation as any).returning();
      return created;
    }

    async deleteEvaluationDimensionTranslation(dimensionId: string, locale: string): Promise<void> {
      await db.delete(evaluationDimensionTranslations).where(and(eq(evaluationDimensionTranslations.dimensionId, dimensionId), eq(evaluationDimensionTranslations.locale, locale)));
    }
  };
}

export class MemTranslationsStorage implements ITranslationsStorage {
  async getSupportedLanguages(): Promise<SupportedLanguage[]> { return []; }
  async getActiveSupportedLanguages(): Promise<SupportedLanguage[]> { return []; }
  async getSupportedLanguage(_: string): Promise<SupportedLanguage | undefined> { return undefined; }
  async createSupportedLanguage(_: InsertSupportedLanguage): Promise<SupportedLanguage> { throw new Error("Not implemented"); }
  async updateSupportedLanguage(_: string, __: Partial<InsertSupportedLanguage>): Promise<SupportedLanguage> { throw new Error("Not implemented"); }
  async deleteSupportedLanguage(_: string): Promise<void> {}
  async getScenarioTranslation(_: string, __: string): Promise<ScenarioTranslation | undefined> { return undefined; }
  async getScenarioTranslations(_: string): Promise<ScenarioTranslation[]> { return []; }
  async getAllScenarioTranslations(_: string): Promise<ScenarioTranslation[]> { return []; }
  async getAllScenarioTranslationLocales(): Promise<Array<{ scenarioId: string; locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }>> { return []; }
  async getOriginalScenarioTranslation(_: string): Promise<ScenarioTranslation | undefined> { return undefined; }
  async getScenarioTranslationWithFallback(_: string, __: string): Promise<ScenarioTranslation | undefined> { return undefined; }
  async upsertScenarioTranslation(_: InsertScenarioTranslation): Promise<ScenarioTranslation> { throw new Error("Not implemented"); }
  async deleteScenarioTranslation(_: string, __: string): Promise<void> {}
  async markScenarioTranslationReviewed(_: string, __: string, ___: string): Promise<ScenarioTranslation> { throw new Error("Not implemented"); }
  async getPersonaTranslation(_: string, __: string): Promise<PersonaTranslation | undefined> { return undefined; }
  async getPersonaTranslations(_: string): Promise<PersonaTranslation[]> { return []; }
  async getAllPersonaTranslations(_: string): Promise<PersonaTranslation[]> { return []; }
  async getAllPersonaTranslationLocales(): Promise<Array<{ personaId: string; locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }>> { return []; }
  async upsertPersonaTranslation(_: InsertPersonaTranslation): Promise<PersonaTranslation> { throw new Error("Not implemented"); }
  async deletePersonaTranslation(_: string, __: string): Promise<void> {}
  async markPersonaTranslationReviewed(_: string, __: string, ___: string): Promise<PersonaTranslation> { throw new Error("Not implemented"); }
  async getCategoryTranslation(_: string, __: string): Promise<CategoryTranslation | undefined> { return undefined; }
  async getCategoryTranslations(_: string): Promise<CategoryTranslation[]> { return []; }
  async upsertCategoryTranslation(_: InsertCategoryTranslation): Promise<CategoryTranslation> { throw new Error("Not implemented"); }
  async deleteCategoryTranslation(_: string, __: string): Promise<void> {}
  async getEvaluationCriteriaSetTranslation(_: string, __: string): Promise<EvaluationCriteriaSetTranslation | undefined> { return undefined; }
  async getEvaluationCriteriaSetTranslations(_: string): Promise<EvaluationCriteriaSetTranslation[]> { return []; }
  async upsertEvaluationCriteriaSetTranslation(_: InsertEvaluationCriteriaSetTranslation): Promise<EvaluationCriteriaSetTranslation> { throw new Error("Not implemented"); }
  async deleteEvaluationCriteriaSetTranslation(_: string, __: string): Promise<void> {}
  async getEvaluationDimensionTranslation(_: string, __: string): Promise<EvaluationDimensionTranslation | undefined> { return undefined; }
  async getEvaluationDimensionTranslations(_: string): Promise<EvaluationDimensionTranslation[]> { return []; }
  async upsertEvaluationDimensionTranslation(_: InsertEvaluationDimensionTranslation): Promise<EvaluationDimensionTranslation> { throw new Error("Not implemented"); }
  async deleteEvaluationDimensionTranslation(_: string, __: string): Promise<void> {}
}
