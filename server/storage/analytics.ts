import { type AiUsageLog, type InsertAiUsageLog, type AiUsageSummary, type AiUsageByFeature, type AiUsageByModel, type AiUsageDaily, type EvaluationCriteriaSet, type InsertEvaluationCriteriaSet, type EvaluationDimension, type InsertEvaluationDimension, type EvaluationCriteriaSetWithDimensions, aiUsageLogs, evaluationCriteriaSets, evaluationDimensions } from "@shared/schema";
import { db } from "./db";
import { eq, asc, desc, and, gte, lte, or, isNull, sql } from "drizzle-orm";

export interface IAnalyticsStorage {
  createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog>;
  getAiUsageSummary(startDate: Date, endDate: Date): Promise<AiUsageSummary>;
  getAiUsageByFeature(startDate: Date, endDate: Date): Promise<AiUsageByFeature[]>;
  getAiUsageByModel(startDate: Date, endDate: Date): Promise<AiUsageByModel[]>;
  getAiUsageDaily(startDate: Date, endDate: Date): Promise<AiUsageDaily[]>;
  getAiUsageLogs(startDate: Date, endDate: Date, limit?: number): Promise<AiUsageLog[]>;

  createEvaluationCriteriaSet(criteriaSet: InsertEvaluationCriteriaSet): Promise<EvaluationCriteriaSet>;
  getEvaluationCriteriaSet(id: string): Promise<EvaluationCriteriaSet | undefined>;
  getAllEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]>;
  getActiveEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]>;
  getDefaultEvaluationCriteriaSet(): Promise<EvaluationCriteriaSet | undefined>;
  getEvaluationCriteriaSetByCategory(categoryId: string): Promise<EvaluationCriteriaSet | undefined>;
  updateEvaluationCriteriaSet(id: string, updates: Partial<InsertEvaluationCriteriaSet>): Promise<EvaluationCriteriaSet>;
  deleteEvaluationCriteriaSet(id: string): Promise<void>;
  setDefaultEvaluationCriteriaSet(id: string): Promise<void>;
  updateEvaluationCriteriaSetStatus(id: string, status: string, approvedBy?: string): Promise<EvaluationCriteriaSet>;
  getEvaluationCriteriaSetVersionHistory(parentSetId: string): Promise<EvaluationCriteriaSet[]>;

  createEvaluationDimension(dimension: InsertEvaluationDimension): Promise<EvaluationDimension>;
  getEvaluationDimension(id: string): Promise<EvaluationDimension | undefined>;
  getEvaluationDimensionsByCriteriaSet(criteriaSetId: string): Promise<EvaluationDimension[]>;
  updateEvaluationDimension(id: string, updates: Partial<InsertEvaluationDimension>): Promise<EvaluationDimension>;
  deleteEvaluationDimension(id: string): Promise<void>;

  getEvaluationCriteriaSetWithDimensions(id: string): Promise<EvaluationCriteriaSetWithDimensions | undefined>;
  getActiveEvaluationCriteriaSetWithDimensions(categoryId?: string): Promise<EvaluationCriteriaSetWithDimensions | undefined>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function AnalyticsMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IAnalyticsStorage {
    async createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog> {
      const [inserted] = await db.insert(aiUsageLogs).values(log as any).returning();
      return inserted;
    }

    async getAiUsageSummary(startDate: Date, endDate: Date): Promise<AiUsageSummary> {
      const result = await db.select({
        totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
        promptTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.promptTokens}), 0)::integer`,
        completionTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.completionTokens}), 0)::integer`,
        totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
        requestCount: sql<number>`COUNT(*)::integer`,
      })
        .from(aiUsageLogs)
        .where(and(gte(aiUsageLogs.occurredAt, startDate), lte(aiUsageLogs.occurredAt, endDate)));
      return result[0] || { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalCostUsd: 0, requestCount: 0 };
    }

    async getAiUsageByFeature(startDate: Date, endDate: Date): Promise<AiUsageByFeature[]> {
      return await db.select({
        feature: aiUsageLogs.feature,
        totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
        totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
        requestCount: sql<number>`COUNT(*)::integer`,
      })
        .from(aiUsageLogs)
        .where(and(gte(aiUsageLogs.occurredAt, startDate), lte(aiUsageLogs.occurredAt, endDate)))
        .groupBy(aiUsageLogs.feature)
        .orderBy(desc(sql`SUM(${aiUsageLogs.totalTokens})`));
    }

    async getAiUsageByModel(startDate: Date, endDate: Date): Promise<AiUsageByModel[]> {
      return await db.select({
        model: aiUsageLogs.model,
        provider: aiUsageLogs.provider,
        totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
        totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
        requestCount: sql<number>`COUNT(*)::integer`,
      })
        .from(aiUsageLogs)
        .where(and(gte(aiUsageLogs.occurredAt, startDate), lte(aiUsageLogs.occurredAt, endDate)))
        .groupBy(aiUsageLogs.model, aiUsageLogs.provider)
        .orderBy(desc(sql`SUM(${aiUsageLogs.totalTokens})`));
    }

    async getAiUsageDaily(startDate: Date, endDate: Date): Promise<AiUsageDaily[]> {
      return await db.select({
        date: sql<string>`TO_CHAR(${aiUsageLogs.occurredAt}, 'YYYY-MM-DD')`,
        totalTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
        totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
        requestCount: sql<number>`COUNT(*)::integer`,
      })
        .from(aiUsageLogs)
        .where(and(gte(aiUsageLogs.occurredAt, startDate), lte(aiUsageLogs.occurredAt, endDate)))
        .groupBy(sql`TO_CHAR(${aiUsageLogs.occurredAt}, 'YYYY-MM-DD')`)
        .orderBy(asc(sql`TO_CHAR(${aiUsageLogs.occurredAt}, 'YYYY-MM-DD')`));
    }

    async getAiUsageLogs(startDate: Date, endDate: Date, limit: number = 100): Promise<AiUsageLog[]> {
      return await db.select().from(aiUsageLogs)
        .where(and(gte(aiUsageLogs.occurredAt, startDate), lte(aiUsageLogs.occurredAt, endDate)))
        .orderBy(desc(aiUsageLogs.occurredAt))
        .limit(limit);
    }

    async createEvaluationCriteriaSet(criteriaSet: InsertEvaluationCriteriaSet): Promise<EvaluationCriteriaSet> {
      const [inserted] = await db.insert(evaluationCriteriaSets).values(criteriaSet as any).returning();
      return inserted;
    }

    async getEvaluationCriteriaSet(id: string): Promise<EvaluationCriteriaSet | undefined> {
      const results = await db.select().from(evaluationCriteriaSets).where(eq(evaluationCriteriaSets.id, id));
      return results[0];
    }

    async getAllEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> {
      return await db.select().from(evaluationCriteriaSets).orderBy(desc(evaluationCriteriaSets.createdAt));
    }

    async getActiveEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> {
      return await db.select().from(evaluationCriteriaSets).where(eq(evaluationCriteriaSets.isActive, true)).orderBy(desc(evaluationCriteriaSets.createdAt));
    }

    async getDefaultEvaluationCriteriaSet(): Promise<EvaluationCriteriaSet | undefined> {
      const results = await db.select().from(evaluationCriteriaSets).where(
        and(
          eq(evaluationCriteriaSets.isDefault, true),
          eq(evaluationCriteriaSets.isActive, true),
          or(eq(evaluationCriteriaSets.status, 'approved'), isNull(evaluationCriteriaSets.status))
        )
      );
      return results[0];
    }

    async getEvaluationCriteriaSetByCategory(categoryId: string): Promise<EvaluationCriteriaSet | undefined> {
      const results = await db.select().from(evaluationCriteriaSets).where(
        and(
          eq(evaluationCriteriaSets.categoryId, categoryId),
          eq(evaluationCriteriaSets.isActive, true),
          or(eq(evaluationCriteriaSets.status, 'approved'), isNull(evaluationCriteriaSets.status))
        )
      );
      return results[0];
    }

    async updateEvaluationCriteriaSet(id: string, updates: Partial<InsertEvaluationCriteriaSet>): Promise<EvaluationCriteriaSet> {
      const [updated] = await db.update(evaluationCriteriaSets).set({ ...updates, updatedAt: new Date() }).where(eq(evaluationCriteriaSets.id, id)).returning();
      return updated;
    }

    async deleteEvaluationCriteriaSet(id: string): Promise<void> {
      await db.delete(evaluationCriteriaSets).where(eq(evaluationCriteriaSets.id, id));
    }

    async setDefaultEvaluationCriteriaSet(id: string): Promise<void> {
      await db.update(evaluationCriteriaSets).set({ isDefault: false });
      await db.update(evaluationCriteriaSets).set({ isDefault: true, updatedAt: new Date() }).where(eq(evaluationCriteriaSets.id, id));
    }

    async updateEvaluationCriteriaSetStatus(id: string, status: string, approvedBy?: string): Promise<EvaluationCriteriaSet> {
      const updates: any = { status, updatedAt: new Date() };
      if (status === 'approved') {
        updates.approvedBy = approvedBy || null;
        updates.approvedAt = new Date();
      }
      const [updated] = await db.update(evaluationCriteriaSets).set(updates).where(eq(evaluationCriteriaSets.id, id)).returning();
      return updated;
    }

    async getEvaluationCriteriaSetVersionHistory(parentSetId: string): Promise<EvaluationCriteriaSet[]> {
      const results = await db.select().from(evaluationCriteriaSets).where(
        or(
          eq(evaluationCriteriaSets.id, parentSetId),
          eq(evaluationCriteriaSets.parentSetId, parentSetId)
        )
      ).orderBy(asc(evaluationCriteriaSets.version));
      return results;
    }

    async createEvaluationDimension(dimension: InsertEvaluationDimension): Promise<EvaluationDimension> {
      const [inserted] = await db.insert(evaluationDimensions).values(dimension as any).returning();
      return inserted;
    }

    async getEvaluationDimension(id: string): Promise<EvaluationDimension | undefined> {
      const results = await db.select().from(evaluationDimensions).where(eq(evaluationDimensions.id, id));
      return results[0];
    }

    async getEvaluationDimensionsByCriteriaSet(criteriaSetId: string): Promise<EvaluationDimension[]> {
      return await db.select().from(evaluationDimensions).where(eq(evaluationDimensions.criteriaSetId, criteriaSetId)).orderBy(asc(evaluationDimensions.displayOrder));
    }

    async updateEvaluationDimension(id: string, updates: Partial<InsertEvaluationDimension>): Promise<EvaluationDimension> {
      const [updated] = await db.update(evaluationDimensions).set(updates as any).where(eq(evaluationDimensions.id, id)).returning();
      return updated;
    }

    async deleteEvaluationDimension(id: string): Promise<void> {
      await db.delete(evaluationDimensions).where(eq(evaluationDimensions.id, id));
    }

    async getEvaluationCriteriaSetWithDimensions(id: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> {
      const criteriaSet = await this.getEvaluationCriteriaSet(id);
      if (!criteriaSet) return undefined;
      const dimensions = await this.getEvaluationDimensionsByCriteriaSet(id);
      return { ...criteriaSet, dimensions };
    }

    async getActiveEvaluationCriteriaSetWithDimensions(categoryId?: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> {
      let criteriaSet: EvaluationCriteriaSet | undefined;
      if (categoryId) criteriaSet = await this.getEvaluationCriteriaSetByCategory(categoryId);
      if (!criteriaSet) criteriaSet = await this.getDefaultEvaluationCriteriaSet();
      if (!criteriaSet) return undefined;
      const dimensions = await this.getEvaluationDimensionsByCriteriaSet(criteriaSet.id);
      return { ...criteriaSet, dimensions };
    }
  };
}

