import { type User, type UpsertUser, users } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, and, lt, gt, sql as drizzleSql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { randomBytes } from "crypto";

export interface IUsersStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: { email: string; password: string; name: string; assignedCategoryId?: string | null; companyId?: string | null; organizationId?: string | null; preferredLanguage?: string }): Promise<User>;
  updateUser(id: string, updates: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User>;
  updateUserLanguage(id: string, language: string): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserLastLogin(id: string): Promise<void>;
  getAllUsers(): Promise<User[]>;
  adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedCategoryId?: string | null; assignedOrganizationId?: string | null }): Promise<User>;
  anonymizeUser(userId: string, performedBy: string | null, triggerType: 'manual' | 'scheduled' | 'self_request'): Promise<User>;
  getUsersEligibleForAnonymization(retentionDays: number): Promise<User[]>;
  getUsersApproachingRetention(retentionDays: number, warningDays?: number): Promise<User[]>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function UsersMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IUsersStorage {
    async getUser(id: string): Promise<User | undefined> {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      return user;
    }

    async createUser(userData: { email: string; password: string; name: string; assignedCategoryId?: string | null; companyId?: string | null; organizationId?: string | null; preferredLanguage?: string }): Promise<User> {
      const [user] = await db.insert(users).values({
        ...userData,
        preferredLanguage: userData.preferredLanguage || 'ko',
        companyId: userData.companyId || null,
        organizationId: userData.organizationId || null,
      }).returning();
      return user;
    }

    async updateUser(id: string, updates: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User> {
      const updateData: any = { updatedAt: new Date() };
      if (updates.name) updateData.name = updates.name;
      if (updates.password) updateData.password = updates.password;
      if (updates.profileImage !== undefined) updateData.profileImage = updates.profileImage;
      if (updates.tier) updateData.tier = updates.tier;
      const [user] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
      if (!user) throw new Error("User not found");
      return user;
    }

    async updateUserLanguage(id: string, language: string): Promise<User> {
      const [user] = await db.update(users).set({ preferredLanguage: language, updatedAt: new Date() }).where(eq(users.id, id)).returning();
      if (!user) throw new Error("User not found");
      return user;
    }

    async upsertUser(userData: UpsertUser): Promise<User> {
      const [user] = await db.insert(users).values(userData).onConflictDoUpdate({
        target: users.id,
        set: { email: userData.email, name: userData.name, updatedAt: new Date() },
      }).returning();
      return user;
    }

    async updateUserLastLogin(id: string): Promise<void> {
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
    }

    async getAllUsers(): Promise<User[]> {
      return await db.select().from(users).orderBy(desc(users.createdAt));
    }

    async adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedCategoryId?: string | null; assignedOrganizationId?: string | null }): Promise<User> {
      const [user] = await db.update(users).set({ ...updates, updatedAt: new Date() }).where(eq(users.id, id)).returning();
      if (!user) throw new Error("User not found");
      return user;
    }

    async anonymizeUser(userId: string, performedBy: string | null, triggerType: 'manual' | 'scheduled' | 'self_request'): Promise<User> {
      const suffix = randomBytes(2).toString('hex').toUpperCase();
      const anonEmail = `anonymous-${suffix.toLowerCase()}@anonymized.internal`;
      const anonName = `익명 사용자 #${suffix}`;
      const invalidPassword = `$ANONYMIZED$${randomBytes(32).toString('hex')}`;

      const [updated] = await db.update(users).set({
        email: anonEmail,
        name: anonName,
        password: invalidPassword,
        profileImage: null,
        isActive: false,
        isAnonymized: true,
        anonymizedAt: new Date(),
        anonymizedBy: performedBy,
        updatedAt: new Date(),
      }).where(eq(users.id, userId)).returning();

      if (!updated) throw new Error("User not found");

      try {
        const { sessions } = await import("@shared/schema");
        await db.delete(sessions).where(
          drizzleSql`${sessions.sess}->>'userId' = ${userId}`
        );
      } catch (err) {
        console.warn(`[anonymize] Could not delete sessions for user ${userId}:`, err);
      }

      console.log(`[anonymize] User ${userId} anonymized. trigger=${triggerType}, performedBy=${performedBy ?? 'system'}`);
      return updated;
    }

    async getUsersEligibleForAnonymization(retentionDays: number): Promise<User[]> {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      return await db.select().from(users).where(
        and(
          eq(users.role, 'user'),
          eq(users.isActive, false),
          eq(users.isAnonymized, false),
          lt(users.updatedAt, cutoff)
        )
      );
    }

    async getUsersApproachingRetention(retentionDays: number, warningDays: number = 7): Promise<User[]> {
      const cutoff = new Date(Date.now() - (retentionDays - warningDays) * 24 * 60 * 60 * 1000);
      const cutoffEarly = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      return await db.select().from(users).where(
        and(
          eq(users.role, 'user'),
          eq(users.isActive, false),
          eq(users.isAnonymized, false),
          lt(users.updatedAt, cutoff),
          gt(users.updatedAt, cutoffEarly)
        )
      );
    }
  };
}

