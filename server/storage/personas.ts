import { type UserPersona, type InsertUserPersona, type PersonaUserScene, type InsertPersonaUserScene, userPersonas, userPersonaLikes, personaUserScenes } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, sql } from "drizzle-orm";

export interface IPersonasStorage {
  createUserPersona(data: InsertUserPersona): Promise<UserPersona>;
  getUserPersonaById(id: string): Promise<UserPersona | undefined>;
  getUserPersonasByCreator(creatorId: string, includeSystem?: boolean): Promise<UserPersona[]>;
  getPublicUserPersonas(sortBy?: 'likes' | 'recent', limit?: number, offset?: number, tag?: string, mbti?: string): Promise<UserPersona[]>;
  getAllPersonas(): Promise<UserPersona[]>;
  updateUserPersona(id: string, creatorId: string, data: Partial<InsertUserPersona>, isAdmin?: boolean): Promise<UserPersona>;
  deleteUserPersona(id: string, creatorId: string, isAdmin?: boolean): Promise<void>;
  toggleUserPersonaLike(userId: string, personaId: string): Promise<{ liked: boolean; likeCount: number }>;
  getUserPersonaLike(userId: string, personaId: string): Promise<boolean>;
  incrementUserPersonaChatCount(id: string): Promise<void>;

  createPersonaUserScene(data: InsertPersonaUserScene): Promise<PersonaUserScene>;
  getPersonaUserSceneById(id: string): Promise<PersonaUserScene | undefined>;
  getPersonaUserScenesByCreator(creatorId: string, search?: string): Promise<PersonaUserScene[]>;
  getPublicPersonaUserScenes(options?: { genre?: string; tag?: string; search?: string; limit?: number; offset?: number }): Promise<PersonaUserScene[]>;
  updatePersonaUserScene(id: string, creatorId: string, data: Partial<InsertPersonaUserScene>): Promise<PersonaUserScene>;
  deletePersonaUserScene(id: string, creatorId: string): Promise<void>;
  incrementPersonaUserSceneUseCount(id: string): Promise<void>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function PersonasMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IPersonasStorage {
    async createUserPersona(data: InsertUserPersona): Promise<UserPersona> {
      const [created] = await db.insert(userPersonas).values(data as any).returning();
      return created;
    }

    async getUserPersonaById(id: string): Promise<UserPersona | undefined> {
      const [persona] = await db.select().from(userPersonas).where(eq(userPersonas.id, id));
      return persona;
    }

    async getUserPersonasByCreator(creatorId: string, includeSystem?: boolean): Promise<UserPersona[]> {
      if (includeSystem) {
        return await db.select().from(userPersonas).where(or(eq(userPersonas.creatorId, creatorId), eq(userPersonas.creatorId, 'system'))).orderBy(desc(userPersonas.createdAt));
      }
      return await db.select().from(userPersonas).where(eq(userPersonas.creatorId, creatorId)).orderBy(desc(userPersonas.createdAt));
    }

    async getPublicUserPersonas(sortBy: 'likes' | 'recent' = 'likes', limit = 50, offset = 0, tag?: string, mbti?: string): Promise<UserPersona[]> {
      const orderCol = sortBy === 'likes' ? desc(userPersonas.likeCount) : desc(userPersonas.createdAt);
      let whereCondition = eq(userPersonas.isPublic, true) as ReturnType<typeof and>;
      if (tag) whereCondition = and(whereCondition, sql`EXISTS (SELECT 1 FROM unnest(${userPersonas.tags}) AS t WHERE t ILIKE ${'%' + tag + '%'})`);
      if (mbti) whereCondition = and(whereCondition, sql`EXISTS (SELECT 1 FROM unnest(${userPersonas.tags}) AS t WHERE t ILIKE ${'%' + mbti + '%'})`);
      return await db.select().from(userPersonas).where(whereCondition).orderBy(orderCol).limit(limit).offset(offset);
    }

    async getAllPersonas(): Promise<UserPersona[]> {
      return await db.select().from(userPersonas).orderBy(desc(userPersonas.createdAt));
    }

    async updateUserPersona(id: string, creatorId: string, data: Partial<InsertUserPersona>, isAdmin?: boolean): Promise<UserPersona> {
      const whereClause = isAdmin ? eq(userPersonas.id, id) : and(eq(userPersonas.id, id), eq(userPersonas.creatorId, creatorId));
      const [updated] = await db.update(userPersonas).set({ ...data as any, updatedAt: new Date() }).where(whereClause).returning();
      if (!updated) throw new Error("UserPersona not found or unauthorized");
      return updated;
    }

    async deleteUserPersona(id: string, creatorId: string, isAdmin?: boolean): Promise<void> {
      const whereClause = isAdmin ? eq(userPersonas.id, id) : and(eq(userPersonas.id, id), eq(userPersonas.creatorId, creatorId));
      await db.delete(userPersonas).where(whereClause);
    }

    async toggleUserPersonaLike(userId: string, personaId: string): Promise<{ liked: boolean; likeCount: number }> {
      const existing = await db.select().from(userPersonaLikes).where(and(eq(userPersonaLikes.userId, userId), eq(userPersonaLikes.personaId, personaId)));
      if (existing.length > 0) {
        await db.delete(userPersonaLikes).where(and(eq(userPersonaLikes.userId, userId), eq(userPersonaLikes.personaId, personaId)));
        const [updated] = await db.update(userPersonas).set({ likeCount: sql`GREATEST(like_count - 1, 0)` }).where(eq(userPersonas.id, personaId)).returning();
        return { liked: false, likeCount: updated?.likeCount ?? 0 };
      } else {
        await db.insert(userPersonaLikes).values({ userId, personaId });
        const [updated] = await db.update(userPersonas).set({ likeCount: sql`like_count + 1` }).where(eq(userPersonas.id, personaId)).returning();
        return { liked: true, likeCount: updated?.likeCount ?? 0 };
      }
    }

    async getUserPersonaLike(userId: string, personaId: string): Promise<boolean> {
      const [row] = await db.select().from(userPersonaLikes).where(and(eq(userPersonaLikes.userId, userId), eq(userPersonaLikes.personaId, personaId)));
      return !!row;
    }

    async incrementUserPersonaChatCount(id: string): Promise<void> {
      await db.update(userPersonas).set({ chatCount: sql`chat_count + 1` }).where(eq(userPersonas.id, id));
    }

    async createPersonaUserScene(data: InsertPersonaUserScene): Promise<PersonaUserScene> {
      const [scene] = await db.insert(personaUserScenes).values(data).returning();
      return scene;
    }

    async getPersonaUserSceneById(id: string): Promise<PersonaUserScene | undefined> {
      const [scene] = await db.select().from(personaUserScenes).where(eq(personaUserScenes.id, id));
      return scene;
    }

    async getPersonaUserScenesByCreator(creatorId: string, search?: string): Promise<PersonaUserScene[]> {
      const conditions: any[] = [eq(personaUserScenes.creatorId, creatorId)];
      if (search) {
        const q = `%${search.toLowerCase()}%`;
        conditions.push(or(sql`lower(${personaUserScenes.title}) like ${q}`, sql`lower(${personaUserScenes.description}) like ${q}`));
      }
      return db.select().from(personaUserScenes).where(and(...conditions)).orderBy(desc(personaUserScenes.createdAt));
    }

    async getPublicPersonaUserScenes(options: { genre?: string; tag?: string; search?: string; limit?: number; offset?: number } = {}): Promise<PersonaUserScene[]> {
      const { genre, tag, search, limit = 50, offset = 0 } = options;
      const conditions: any[] = [eq(personaUserScenes.isPublic, true)];
      if (genre) conditions.push(sql`lower(${personaUserScenes.genre}) like ${`%${genre.toLowerCase()}%`}`);
      if (tag) conditions.push(sql`${personaUserScenes.tags} @> ${JSON.stringify([tag])}::jsonb`);
      if (search) {
        const q = `%${search.toLowerCase()}%`;
        conditions.push(or(sql`lower(${personaUserScenes.title}) like ${q}`, sql`lower(${personaUserScenes.description}) like ${q}`));
      }
      return await db.select().from(personaUserScenes).where(and(...conditions)).orderBy(desc(personaUserScenes.useCount), desc(personaUserScenes.createdAt)).limit(limit).offset(offset);
    }

    async updatePersonaUserScene(id: string, creatorId: string, data: Partial<InsertPersonaUserScene>): Promise<PersonaUserScene> {
      const existing = await this.getPersonaUserSceneById(id);
      if (!existing) throw new Error("장면을 찾을 수 없습니다.");
      if (existing.creatorId !== creatorId) throw new Error("권한이 없습니다.");
      const [updated] = await db.update(personaUserScenes).set({ ...data, updatedAt: new Date() }).where(eq(personaUserScenes.id, id)).returning();
      return updated;
    }

    async deletePersonaUserScene(id: string, creatorId: string): Promise<void> {
      const existing = await this.getPersonaUserSceneById(id);
      if (!existing) throw new Error("장면을 찾을 수 없습니다.");
      if (existing.creatorId !== creatorId) throw new Error("권한이 없습니다.");
      await db.delete(personaUserScenes).where(eq(personaUserScenes.id, id));
    }

    async incrementPersonaUserSceneUseCount(id: string): Promise<void> {
      await db.update(personaUserScenes).set({ useCount: sql`use_count + 1` }).where(eq(personaUserScenes.id, id));
    }
  };
}

