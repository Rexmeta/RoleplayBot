import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateStrategyReflectionFeedback } from "../services/geminiService";
import { getOperatorAccessibleCategoryIds, asyncHandler, createHttpError } from "./routerHelpers";

export default function createScenarioRunsRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/feedbacks", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const feedbacks = await storage.getUserFeedbacks(userId);
    res.json(feedbacks);
  }));

  router.get("/api/scenario-runs", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;

    const scenarioRunsWithPersonas = await storage.getUserScenarioRunsWithPersonaRuns(userId);

    const scenarioIds = Array.from(new Set(scenarioRunsWithPersonas.map(sr => sr.scenarioId)));
    const deletedScenarioIds = new Set<string>();
    for (const scenarioId of scenarioIds) {
      const scenario = await storage.getScenario(scenarioId);
      if (!scenario || scenario.isDeleted) {
        deletedScenarioIds.add(scenarioId);
      }
    }

    const enrichedRuns = scenarioRunsWithPersonas.map(sr => ({
      ...sr,
      isScenarioDeleted: deletedScenarioIds.has(sr.scenarioId),
    }));

    console.log(`📊 Scenario runs for user ${userId}:`, enrichedRuns.map(sr => ({
      id: sr.id,
      scenarioId: sr.scenarioId,
      status: sr.status,
      isScenarioDeleted: sr.isScenarioDeleted,
      personaRunsCount: sr.personaRuns?.length || 0,
      personaRuns: sr.personaRuns?.map(pr => ({ id: pr.id, personaId: pr.personaId, status: pr.status, score: pr.score }))
    })));
    res.json(enrichedRuns);
  }));

  router.get("/api/scenario-runs/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const scenarioRun = await storage.getScenarioRunWithPersonaRuns(req.params.id);

    if (!scenarioRun) {
      throw createHttpError(404, "Scenario run not found");
    }

    if (scenarioRun.userId !== userId) {
      throw createHttpError(403, "Unauthorized");
    }

    res.json(scenarioRun);
  }));

  router.post("/api/scenario-runs/:id/complete", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { id } = req.params;

    const scenarioRun = await storage.getScenarioRun(id);
    if (!scenarioRun) {
      throw createHttpError(404, "Scenario run not found");
    }

    if (scenarioRun.userId !== userId) {
      throw createHttpError(403, "Unauthorized");
    }

    const updated = await storage.updateScenarioRun(id, {
      status: 'completed',
      completedAt: new Date()
    });

    res.json({ success: true, scenarioRun: updated });
  }));

  router.post("/api/scenario-runs/:id/strategy-reflection", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { id } = req.params;
    const { strategyReflection, conversationOrder } = req.body;

    if (!strategyReflection || typeof strategyReflection !== 'string') {
      throw createHttpError(400, "Strategy reflection text is required");
    }

    if (!Array.isArray(conversationOrder)) {
      throw createHttpError(400, "Conversation order must be an array");
    }

    const scenarioRun = await storage.getScenarioRun(id);
    if (!scenarioRun) {
      throw createHttpError(404, "Scenario run not found");
    }

    if (scenarioRun.userId !== userId) {
      throw createHttpError(403, "Unauthorized");
    }

    const scenarios = await fileManager.getAllScenarios();
    const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);

    let sequenceAnalysis = null;

    const strategyUser = await storage.getUser(userId);
    const strategyUserLanguage = (strategyUser?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';

    if (scenario) {
      const evaluation = await generateStrategyReflectionFeedback(
        strategyReflection,
        conversationOrder,
        {
          title: scenario.title,
          context: scenario.context?.situation || scenario.description || '',
          objectives: scenario.objectives || [],
          personas: (scenario.personas || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            department: p.department || ''
          }))
        },
        strategyUserLanguage
      );

      sequenceAnalysis = {
        strategicScore: evaluation.strategicScore,
        strategicRationale: evaluation.strategicRationale,
        sequenceEffectiveness: evaluation.sequenceEffectiveness,
        alternativeApproaches: evaluation.alternativeApproaches,
        strategicInsights: evaluation.strategicInsights,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements
      };
    }

    const updated = await storage.updateScenarioRun(id, {
      strategyReflection,
      conversationOrder,
      sequenceAnalysis,
      status: 'completed',
      completedAt: new Date()
    });

    res.json({ success: true, scenarioRun: updated, sequenceAnalysis });
  }));

  router.get("/api/scenario-runs/:id/persona-runs", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const scenarioRun = await storage.getScenarioRun(req.params.id);

    if (!scenarioRun) {
      throw createHttpError(404, "Scenario run not found");
    }

    if (scenarioRun.userId !== userId) {
      throw createHttpError(403, "Unauthorized");
    }

    const personaRuns = await storage.getPersonaRunsByScenarioRun(req.params.id);
    res.json(personaRuns);
  }));

  router.get("/api/dashboard/summary", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const userId = user?.id;
    if (!userId) {
      throw createHttpError(401, "Unauthorized");
    }

    const allFileScenarios = await fileManager.getAllScenarios();
    let accessibleScenarioIds: string[] | null = null;

    const isGuestAccount = user.email === 'guest@mothle.com';
    if (isGuestAccount) {
      accessibleScenarioIds = allFileScenarios
        .filter((s: any) => s.isDemo === true)
        .map((s: any) => s.id);
    } else if (user.role !== 'admin') {
      const userWithAssignments = user as any;
      if (user.role === 'operator') {
        const opCategoryIds = await getOperatorAccessibleCategoryIds(user);
        if (opCategoryIds.length > 0) {
          accessibleScenarioIds = allFileScenarios
            .filter((s: any) => opCategoryIds.includes(String(s.categoryId)))
            .map((s: any) => s.id);
        } else {
          accessibleScenarioIds = [];
        }
      } else {
        let categoryIds: string[] = [];
        if (userWithAssignments.assignedCategoryId) {
          categoryIds.push(userWithAssignments.assignedCategoryId);
        }
        if (userWithAssignments.organizationId || userWithAssignments.companyId) {
          const allCategories = await storage.getAllCategories();
          for (const cat of allCategories) {
            const catAny = cat as any;
            if (userWithAssignments.organizationId && catAny.organizationId === userWithAssignments.organizationId) {
              if (!categoryIds.includes(cat.id)) categoryIds.push(cat.id);
            } else if (userWithAssignments.companyId && catAny.companyId === userWithAssignments.companyId) {
              if (!categoryIds.includes(cat.id)) categoryIds.push(cat.id);
            }
          }
        }
        if (categoryIds.length > 0) {
          accessibleScenarioIds = allFileScenarios
            .filter((s: any) => categoryIds.includes(String(s.categoryId)))
            .map((s: any) => s.id);
        }
      }
    }

    const summary = await storage.getDashboardSummary(userId, accessibleScenarioIds);
    res.json(summary);
  }));

  router.get("/api/persona-runs/:id/messages", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRun = await storage.getPersonaRun(req.params.id);

    if (!personaRun) {
      throw createHttpError(404, "Persona run not found");
    }

    const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
    if (!scenarioRun || scenarioRun.userId !== userId) {
      throw createHttpError(403, "Unauthorized");
    }

    const messages = await storage.getChatMessagesByPersonaRun(req.params.id);
    res.json(messages);
  }));

  router.delete("/api/scenario-runs/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const scenarioRun = await storage.getScenarioRun(req.params.id);

    if (!scenarioRun) {
      throw createHttpError(404, "Scenario run not found");
    }

    if (scenarioRun.userId !== userId) {
      throw createHttpError(403, "Unauthorized");
    }

    await storage.deleteScenarioRun(req.params.id);
    res.json({ success: true });
  }));

  return router;
}
