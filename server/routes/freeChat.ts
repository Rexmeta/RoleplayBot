import { Router } from "express";
import { storage } from "../storage";
import { generateAIResponse } from "../services/geminiService";
import { buildFreeChatPersona, buildFreeChatScenario, asyncHandler, createHttpError } from "./routerHelpers";

export default function createFreeChatRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/free-chat/personas", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const personas = await storage.getFreeChatPersonas();
    res.json(personas);
  }));

  router.post("/api/free-chat/start", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const userId = req.user?.id;
    const { personaId, mode = "text", difficulty = 2, gender } = req.body;

    if (!personaId) throw createHttpError(400, "personaId is required");

    const mbtiPersona = await storage.getMbtiPersona(personaId);
    if (!mbtiPersona) throw createHttpError(404, "Persona not found");
    if (!mbtiPersona.freeChatAvailable) throw createHttpError(403, "This persona is not available for free chat");

    const user = await storage.getUser(userId);

    const existingRuns = await storage.getUserScenarioRuns(userId);
    const freeChatAttempts = existingRuns.filter(r => r.scenarioId === "__free_chat__").length;
    const scenarioRun = await storage.createScenarioRun({
      userId,
      scenarioId: "__free_chat__",
      scenarioName: `자유 대화 - ${mbtiPersona.mbti}`,
      attemptNumber: freeChatAttempts + 1,
      mode,
      difficulty,
      status: "active"
    });

    const effectiveGender = gender || mbtiPersona.gender || "male";
    const personaSnapshot = {
      id: mbtiPersona.id,
      name: mbtiPersona.mbti,
      mbti: mbtiPersona.mbti,
      gender: effectiveGender,
      images: mbtiPersona.images,
      freeChatDescription: mbtiPersona.freeChatDescription,
      communicationStyle: mbtiPersona.communicationStyle,
      personalityTraits: mbtiPersona.personalityTraits,
      motivation: mbtiPersona.motivation,
      background: mbtiPersona.background,
      communicationPatterns: mbtiPersona.communicationPatterns,
    };

    const personaRun = await storage.createPersonaRun({
      scenarioRunId: scenarioRun.id,
      personaId: mbtiPersona.id,
      personaName: mbtiPersona.mbti,
      personaSnapshot,
      mbtiType: mbtiPersona.id,
      phase: 1,
      mode,
      difficulty,
      status: "active"
    });

    const responseBase = {
      id: personaRun.id,
      scenarioRunId: scenarioRun.id,
      scenarioId: "__free_chat__",
      scenarioName: `자유 대화 - ${mbtiPersona.mbti}`,
      personaId: mbtiPersona.id,
      personaSnapshot,
      turnCount: 0,
      status: "active",
      mode,
      difficulty,
      userId,
      createdAt: scenarioRun.startedAt,
    };

    if (mode === "realtime_voice") {
      return res.json({ ...responseBase, messages: [] });
    }

    const persona = buildFreeChatPersona(mbtiPersona);
    const freeChatScenario = buildFreeChatScenario(mbtiPersona, difficulty);
    const userLanguage = (user?.preferredLanguage as "ko" | "en" | "ja" | "zh") || "ko";

    const aiResult = await Promise.race([
      generateAIResponse(freeChatScenario as any, [], persona, undefined, userLanguage),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI 응답 시간 초과 (25초). 다시 시도해 주세요.')), 25000)
      )
    ]);

    await storage.createChatMessage({
      personaRunId: personaRun.id,
      sender: "ai",
      message: aiResult.content,
      turnIndex: 0,
      emotion: aiResult.emotion || null,
      emotionReason: aiResult.emotionReason || null
    });
    await storage.updatePersonaRun(personaRun.id, { actualStartedAt: new Date() });

    return res.json({
      ...responseBase,
      messages: [{
        sender: "ai",
        message: aiResult.content,
        timestamp: new Date().toISOString(),
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
      }],
    });
  }));

  return router;
}