export class MemUsersStorage implements IUsersStorage {
  protected _users: Map<string, User> = new Map();

  async getUser(id: string): Promise<User | undefined> {
    return this._users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this._users.values()).find(u => u.email === email);
  }

  async createUser(userData: { email: string; password: string; name: string; assignedCategoryId?: string | null; companyId?: string | null; organizationId?: string | null; preferredLanguage?: string }): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      email: userData.email,
      password: userData.password,
      name: userData.name,
      role: 'user',
      profileImage: null,
      tier: 'bronze',
      preferredLanguage: userData.preferredLanguage || 'ko',
      isActive: true,
      lastLoginAt: null,
      companyId: userData.companyId || null,
      organizationId: userData.organizationId || null,
      assignedCategoryId: userData.assignedCategoryId || null,
      assignedOrganizationId: null,
      assignedCompanyId: null,
      isAnonymized: false,
      anonymizedAt: null,
      anonymizedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this._users.set(id, user);
    return user;
  }

  async updateUser(id: string, updates: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User> {
    const existing = this._users.get(id);
    if (!existing) throw new Error("User not found");
    const updated: User = {
      ...existing,
      ...(updates.name && { name: updates.name }),
      ...(updates.password && { password: updates.password }),
      ...(updates.profileImage !== undefined && { profileImage: updates.profileImage }),
      ...(updates.tier && { tier: updates.tier }),
      updatedAt: new Date(),
    };
    this._users.set(id, updated);
    return updated;
  }

  async updateUserLanguage(id: string, language: string): Promise<User> {
    const existing = this._users.get(id);
    if (!existing) throw new Error("User not found");
    const updated: User = { ...existing, preferredLanguage: language, updatedAt: new Date() };
    this._users.set(id, updated);
    return updated;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = this._users.get(userData.id as string);
    const user: User = {
      id: userData.id as string,
      email: userData.email || '',
      password: existingUser?.password || '',
      name: userData.name || '',
      role: existingUser?.role || 'user',
      profileImage: existingUser?.profileImage || null,
      tier: existingUser?.tier || 'bronze',
      preferredLanguage: existingUser?.preferredLanguage || 'ko',
      isActive: existingUser?.isActive ?? true,
      lastLoginAt: existingUser?.lastLoginAt || null,
      companyId: existingUser?.companyId || null,
      organizationId: existingUser?.organizationId || null,
      assignedCategoryId: existingUser?.assignedCategoryId || null,
      assignedOrganizationId: existingUser?.assignedOrganizationId || null,
      assignedCompanyId: existingUser?.assignedCompanyId || null,
      isAnonymized: existingUser?.isAnonymized ?? false,
      anonymizedAt: existingUser?.anonymizedAt ?? null,
      anonymizedBy: existingUser?.anonymizedBy ?? null,
      createdAt: existingUser?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    this._users.set(user.id, user);
    return user;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    const user = this._users.get(id);
    if (user) { user.lastLoginAt = new Date(); this._users.set(id, user); }
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this._users.values());
  }

  async adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedCategoryId?: string | null; assignedOrganizationId?: string | null }): Promise<User> {
    const user = this._users.get(id);
    if (!user) throw new Error("User not found");
    const updated = { ...user, ...updates, updatedAt: new Date() };
    this._users.set(id, updated);
    return updated;
  }

  async anonymizeUser(userId: string, performedBy: string | null, triggerType: 'manual' | 'scheduled' | 'self_request'): Promise<User> {
    const user = this._users.get(userId);
    if (!user) throw new Error("User not found");
    const suffix = randomBytes(2).toString('hex').toUpperCase();
    const updated: User = {
      ...user,
      email: `anonymous-${suffix.toLowerCase()}@anonymized.internal`,
      name: `익명 사용자 #${suffix}`,
      password: `$ANONYMIZED$${randomBytes(32).toString('hex')}`,
      profileImage: null,
      isActive: false,
      isAnonymized: true,
      anonymizedAt: new Date(),
      anonymizedBy: performedBy,
      updatedAt: new Date(),
    };
    this._users.set(userId, updated);
    console.log(`[anonymize] MemStorage: User ${userId} anonymized. trigger=${triggerType}`);
    return updated;
  }

  async getUsersEligibleForAnonymization(retentionDays: number): Promise<User[]> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    return Array.from(this._users.values()).filter(u =>
      u.role === 'user' &&
      u.isActive === false &&
      u.isAnonymized === false &&
      u.updatedAt !== null &&
      u.updatedAt < cutoff
    );
  }

  async getUsersApproachingRetention(retentionDays: number, warningDays: number = 7): Promise<User[]> {
    const cutoff = new Date(Date.now() - (retentionDays - warningDays) * 24 * 60 * 60 * 1000);
    const cutoffEarly = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    return Array.from(this._users.values()).filter(u =>
      u.role === 'user' &&
      u.isActive === false &&
      u.isAnonymized === false &&
      u.updatedAt !== null &&
      u.updatedAt < cutoff &&
      u.updatedAt > cutoffEarly
    );
  }
}
