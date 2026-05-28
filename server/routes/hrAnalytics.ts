import { Router } from "express";
import { storage } from "../storage";
import { db } from "../storage/db";
import { hrBenchmarkTargets } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { isSystemAdmin, isOperatorOrAdmin } from "../middleware/authMiddleware";

const DEFAULT_TARGET_SCORE = 3.5;

async function checkHrAnalyticsAccess(user: any): Promise<boolean> {
  if (user.role === "admin") return true;
  const orgId = user.organizationId || user.assignedOrganizationId;
  if (!orgId) return false;
  try {
    const { plan } = await storage.getOrCreateOrgSubscription(orgId);
    return !!(plan.features as Record<string, any>)?.hr_analytics;
  } catch {
    return false;
  }
}

async function getOrgUsers(orgId: string) {
  const allUsers = await storage.getAllUsers();
  return allUsers.filter(u => u.organizationId === orgId && u.isActive !== false);
}

async function getOrgBenchmarkTargets(orgId: string): Promise<Record<string, { targetScore: number; dimensionName: string }>> {
  const rows = await db.select().from(hrBenchmarkTargets).where(eq(hrBenchmarkTargets.orgId, orgId));
  const result: Record<string, { targetScore: number; dimensionName: string }> = {};
  for (const row of rows) {
    result[row.dimensionKey] = { targetScore: row.targetScore, dimensionName: row.dimensionName };
  }
  return result;
}

