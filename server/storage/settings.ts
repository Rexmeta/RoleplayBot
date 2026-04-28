import { type SystemSetting, systemSettings } from "@shared/schema";
import { db } from "./db";
import { eq, asc, and } from "drizzle-orm";

export interface ISettingsStorage {
  getSystemSettings(): Promise<SystemSetting[]>;
  getSystemSettingsByCategory(category: string): Promise<SystemSetting[]>;
  getSystemSetting(category: string, key: string): Promise<SystemSetting | undefined>;
  upsertSystemSetting(setting: { category: string; key: string; value: string; description?: string; updatedBy?: string }): Promise<SystemSetting>;
  deleteSystemSetting(category: string, key: string): Promise<void>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function SettingsMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements ISettingsStorage {
    async getSystemSettings(): Promise<SystemSetting[]> {
      return await db.select().from(systemSettings).orderBy(asc(systemSettings.category), asc(systemSettings.key));
    }

    async getSystemSettingsByCategory(category: string): Promise<SystemSetting[]> {
      return await db.select().from(systemSettings).where(eq(systemSettings.category, category)).orderBy(asc(systemSettings.key));
    }

    async getSystemSetting(category: string, key: string): Promise<SystemSetting | undefined> {
      const [setting] = await db.select().from(systemSettings).where(and(eq(systemSettings.category, category), eq(systemSettings.key, key)));
      return setting;
    }

    async upsertSystemSetting(setting: { category: string; key: string; value: string; description?: string; updatedBy?: string }): Promise<SystemSetting> {
      const existing = await this.getSystemSetting(setting.category, setting.key);
      if (existing) {
        const [updated] = await db.update(systemSettings)
          .set({ value: setting.value, description: setting.description, updatedBy: setting.updatedBy, updatedAt: new Date() })
          .where(and(eq(systemSettings.category, setting.category), eq(systemSettings.key, setting.key)))
          .returning();
        return updated;
      } else {
        const [inserted] = await db.insert(systemSettings).values({
          category: setting.category,
          key: setting.key,
          value: setting.value,
          description: setting.description,
          updatedBy: setting.updatedBy,
        }).returning();
        return inserted;
      }
    }

    async deleteSystemSetting(category: string, key: string): Promise<void> {
      await db.delete(systemSettings).where(and(eq(systemSettings.category, category), eq(systemSettings.key, key)));
    }
  };
}

export class MemSettingsStorage implements ISettingsStorage {
  async getSystemSettings(): Promise<SystemSetting[]> { throw new Error("Not implemented in MemStorage"); }
  async getSystemSettingsByCategory(_: string): Promise<SystemSetting[]> { throw new Error("Not implemented in MemStorage"); }
  async getSystemSetting(_: string, __: string): Promise<SystemSetting | undefined> { throw new Error("Not implemented in MemStorage"); }
  async upsertSystemSetting(_: { category: string; key: string; value: string; description?: string; updatedBy?: string }): Promise<SystemSetting> { throw new Error("Not implemented in MemStorage"); }
  async deleteSystemSetting(_: string, __: string): Promise<void> { throw new Error("Not implemented in MemStorage"); }
}
