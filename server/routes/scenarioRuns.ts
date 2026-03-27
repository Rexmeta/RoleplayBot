import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateStrategyReflectionFeedback } from "../services/geminiService";
import { getOperatorAccessibleCategoryIds } from "./routerHelpers";

export default function createScenarioRunsRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/feedbacks", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      const feedbacks = await storage.getUserFeedbacks(userId);
      res.json(feedbacks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch feedbacks" });
    }
  });

  // 새로운 데이터 구조: Scenario Runs API
  // Get all scenario runs for the current user (with persona runs)
  router.get("/api/scenario-runs", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      // ✨ 개선: personaRuns와 함께 조회하여 프론트엔드에서 추가 쿼리 불필요
      const scenarioRunsWithPersonas = await storage.getUserScenarioRunsWithPersonaRuns(userId);
      
      // 시나리오 삭제 상태 확인하여 추가
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
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scenario runs" });
    }
  });

  // Get scenario run with all persona runs
  router.get("/api/scenario-runs/:id", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const scenarioRun = await storage.getScenarioRunWithPersonaRuns(req.params.id);
      
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      // 권한 확인
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      res.json(scenarioRun);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scenario run" });
    }
  });

  // Complete a scenario run
  router.post("/api/scenario-runs/:id/complete", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      
      const scenarioRun = await storage.getScenarioRun(id);
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      const updated = await storage.updateScenarioRun(id, {
        status: 'completed',
        completedAt: new Date()
      });
      
      res.json({ success: true, scenarioRun: updated });
    } catch (error) {
      console.error("Error completing scenario run:", error);
      res.status(500).json({ error: "Failed to complete scenario run" });
    }
  });

  // Strategy Reflection API for Scenario Runs
  router.post("/api/scenario-runs/:id/strategy-reflection", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const { strategyReflection, conversationOrder } = req.body;
      
      if (!strategyReflection || typeof strategyReflection !== 'string') {
        return res.status(400).json({ error: "Strategy reflection text is required" });
      }
      
      if (!Array.isArray(conversationOrder)) {
        return res.status(400).json({ error: "Conversation order must be an array" });
      }
      
      const scenarioRun = await storage.getScenarioRun(id);
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      // 시나리오 정보 가져오기
      const scenarios = await fileManager.getAllScenarios();
      const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
      
      let sequenceAnalysis = null;
      
      // 사용자 언어 설정 가져오기
      const strategyUser = await storage.getUser(userId);
      const strategyUserLanguage = (strategyUser?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
      
      if (scenario) {
        // AI 평가 생성
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
        
        // sequenceAnalysis 형식으로 변환
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
      
      // 전략 회고 저장과 동시에 scenario_run 완료 처리 (sequenceAnalysis 포함)
      const updated = await storage.updateScenarioRun(id, {
        strategyReflection,
        conversationOrder,
        sequenceAnalysis,
        status: 'completed',
        completedAt: new Date()
      });
      
      res.json({ success: true, scenarioRun: updated, sequenceAnalysis });
    } catch (error) {
      console.error("Error saving strategy reflection:", error);
      res.status(500).json({ error: "Failed to save strategy reflection" });
    }
  });

  // Get persona runs for a scenario run
  router.get("/api/scenario-runs/:id/persona-runs", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const scenarioRun = await storage.getScenarioRun(req.params.id);
      
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      const personaRuns = await storage.getPersonaRunsByScenarioRun(req.params.id);
      res.json(personaRuns);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch persona runs" });
    }
  });

  // 개인화 대시보드 요약 API
  router.get("/api/dashboard/summary", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const user = req.user;
      const userId = user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Compute the same accessible scenario set used by /api/scenarios
      // We load from fileManager to match the same source of truth
      const allFileScenarios = await fileManager.getAllScenarios();
      let accessibleScenarioIds: string[] | null = null;

      const isGuestAccount = user.email === 'guest@mothle.com';
      if (isGuestAccount) {
        // Guest sees only demo scenarios
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
          // If no org/company/category constraints: null = all scenarios
        }
      }
      // admin: null = all scenarios

      const summary = await storage.getDashboardSummary(userId, accessibleScenarioIds);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
    }
  });

  // Get chat messages for a persona run
  router.get("/api/persona-runs/:id/messages", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRun = await storage.getPersonaRun(req.params.id);
      
      if (!personaRun) {
        return res.status(404).json({ error: "Persona run not found" });
      }
      
      // 권한 확인: persona run의 scenario run이 현재 사용자 소유인지 확인
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      if (!scenarioRun || scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      const messages = await storage.getChatMessagesByPersonaRun(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  });

  // Delete scenario run (cascade deletes persona_runs and chat_messages)
  router.delete("/api/scenario-runs/:id", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const scenarioRun = await storage.getScenarioRun(req.params.id);
      
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      await storage.deleteScenarioRun(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scenario run:", error);
      res.status(500).json({ error: "Failed to delete scenario run" });
    }
  });

  return router;
}
