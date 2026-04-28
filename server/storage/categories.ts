import { type Category, type InsertCategory, type UserBookmark, type ScenarioStats, categories, userBookmarks, scenarioRuns } from "@shared/schema";
import { db } from "./db";
import { eq, asc, desc, and, inArray, sql, count } from "drizzle-orm";

export interface ICategoriesStorage {
  createCategory(category: InsertCategory): Promise<Category>;
  getCategory(id: string): Promise<Category | undefined>;
  getAllCategories(): Promise<Category[]>;
  updateCategory(id: string, updates: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: string): Promise<void>;

  addBookmark(userId: string, scenarioId: string): Promise<UserBookmark>;
  removeBookmark(userId: string, scenarioId: string): Promise<void>;
  getUserBookmarks(userId: string): Promise<UserBookmark[]>;

  getScenarioStats(scenarioIds?: string[]): Promise<ScenarioStats[]>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function CategoriesMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements ICategoriesStorage {
    async createCategory(insertCategory: InsertCategory): Promise<Category> {
      const [category] = await db.insert(categories).values(insertCategory).returning();
      return category;
    }

    async getCategory(id: string): Promise<Category | undefined> {
      const [category] = await db.select().from(categories).where(eq(categories.id, id));
      return category;
    }

    async getAllCategories(): Promise<Category[]> {
      return await db.select().from(categories).orderBy(asc(categories.order));
    }

    async updateCategory(id: string, updates: Partial<InsertCategory>): Promise<Category> {
      const [category] = await db.update(categories).set(updates).where(eq(categories.id, id)).returning();
      if (!category) throw new Error("Category not found");
      return category;
    }

    async deleteCategory(id: string): Promise<void> {
      await db.delete(categories).where(eq(categories.id, id));
    }

    async addBookmark(userId: string, scenarioId: string): Promise<UserBookmark> {
      const existing = await db.select().from(userBookmarks).where(and(eq(userBookmarks.userId, userId), eq(userBookmarks.scenarioId, scenarioId)));
      if (existing.length > 0) return existing[0];
      const [bookmark] = await db.insert(userBookmarks).values({ userId, scenarioId }).returning();
      return bookmark;
    }

    async removeBookmark(userId: string, scenarioId: string): Promise<void> {
      await db.delete(userBookmarks).where(and(eq(userBookmarks.userId, userId), eq(userBookmarks.scenarioId, scenarioId)));
    }

    async getUserBookmarks(userId: string): Promise<UserBookmark[]> {
      return await db.select().from(userBookmarks).where(eq(userBookmarks.userId, userId)).orderBy(desc(userBookmarks.createdAt));
    }

    async getScenarioStats(scenarioIds?: string[]): Promise<ScenarioStats[]> {
      const rows = await db.select({
        scenarioId: scenarioRuns.scenarioId,
        completionCount: count(scenarioRuns.id),
        averageScore: sql<number | null>`AVG(${scenarioRuns.totalScore})`,
      })
        .from(scenarioRuns)
        .where(eq(scenarioRuns.status, 'completed'))
        .groupBy(scenarioRuns.scenarioId);

      const filtered = scenarioIds && scenarioIds.length > 0
        ? rows.filter(r => scenarioIds.includes(r.scenarioId))
        : rows;

      return filtered.map(r => ({
        scenarioId: r.scenarioId,
        completionCount: Number(r.completionCount) || 0,
        averageScore: r.averageScore != null ? Math.round(Number(r.averageScore)) : null,
      }));
    }
  };
}

export class MemCategoriesStorage implements ICategoriesStorage {
  async createCategory(_: InsertCategory): Promise<Category> { throw new Error("Not implemented in MemStorage"); }
  async getCategory(_: string): Promise<Category | undefined> { throw new Error("Not implemented in MemStorage"); }
  async getAllCategories(): Promise<Category[]> { throw new Error("Not implemented in MemStorage"); }
  async updateCategory(_: string, __: Partial<InsertCategory>): Promise<Category> { throw new Error("Not implemented in MemStorage"); }
  async deleteCategory(_: string): Promise<void> { throw new Error("Not implemented in MemStorage"); }
  async addBookmark(_: string, __: string): Promise<UserBookmark> { throw new Error("Not implemented in MemStorage"); }
  async removeBookmark(_: string, __: string): Promise<void> {}
  async getUserBookmarks(_: string): Promise<UserBookmark[]> { return []; }
  async getScenarioStats(_?: string[]): Promise<ScenarioStats[]> { return []; }
}
