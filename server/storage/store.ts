import { type StorePack, type InsertStorePack, type StoreEntitlement, type InsertStoreEntitlement, storePacks, storeEntitlements, scenarios, mbtiPersonas, plans, subscriptions } from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

const STORE_TIER_ORDER: Record<string, number> = { starter: 1, pro: 2, enterprise: 3 };

export interface IStoreStorage {
  getAllStorePacks(): Promise<StorePack[]>;
  getActiveStorePacks(): Promise<StorePack[]>;
  getStorePack(id: string): Promise<StorePack | undefined>;
  createStorePack(pack: InsertStorePack): Promise<StorePack>;
  updateStorePack(id: string, updates: Partial<InsertStorePack>): Promise<StorePack>;
  deleteStorePack(id: string): Promise<void>;

  getStoreEntitlementsForOrg(orgId: string): Promise<StoreEntitlement[]>;
  getStoreEntitlementsForPack(packId: string): Promise<StoreEntitlement[]>;
  getAllStoreEntitlements(): Promise<(StoreEntitlement & { pack: StorePack | null })[]>;
  hasEntitlement(orgId: string, packId: string): Promise<boolean>;
  /** True if org has an explicit entitlement OR qualifies via plan tier. */
  isOrgEntitledToPack(orgId: string | null, packId: string): Promise<boolean>;
  grantEntitlement(entitlement: InsertStoreEntitlement): Promise<StoreEntitlement>;
  revokeEntitlement(orgId: string, packId: string): Promise<void>;
  getStoreRevenueSummary(): Promise<{ totalEntitlements: number; revenueUsd: number; byPack: { packId: string; packName: string; count: number; revenueUsd: number }[] }>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function StoreMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IStoreStorage {
    async getAllStorePacks(): Promise<StorePack[]> {
      const packs = await db.select().from(storePacks).orderBy(desc(storePacks.createdAt));
      return this._enrichPackCounts(packs);
    }

    async getActiveStorePacks(): Promise<StorePack[]> {
      const packs = await db.select().from(storePacks).where(eq(storePacks.isActive, true)).orderBy(storePacks.name);
      return this._enrichPackCounts(packs);
    }

    private async _enrichPackCounts(packs: StorePack[]): Promise<StorePack[]> {
      if (packs.length === 0) return packs;
      const [scenarioCounts, personaCounts] = await Promise.all([
        db.select({ packId: scenarios.storePackId, count: sql<number>`count(*)::int` })
          .from(scenarios)
          .where(sql`${scenarios.storePackId} IS NOT NULL AND ${scenarios.storeListed} = true AND ${scenarios.isDeleted} IS NOT TRUE`)
          .groupBy(scenarios.storePackId),
        db.select({ packId: mbtiPersonas.storePackId, count: sql<number>`count(*)::int` })
          .from(mbtiPersonas)
          .where(sql`${mbtiPersonas.storePackId} IS NOT NULL AND ${mbtiPersonas.storeListed} = true`)
          .groupBy(mbtiPersonas.storePackId),
      ]);
      const sMap = new Map(scenarioCounts.map(r => [r.packId, r.count]));
      const pMap = new Map(personaCounts.map(r => [r.packId, r.count]));
      return packs.map(p => ({
        ...p,
        scenarioCount: sMap.get(p.id) ?? 0,
        personaCount: pMap.get(p.id) ?? 0,
      }));
    }

    async getStorePack(id: string): Promise<StorePack | undefined> {
      const rows = await db.select().from(storePacks).where(eq(storePacks.id, id));
      return rows[0];
    }

    async createStorePack(pack: InsertStorePack): Promise<StorePack> {
      const [inserted] = await db.insert(storePacks).values(pack as any).returning();
      return inserted;
    }

    async updateStorePack(id: string, updates: Partial<InsertStorePack>): Promise<StorePack> {
      const [updated] = await db
        .update(storePacks)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(storePacks.id, id))
        .returning();
      return updated;
    }

    async deleteStorePack(id: string): Promise<void> {
      await db.delete(storePacks).where(eq(storePacks.id, id));
    }

    async getStoreEntitlementsForOrg(orgId: string): Promise<StoreEntitlement[]> {
      return db.select().from(storeEntitlements).where(eq(storeEntitlements.orgId, orgId));
    }

    async getStoreEntitlementsForPack(packId: string): Promise<StoreEntitlement[]> {
      return db.select().from(storeEntitlements).where(eq(storeEntitlements.packId, packId));
    }

    async getAllStoreEntitlements(): Promise<(StoreEntitlement & { pack: StorePack | null })[]> {
      const rows = await db
        .select({ entitlement: storeEntitlements, pack: storePacks })
        .from(storeEntitlements)
        .leftJoin(storePacks, eq(storeEntitlements.packId, storePacks.id))
        .orderBy(desc(storeEntitlements.unlockedAt));
      return rows.map(r => ({ ...r.entitlement, pack: r.pack }));
    }

    async hasEntitlement(orgId: string, packId: string): Promise<boolean> {
      const rows = await db
        .select({ id: storeEntitlements.id })
        .from(storeEntitlements)
        .where(and(eq(storeEntitlements.orgId, orgId), eq(storeEntitlements.packId, packId)));
      return rows.length > 0;
    }

