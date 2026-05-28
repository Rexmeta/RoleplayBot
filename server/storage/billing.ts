import { type Plan, type InsertPlan, type Subscription, type InsertSubscription, type InsertAiUsageLog, type AiUsageLog, plans, subscriptions, aiUsageLogs, UNLIMITED_QUOTA } from "@shared/schema";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";

export interface IBillingStorage {
  getAllPlans(): Promise<Plan[]>;
  getActivePlans(): Promise<Plan[]>;
  getPlan(id: string): Promise<Plan | undefined>;
  getPlanByName(name: string): Promise<Plan | undefined>;
  createPlan(plan: InsertPlan): Promise<Plan>;
  updatePlan(id: string, updates: Partial<InsertPlan>): Promise<Plan>;

  getSubscriptionByUserId(userId: string): Promise<Subscription | undefined>;
  getSubscriptionByOrgId(orgId: string): Promise<Subscription | undefined>;
  getSubscriptionById(id: string): Promise<Subscription | undefined>;
  getAllSubscriptions(): Promise<(Subscription & { plan: Plan | null })[]>;
  createSubscription(sub: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, updates: Partial<InsertSubscription>): Promise<Subscription>;
  assignPlanToUser(userId: string, planId: string): Promise<Subscription>;
  assignPlanToOrg(orgId: string, planId: string): Promise<Subscription>;
  incrementSubscriptionUsage(userId: string, tokens: number): Promise<void>;
  resetSubscriptionCycle(userId: string): Promise<void>;
  getOrCreateSubscription(userId: string): Promise<{ subscription: Subscription; plan: Plan }>;
  getOrCreateOrgSubscription(orgId: string): Promise<{ subscription: Subscription; plan: Plan }>;
  getOrgMonthlySpend(orgId: string): Promise<{ tokensUsed: number; estimatedCostUsd: number }>;
  logUsageAndIncrementSubscription(log: InsertAiUsageLog): Promise<AiUsageLog>;
  seedDefaultPlans(): Promise<void>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function BillingMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IBillingStorage {
    async getAllPlans(): Promise<Plan[]> {
      return db.select().from(plans).orderBy(plans.priceUsdMonthly);
    }

    async getActivePlans(): Promise<Plan[]> {
      return db.select().from(plans).where(eq(plans.isActive, true)).orderBy(plans.priceUsdMonthly);
    }

    async getPlan(id: string): Promise<Plan | undefined> {
      const rows = await db.select().from(plans).where(eq(plans.id, id));
      return rows[0];
    }

    async getPlanByName(name: string): Promise<Plan | undefined> {
      const rows = await db.select().from(plans).where(eq(plans.name, name));
      return rows[0];
    }

    async createPlan(plan: InsertPlan): Promise<Plan> {
      const [inserted] = await db.insert(plans).values(plan as any).returning();
      return inserted;
    }

    async updatePlan(id: string, updates: Partial<InsertPlan>): Promise<Plan> {
      const [updated] = await db
        .update(plans)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(plans.id, id))
        .returning();
      return updated;
    }

    async getSubscriptionByUserId(userId: string): Promise<Subscription | undefined> {
      const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
      return rows[0];
    }

    async getSubscriptionByOrgId(orgId: string): Promise<Subscription | undefined> {
      const rows = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
      return rows[0];
    }

    async getSubscriptionById(id: string): Promise<Subscription | undefined> {
      const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
      return rows[0];
    }

    async getAllSubscriptions(): Promise<(Subscription & { plan: Plan | null })[]> {
      const rows = await db
        .select({
          subscription: subscriptions,
          plan: plans,
        })
        .from(subscriptions)
        .leftJoin(plans, eq(subscriptions.planId, plans.id))
        .orderBy(subscriptions.createdAt);
      return rows.map(r => ({ ...r.subscription, plan: r.plan }));
    }

    async createSubscription(sub: InsertSubscription): Promise<Subscription> {
      const [inserted] = await db.insert(subscriptions).values(sub as any).returning();
      return inserted;
    }