export class MemPersonasStorage implements IPersonasStorage {
  async createUserPersona(_: InsertUserPersona): Promise<UserPersona> { throw new Error("Not implemented"); }
  async getUserPersonaById(_: string): Promise<UserPersona | undefined> { return undefined; }
  async getUserPersonasByCreator(_: string, __?: boolean): Promise<UserPersona[]> { return []; }
  async getPublicUserPersonas(_?: 'likes' | 'recent', __?: number, ___?: number, ____?: string, _____?: string): Promise<UserPersona[]> { return []; }
  async getAllPersonas(): Promise<UserPersona[]> { return []; }
  async updateUserPersona(_: string, __: string, ___: Partial<InsertUserPersona>, ____?: boolean): Promise<UserPersona> { throw new Error("Not implemented"); }
  async deleteUserPersona(_: string, __: string, ___?: boolean): Promise<void> {}
  async toggleUserPersonaLike(_: string, __: string): Promise<{ liked: boolean; likeCount: number }> { return { liked: false, likeCount: 0 }; }
  async getUserPersonaLike(_: string, __: string): Promise<boolean> { return false; }
  async incrementUserPersonaChatCount(_: string): Promise<void> {}
  async createPersonaUserScene(_: InsertPersonaUserScene): Promise<PersonaUserScene> { throw new Error("Not implemented"); }
  async getPersonaUserSceneById(_: string): Promise<PersonaUserScene | undefined> { return undefined; }
  async getPersonaUserScenesByCreator(_: string, __?: string): Promise<PersonaUserScene[]> { return []; }
  async getPublicPersonaUserScenes(_?: { genre?: string; tag?: string; search?: string; limit?: number; offset?: number }): Promise<PersonaUserScene[]> { return []; }
  async updatePersonaUserScene(_: string, __: string, ___: Partial<InsertPersonaUserScene>): Promise<PersonaUserScene> { throw new Error("Not implemented"); }
  async deletePersonaUserScene(_: string, __: string): Promise<void> {}
  async incrementPersonaUserSceneUseCount(_: string): Promise<void> {}
}