    async isOrgEntitledToPack(orgId: string | null, packId: string): Promise<boolean> {
      if (!orgId) return false;
      // Fast path: explicit entitlement
      if (await this.hasEntitlement(orgId, packId)) return true;
      // Plan-tier path: check if org's plan tier meets the pack's planTierMinimum
      const pack = await this.getStorePack(packId);
      if (!pack?.planTierMinimum) return false;
      const required = STORE_TIER_ORDER[pack.planTierMinimum.toLowerCase()] ?? 999;
      if (required === 999) return false;
      try {
        const subRows = await db
          .select({ planId: subscriptions.planId })
          .from(subscriptions)
          .where(eq(subscriptions.orgId, orgId))
          .limit(1);
        if (!subRows.length) return false;
        const planRows = await db
          .select({ name: plans.name })
          .from(plans)
          .where(eq(plans.id, subRows[0].planId))
          .limit(1);
        if (!planRows.length) return false;
        const orgTier = STORE_TIER_ORDER[(planRows[0].name ?? '').toLowerCase()] ?? 0;
        return orgTier >= required;
      } catch {
        return false;
      }
    }

    async grantEntitlement(entitlement: InsertStoreEntitlement): Promise<StoreEntitlement> {
      const [inserted] = await db
        .insert(storeEntitlements)
        .values(entitlement as any)
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const rows = await db.select().from(storeEntitlements).where(
          and(eq(storeEntitlements.orgId, entitlement.orgId), eq(storeEntitlements.packId, entitlement.packId))
        );
        return rows[0];
      }
      return inserted;
    }

    async revokeEntitlement(orgId: string, packId: string): Promise<void> {
      await db.delete(storeEntitlements).where(
        and(eq(storeEntitlements.orgId, orgId), eq(storeEntitlements.packId, packId))
      );
    }

    async getStoreRevenueSummary(): Promise<{ totalEntitlements: number; revenueUsd: number; byPack: { packId: string; packName: string; count: number; revenueUsd: number }[] }> {
      const allEntitlements = await db
        .select({ entitlement: storeEntitlements, pack: storePacks })
        .from(storeEntitlements)
        .leftJoin(storePacks, eq(storeEntitlements.packId, storePacks.id));

      const byPackMap = new Map<string, { packId: string; packName: string; count: number; revenueUsd: number }>();
      let totalRevenue = 0;

      for (const row of allEntitlements) {
        const packId = row.entitlement.packId;
        const packName = row.pack?.name ?? packId;
        const price = row.pack?.priceUsd ?? 0;
        totalRevenue += price;
        const existing = byPackMap.get(packId);
        if (existing) {
          existing.count++;
          existing.revenueUsd += price;
        } else {
          byPackMap.set(packId, { packId, packName, count: 1, revenueUsd: price });
        }
      }

      return {
        totalEntitlements: allEntitlements.length,
        revenueUsd: totalRevenue,
        byPack: Array.from(byPackMap.values()).sort((a, b) => b.revenueUsd - a.revenueUsd),
      };
    }
  };
}

export class MemStoreStorage implements IStoreStorage {
  private packs: StorePack[] = [];
  private entitlements: StoreEntitlement[] = [];

  async getAllStorePacks() { return [...this.packs]; }
  async getActiveStorePacks() { return this.packs.filter(p => p.isActive); }
  async getStorePack(id: string) { return this.packs.find(p => p.id === id); }
  async createStorePack(pack: InsertStorePack) {
    const row = { id: crypto.randomUUID(), ...pack, scenarioCount: pack.scenarioCount ?? 0, personaCount: pack.personaCount ?? 0, createdAt: new Date(), updatedAt: new Date() } as StorePack;
    this.packs.push(row);
    return row;
  }
  async updateStorePack(id: string, updates: Partial<InsertStorePack>) {
    const idx = this.packs.findIndex(p => p.id === id);
    if (idx === -1) throw new Error("Pack not found");
    this.packs[idx] = { ...this.packs[idx], ...updates, updatedAt: new Date() };
    return this.packs[idx];
  }
  async deleteStorePack(id: string) { this.packs = this.packs.filter(p => p.id !== id); }
  async getStoreEntitlementsForOrg(orgId: string) { return this.entitlements.filter(e => e.orgId === orgId); }
  async getStoreEntitlementsForPack(packId: string) { return this.entitlements.filter(e => e.packId === packId); }
  async getAllStoreEntitlements() { return this.entitlements.map(e => ({ ...e, pack: this.packs.find(p => p.id === e.packId) ?? null })); }
  async hasEntitlement(orgId: string, packId: string) { return this.entitlements.some(e => e.orgId === orgId && e.packId === packId); }
  async isOrgEntitledToPack(orgId: string | null, packId: string) {
    if (!orgId) return false;
    return this.hasEntitlement(orgId, packId);
  }
  async grantEntitlement(entitlement: InsertStoreEntitlement) {
    const existing = this.entitlements.find(e => e.orgId === entitlement.orgId && e.packId === entitlement.packId);
    if (existing) return existing;
    const row = { id: crypto.randomUUID(), ...entitlement, unlockedAt: new Date() } as StoreEntitlement;
    this.entitlements.push(row);
    return row;
  }
  async revokeEntitlement(orgId: string, packId: string) {
    this.entitlements = this.entitlements.filter(e => !(e.orgId === orgId && e.packId === packId));
  }
  async getStoreRevenueSummary() { return { totalEntitlements: 0, revenueUsd: 0, byPack: [] }; }
}