    async updateSubscription(id: string, updates: Partial<InsertSubscription>): Promise<Subscription> {
      const [updated] = await db
        .update(subscriptions)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(subscriptions.id, id))
        .returning();
      return updated;
    }

    async assignPlanToUser(userId: string, planId: string): Promise<Subscription> {
      const existing = await this.getSubscriptionByUserId(userId);
      if (existing) {
        const [updated] = await db
          .update(subscriptions)
          .set({ planId, cycleStart: new Date(), tokensUsedThisCycle: 0, updatedAt: new Date() })
          .where(eq(subscriptions.id, existing.id))
          .returning();
        return updated;
      }
      return this.createSubscription({
        userId,
        planId,
        cycleStart: new Date(),
        tokensUsedThisCycle: 0,
        status: "active",
      });
    }

    async assignPlanToOrg(orgId: string, planId: string): Promise<Subscription> {
      const existing = await this.getSubscriptionByOrgId(orgId);
      if (existing) {
        const [updated] = await db
          .update(subscriptions)
          .set({ planId, cycleStart: new Date(), tokensUsedThisCycle: 0, updatedAt: new Date() })
          .where(eq(subscriptions.id, existing.id))
          .returning();
        return updated;
      }
      return this.createSubscription({
        orgId,
        planId,
        cycleStart: new Date(),
        tokensUsedThisCycle: 0,
        status: "active",
      });
    }

    async getOrCreateOrgSubscription(orgId: string): Promise<{ subscription: Subscription; plan: Plan }> {
      let sub = await this.getSubscriptionByOrgId(orgId);
      if (!sub) {
        const starterPlan = await this.getPlanByName("Starter");
        if (!starterPlan) throw new Error("Default Starter plan not found. Run seedDefaultPlans first.");
        sub = await this.createSubscription({
          orgId,
          planId: starterPlan.id,
          cycleStart: new Date(),
          tokensUsedThisCycle: 0,
          status: "active",
        });
      }
      const plan = await this.getPlan(sub.planId);
      if (!plan) throw new Error(`Plan ${sub.planId} not found`);
      const now = new Date();
      const cycleStart = new Date(sub.cycleStart);
      const msInMonth = 30 * 24 * 60 * 60 * 1000;
      if (now.getTime() - cycleStart.getTime() >= msInMonth) {
        await db.update(subscriptions).set({ cycleStart: new Date(), tokensUsedThisCycle: 0, updatedAt: new Date() }).where(eq(subscriptions.orgId, orgId));
        const refreshed = await this.getSubscriptionByOrgId(orgId);
        return { subscription: refreshed!, plan };
      }
      return { subscription: sub, plan };
    }

    async getOrgMonthlySpend(orgId: string): Promise<{ tokensUsed: number; estimatedCostUsd: number }> {
      const sub = await this.getSubscriptionByOrgId(orgId);
      if (!sub) return { tokensUsed: 0, estimatedCostUsd: 0 };
      const tokensUsed = sub.tokensUsedThisCycle;
      const costPerToken = 0.30 / 1_000_000;
      return { tokensUsed, estimatedCostUsd: Math.round(tokensUsed * costPerToken * 10000) / 10000 };
    }

    async incrementSubscriptionUsage(userId: string, tokens: number): Promise<void> {
      if (tokens <= 0) return;
      // Ensure subscription row exists before incrementing (get-or-create)
      const existing = await this.getSubscriptionByUserId(userId);
      if (!existing) {
        await this.getOrCreateSubscription(userId);
      }
      await db
        .update(subscriptions)
        .set({
          tokensUsedThisCycle: sql`${subscriptions.tokensUsedThisCycle} + ${tokens}`,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
    }

    async resetSubscriptionCycle(userId: string): Promise<void> {
      await db
        .update(subscriptions)
        .set({ cycleStart: new Date(), tokensUsedThisCycle: 0, updatedAt: new Date() })
        .where(eq(subscriptions.userId, userId));
    }

    async getOrCreateSubscription(userId: string): Promise<{ subscription: Subscription; plan: Plan }> {
      let sub = await this.getSubscriptionByUserId(userId);

      if (!sub) {
        const starterPlan = await this.getPlanByName("Starter");
        if (!starterPlan) {
          throw new Error("Default Starter plan not found. Run seedDefaultPlans first.");
        }
        sub = await this.createSubscription({
          userId,
          planId: starterPlan.id,
          cycleStart: new Date(),
          tokensUsedThisCycle: 0,
          status: "active",
        });
      }

      const plan = await this.getPlan(sub.planId);
      if (!plan) throw new Error(`Plan ${sub.planId} not found`);

      const now = new Date();
      const cycleStart = new Date(sub.cycleStart);
      const msInMonth = 30 * 24 * 60 * 60 * 1000;
      if (now.getTime() - cycleStart.getTime() >= msInMonth) {
        await this.resetSubscriptionCycle(userId);
        const refreshed = await this.getSubscriptionByUserId(userId);
        return { subscription: refreshed!, plan };
      }

      return { subscription: sub, plan };
    }

    async logUsageAndIncrementSubscription(log: InsertAiUsageLog): Promise<AiUsageLog> {
      const userId = log.userId;
      const tokens = (log.totalTokens || 0);
      // Ensure subscription row exists BEFORE entering the transaction so the increment never silently drops
      if (userId && tokens > 0) {
        await this.getOrCreateSubscription(userId);
      }
      return await db.transaction(async (tx) => {
        const [inserted] = await tx.insert(aiUsageLogs).values(log as any).returning();
        if (userId && tokens > 0) {
          await tx
            .update(subscriptions)
            .set({
              tokensUsedThisCycle: sql`${subscriptions.tokensUsedThisCycle} + ${tokens}`,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, userId));
        }
        return inserted;
      });
    }

    async seedDefaultPlans(): Promise<void> {
      const { DEFAULT_PLANS } = await import("@shared/schema");
      for (const p of DEFAULT_PLANS) {
        const existing = await this.getPlanByName(p.name);
        if (!existing) {
          await this.createPlan({
            name: p.name,
            tokenQuotaMonthly: p.tokenQuotaMonthly,
            priceUsdMonthly: p.priceUsdMonthly,
            features: p.features as Record<string, any>,
            isActive: true,
          });
          console.log(`[billing] Seeded plan: ${p.name}`);
        }
      }
    }
  };
}