export class MemAnalyticsStorage implements IAnalyticsStorage {
  async createAiUsageLog(_: InsertAiUsageLog): Promise<AiUsageLog> { throw new Error("Not implemented in MemStorage"); }
  async getAiUsageSummary(_: Date, __: Date): Promise<AiUsageSummary> { return { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalCostUsd: 0, requestCount: 0 }; }
  async getAiUsageByFeature(_: Date, __: Date): Promise<AiUsageByFeature[]> { return []; }
  async getAiUsageByModel(_: Date, __: Date): Promise<AiUsageByModel[]> { return []; }
  async getAiUsageDaily(_: Date, __: Date): Promise<AiUsageDaily[]> { return []; }
  async getAiUsageLogs(_: Date, __: Date, ___?: number): Promise<AiUsageLog[]> { return []; }
  async createEvaluationCriteriaSet(_: InsertEvaluationCriteriaSet): Promise<EvaluationCriteriaSet> { throw new Error("Not implemented in MemStorage"); }
  async getEvaluationCriteriaSet(_: string): Promise<EvaluationCriteriaSet | undefined> { throw new Error("Not implemented in MemStorage"); }
  async getAllEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> { return []; }
  async getActiveEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> { return []; }
  async getDefaultEvaluationCriteriaSet(): Promise<EvaluationCriteriaSet | undefined> { return undefined; }
  async getEvaluationCriteriaSetByCategory(_: string): Promise<EvaluationCriteriaSet | undefined> { return undefined; }
  async updateEvaluationCriteriaSet(_: string, __: Partial<InsertEvaluationCriteriaSet>): Promise<EvaluationCriteriaSet> { throw new Error("Not implemented in MemStorage"); }
  async deleteEvaluationCriteriaSet(_: string): Promise<void> { throw new Error("Not implemented in MemStorage"); }
  async setDefaultEvaluationCriteriaSet(_: string): Promise<void> { throw new Error("Not implemented in MemStorage"); }
  async updateEvaluationCriteriaSetStatus(_: string, __: string, ___?: string): Promise<EvaluationCriteriaSet> { throw new Error("Not implemented in MemStorage"); }
  async getEvaluationCriteriaSetVersionHistory(_: string): Promise<EvaluationCriteriaSet[]> { return []; }
  async createEvaluationDimension(_: InsertEvaluationDimension): Promise<EvaluationDimension> { throw new Error("Not implemented in MemStorage"); }
  async getEvaluationDimension(_: string): Promise<EvaluationDimension | undefined> { throw new Error("Not implemented in MemStorage"); }
  async getEvaluationDimensionsByCriteriaSet(_: string): Promise<EvaluationDimension[]> { return []; }
  async updateEvaluationDimension(_: string, __: Partial<InsertEvaluationDimension>): Promise<EvaluationDimension> { throw new Error("Not implemented in MemStorage"); }
  async deleteEvaluationDimension(_: string): Promise<void> { throw new Error("Not implemented in MemStorage"); }
  async getEvaluationCriteriaSetWithDimensions(_: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> { return undefined; }
  async getActiveEvaluationCriteriaSetWithDimensions(_?: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> { return undefined; }
}
