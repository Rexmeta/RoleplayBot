import { Router } from "express";
import { storage } from "../storage";
import { generateAIResponse } from "../services/geminiService";
import { buildFreeChatPersona, buildFreeChatScenario } from "./routerHelpers";

export default function createFreeChatRouter(isAuthenticated: any) {
  const router = Router();

  /** GET /api/free-chat/personas — 자유 대화 가능한 MBTI 페르소나 목록 (시스템 관리자 전용) */
  router.get("/api/free-chat/personas", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const personas = await storage.getFreeChatPersonas();
      res.json(personas);
    } catch (error: any) {
      console.error("Free chat personas fetch error:", error);
      res.status(500).json({ error: "Failed to fetch free chat personas" });
    }
  });

  /** POST /api/free-chat/start — 자유 대화 시작 (시스템 관리자 전용) */
  router.post("/api/free-chat/start", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      // @ts-ignore
      const userId = req.user?.id;
      const { personaId, mode = "text", difficulty = 2, gender } = req.body;

      if (!personaId) return res.status(400).json({ error: "personaId is required" });

      const mbtiPersona = await storage.getMbtiPersona(personaId);
      if (!mbtiPersona) return res.status(404).json({ error: "Persona not found" });
      if (!mbtiPersona.freeChatAvailable) return res.status(403).json({ error: "This persona is not available for free chat" });

      const user = await storage.getUser(userId);

      // ScenarioRun 생성 (__free_chat__ 센티넬 값)
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

      // PersonaSnapshot 구성 (ChatWindow 이미지 렌더링에 필요한 필드 포함)
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

      // PersonaRun 생성
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

      // 실시간 음성 모드는 WebSocket 연결 후 첫 메시지 수신
      if (mode === "realtime_voice") {
        return res.json({ ...responseBase, messages: [] });
      }

      // 텍스트/TTS: 첫 AI 인사말 생성
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
    } catch (error: any) {
      console.error("Free chat start error:", error);
      res.status(500).json({ error: error.message || "Failed to start free chat" });
    }
  });

  return router;
}