export class MemBillingStorage implements IBillingStorage {
  private _plans: Plan[] = [];
  private _subs: Subscription[] = [];

  async getAllPlans(): Promise<Plan[]> { return this._plans; }
  async getActivePlans(): Promise<Plan[]> { return this._plans.filter(p => p.isActive); }
  async getPlan(id: string): Promise<Plan | undefined> { return this._plans.find(p => p.id === id); }
  async getPlanByName(name: string): Promise<Plan | undefined> { return this._plans.find(p => p.name === name); }
  async createPlan(plan: InsertPlan): Promise<Plan> {
    const p: Plan = { id: Math.random().toString(36).slice(2), ...plan, features: (plan.features as Record<string, any>) ?? {}, priceUsdMonthly: plan.priceUsdMonthly ?? 0, isActive: plan.isActive ?? true, createdAt: new Date(), updatedAt: new Date() };
    this._plans.push(p);
    return p;
  }
  async updatePlan(id: string, updates: Partial<InsertPlan>): Promise<Plan> {
    const idx = this._plans.findIndex(p => p.id === id);
    this._plans[idx] = { ...this._plans[idx], ...updates, updatedAt: new Date() };
    return this._plans[idx];
  }
  async getSubscriptionByUserId(userId: string): Promise<Subscription | undefined> { return this._subs.find(s => s.userId === userId); }
  async getSubscriptionByOrgId(orgId: string): Promise<Subscription | undefined> { return this._subs.find(s => s.orgId === orgId); }
  async getSubscriptionById(id: string): Promise<Subscription | undefined> { return this._subs.find(s => s.id === id); }
  async getAllSubscriptions(): Promise<(Subscription & { plan: Plan | null })[]> {
    return this._subs.map(s => ({ ...s, plan: this._plans.find(p => p.id === s.planId) ?? null }));
  }
  async createSubscription(sub: InsertSubscription): Promise<Subscription> {
    const s: Subscription = { id: Math.random().toString(36).slice(2), ...sub, userId: sub.userId ?? null, orgId: sub.orgId ?? null, cycleStart: sub.cycleStart ?? new Date(), tokensUsedThisCycle: sub.tokensUsedThisCycle ?? 0, status: sub.status ?? 'active', createdAt: new Date(), updatedAt: new Date() };
    this._subs.push(s);
    return s;
  }
  async updateSubscription(id: string, updates: Partial<InsertSubscription>): Promise<Subscription> {
    const idx = this._subs.findIndex(s => s.id === id);
    this._subs[idx] = { ...this._subs[idx], ...updates, updatedAt: new Date() };
    return this._subs[idx];
  }
  async assignPlanToUser(userId: string, planId: string): Promise<Subscription> {
    const existing = await this.getSubscriptionByUserId(userId);
    if (existing) return this.updateSubscription(existing.id, { planId, cycleStart: new Date(), tokensUsedThisCycle: 0 });
    return this.createSubscription({ userId, planId, cycleStart: new Date(), tokensUsedThisCycle: 0, status: 'active' });
  }
  async assignPlanToOrg(orgId: string, planId: string): Promise<Subscription> {
    const existing = await this.getSubscriptionByOrgId(orgId);
    if (existing) return this.updateSubscription(existing.id, { planId, cycleStart: new Date(), tokensUsedThisCycle: 0 });
    return this.createSubscription({ orgId, planId, cycleStart: new Date(), tokensUsedThisCycle: 0, status: 'active' });
  }
  async incrementSubscriptionUsage(userId: string, tokens: number): Promise<void> {
    const sub = this._subs.find(s => s.userId === userId);
    if (sub) sub.tokensUsedThisCycle += tokens;
  }
  async resetSubscriptionCycle(userId: string): Promise<void> {
    const sub = this._subs.find(s => s.userId === userId);
    if (sub) { sub.cycleStart = new Date(); sub.tokensUsedThisCycle = 0; }
  }
  async getOrCreateSubscription(userId: string): Promise<{ subscription: Subscription; plan: Plan }> {
    let sub = await this.getSubscriptionByUserId(userId);
    if (!sub) {
      const starter = await this.getPlanByName('Starter');
      if (!starter) throw new Error('Starter plan not found');
      sub = await this.createSubscription({ userId, planId: starter.id, cycleStart: new Date(), tokensUsedThisCycle: 0, status: 'active' });
    }
    const plan = await this.getPlan(sub.planId);
    if (!plan) throw new Error('Plan not found');
    return { subscription: sub, plan };
  }
  async getOrCreateOrgSubscription(orgId: string): Promise<{ subscription: Subscription; plan: Plan }> {
    let sub = await this.getSubscriptionByOrgId(orgId);
    if (!sub) {
      const starter = await this.getPlanByName('Starter');
      if (!starter) throw new Error('Starter plan not found');
      sub = await this.createSubscription({ orgId, planId: starter.id, cycleStart: new Date(), tokensUsedThisCycle: 0, status: 'active' });
    }
    const plan = await this.getPlan(sub.planId);
    if (!plan) throw new Error('Plan not found');
    return { subscription: sub, plan };
  }
  async getOrgMonthlySpend(orgId: string): Promise<{ tokensUsed: number; estimatedCostUsd: number }> {
    const sub = this._subs.find(s => s.orgId === orgId);
    if (!sub) return { tokensUsed: 0, estimatedCostUsd: 0 };
    const tokensUsed = sub.tokensUsedThisCycle;
    const costPerToken = 0.30 / 1_000_000;
    return { tokensUsed, estimatedCostUsd: Math.round(tokensUsed * costPerToken * 10000) / 10000 };
  }
  async logUsageAndIncrementSubscription(log: InsertAiUsageLog): Promise<AiUsageLog> {
    const fakeLog = { id: Math.random().toString(36).slice(2), ...log, createdAt: new Date() } as unknown as AiUsageLog;
    const userId = log.userId;
    const tokens = log.totalTokens || 0;
    if (userId && tokens > 0) {
      await this.getOrCreateSubscription(userId);
      const sub = this._subs.find(s => s.userId === userId);
      if (sub) sub.tokensUsedThisCycle += tokens;
    }
    return fakeLog;
  }
  async seedDefaultPlans(): Promise<void> {
    const { DEFAULT_PLANS } = await import('@shared/schema');
    for (const p of DEFAULT_PLANS) {
      if (!this._plans.find(x => x.name === p.name)) {
        await this.createPlan({ name: p.name, tokenQuotaMonthly: p.tokenQuotaMonthly, priceUsdMonthly: p.priceUsdMonthly, features: p.features as Record<string, any>, isActive: true });
      }
    }
  }
}
