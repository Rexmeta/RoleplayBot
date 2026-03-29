import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateAIResponse } from "../services/geminiService";
import {
  insertConversationSchema,
  insertPersonaSelectionSchema,
  insertStrategyChoiceSchema,
  insertSequenceAnalysisSchema
} from "@shared/schema";
import {
  verifyConversationOwnership,
  verifyPersonaRunOwnership,
  checkAndCompleteScenario,
  buildFreeChatPersona,
  buildFreeChatScenario,
  generateAndSaveFeedback,
  asyncHandler,
  createHttpError
} from "./routerHelpers";

export default function createConversationsRouter(isAuthenticated: any) {
  const router = Router();

  router.post("/", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;

    const user = await storage.getUser(userId);
    if (user && user.email === 'guest@mothle.com') {
      const existingRuns = await storage.getUserScenarioRuns(userId);
      const hasCompletedDemo = existingRuns.some((run: any) => run.status === 'completed');
      if (hasCompletedDemo) {
        throw Object.assign(createHttpError(403, "게스트 계정은 1회만 체험할 수 있습니다. 회원가입 후 계속 이용해주세요."), { errorCode: "GUEST_DEMO_LIMIT_REACHED" });
      }
    }

    const validatedData = insertConversationSchema.parse(req.body);

    const forceNewRun = req.body.forceNewRun === true;

    let scenarioRun;

    if (forceNewRun) {
      console.log(`🆕 forceNewRun=true, 새 Scenario Run 강제 생성`);
      scenarioRun = null;
    } else {
      scenarioRun = await storage.findActiveScenarioRun(userId, validatedData.scenarioId);
    }

    if (scenarioRun) {
      console.log(`♻️ 기존 Scenario Run 재사용: ${scenarioRun.id} (attempt #${scenarioRun.attemptNumber})`);
    } else {
      const existingRuns = await storage.getUserScenarioRuns(userId);
      const sameScenarioRuns = existingRuns.filter(r => r.scenarioId === validatedData.scenarioId);
      const attemptNumber = sameScenarioRuns.length + 1;

      scenarioRun = await storage.createScenarioRun({
        userId,
        scenarioId: validatedData.scenarioId,
        scenarioName: validatedData.scenarioName,
        attemptNumber,
        mode: validatedData.mode,
        difficulty: validatedData.difficulty,
        status: 'active'
      });

      console.log(`📋 새로운 Scenario Run 생성: ${scenarioRun.id} (attempt #${attemptNumber})`);
    }

    const personaId = validatedData.personaId || validatedData.scenarioId;

    const scenarioFromDb = await storage.getScenario(validatedData.scenarioId);
    if (!scenarioFromDb) {
      throw Object.assign(createHttpError(404, "시나리오를 찾을 수 없습니다."), { errorCode: "SCENARIO_NOT_FOUND" });
    }
    if (scenarioFromDb.isDeleted) {
      throw Object.assign(createHttpError(410, "이 시나리오는 삭제되어 더 이상 이용할 수 없습니다."), { errorCode: "SCENARIO_DELETED" });
    }

    const scenarios = await fileManager.getAllScenarios();
    const scenarioObj = scenarios.find(s => s.id === validatedData.scenarioId);
    if (!scenarioObj) {
      throw new Error(`Scenario not found: ${validatedData.scenarioId}`);
    }

    const scenarioPersona = scenarioObj.personas.find((p: any) => p.id === personaId) as any;
    if (!scenarioPersona) {
      throw new Error(`Persona not found in scenario: ${personaId}`);
    }

    const mbtiType = (scenarioPersona as any).mbti || (scenarioPersona as any).personaRef?.replace('.json', '');
    const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

    const existingPersonaRuns = await storage.getPersonaRunsByScenarioRun(scenarioRun.id);
    const phase = existingPersonaRuns.length + 1;

    const personaRun = await storage.createPersonaRun({
      scenarioRunId: scenarioRun.id,
      personaId,
      personaName: (scenarioPersona as any).name,
      personaSnapshot: validatedData.personaSnapshot || {},
      mbtiType: mbtiType || null,
      phase,
      mode: validatedData.mode,
      difficulty: validatedData.difficulty || 2,
      status: 'active'
    });

    console.log(`👤 Persona Run 생성: ${personaRun.id}, mode=${validatedData.mode}`);

    if (validatedData.mode === 'realtime_voice') {
      console.log('🎙️ 실시간 음성 모드 - Gemini 호출 건너뛰기');
      return res.json({
        id: personaRun.id,
        scenarioRunId: scenarioRun.id,
        scenarioId: validatedData.scenarioId,
        scenarioName: validatedData.scenarioName,
        personaId,
        personaSnapshot: validatedData.personaSnapshot,
        messages: [],
        turnCount: 0,
        status: 'active',
        mode: validatedData.mode,
        difficulty: validatedData.difficulty || 2,
        userId,
        createdAt: scenarioRun.startedAt,
        updatedAt: scenarioRun.startedAt
      });
    }

    console.log('💬 텍스트/TTS 모드 - Gemini로 초기 메시지 생성');

    try {
      const scenarioPersonaAny = scenarioPersona as any;
      const mbtiPersonaAny = mbtiPersona as any;
      const persona = {
        id: scenarioPersonaAny.id,
        name: scenarioPersonaAny.name,
        role: scenarioPersonaAny.position,
        department: scenarioPersonaAny.department,
        personality: mbtiPersonaAny?.communication_style || mbtiPersonaAny?.communicationStyle || '균형 잡힌 의사소통',
        responseStyle: mbtiPersonaAny?.communication_patterns?.opening_style || mbtiPersonaAny?.communicationPatterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
        goals: mbtiPersonaAny?.communication_patterns?.win_conditions || mbtiPersonaAny?.communicationPatterns?.win_conditions || ['목표 달성'],
        background: mbtiPersonaAny?.background?.personal_values?.join(', ') || mbtiPersonaAny?.background?.personalValues?.join(', ') || '전문성'
      };

      const scenarioWithUserDifficulty = {
        ...scenarioObj,
        difficulty: validatedData.difficulty || 2
      };

      const user = await storage.getUser(userId);
      const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';

      const AI_TIMEOUT_MS = 25000;
      const aiResult = await Promise.race([
        generateAIResponse(
          scenarioWithUserDifficulty as any,
          [],
          persona,
          undefined,
          userLanguage
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI 응답 시간 초과 (25초). 다시 시도해 주세요.')), AI_TIMEOUT_MS)
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

      await storage.updatePersonaRun(personaRun.id, {
        actualStartedAt: new Date()
      });

      console.log(`💬 첫 AI 메시지 생성 완료`);

      res.json({
        id: personaRun.id,
        scenarioRunId: scenarioRun.id,
        scenarioId: validatedData.scenarioId,
        scenarioName: validatedData.scenarioName,
        personaId,
        personaSnapshot: validatedData.personaSnapshot,
        messages: [{
          sender: "ai",
          message: aiResult.content,
          timestamp: new Date().toISOString(),
          emotion: aiResult.emotion,
          emotionReason: aiResult.emotionReason
        }],
        turnCount: 0,
        status: 'active',
        mode: validatedData.mode,
        difficulty: validatedData.difficulty,
        userId,
        createdAt: scenarioRun.startedAt,
        updatedAt: scenarioRun.startedAt
      });
    } catch (aiError) {
      console.error("AI 초기 메시지 생성 실패:", aiError);
      res.json({
        id: personaRun.id,
        scenarioRunId: scenarioRun.id,
        scenarioId: validatedData.scenarioId,
        scenarioName: validatedData.scenarioName,
        personaId,
        personaSnapshot: validatedData.personaSnapshot,
        messages: [],
        turnCount: 0,
        status: 'active',
        mode: validatedData.mode,
        difficulty: validatedData.difficulty,
        userId,
        createdAt: scenarioRun.startedAt,
        updatedAt: scenarioRun.startedAt
      });
    }
  }));

  router.get("/", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const conversations = await storage.getUserConversations(userId);
    res.json(conversations);
  }));

  router.get("/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRunId = req.params.id;

    const personaRun = await storage.getPersonaRun(personaRunId);
    if (!personaRun) {
      throw createHttpError(404, "Conversation not found");
    }

    const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
    const requestUser = req.user as any;
    const isAdminOrOperator = requestUser?.role === 'admin' || requestUser?.role === 'operator';
    if (!scenarioRun || (!isAdminOrOperator && scenarioRun.userId !== userId)) {
      throw createHttpError(403, "Unauthorized access");
    }

    const chatMessages = await storage.getChatMessagesByPersonaRun(personaRunId);

    const messages = chatMessages.map(msg => ({
      sender: msg.sender as "user" | "ai",
      message: msg.message,
      timestamp: msg.createdAt.toISOString(),
      emotion: msg.emotion || undefined,
      emotionReason: msg.emotionReason || undefined
    }));

    res.json({
      id: personaRun.id,
      scenarioRunId: scenarioRun.id,
      scenarioId: scenarioRun.scenarioId,
      scenarioName: scenarioRun.scenarioName,
      personaId: personaRun.personaId,
      personaSnapshot: personaRun.personaSnapshot,
      messages,
      turnCount: personaRun.turnCount,
      status: personaRun.status,
      mode: personaRun.mode || scenarioRun.mode,
      difficulty: personaRun.difficulty || scenarioRun.difficulty,
      userId: scenarioRun.userId,
      createdAt: personaRun.startedAt,
      updatedAt: personaRun.completedAt || personaRun.startedAt
    });
  }));

  router.delete("/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const { conversation: sessionConversation } = await verifyConversationOwnership(req.params.id, userId);

    const conversationOrder = sessionConversation.conversationOrder || [];

    if (conversationOrder.length > 0) {
      console.log(`시나리오 세션 삭제: ${req.params.id}, 연관 페르소나: ${conversationOrder.length}개`);

      const sessionTime = new Date(sessionConversation.createdAt).getTime();
      const TIME_WINDOW = 24 * 60 * 60 * 1000;
      const allConversations = await storage.getUserConversations(userId);

      const personaConversationsToDelete = allConversations.filter(c => {
        if (c.id === req.params.id) return false;

        const convTime = new Date(c.createdAt).getTime();
        const isWithinTimeWindow = Math.abs(sessionTime - convTime) < TIME_WINDOW;
        const isBeforeSession = convTime <= sessionTime;

        return c.scenarioId === sessionConversation.scenarioId &&
          conversationOrder.includes(c.personaId!) &&
          c.status === 'completed' &&
          isBeforeSession &&
          isWithinTimeWindow;
      });

      const personaConversationsByPersona = new Map<string, any>();
      for (const conv of personaConversationsToDelete) {
        const existing = personaConversationsByPersona.get(conv.personaId!);
        if (!existing || new Date(conv.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
          personaConversationsByPersona.set(conv.personaId!, conv);
        }
      }

      for (const personaConversation of Array.from(personaConversationsByPersona.values())) {
        console.log(`  - 페르소나 대화 삭제: ${personaConversation.id} (${personaConversation.personaId})`);
        try {
          await storage.deleteConversation(personaConversation.id);
        } catch (err) {
          console.error(`    페르소나 대화 삭제 실패: ${personaConversation.id}`, err);
        }
      }

      console.log(`  총 ${personaConversationsByPersona.size}개의 페르소나 대화 삭제 완료`);
    } else {
      console.log(`단일 대화 삭제: ${req.params.id}`);
    }

    await storage.deleteConversation(req.params.id);

    res.json({ success: true, message: "대화가 삭제되었습니다." });
  }));

  router.post("/:id/messages", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRunId = req.params.id;

    const { personaRun, scenarioRun } = await verifyPersonaRunOwnership(personaRunId, userId);

    const { message } = req.body;
    if (typeof message !== "string") {
      throw createHttpError(400, "Message must be a string");
    }

    const isSkipTurn = message.trim() === "";

    if (personaRun!.status === "completed") {
      throw createHttpError(400, "Conversation already completed");
    }

    const existingMessages = await storage.getChatMessagesByPersonaRun(personaRunId);
    const currentTurnIndex = Math.floor(existingMessages.length / 2);

    if (existingMessages.length > 0) {
      const lastMessage = existingMessages[existingMessages.length - 1];
      const timeSinceLastMessage = Date.now() - new Date(lastMessage.createdAt).getTime();
      const RESUME_THRESHOLD_MS = 5 * 60 * 1000;

      if (timeSinceLastMessage > RESUME_THRESHOLD_MS) {
        console.log(`🔄 대화 재개 감지: ${Math.floor(timeSinceLastMessage / 1000 / 60)}분 경과, actualStartedAt 업데이트`);
        await storage.updatePersonaRun(personaRunId, {
          actualStartedAt: new Date()
        });
      }
    }

    if (!isSkipTurn) {
      await storage.createChatMessage({
        personaRunId,
        sender: "user",
        message,
        turnIndex: currentTurnIndex
      });
    }

    const newTurnCount = personaRun!.turnCount + 1;

    const personaId = personaRun!.personaId;

    let persona: any;
    let scenarioWithUserDifficulty: any;

    if (scenarioRun!.scenarioId === "__free_chat__") {
      const snapshot = personaRun!.personaSnapshot as any || {};
      persona = buildFreeChatPersona(snapshot);
      scenarioWithUserDifficulty = buildFreeChatScenario(snapshot, personaRun!.difficulty || scenarioRun!.difficulty || 2);
    } else if (scenarioRun!.scenarioId?.startsWith("__user_persona__:")) {
      const userPersonaId = scenarioRun!.scenarioId.split(":")[1];
      const userPersonaData = await storage.getUserPersonaById(userPersonaId);
      if (!userPersonaData) throw new Error(`UserPersona not found: ${userPersonaId}`);
      const p = userPersonaData.personality as any || {};
      persona = {
        id: userPersonaData.id,
        name: userPersonaData.name,
        role: "대화 상대",
        department: "",
        mbti: "",
        gender: "neutral",
        image: userPersonaData.avatarUrl || undefined,
        expressions: (userPersonaData.expressions as Record<string, string>) || undefined,
        personality: {
          traits: p.traits || [],
          communicationStyle: p.communicationStyle || "",
          motivation: p.background || "",
          fears: [],
        },
        rawPersonality: p,
        description: userPersonaData.description,
        greeting: userPersonaData.greeting,
      };
      scenarioWithUserDifficulty = {
        id: `__user_persona__:${userPersonaData.id}`,
        title: `${userPersonaData.name}와의 대화`,
        description: userPersonaData.description,
        context: {
          situation: userPersonaData.description || "자유로운 대화 상황",
          timeline: "현재",
          stakes: "자유 대화",
          playerRole: { position: "대화 참여자", department: "", experience: "", responsibility: "편하게 대화하기" },
        },
        objectives: ["자유롭게 대화하기"],
        personas: [],
        difficulty: personaRun!.difficulty || scenarioRun!.difficulty || 2,
        successCriteria: { optimal: "자연스러운 대화", good: "적극적인 소통", acceptable: "기본 대화 유지", failure: "대화 거부" },
        _userPersonaMode: true,
        _userPersonaSystemPrompt: `당신은 "${userPersonaData.name}"라는 AI 캐릭터입니다.

${userPersonaData.description ? `캐릭터 설명: ${userPersonaData.description}` : ""}
${p.background ? `배경: ${p.background}` : ""}
${p.traits?.length ? `성격 특성: ${p.traits.join(", ")}` : ""}
${p.communicationStyle ? `대화 방식: ${p.communicationStyle}` : ""}
${p.speechStyle ? `말투: ${p.speechStyle}` : ""}

위 캐릭터로서 자연스럽게 대화하세요. 캐릭터의 성격, 말투, 배경을 일관되게 유지하세요.
사용자와 자유롭게 대화하고, 사용자가 묻는 것에 캐릭터에 맞게 답변하세요.`,
      };
    } else {
      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find(s => s.id === scenarioRun!.scenarioId);
      if (!scenarioObj) throw new Error(`Scenario not found: ${scenarioRun!.scenarioId}`);

      const scenarioPersona: any = scenarioObj.personas.find((p: any) => p.id === personaId);
      if (!scenarioPersona) throw new Error(`Persona not found in scenario: ${personaId}`);

      const mbtiType = scenarioPersona.personaRef?.replace('.json', '');
      const mbtiPersonaData: any = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

      persona = {
        id: scenarioPersona.id,
        name: scenarioPersona.name,
        role: scenarioPersona.position,
        department: scenarioPersona.department,
        personality: mbtiPersonaData?.communication_style || (mbtiPersonaData as any)?.communicationStyle || '균형 잡힌 의사소통',
        responseStyle: mbtiPersonaData?.communication_patterns?.opening_style || (mbtiPersonaData as any)?.communicationPatterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
        goals: mbtiPersonaData?.communication_patterns?.win_conditions || (mbtiPersonaData as any)?.communicationPatterns?.win_conditions || ['목표 달성'],
        background: mbtiPersonaData?.background?.personal_values?.join(', ') || (mbtiPersonaData as any)?.background?.personalValues?.join(', ') || '전문성'
      };

      scenarioWithUserDifficulty = {
        ...scenarioObj,
        difficulty: personaRun!.difficulty || scenarioRun!.difficulty
      };
    }

    const messagesForAI = (isSkipTurn ? existingMessages : [...existingMessages, {
      id: "temp",
      createdAt: new Date(),
      personaRunId,
      sender: "user" as const,
      message,
      turnIndex: currentTurnIndex,
      emotion: null,
      emotionReason: null
    }]).map(msg => ({
      sender: msg.sender as "user" | "ai",
      message: msg.message,
      timestamp: msg.createdAt.toISOString(),
      emotion: msg.emotion || undefined,
      emotionReason: msg.emotionReason || undefined
    }));

    const user = await storage.getUser(userId);
    const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';

    const aiResult = await generateAIResponse(
      scenarioWithUserDifficulty as any,
      messagesForAI,
      persona,
      undefined,
      userLanguage
    );

    await storage.createChatMessage({
      personaRunId,
      sender: "ai",
      message: aiResult.content,
      turnIndex: currentTurnIndex,
      emotion: aiResult.emotion || null,
      emotionReason: aiResult.emotionReason || null
    });

    const isCompleted = (aiResult as any).isCompleted || false;
    const updatedPersonaRun = await storage.updatePersonaRun(personaRunId, {
      turnCount: newTurnCount,
      status: isCompleted ? "completed" : "active",
      completedAt: isCompleted ? new Date() : null
    });

    if (isCompleted) {
      await checkAndCompleteScenario(personaRun!.scenarioRunId);
    }

    res.json({
      message: aiResult.content,
      emotion: aiResult.emotion,
      emotionReason: aiResult.emotionReason,
      isCompleted,
      turnCount: newTurnCount,
      personaRun: updatedPersonaRun,
      messages: [{
        sender: "ai",
        message: aiResult.content,
        timestamp: new Date().toISOString(),
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason
      }]
    });
  }));

  router.post("/:id/realtime-messages", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRunId = req.params.id;

    const { personaRun } = await verifyPersonaRunOwnership(personaRunId, userId);

    const { messages } = req.body;

    if (!Array.isArray(messages)) {
      throw createHttpError(400, "Messages must be an array");
    }

    console.log(`🎙️ 실시간 음성 대화 메시지 일괄 저장: ${personaRunId}, ${messages.length}개 메시지`);

    await storage.deleteChatMessagesByPersonaRun(personaRunId);

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      await storage.createChatMessage({
        personaRunId,
        sender: msg.sender,
        message: msg.message,
        turnIndex: Math.floor(i / 2),
        emotion: msg.emotion || null,
        emotionReason: msg.emotionReason || null,
        createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date()
      });
    }

    const turnCount = Math.floor(messages.length / 2);
    await storage.updatePersonaRun(personaRunId, {
      status: 'completed',
      completedAt: new Date(),
      turnCount
    });

    await checkAndCompleteScenario(personaRun!.scenarioRunId);

    res.json({ success: true, turnCount });
  }));

  router.delete("/:id/messages", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRunId = req.params.id;

    await verifyPersonaRunOwnership(personaRunId, userId);

    await storage.deleteChatMessagesByPersonaRun(personaRunId);

    const updatedPersonaRun = await storage.updatePersonaRun(personaRunId, {
      status: "active",
      turnCount: 0,
      completedAt: null,
      score: null
    });

    const feedback = await storage.getFeedbackByConversationId(personaRunId);
    if (feedback) {
      await storage.deleteFeedback(feedback.id);
    }

    res.json({ success: true, personaRun: updatedPersonaRun });
  }));

  router.post("/:id/persona-selections", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const conversationId = req.params.id;

    await verifyPersonaRunOwnership(conversationId, userId);

    const validationResult = insertPersonaSelectionSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw Object.assign(createHttpError(400, "Invalid selection data"), { details: validationResult.error.issues });
    }

    const conversation = await storage.addPersonaSelection(conversationId, validationResult.data);
    res.json({ success: true, conversation });
  }));

  router.get("/:id/persona-selections", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    await verifyPersonaRunOwnership(req.params.id, userId);
    const selections = await storage.getPersonaSelections(req.params.id);
    res.json(selections);
  }));

  router.post("/:id/sequence-plan", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const conversationId = req.params.id;

    await verifyPersonaRunOwnership(conversationId, userId);

    const { sequencePlan, conversationType } = req.body;

    if (!Array.isArray(sequencePlan)) {
      throw createHttpError(400, "sequencePlan must be an array");
    }

    for (const selection of sequencePlan) {
      const validationResult = insertPersonaSelectionSchema.safeParse(selection);
      if (!validationResult.success) {
        throw Object.assign(createHttpError(400, "Invalid selection in sequence plan"), { details: validationResult.error.issues });
      }
    }

    const conversation = await storage.updateConversation(conversationId, {
      personaSelections: sequencePlan,
      conversationType: conversationType || 'sequential',
      totalPhases: sequencePlan.length
    });

    res.json({ success: true, conversation });
  }));

  router.post("/:id/strategy-choices", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    await verifyPersonaRunOwnership(req.params.id, userId);

    const validationResult = insertStrategyChoiceSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw Object.assign(createHttpError(400, "Invalid strategy choice data"), { details: validationResult.error.issues });
    }

    const conversation = await storage.addStrategyChoice(req.params.id, validationResult.data);
    res.json({ success: true, conversation });
  }));

  router.get("/:id/strategy-choices", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    await verifyPersonaRunOwnership(req.params.id, userId);
    const choices = await storage.getStrategyChoices(req.params.id);
    res.json(choices);
  }));

  router.post("/:id/sequence-analysis", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    await verifyPersonaRunOwnership(req.params.id, userId);

    const validationResult = insertSequenceAnalysisSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw Object.assign(createHttpError(400, "Invalid sequence analysis data"), { details: validationResult.error.issues });
    }

    const conversation = await storage.saveSequenceAnalysis(req.params.id, validationResult.data);
    res.json({ success: true, conversation });
  }));

  router.get("/:id/sequence-analysis", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    await verifyPersonaRunOwnership(req.params.id, userId);
    const analysis = await storage.getSequenceAnalysis(req.params.id);
    if (!analysis) {
      throw createHttpError(404, "Sequence analysis not found");
    }
    res.json(analysis);
  }));

  router.post("/:id/strategy-reflection", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    await verifyPersonaRunOwnership(req.params.id, userId);

    const { strategyReflection, conversationOrder } = req.body;
    if (typeof strategyReflection !== 'string') {
      throw createHttpError(400, "Strategy reflection text is required");
    }
    if (!Array.isArray(conversationOrder)) {
      throw createHttpError(400, "Conversation order must be an array");
    }

    const conversation = await storage.saveStrategyReflection(
      req.params.id,
      strategyReflection,
      conversationOrder
    );

    res.json({ success: true, conversation });
  }));

  router.post("/:id/feedback", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRunId = req.params.id;
    const { force } = req.body;

    const personaRun = await storage.getPersonaRun(personaRunId);
    if (!personaRun) {
      throw createHttpError(404, "Conversation not found");
    }

    const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
    const requestUser = req.user as any;
    const isAdminOrOperator = requestUser?.role === 'admin' || requestUser?.role === 'operator';
    if (!scenarioRun || (!isAdminOrOperator && scenarioRun.userId !== userId)) {
      throw createHttpError(403, "Unauthorized access");
    }

    if (force) {
      const existingFeedback = await storage.getFeedbackByConversationId(personaRunId);
      if (existingFeedback) {
        await storage.deleteFeedback(existingFeedback.id);
        console.log(`피드백 삭제 (재생성): ${personaRunId}`);
      }
    }

    const chatMessages = await storage.getChatMessagesByPersonaRun(personaRunId);
    const conversation = {
      id: personaRunId,
      messages: chatMessages.map((msg: any) => ({
        sender: msg.sender,
        message: msg.message,
        timestamp: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
        emotion: msg.emotion || undefined,
        emotionReason: msg.emotionReason || undefined
      })),
      status: personaRun.status,
      createdAt: personaRun.startedAt,
      completedAt: personaRun.completedAt
    };

    const scenarios = await fileManager.getAllScenarios();
    const scenarioObj = scenarios.find((s: any) => s.id === scenarioRun!.scenarioId);
    if (!scenarioObj) {
      throw createHttpError(404, "Scenario not found");
    }

    const personas = scenarioObj.personas || [];
    const persona = personas.find((p: any) => p.id === personaRun.personaId) || personas[0];

    const user = await storage.getUser(userId);
    const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';

    const feedback = await generateAndSaveFeedback(personaRunId, conversation, scenarioObj, persona, userLanguage);
    res.json(feedback);
  }));

  router.get("/:id/feedback", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRunId = req.params.id;

    const feedback = await storage.getFeedbackByConversationId(personaRunId);
    if (!feedback) {
      throw createHttpError(404, "Feedback not found");
    }

    const personaRun = await storage.getPersonaRun(personaRunId);
    if (!personaRun) {
      throw createHttpError(404, "Conversation not found");
    }
    const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);

    const requestUser = req.user as any;
    const isAdminOrOperator = requestUser?.role === 'admin' || requestUser?.role === 'operator';

    if (!scenarioRun || (!isAdminOrOperator && scenarioRun.userId !== userId)) {
      throw createHttpError(403, "Unauthorized access");
    }

    res.json(feedback);
  }));

  return router;
}
