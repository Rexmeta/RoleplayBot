import { Router } from "express";
import { storage } from "../storage";
import { isSystemAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { UNLIMITED_QUOTA } from "@shared/schema";

export default function createSubscriptionsRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/plans", isAuthenticated, asyncHandler(async (req, res) => {
    const activePlans = await storage.getActivePlans();
    res.json(activePlans);
  }));

  router.get("/my", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) throw createHttpError(401, "Not authenticated");

    const { subscription, plan } = await storage.getOrCreateSubscription(userId);

    const isUnlimited = plan.tokenQuotaMonthly === UNLIMITED_QUOTA;
    const used = subscription.tokensUsedThisCycle;
    const quota = plan.tokenQuotaMonthly;
    const percentUsed = isUnlimited ? 0 : Math.min(100, Math.round((used / quota) * 100));

    const costPerToken = 0.30 / 1_000_000;
    const estimatedCostUsd = used * costPerToken;

    res.json({
      subscription: {
        id: subscription.id,
        planId: subscription.planId,
        cycleStart: subscription.cycleStart,
        tokensUsedThisCycle: used,
        status: subscription.status,
      },
      plan: {
        id: plan.id,
        name: plan.name,
        tokenQuotaMonthly: quota,
        priceUsdMonthly: plan.priceUsdMonthly,
        features: plan.features,
      },
      usage: {
        used,
        quota,
        isUnlimited,
        percentUsed,
        estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
        cycleStart: subscription.cycleStart,
      },
    });
  }));

  router.get("/", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const allSubs = await storage.getAllSubscriptions();

    const allUsers = await storage.getAllUsers();
    const userMap = new Map(allUsers.map(u => [u.id, { id: u.id, email: u.email, name: u.name }]));

    const allOrgs: any[] = typeof (storage as any).getAllOrganizations === 'function'
      ? await (storage as any).getAllOrganizations()
      : [];
    const orgMap = new Map(allOrgs.map((o: any) => [o.id, { id: o.id, name: o.name }]));

    const costPerToken = 0.30 / 1_000_000;

    const result = allSubs.map(sub => {
      const plan = sub.plan;
      const isUnlimited = plan?.tokenQuotaMonthly === UNLIMITED_QUOTA;
      const used = sub.tokensUsedThisCycle;
      const quota = plan?.tokenQuotaMonthly ?? 0;
      const percentUsed = isUnlimited ? 0 : quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
      const estimatedCostUsd = Math.round(used * costPerToken * 10000) / 10000;

      const isOrgSub = !!sub.orgId && !sub.userId;
      const subscriber = isOrgSub
        ? { id: sub.orgId!, email: "", name: orgMap.get(sub.orgId!)?.name ?? `Org ${sub.orgId}`, isOrg: true }
        : { ...(userMap.get(sub.userId!) ?? { id: sub.userId ?? "", email: "Unknown", name: "Unknown" }), isOrg: false };

      return {
        id: sub.id,
        user: subscriber,
        orgId: sub.orgId ?? null,
        userId: sub.userId ?? null,
        isOrgSubscription: isOrgSub,
        plan: plan ? { id: plan.id, name: plan.name, tokenQuotaMonthly: plan.tokenQuotaMonthly, priceUsdMonthly: plan.priceUsdMonthly } : null,
        cycleStart: sub.cycleStart,
        status: sub.status,
        usage: { used, quota, isUnlimited, percentUsed, estimatedCostUsd },
      };
    });

    res.json(result);
  }));

  router.patch("/:id/plan", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { planId } = req.body;

    if (!planId) throw createHttpError(400, "planId is required");

    const plan = await storage.getPlan(planId);
    if (!plan) throw createHttpError(404, "Plan not found");

    const sub = await storage.getSubscriptionById(id);
    if (!sub) throw createHttpError(404, "Subscription not found");

    const updated = await storage.updateSubscription(id, { planId, cycleStart: new Date(), tokensUsedThisCycle: 0 });

    res.json(updated);
  }));

  router.post("/assign", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { userId, planId } = req.body;

    if (!userId) throw createHttpError(400, "userId is required");
    if (!planId) throw createHttpError(400, "planId is required");

    const plan = await storage.getPlan(planId);
    if (!plan) throw createHttpError(404, "Plan not found");

    const sub = await storage.assignPlanToUser(userId, planId);
    res.json(sub);
  }));

  router.post("/assign-org", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { orgId, planId } = req.body;

    if (!orgId) throw createHttpError(400, "orgId is required");
    if (!planId) throw createHttpError(400, "planId is required");

    const plan = await storage.getPlan(planId);
    if (!plan) throw createHttpError(404, "Plan not found");

    const sub = await storage.assignPlanToOrg(orgId, planId);
    res.json(sub);
  }));

  router.get("/org/:orgId", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    const { subscription, plan } = await storage.getOrCreateOrgSubscription(orgId);
    const spend = await storage.getOrgMonthlySpend(orgId);
    const isUnlimited = plan.tokenQuotaMonthly === UNLIMITED_QUOTA;
    const percentUsed = isUnlimited ? 0 : plan.tokenQuotaMonthly > 0
      ? Math.min(100, Math.round((spend.tokensUsed / plan.tokenQuotaMonthly) * 100)) : 0;

    res.json({
      subscription: { id: subscription.id, planId: subscription.planId, cycleStart: subscription.cycleStart, status: subscription.status },
      plan: { id: plan.id, name: plan.name, tokenQuotaMonthly: plan.tokenQuotaMonthly, priceUsdMonthly: plan.priceUsdMonthly },
      usage: { ...spend, isUnlimited, percentUsed, quota: plan.tokenQuotaMonthly },
    });
  }));

  return router;
}