function csvEscape(v: any): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export default function createHrAnalyticsRouter(isAuthenticated: any) {
  const router = Router();

  router.use(isAuthenticated);

  const planGate = asyncHandler(async (req: any, res: any, next: any) => {
    const allowed = await checkHrAnalyticsAccess(req.user);
    if (!allowed) {
      return res.status(403).json({ error: "hr_analytics_not_enabled", message: "This feature requires an Analytics plan." });
    }
    next();
  });

  const hrRoleGate = [isOperatorOrAdmin, planGate];

  router.get("/api/analytics/hr/plan-status", asyncHandler(async (req: any, res) => {
    const user = req.user;
    const allowed = await checkHrAnalyticsAccess(user);
    const isAuthorized = user.role === "admin" || user.role === "operator";
    const orgId = user.organizationId || user.assignedOrganizationId;
    let planName = "Starter";
    if (orgId) {
      try {
        const { plan } = await storage.getOrCreateOrgSubscription(orgId);
        planName = plan.name;
      } catch {}
    }
    res.json({ enabled: allowed, planName, orgId, userRole: user.role, isAuthorized });
  }));

  router.get("/api/analytics/hr/team-competency", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = (user.role === "admin" ? req.query.orgId : null) || user.organizationId || user.assignedOrganizationId;
    if (!orgId) return res.json({ members: [], dimensions: [] });

    const orgUsers = await getOrgUsers(orgId);
    const memberData: any[] = [];
    const dimensionSet: Record<string, string> = {};

    for (const member of orgUsers) {
      const feedbacks = await storage.getUserFeedbacks(member.id);
      const validFeedbacks = feedbacks.filter(f =>
        f.reportStatus !== "insufficient_data" &&
        !((f.detailedFeedback as any)?.reportStatus === "insufficient_data")
      );

      const dimensionTotals: Record<string, { total: number; count: number; name: string }> = {};
      for (const fb of validFeedbacks) {
        const scores = fb.scores as any[];
        if (!Array.isArray(scores)) continue;
        for (const s of scores) {
          const key = s.category;
          if (!dimensionTotals[key]) {
            dimensionTotals[key] = { total: 0, count: 0, name: s.name || key };
            dimensionSet[key] = s.name || key;
          }
          dimensionTotals[key].total += s.score || 0;
          dimensionTotals[key].count += 1;
        }
      }

      const dimensionAverages: Record<string, number | null> = {};
      for (const [key, stats] of Object.entries(dimensionTotals)) {
        dimensionAverages[key] = stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : null;
      }

      memberData.push({
        userId: member.id,
        name: member.name,
        email: member.email,
        profileImage: member.profileImage,
        sessionCount: validFeedbacks.length,
        dimensionAverages,
        overallAverage: validFeedbacks.filter(f => f.overallScore != null).length > 0
          ? Number((validFeedbacks.filter(f => f.overallScore != null).reduce((a, f) => a + (f.overallScore ?? 0), 0) / validFeedbacks.filter(f => f.overallScore != null).length).toFixed(1))
          : null,
      });
    }

    const dimensions = Object.entries(dimensionSet).map(([key, name]) => ({ key, name }));
    res.json({ members: memberData, dimensions, orgId });
  }));

  router.get("/api/analytics/hr/member-feedbacks", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = (user.role === "admin" ? req.query.orgId : null) || user.organizationId || user.assignedOrganizationId;
    const { userId, dimensionKey } = req.query;
    if (!orgId || !userId) return res.json({ sessions: [] });

    const orgUsers = await getOrgUsers(orgId);
    const isMember = orgUsers.some(u => u.id === userId);
    if (!isMember) return res.status(403).json({ error: "User not in org" });

    const feedbacks = await storage.getUserFeedbacks(userId as string);
    const validFeedbacks = feedbacks
      .filter(f =>
        f.reportStatus !== "insufficient_data" &&
        !((f.detailedFeedback as any)?.reportStatus === "insufficient_data")
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const sessions = validFeedbacks.map(fb => {
      const detailedFb = fb.detailedFeedback as any;
      const scores = fb.scores as any[];
      let dimensionScore: number | null = null;
      if (dimensionKey && Array.isArray(scores)) {
        const found = scores.find((s: any) => s.category === dimensionKey);
        dimensionScore = found?.score ?? null;
      }
      return {
        personaRunId: fb.personaRunId,
        date: fb.createdAt,
        overallScore: fb.overallScore,
        dimensionScore,
        scenarioName: detailedFb?.scenarioName || "",
        categoryName: detailedFb?.scenarioCategoryName || "",
        strengths: detailedFb?.strengths || [],
        improvements: detailedFb?.improvements || [],
      };
    });

    res.json({ sessions });
  }));

  router.get("/api/analytics/hr/skill-gap", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = (user.role === "admin" ? req.query.orgId : null) || user.organizationId || user.assignedOrganizationId;
    if (!orgId) return res.json({ radarData: [], benchmarkTargets: {} });

    const orgUsers = await getOrgUsers(orgId);
    const benchmarkTargets = await getOrgBenchmarkTargets(orgId);

    const dimensionTotals: Record<string, { total: number; count: number; name: string }> = {};
    const dimensionCategories: Record<string, Set<string>> = {};

    for (const member of orgUsers) {
      const feedbacks = await storage.getUserFeedbacks(member.id);
      const validFeedbacks = feedbacks.filter(f =>
        f.reportStatus !== "insufficient_data" &&
        !((f.detailedFeedback as any)?.reportStatus === "insufficient_data")
      );
      for (const fb of validFeedbacks) {
        const scores = fb.scores as any[];
        if (!Array.isArray(scores)) continue;
        const catName = (fb.detailedFeedback as any)?.scenarioCategoryName || "";
        for (const s of scores) {
          const key = s.category;
          if (!dimensionTotals[key]) {
            dimensionTotals[key] = { total: 0, count: 0, name: s.name || key };
            dimensionCategories[key] = new Set();
          }
          dimensionTotals[key].total += s.score || 0;
          dimensionTotals[key].count += 1;
          if (catName) dimensionCategories[key].add(catName);
        }
      }
    }

    const radarData = Object.entries(dimensionTotals).map(([key, stats]) => {
      const avg = stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0;
      const target = benchmarkTargets[key]?.targetScore ?? DEFAULT_TARGET_SCORE;
      const gap = Number((avg - target).toFixed(2));
      const suggestedCategories = gap < 0
        ? Array.from(dimensionCategories[key] || []).slice(0, 3)
        : [];
      return {
        dimension: key,
        name: stats.name,
        teamAverage: avg,
        target,
        gap,
        suggestedCategories,
      };
    }).sort((a, b) => a.gap - b.gap);

    res.json({ radarData, benchmarkTargets });
  }));

  router.get("/api/analytics/hr/growth-trend", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = (user.role === "admin" ? req.query.orgId : null) || user.organizationId || user.assignedOrganizationId;
    const { startDate, endDate, categoryName } = req.query;
    if (!orgId) return res.json({ trend: [], allCategories: [] });

    const orgUsers = await getOrgUsers(orgId);
    const monthlyScores: Record<string, Record<string, { total: number; count: number }>> = {};
    const allCategorySet = new Set<string>();

    for (const member of orgUsers) {
      const feedbacks = await storage.getUserFeedbacks(member.id);
      const validFeedbacks = feedbacks.filter(f => {
        if (f.reportStatus === "insufficient_data") return false;
        if ((f.detailedFeedback as any)?.reportStatus === "insufficient_data") return false;
        if (f.overallScore == null) return false;
        const date = new Date(f.createdAt);
        if (startDate && date < new Date(startDate as string)) return false;
        if (endDate && date > new Date(endDate as string)) return false;
        return true;
      });

      for (const fb of validFeedbacks) {
        const date = new Date(fb.createdAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const detailedFb = fb.detailedFeedback as any;
        const cat = detailedFb?.scenarioCategoryName || "General";
        allCategorySet.add(cat);

        if (categoryName && cat !== categoryName) continue;

        if (!monthlyScores[monthKey]) monthlyScores[monthKey] = {};
        if (!monthlyScores[monthKey][cat]) monthlyScores[monthKey][cat] = { total: 0, count: 0 };
        monthlyScores[monthKey][cat].total += fb.overallScore ?? 0;
        monthlyScores[monthKey][cat].count += 1;
      }
    }

    const trend = Object.entries(monthlyScores)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, cats]) => {
        const categories: Record<string, number> = {};
        let totalAll = 0, countAll = 0;
        for (const [cat, stats] of Object.entries(cats)) {
          categories[cat] = Number((stats.total / stats.count).toFixed(1));
          totalAll += stats.total;
          countAll += stats.count;
        }
        return {
          month,
          average: countAll > 0 ? Number((totalAll / countAll).toFixed(1)) : 0,
          categories,
        };
      });

    res.json({ trend, allCategories: Array.from(allCategorySet).sort() });
  }));

  router.get("/api/analytics/hr/at-risk", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = (user.role === "admin" ? req.query.orgId : null) || user.organizationId || user.assignedOrganizationId;
    const threshold = parseFloat((req.query.threshold as string) || "60");
    const lookbackN = parseInt((req.query.lookback as string) || "5");
    if (!orgId) return res.json({ atRisk: [], highPerformers: [] });

    const orgUsers = await getOrgUsers(orgId);
    const memberStats: any[] = [];

    for (const member of orgUsers) {
      const feedbacks = await storage.getUserFeedbacks(member.id);
      const validFeedbacks = feedbacks.filter(f =>
        f.reportStatus !== "insufficient_data" &&
        !((f.detailedFeedback as any)?.reportStatus === "insufficient_data") &&
        f.overallScore != null
      ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (validFeedbacks.length === 0) continue;

      const recentN = validFeedbacks.slice(0, lookbackN);
      const recentAvg = recentN.reduce((a, f) => a + (f.overallScore ?? 0), 0) / recentN.length;
      const allAvg = validFeedbacks.reduce((a, f) => a + (f.overallScore ?? 0), 0) / validFeedbacks.length;

      let trend: "improving" | "declining" | "stable" = "stable";
      if (validFeedbacks.length >= 3) {
        const half = Math.ceil(validFeedbacks.length / 2);
        const older = validFeedbacks.slice(half).map(f => f.overallScore ?? 0);
        const newer = validFeedbacks.slice(0, half).map(f => f.overallScore ?? 0);
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        const newerAvg = newer.reduce((a, b) => a + b, 0) / newer.length;
        if (newerAvg > olderAvg + 3) trend = "improving";
        else if (newerAvg < olderAvg - 3) trend = "declining";
      }

      const scenarioBreakdown = validFeedbacks.slice(0, 10).map(fb => {
        const detailedFb = fb.detailedFeedback as any;
        return {
          personaRunId: fb.personaRunId,
          date: fb.createdAt,
          score: fb.overallScore,
          strengths: detailedFb?.strengths || [],
          improvements: detailedFb?.improvements || [],
          scenarioName: detailedFb?.scenarioName || "",
        };
      });

      memberStats.push({
        userId: member.id,
        name: member.name,
        email: member.email,
        profileImage: member.profileImage,
        recentAverage: Number(recentAvg.toFixed(1)),
        overallAverage: Number(allAvg.toFixed(1)),
        sessionCount: validFeedbacks.length,
        trend,
        scenarioBreakdown,
      });
    }

    const atRisk = memberStats
      .filter(m => m.recentAverage < threshold)
      .sort((a, b) => a.recentAverage - b.recentAverage);

    const highPerformers = memberStats
      .filter(m => m.recentAverage >= threshold)
      .sort((a, b) => b.recentAverage - a.recentAverage);

    res.json({ atRisk, highPerformers });
  }));

  router.get("/api/analytics/hr/benchmark-targets", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = (user.role === "admin" ? req.query.orgId : null) || user.organizationId || user.assignedOrganizationId;
    if (!orgId) return res.json([]);
    const rows = await db.select().from(hrBenchmarkTargets).where(eq(hrBenchmarkTargets.orgId, orgId));
    res.json(rows);
  }));

  router.put("/api/analytics/hr/benchmark-targets", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const orgId = (user.role === "admin" ? req.body.orgId : null) || user.organizationId || user.assignedOrganizationId;
    if (!orgId) throw createHttpError(400, "Organization not found");
    const { targets } = req.body;
    if (!Array.isArray(targets)) throw createHttpError(400, "targets must be an array");

    for (const target of targets) {
      const { dimensionKey, dimensionName, targetScore } = target;
      if (!dimensionKey) continue;
      const existing = await db.select().from(hrBenchmarkTargets)
        .where(and(eq(hrBenchmarkTargets.orgId, orgId), eq(hrBenchmarkTargets.dimensionKey, dimensionKey)));

      if (existing.length > 0) {
        await db.update(hrBenchmarkTargets)
          .set({ targetScore: parseFloat(targetScore), dimensionName: dimensionName || "", updatedAt: new Date() })
          .where(eq(hrBenchmarkTargets.id, existing[0].id));
      } else {
        await db.insert(hrBenchmarkTargets).values({
          orgId,
          dimensionKey,
          dimensionName: dimensionName || "",
          targetScore: parseFloat(targetScore),
        });
      }
    }
    res.json({ success: true });
  }));

  router.get("/api/analytics/hr/export/:type", ...hrRoleGate, asyncHandler(async (req: any, res) => {
    const { type } = req.params;
    const { format: fmt = "csv", startDate, endDate, threshold: thresholdQ, categoryName } = req.query;
    const user = req.user;
    const orgId = (user.role === "admin" ? req.query.orgId : null) || user.organizationId || user.assignedOrganizationId;
    if (!orgId) throw createHttpError(400, "Organization not found");

    const orgUsers = await getOrgUsers(orgId);
    const benchmarkTargets = await getOrgBenchmarkTargets(orgId);

    if (type === "team-competency") {
      const rows: any[] = [];
      const dimensionSet: Record<string, string> = {};

      for (const member of orgUsers) {
        const feedbacks = await storage.getUserFeedbacks(member.id);
        const validFeedbacks = feedbacks.filter(f =>
          f.reportStatus !== "insufficient_data" &&
          !((f.detailedFeedback as any)?.reportStatus === "insufficient_data")
        );
        const dimTotals: Record<string, { total: number; count: number; name: string }> = {};
        for (const fb of validFeedbacks) {
          const scores = fb.scores as any[];
          if (!Array.isArray(scores)) continue;
          for (const s of scores) {
            if (!dimTotals[s.category]) { dimTotals[s.category] = { total: 0, count: 0, name: s.name || s.category }; dimensionSet[s.category] = s.name || s.category; }
            dimTotals[s.category].total += s.score || 0;
            dimTotals[s.category].count += 1;
          }
        }
        const dimensionAverages: Record<string, any> = {};
        for (const [key, stats] of Object.entries(dimTotals)) {
          dimensionAverages[key] = stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : null;
        }
        rows.push({ name: member.name, email: member.email, sessions: validFeedbacks.length, ...dimensionAverages });
      }

      if (fmt === "json") {
        res.setHeader("Content-Disposition", "attachment; filename=team-competency.json");
        res.setHeader("Content-Type", "application/json");
        return res.json(rows);
      }

      const dims = Object.keys(dimensionSet);
      const header = ["Name", "Email", "Sessions", ...dims.map(d => dimensionSet[d])];
      const csvRows = rows.map(r => [r.name, r.email, r.sessions, ...dims.map(d => r[d] ?? "")]);
      const csv = [header, ...csvRows].map(r => r.map(csvEscape).join(",")).join("\n");
      res.setHeader("Content-Disposition", "attachment; filename=team-competency.csv");
      res.setHeader("Content-Type", "text/csv");
      return res.send(csv);
    }

    if (type === "skill-gap") {
      const dimTotals: Record<string, { total: number; count: number; name: string }> = {};
      for (const member of orgUsers) {
        const feedbacks = await storage.getUserFeedbacks(member.id);
        for (const fb of feedbacks.filter(f => f.reportStatus !== "insufficient_data" && !((f.detailedFeedback as any)?.reportStatus === "insufficient_data"))) {
          const scores = fb.scores as any[];
          if (!Array.isArray(scores)) continue;
          for (const s of scores) {
            if (!dimTotals[s.category]) dimTotals[s.category] = { total: 0, count: 0, name: s.name || s.category };
            dimTotals[s.category].total += s.score || 0;
            dimTotals[s.category].count += 1;
          }
        }
      }
      const rows = Object.entries(dimTotals).map(([key, stats]) => {
        const avg = stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0;
        const target = benchmarkTargets[key]?.targetScore ?? DEFAULT_TARGET_SCORE;
        return { dimension: key, name: stats.name, teamAverage: avg, target, gap: Number((avg - target).toFixed(2)) };
      });

      if (fmt === "json") {
        res.setHeader("Content-Disposition", "attachment; filename=skill-gap.json");
        res.setHeader("Content-Type", "application/json");
        return res.json(rows);
      }
      const header = ["Dimension", "Name", "Team Average", "Target", "Gap"];
      const csvRows = rows.map(r => [r.dimension, r.name, r.teamAverage, r.target, r.gap]);
      const csv = [header, ...csvRows].map(r => r.map(csvEscape).join(",")).join("\n");
      res.setHeader("Content-Disposition", "attachment; filename=skill-gap.csv");
      res.setHeader("Content-Type", "text/csv");
      return res.send(csv);
    }

    if (type === "growth-trend") {
      const monthlyScores: Record<string, Record<string, { total: number; count: number }>> = {};
      for (const member of orgUsers) {
        const feedbacks = await storage.getUserFeedbacks(member.id);
        for (const fb of feedbacks.filter(f => {
          if (f.reportStatus === "insufficient_data" || (f.detailedFeedback as any)?.reportStatus === "insufficient_data") return false;
          if (f.overallScore == null) return false;
          const date = new Date(f.createdAt);
          if (startDate && date < new Date(startDate as string)) return false;
          if (endDate && date > new Date(endDate as string)) return false;
          return true;
        })) {
          const date = new Date(fb.createdAt);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
          const detailedFb = fb.detailedFeedback as any;
          const cat = detailedFb?.scenarioCategoryName || "General";
          if (categoryName && cat !== categoryName) continue;
          if (!monthlyScores[monthKey]) monthlyScores[monthKey] = {};
          if (!monthlyScores[monthKey][cat]) monthlyScores[monthKey][cat] = { total: 0, count: 0 };
          monthlyScores[monthKey][cat].total += fb.overallScore ?? 0;
          monthlyScores[monthKey][cat].count += 1;
        }
      }

      const trendRows: any[] = [];
      for (const [month, cats] of Object.entries(monthlyScores).sort(([a], [b]) => a.localeCompare(b))) {
        for (const [cat, stats] of Object.entries(cats)) {
          trendRows.push({ month, category: cat, average: Number((stats.total / stats.count).toFixed(1)) });
        }
      }

      if (fmt === "json") {
        res.setHeader("Content-Disposition", "attachment; filename=growth-trend.json");
        res.setHeader("Content-Type", "application/json");
        return res.json(trendRows);
      }
      const header = ["Month", "Category", "Average Score"];
      const csv = [header, ...trendRows.map(r => [r.month, r.category, r.average])].map(r => r.map(csvEscape).join(",")).join("\n");
      res.setHeader("Content-Disposition", "attachment; filename=growth-trend.csv");
      res.setHeader("Content-Type", "text/csv");
      return res.send(csv);
    }

    if (type === "at-risk") {
      const threshold = parseFloat((thresholdQ as string) || "60");
      const lookbackN = 5;
      const memberStats: any[] = [];

      for (const member of orgUsers) {
        const feedbacks = await storage.getUserFeedbacks(member.id);
        const validFeedbacks = feedbacks.filter(f =>
          f.reportStatus !== "insufficient_data" &&
          !((f.detailedFeedback as any)?.reportStatus === "insufficient_data") &&
          f.overallScore != null
        ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        if (validFeedbacks.length === 0) continue;

        const recentN = validFeedbacks.slice(0, lookbackN);
        const recentAvg = recentN.reduce((a, f) => a + (f.overallScore ?? 0), 0) / recentN.length;
        const allAvg = validFeedbacks.reduce((a, f) => a + (f.overallScore ?? 0), 0) / validFeedbacks.length;
        const classification = recentAvg < threshold ? "at-risk" : "high-performer";
        memberStats.push({
          name: member.name, email: member.email,
          recentAverage: Number(recentAvg.toFixed(1)),
          overallAverage: Number(allAvg.toFixed(1)),
          sessions: validFeedbacks.length,
          classification,
        });
      }

      if (fmt === "json") {
        res.setHeader("Content-Disposition", "attachment; filename=at-risk.json");
        res.setHeader("Content-Type", "application/json");
        return res.json(memberStats);
      }
      const header = ["Name", "Email", "Recent Average", "Overall Average", "Sessions", "Classification"];
      const csv = [header, ...memberStats.map(r => [r.name, r.email, r.recentAverage, r.overallAverage, r.sessions, r.classification])].map(r => r.map(csvEscape).join(",")).join("\n");
      res.setHeader("Content-Disposition", "attachment; filename=at-risk.csv");
      res.setHeader("Content-Type", "text/csv");
      return res.send(csv);
    }

    throw createHttpError(400, "Unknown export type");
  }));

  router.get("/api/analytics/hr/orgs", isSystemAdmin, asyncHandler(async (req: any, res) => {
    const allOrgs = await storage.getAllOrganizations();
    res.json(allOrgs);
  }));

  return router;
}
