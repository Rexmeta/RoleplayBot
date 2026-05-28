import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { UNLIMITED_QUOTA } from "@shared/schema";

export async function checkTokenQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      next();
      return;
    }

    const { subscription, plan } = await storage.getOrCreateSubscription(userId);

    if (plan.tokenQuotaMonthly === UNLIMITED_QUOTA) {
      next();
      return;
    }

    if (subscription.tokensUsedThisCycle >= plan.tokenQuotaMonthly) {
      res.status(402).json({
        error: "quota_exceeded",
        plan: plan.name,
        used: subscription.tokensUsedThisCycle,
        limit: plan.tokenQuotaMonthly,
        message: `Monthly token quota of ${(plan.tokenQuotaMonthly / 1_000_000).toFixed(1)}M tokens exhausted. Please upgrade your plan.`,
      });
      return;
    }

    next();
  } catch (err) {
    console.error("[tokenQuotaMiddleware] Error checking quota:", err);
    next();
  }
}
