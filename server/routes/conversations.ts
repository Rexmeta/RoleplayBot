import { Router } from "express";
import { storage, db } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateAIResponse, generateStreamingAIResponse } from "../services/aiServiceFactory";
import type { RoleplayScenario } from "../services/aiServiceFactory";
import {
  insertConversationSchema,
  insertPersonaSelectionSchema,
  insertStrategyChoiceSchema,
  insertSequenceAnalysisSchema,
  scenarioRuns,
  personaRuns,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
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
import { normalizeProfileName, parseJoinModeSpeakerSegments } from "../services/conversationContextBuilder";
import { filterThinkingText } from "../services/voice/textFilter";
import { createDefaultSimulationState, TurnScore } from "../services/simulation/simulationTypes";
import type { ScenarioPersona } from "../services/aiServiceFactory";
import { setSessionState, getSessionState, applySimulationPatch, checkIncidentCooldown, recordIncidentCooldown, getSessionHarnessConfig, getSessionEvaluationHarness, getSessionFlowGraph } from "../services/simulation/simulationEngine";
import { applyHarnessToSession, readScenarioHarness } from "../services/simulation/harnessReader";
import { evaluateUserResponse } from "../services/simulation/evaluateUserResponse";
import { buildRuleFallbackPatch, resolveStageTransition, inferIncidentCandidate, evaluateIncidentProbability } from "../services/simulation/simulationRules";
import { buildSimulationStateBlock } from "../services/simulation/simulationPrompt";
import { handleToolCall } from "../services/simulation/simulationToolHandler";
import { v4 as uuidv4 } from "uuid";

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
    const providedScenarioRunId = req.body.scenarioRunId as string | undefined;

    let scenarioRun;

    if (forceNewRun) {
      console.log(`🆕 forceNewRun=true, 기존 active 세션 정리 후 새 Scenario Run 강제 생성`);
      await storage.abandonActiveScenarioRuns(userId, validatedData.scenarioId);
      scenarioRun = null;
    } else if (providedScenarioRunId) {
      const candidateRun = await storage.getScenarioRun(providedScenarioRunId);
      if (candidateRun && candidateRun.userId === userId && candidateRun.status === 'active' && candidateRun.scenarioId === validatedData.scenarioId) {
        scenarioRun = candidateRun;
        console.log(`🎯 클라이언트 제공 scenarioRunId 직접 사용: ${scenarioRun.id}`);
      } else {
        console.warn(`⚠️ 제공된 scenarioRunId(${providedScenarioRunId})가 유효하지 않음, findActiveScenarioRun으로 폴백`);
        scenarioRun = await storage.findActiveScenarioRun(userId, validatedData.scenarioId);
      }
    } else {
      scenarioRun = await storage.findActiveScenarioRun(userId, validatedData.scenarioId);
    }

    if (scenarioRun) {
      console.log(`♻️ 기존 Scenario Run 재사용: ${scenarioRun.id} (attempt #${scenarioRun.attemptNumber})`);
    } else {
      const existingRuns = await storage.getUserScenarioRuns(userId);
      const sameScenarioRuns = existingRuns.filter(r => r.scenarioId === validatedData.scenarioId);
      const attemptNumber = sameScenarioRuns.length + 1;

      let scenarioVersionId: string | undefined;
      let scenarioSnapshotForRun: Record<string, unknown> | undefined;
      let evaluationHarnessSnapshotForRun: Record<string, unknown> | undefined;

      try {
        const latestVersion = await storage.getLatestPublishedVersion(validatedData.scenarioId);
        if (latestVersion) {
          scenarioVersionId = latestVersion.id;
          scenarioSnapshotForRun = latestVersion.contentSnapshot as Record<string, unknown>;
          evaluationHarnessSnapshotForRun = latestVersion.evaluationHarnessSnapshot as Record<string, unknown> | undefined;
          console.log(`🏷️ Scenario Run에 버전 v${latestVersion.version} 연결: ${latestVersion.id}`);
        }
      } catch (versionErr) {
        console.warn('⚠️ 시나리오 버전 조회 실패 (무시됨):', versionErr);
      }

      scenarioRun = await storage.createScenarioRun({
        userId,
        scenarioId: validatedData.scenarioId,
        scenarioName: validatedData.scenarioName,
        attemptNumber,
        mode: validatedData.mode,
        difficulty: validatedData.difficulty,
        status: 'active',
        ...(scenarioVersionId && {
          scenarioVersionId,
          scenarioSnapshot: scenarioSnapshotForRun ?? null,
          evaluationHarnessSnapshot: evaluationHarnessSnapshotForRun ?? null,
        }),
      } as any);

      console.log(`📋 새로운 Scenario Run 생성: ${scenarioRun.id} (attempt #${attemptNumber})`);
    }

    const personaId = validatedData.personaId || validatedData.scenarioId;

    const [scenarioFromDb, scenarios] = await Promise.all([
      storage.getScenario(validatedData.scenarioId),
      fileManager.getAllScenarios(),
    ]);
    if (!scenarioFromDb) {
      throw Object.assign(createHttpError(404, "시나리오를 찾을 수 없습니다."), { errorCode: "SCENARIO_NOT_FOUND" });
    }
    if (scenarioFromDb.isDeleted) {
      throw Object.assign(createHttpError(410, "이 시나리오는 삭제되어 더 이상 이용할 수 없습니다."), { errorCode: "SCENARIO_DELETED" });
    }

    const scenarioObj = scenarios.find(s => s.id === validatedData.scenarioId);
    if (!scenarioObj) {
      throw new Error(`Scenario not found: ${validatedData.scenarioId}`);
    }

    let scenarioPersona = scenarioObj.personas.find((p: any) => p.id === personaId) as any;
    if (!scenarioPersona) {
      const normalizedPersonaId = personaId.toLowerCase();
      scenarioPersona = scenarioObj.personas.find((p: any) =>
        p.id?.toLowerCase() === normalizedPersonaId ||
        p.personaRef?.replace('.json', '').toLowerCase() === normalizedPersonaId
      ) as any;
      if (scenarioPersona) {
        console.warn(`[conversations] Persona ID fallback matched: requested="${personaId}", matched="${scenarioPersona.id}"`);
      }
    }
    if (!scenarioPersona) {
      throw new Error(`Persona not found in scenario: ${personaId}`);
    }

    const mbtiType = (scenarioPersona as any).mbti || (scenarioPersona as any).personaRef?.replace('.json', '');
    const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

    const existingPersonaRuns = await storage.getPersonaRunsByScenarioRun(scenarioRun.id);
    const phase = existingPersonaRuns.length + 1;

    const duplicatePersonaRun = existingPersonaRuns.find(
      r => r.personaId === personaId && r.status === 'active'
    );
    if (duplicatePersonaRun) {
      console.log(`⚠️ 중복 Persona Run 감지, 기존 Run 반환: ${duplicatePersonaRun.id}`);
      const [existingMessages, existingSimState] = await Promise.all([
        storage.getChatMessagesByPersonaRun(duplicatePersonaRun.id),
        storage.getSimulationState(duplicatePersonaRun.id),
      ]);
      return res.json({
        id: duplicatePersonaRun.id,
        scenarioRunId: scenarioRun.id,
        scenarioId: validatedData.scenarioId,
        scenarioName: validatedData.scenarioName,
        personaId,
        personaSnapshot: duplicatePersonaRun.personaSnapshot,
        messages: existingMessages,
        turnCount: existingMessages.filter(m => m.role === 'user').length,
        status: 'active',
        mode: duplicatePersonaRun.mode,
        difficulty: duplicatePersonaRun.difficulty,
        userId,
        createdAt: duplicatePersonaRun.startedAt,
        updatedAt: duplicatePersonaRun.startedAt,
        simulationState: existingSimState,
      });
    }

    const personaRun = await storage.createPersonaRun({
      scenarioRunId: scenarioRun.id,
      personaId,
      personaName: (scenarioPersona as any).name,
      personaSnapshot: validatedData.personaSnapshot || {},
      mbtiType: mbtiType || null,
      phase,
      mode: validatedData.mode,
      difficulty: validatedData.difficulty || 4,
      status: 'active'
    });

    console.log(`👤 Persona Run 생성: ${personaRun.id}, mode=${validatedData.mode}`);

    const isPersonaXMode = validatedData.scenarioId.startsWith('__user_persona__:') ||
      validatedData.scenarioId.startsWith('__mbti_persona__:') ||
      validatedData.scenarioId === '__free_chat__';
    let initialSimState = null;
    if (!isPersonaXMode) {
      const freshState = createDefaultSimulationState();
      // Initialize timer from scenario config so it is available from the first turn
      const initTimerCfg = (scenarioObj as any)?.simulationConfig?.timer;
      if (initTimerCfg?.enabled && initTimerCfg.timeLimitSec > 0) {
        freshState.timer = { enabled: true, timeLimitSec: initTimerCfg.timeLimitSec, startedAt: new Date().toISOString(), pausedAt: null, elapsedSec: 0 };
      }
      setSessionState(personaRun.id, freshState);
      const harnessConfig = readScenarioHarness({
        ...(scenarioFromDb as any),
        ...(scenarioObj as any),
        npcBehaviorHarness: (scenarioPersona as any)?.npcBehaviorHarness ?? null,
      });
      applyHarnessToSession(personaRun.id, harnessConfig);
      initialSimState = freshState;
      storage.saveSimulationState(personaRun.id, freshState as unknown as Record<string, unknown>)
        .then(() => {
          storage.createSimulationEvent({
            personaRunId: personaRun.id,
            scenarioRunId: scenarioRun.id,
            turnIndex: 0,
            turnId: uuidv4(),
            eventType: 'state_init',
            toolName: null,
            args: { scenarioId: validatedData.scenarioId, mode: validatedData.mode },
            result: null,
            stateBefore: null,
            stateAfter: freshState,
            stateVersionBefore: null,
            stateVersionAfter: freshState.version,
            includeInReport: false,
          }).catch(e => console.warn('[conversations] Failed to log state_init event:', e));
        })
        .catch(e => console.warn('[conversations] Failed to persist initial simulation state:', e));
    }

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
        difficulty: validatedData.difficulty || 4,
        userId,
        createdAt: scenarioRun.startedAt,
        updatedAt: scenarioRun.startedAt,
        simulationState: initialSimState,
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

      const allScenarioPersonas = (scenarioObj.personas || []) as any[];
      const primaryPersonaIdx = allScenarioPersonas.findIndex((p: any) => p.isPrimary === true);
      const scenarioWithUserDifficulty = {
        ...scenarioObj,
        difficulty: validatedData.difficulty || 4,
        allPersonas: allScenarioPersonas.length > 1 ? allScenarioPersonas : undefined,
        activePersonaIndex: primaryPersonaIdx >= 0 ? primaryPersonaIdx : 0,
      };

      const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
      const userName = normalizeProfileName(user?.name);

      const AI_TIMEOUT_MS = 25000;
      const aiResult = await Promise.race([
        generateAIResponse(
          scenarioWithUserDifficulty as any,
          [],
          persona,
          undefined,
          userLanguage,
          userName
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
        updatedAt: scenarioRun.startedAt,
        simulationState: initialSimState,
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
        updatedAt: scenarioRun.startedAt,
        simulationState: initialSimState,
      });
    }
  }));

  router.get("/", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;

    const oldConversations = await storage.getUserConversations(userId);

    const personaScenarioRuns = await db
      .select()
      .from(scenarioRuns)
      .where(
        eq(scenarioRuns.userId, userId)
      );

    const personaOnlyRuns = personaScenarioRuns.filter(
      sr => sr.scenarioId.startsWith("__user_persona__:") || sr.scenarioId.startsWith("__mbti_persona__:")
    );

    const personaRunsData = personaOnlyRuns.length > 0
      ? await db
          .select()
          .from(personaRuns)
          .where(inArray(personaRuns.scenarioRunId, personaOnlyRuns.map(sr => sr.id)))
      : [];

    const scenarioRunMap = new Map(personaOnlyRuns.map(sr => [sr.id, sr]));

    const personaConversations = personaRunsData.map(pr => {
      const sr = scenarioRunMap.get(pr.scenarioRunId);
      return {
        id: pr.id,
        scenarioId: sr?.scenarioId ?? "",
        scenarioName: sr?.scenarioName ?? "",
        personaSnapshot: pr.personaSnapshot as { name?: string; avatarUrl?: string } | null,
        createdAt: pr.startedAt?.toISOString() ?? new Date().toISOString(),
        status: pr.status,
      };
    });

    const oldConvIds = new Set(oldConversations.map((c: any) => c.id));
    const mergedConversations = [
      ...oldConversations,
      ...personaConversations.filter(pc => !oldConvIds.has(pc.id)),
    ];

    res.json(mergedConversations);
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
      emotionReason: msg.emotionReason || undefined,
      turnIndex: msg.turnIndex,
    }));

    const isPersonaXGet = scenarioRun.scenarioId === '__free_chat__' ||
      scenarioRun.scenarioId?.startsWith('__user_persona__:') ||
      scenarioRun.scenarioId?.startsWith('__mbti_persona__:');

    let simState: import('../services/simulation/simulationTypes').SimulationState | null = getSessionState(personaRun.id);
    if (!simState && !isPersonaXGet) {
      try {
        const stored = await storage.getSimulationState(personaRun.id);
        if (stored) {
          simState = stored as unknown as import('../services/simulation/simulationTypes').SimulationState;
          setSessionState(personaRun.id, simState);
          // Log state_restore event (best-effort, no await)
          storage.createSimulationEvent({
            personaRunId: personaRun.id,
            scenarioRunId: scenarioRun.id,
            turnIndex: personaRun.turnCount ?? 0,
            turnId: uuidv4(),
            eventType: 'state_restore',
            toolName: null,
            args: null,
            result: null,
            stateBefore: null,
            stateAfter: simState,
            stateVersionBefore: null,
            stateVersionAfter: simState.version,
            includeInReport: false,
          }).catch(e => console.warn('[conversations] Failed to log state_restore event:', e));
        } else {
          simState = createDefaultSimulationState();
          setSessionState(personaRun.id, simState);
          await storage.saveSimulationState(personaRun.id, simState as unknown as Record<string, unknown>);
          // Log state_init for lazy-created default state
          storage.createSimulationEvent({
            personaRunId: personaRun.id,
            scenarioRunId: scenarioRun.id,
            turnIndex: 0,
            turnId: uuidv4(),
            eventType: 'state_init',
            toolName: null,
            args: null,
            result: null,
            stateBefore: null,
            stateAfter: simState,
            stateVersionBefore: null,
            stateVersionAfter: simState.version,
            includeInReport: false,
          }).catch(e => console.warn('[conversations] Failed to log state_init event (lazy):', e));
        }
      } catch (e) {
        console.warn('[conversations] Failed to lazy-init simulation state:', e);
      }
    }

    let scenarioVersionNumber: number | null = null;
    if ((scenarioRun as any).scenarioVersionId) {
      try {
        const version = await storage.getScenarioVersion((scenarioRun as any).scenarioVersionId);
        scenarioVersionNumber = version?.version ?? null;
      } catch { /* ignore */ }
    }

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
      updatedAt: personaRun.completedAt || personaRun.startedAt,
      simulationState: simState,
      terminationReason: personaRun.terminationReason ?? null,
      personaSwitchLog: personaRun.personaSwitchLog ?? [],
      activePersonaIndex: (personaRun.activePersonaIndex as number | null) ?? 0,
      scenarioVersionId: (scenarioRun as any).scenarioVersionId ?? null,
      scenarioVersion: scenarioVersionNumber,
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

    const { message, previousInputMode } = req.body;
    if (typeof message !== "string") {
      throw createHttpError(400, "Message must be a string");
    }

    const VALID_INPUT_MODES = ['realtime-voice', 'text', 'tts'] as const;
    const validatedPreviousMode = VALID_INPUT_MODES.includes(previousInputMode)
      ? (previousInputMode as typeof VALID_INPUT_MODES[number])
      : undefined;

    const isSkipTurn = message.trim() === "";

    if (personaRun!.status === "completed") {
      if (validatedPreviousMode === 'realtime-voice') {
        console.log(`🔄 음성→텍스트 전환 후 재활성화: ${personaRunId}`);
        await storage.updatePersonaRun(personaRunId, { status: 'active', completedAt: null });
        personaRun!.status = 'active';
      } else {
        throw createHttpError(400, "Conversation already completed");
      }
    }

    const isPersonaX = scenarioRun!.scenarioId === '__free_chat__' ||
      scenarioRun!.scenarioId?.startsWith('__user_persona__:') ||
      scenarioRun!.scenarioId?.startsWith('__mbti_persona__:');

    const shouldEvalEarly = !isPersonaX && !isSkipTurn && message.trim().length >= 10;
    const cachedSimState = shouldEvalEarly ? getSessionState(personaRunId) : null;
    const needSimStateFromDb = shouldEvalEarly && !cachedSimState;

    const [existingMessages, user, preloadedSimState, scenarioDbRecord] = await Promise.all([
      storage.getChatMessagesByPersonaRun(personaRunId),
      storage.getUser(userId),
      needSimStateFromDb ? storage.getSimulationState(personaRunId) : Promise.resolve(null),
      !isPersonaX ? storage.getScenario(scenarioRun!.scenarioId) : Promise.resolve(null),
    ]);
    // Greeting is stored at turnIndex 0 (1 existing message after init).
    // Using Math.ceil ensures the first real user turn starts at 1, not 0,
    // so the greeting's turnIndex is never shared with any subsequent message.
    const currentTurnIndex = Math.ceil(existingMessages.length / 2);

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

    const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
    const userName = normalizeProfileName(user?.name);

    let persona: any;
    let scenarioWithUserDifficulty: any;
    let scenarioObjRef: any = null; // hoisted for auto-feedback trigger

    if (scenarioRun!.scenarioId === "__free_chat__") {
      const snapshot = personaRun!.personaSnapshot as any || {};
      persona = buildFreeChatPersona(snapshot);
      scenarioWithUserDifficulty = buildFreeChatScenario(snapshot, personaRun!.difficulty || scenarioRun!.difficulty || 4);
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
        difficulty: personaRun!.difficulty || scenarioRun!.difficulty || 4,
        successCriteria: { optimal: "자연스러운 대화", good: "적극적인 소통", acceptable: "기본 대화 유지", failure: "대화 거부" },
        _userPersonaMode: true,
        _userPersonaSystemPrompt: (() => {
          const snapshot = personaRun!.personaSnapshot as any || {};
          const sceneData = snapshot.scene || null;
          const sceneBlock = sceneData
            ? [
                "## 현재 장면 설정 (반드시 따를 것)",
                `배경: ${sceneData.setting}`,
                `분위기: ${sceneData.mood}`,
                sceneData.genre ? `장르: ${sceneData.genre}` : "",
                sceneData.openingLine ? `첫 대사 맥락: ${sceneData.openingLine}` : "",
                "",
                "위 장면 설정에 완전히 몰입하여 대화를 진행하세요. 장면의 배경·분위기·장르가 대화 전반에 걸쳐 일관되게 반영되어야 합니다.",
              ].filter(Boolean).join("\n")
            : "";
          const scenePrefix = sceneBlock ? `${sceneBlock}\n\n` : "";
          const userNameLine = userName ? `상대방 실명: 대화 상대방의 이름은 [${userName}]입니다. 대화 중 자연스럽게 "${userName}" 또는 "${userName} 씨"로 불러주세요.` : "";
          return `${scenePrefix}당신은 "${userPersonaData.name}"라는 AI 캐릭터입니다.

${userPersonaData.description ? `캐릭터 설명: ${userPersonaData.description}` : ""}
${p.background ? `배경: ${p.background}` : ""}
${p.traits?.length ? `성격 특성: ${p.traits.join(", ")}` : ""}
${p.communicationStyle ? `대화 방식: ${p.communicationStyle}` : ""}
${p.speechStyle ? `말투: ${p.speechStyle}` : ""}
${userNameLine}

위 캐릭터로서 자연스럽게 대화하세요. 캐릭터의 성격, 말투, 배경을 일관되게 유지하세요.
사용자와 자유롭게 대화하고, 사용자가 묻는 것에 캐릭터에 맞게 답변하세요.`;
        })(),
      };
    } else {
      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find(s => s.id === scenarioRun!.scenarioId);
      if (!scenarioObj) throw new Error(`Scenario not found: ${scenarioRun!.scenarioId}`);
      scenarioObjRef = scenarioObj; // hoist for auto-feedback

      let scenarioPersona: any = scenarioObj.personas.find((p: any) => p.id === personaId);
      if (!scenarioPersona) {
        const normalizedPersonaId = personaId.toLowerCase();
        scenarioPersona = scenarioObj.personas.find((p: any) =>
          p.id?.toLowerCase() === normalizedPersonaId ||
          p.personaRef?.replace('.json', '').toLowerCase() === normalizedPersonaId
        );
        if (scenarioPersona) {
          console.warn(`[conversations/messages] Persona ID fallback matched: requested="${personaId}", matched="${scenarioPersona.id}"`);
        }
      }
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

      const allScenarioPersonas = (scenarioObj.personas || []) as any[];
      // Resolve initial active persona from isPrimary flag when activePersonaIndex is not yet set
      const primaryPersonaIdx = allScenarioPersonas.findIndex((p: any) => p.isPrimary === true);
      const resolvedActivePersonaIndex = (personaRun!.activePersonaIndex as number | null)
        ?? (primaryPersonaIdx >= 0 ? primaryPersonaIdx : 0);
      scenarioWithUserDifficulty = {
        ...scenarioObj,
        difficulty: personaRun!.difficulty || scenarioRun!.difficulty,
        allPersonas: allScenarioPersonas.length > 1 ? allScenarioPersonas : undefined,
        activePersonaIndex: resolvedActivePersonaIndex,
      };

      // Override active persona with the currently active one when a prior switch has occurred
      const currentActivePersonaIdx = resolvedActivePersonaIndex;
      if (currentActivePersonaIdx > 0 && allScenarioPersonas.length > currentActivePersonaIdx) {
        const activeSP = allScenarioPersonas[currentActivePersonaIdx] as any;
        const activeMbtiType = activeSP.personaRef?.replace('.json', '');
        const activeMbtiData: any = activeMbtiType ? await fileManager.getPersonaByMBTI(activeMbtiType) : null;
        persona = {
          id: activeSP.id,
          name: activeSP.name,
          role: activeSP.position,
          department: activeSP.department,
          personality: activeMbtiData?.communication_style || activeMbtiData?.communicationStyle || '균형 잡힌 의사소통',
          responseStyle: activeMbtiData?.communication_patterns?.opening_style || activeMbtiData?.communicationPatterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
          goals: activeMbtiData?.communication_patterns?.win_conditions || activeMbtiData?.communicationPatterns?.win_conditions || ['목표 달성'],
          background: activeMbtiData?.background?.personal_values?.join(', ') || activeMbtiData?.background?.personalValues?.join(', ') || '전문성',
        };
      }
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
      emotionReason: msg.emotionReason || undefined,
      turnIndex: msg.turnIndex ?? undefined,
    }));

    const scenarioForAI: RoleplayScenario = scenarioWithUserDifficulty;
    // Inject persona switch log so prepareConversationHistory can label messages correctly
    (scenarioForAI as any).personaSwitchLog = personaRun!.personaSwitchLog ?? [];
    // Only realtime-voice → text requires a style-continuity hint because it uses a
    // separate AI model (Gemini Live) that has no shared prompt state with the text model.
    // text ↔ tts transitions share the same provider and existing history, so no hint needed.
    if (validatedPreviousMode === 'realtime-voice') {
      console.log('🔄 Voice→Text mode transition detected: injecting style continuity hint');
      scenarioForAI.modeTransitionHint = '이전 대화는 음성(voice)으로 이루어졌습니다. 지금부터 텍스트 모드로 전환되었습니다. 이전 대화의 캐릭터와 분위기, 톤을 그대로 유지하며 텍스트로 자연스럽게 이어가세요. 말투나 태도가 갑자기 바뀌지 않도록 주의하세요.';
    }

    // ── Simulation evaluation orchestration ────────────────────────────────────
    // fast (default): run LLM evaluation in parallel with AI generation (non-blocking)
    // quality: run LLM evaluation FIRST, inject [SIMULATION_STATE] into AI prompt, then generate
    const evalMode: 'fast' | 'quality' =
      (scenarioWithUserDifficulty as any)?.simulationConfig?.evaluationMode ?? 'fast';
    const shouldEval = !isPersonaX && !isSkipTurn && message.trim().length >= 10;
    const evalTurnId = uuidv4();

    // Pre-load simulation state (required before AI generation for quality mode)
    // cachedSimState and preloadedSimState were fetched in parallel above to avoid sequential round-trips.
    let evalState: import('../services/simulation/simulationTypes').SimulationState | null = null;
    if (shouldEval) {
      try {
        evalState = cachedSimState;
        if (!evalState) {
          const stored = preloadedSimState;
          if (stored) {
            evalState = stored as unknown as import('../services/simulation/simulationTypes').SimulationState;
          } else {
            const defaultState = createDefaultSimulationState();
            // Initialize timer from scenario config if present
            const timerCfg = (scenarioWithUserDifficulty as any)?.simulationConfig?.timer;
            if (timerCfg?.enabled && timerCfg.timeLimitSec > 0) {
              defaultState.timer = { enabled: true, timeLimitSec: timerCfg.timeLimitSec, startedAt: new Date().toISOString(), pausedAt: null, elapsedSec: 0 };
            }
            evalState = defaultState;
          }
          setSessionState(personaRunId, evalState);
        }
      } catch (e) {
        const preloadError = e instanceof Error ? e : new Error(String(e));
        console.error('[conversations] Failed to pre-load simulation state', {
          personaRunId,
          turnIndex: currentTurnIndex,
          evaluationMode: evalMode,
          errorMessage: preloadError.message,
          errorStack: preloadError.stack,
        });
        // Ensure evalState is never null when shouldEval is true — use a default
        // so the evaluation pipeline always has a valid starting state.
        if (!evalState) {
          evalState = createDefaultSimulationState();
          // Sync in-memory session state immediately so getSessionState() is consistent
          setSessionState(personaRunId, evalState);
        }
      }
    }

    // Quality mode: evaluate FIRST → apply patches → inject [SIMULATION_STATE] into AI prompt
    // Fast mode: evaluate synchronously AFTER AI generation (no [SIMULATION_STATE] injection)
    let qualityEvalResult: import('../services/simulation/evaluateUserResponse').EvaluationResult | null = null;
    let qualityFinalState: import('../services/simulation/simulationTypes').SimulationState | null = null;
    let fastEvalInput: Parameters<typeof evaluateUserResponse>[0] | null = null;
    let fastEvalPromise: Promise<import('../services/simulation/evaluateUserResponse').EvaluationResult> | null = null;

    const scenarioEvalHarness = !isPersonaX
      ? ((scenarioDbRecord as any)?.evaluationHarness ?? null)
      : null;
    const scenarioDifficultyProfile = !isPersonaX
      ? ((scenarioDbRecord as any)?.difficultyProfile ?? null)
      : null;
    const activePersonaNpcHarness = !isPersonaX
      ? getSessionHarnessConfig(personaRunId).npcBehaviorHarness ?? null
      : null;

    if (shouldEval && evalState) {
      const baseEvalInput = {
        personaRunId, turnId: evalTurnId, turnIndex: currentTurnIndex,
        userText: message, aiText: '',
        simulationState: evalState, language: userLanguage, evaluationMode: evalMode,
        evaluationHarness: scenarioEvalHarness,
        npcBehaviorHarness: activePersonaNpcHarness,
      };
      if (evalMode === 'quality') {
        try {
          qualityEvalResult = await evaluateUserResponse(baseEvalInput);
          // Apply all patches to build updated state for [SIMULATION_STATE] injection
          let qs = applySimulationPatch(personaRunId, {
            source: 'server_evaluation', priority: 'normal', turnId: evalTurnId,
            patch: { turnScoresToAdd: [qualityEvalResult.turnScore], npcEmotionDelta: qualityEvalResult.emotionDelta },
          });
          const qr = buildRuleFallbackPatch(qualityEvalResult.turnScore, qs, 0);
          if (qr) qs = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'low', turnId: evalTurnId, patch: qr });
          const qt = resolveStageTransition(qs, getSessionFlowGraph(personaRunId));
          if (qt) qs = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'normal', turnId: evalTurnId, patch: { targetStage: qt } });
          // Server-rule incident inference for quality mode (text/TTS path)
          const qInc = inferIncidentCandidate(qs, personaRunId, currentTurnIndex, userLanguage as any, scenarioRun!.scenarioId);
          if (qInc && evaluateIncidentProbability(true, scenarioDifficultyProfile)) {
            const qCool = checkIncidentCooldown(personaRunId, qInc.type);
            if (qCool.allowed) {
              recordIncidentCooldown(personaRunId, qInc.type);
              qs = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'normal', turnId: evalTurnId, patch: { incidentsToAdd: [qInc] } });
            }
          }
          qualityFinalState = qs;
          // Inject updated [SIMULATION_STATE] block into AI generation prompt
          scenarioForAI.simulationStateBlock = buildSimulationStateBlock(qs);
        } catch (e) {
          console.warn('[conversations] Quality mode pre-evaluation failed, continuing without state injection:', e);
        }
      } else {
        // Fast mode: start evaluation in parallel with AI generation.
        // buildEvaluationPrompt only uses userText/simulationState/language — aiText is not used in the prompt.
        // No [SIMULATION_STATE] injection — AI responds without evaluation context.
        fastEvalInput = { ...baseEvalInput };
        fastEvalPromise = evaluateUserResponse(fastEvalInput);
      }
    }

    // ── SSE Streaming path ──────────────────────────────────────────────────────
    // Activated when client sends Accept: text/event-stream and mode is 'text'.
    // Skip turns (empty messages) always use the regular JSON path.
    const wantsStream = (req.headers['accept'] || '').includes('text/event-stream');
    const conversationMode = personaRun!.mode || scenarioRun!.mode;
    const useStreaming = wantsStream && conversationMode === 'text' && !isSkipTurn;

    if (useStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      type SseDeltaEvent = { type: 'delta'; content: string };
      type SseDoneEvent = {
        type: 'done'; message: string; emotion: string; emotionReason: string;
        isCompleted: boolean; turnCount: number; personaRun: Record<string, unknown> | null;
        messages: Array<{ sender: string; message: string; timestamp: string; emotion?: string; emotionReason?: string; speakerSegments?: import('../services/conversationContextBuilder').SpeakerSegment[] }>;
        simulationState: import('../services/simulation/simulationTypes').SimulationState | null;
        turnScore: TurnScore | null;
        evaluationSkipped?: boolean; personaSwitched?: Record<string, unknown>;
        speakerSegments?: import('../services/conversationContextBuilder').SpeakerSegment[];
      };
      type SseErrorEvent = { type: 'error'; message: string };
      type SseEvent = SseDeltaEvent | SseDoneEvent | SseErrorEvent;

      const flushResponse = (r: typeof res) => {
        // Some Express middleware (e.g. compression) exposes a flush() method
        if ('flush' in r && typeof (r as { flush?: () => void }).flush === 'function') {
          (r as { flush: () => void }).flush();
        }
      };

      const writeEvent = (data: SseEvent) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        flushResponse(res);
      };

      let fullContent = '';
      try {
        const stream = await generateStreamingAIResponse(
          scenarioForAI, messagesForAI, persona, undefined, userLanguage, userName
        );
        for await (const chunk of stream) {
          fullContent += chunk;
          writeEvent({ type: 'delta', content: chunk });
        }
      } catch (streamErr) {
        console.error('[streaming] AI generation error:', streamErr);
        writeEvent({ type: 'error', message: '응답 생성 중 오류가 발생했습니다.' });
        res.end();
        return;
      }

      // Parse [META:{...}] marker from end of streamed content
      const metaMatch = fullContent.match(/\[META:([\s\S]*?)\]\s*$/);
      type MetaSwitchPersona = { targetPersonaIndex: number; reason?: string; transitionLine?: string };
      let metaParsed: { emotion?: string; emotionReason?: string; complete?: boolean; switchPersona?: MetaSwitchPersona } = {};
      let streamCleanContent = fullContent;
      if (metaMatch) {
        try {
          metaParsed = JSON.parse(metaMatch[1]);
          streamCleanContent = fullContent.slice(0, fullContent.lastIndexOf('[META:')).trimEnd();
        } catch (e) {
          console.warn('[streaming] Failed to parse META marker:', e);
        }
      }
      // Apply thinking-text filter (same as non-streaming path)
      streamCleanContent = filterThinkingText(streamCleanContent, userLanguage).trim() || streamCleanContent;

      const streamEmotion = metaParsed.emotion || '중립';
      const streamEmotionReason = metaParsed.emotionReason || '';
      const streamSwitchPersonaInfo = (metaParsed.switchPersona && typeof metaParsed.switchPersona === 'object')
        ? metaParsed.switchPersona as { targetPersonaIndex: number; reason?: string; transitionLine?: string }
        : undefined;
      const streamAiMessageContent = streamSwitchPersonaInfo?.transitionLine?.trim() || streamCleanContent;

      // Save AI message to DB
      await storage.createChatMessage({
        personaRunId, sender: 'ai', message: streamAiMessageContent,
        turnIndex: currentTurnIndex, emotion: streamEmotion || null, emotionReason: streamEmotionReason || null
      });

      // Handle persona switch
      type PersonaSwitchEntry = { turn: number; fromPersonaIndex: number; toPersonaIndex: number; fromPersonaId: string; toPersonaId: string; reason: string; transitionLine: string; timestamp: string };
      let streamNewActivePersonaIndex: number = (personaRun!.activePersonaIndex as number | null) ?? 0;
      let streamNewPersonaSwitchLog: PersonaSwitchEntry[] = Array.isArray(personaRun!.personaSwitchLog) ? [...(personaRun!.personaSwitchLog as PersonaSwitchEntry[])] : [];
      type FullPersona = ScenarioPersona & { position?: string; image?: string };
      let streamSwitchToPersona: FullPersona | null = null;
      let streamSwitchFromPersona: FullPersona | null = null;
      if (streamSwitchPersonaInfo && typeof streamSwitchPersonaInfo.targetPersonaIndex === 'number') {
        const scenarioCast = scenarioWithUserDifficulty as { allPersonas?: FullPersona[]; personas?: FullPersona[] };
        const allSPs: FullPersona[] = scenarioCast?.allPersonas ?? scenarioCast?.personas ?? [];
        const tr = handleToolCall('switch_persona', {
          targetPersonaIndex: streamSwitchPersonaInfo.targetPersonaIndex,
          reason: streamSwitchPersonaInfo.reason ?? '',
          transitionLine: streamSwitchPersonaInfo.transitionLine ?? '',
        }, {
          personaRunId, turnId: evalTurnId, turnIndex: currentTurnIndex,
          currentTurnIncidentFired: false, toolCallCountThisTurn: 0, emotionCallCountThisTurn: 0,
          language: userLanguage as 'ko' | 'en' | 'ja' | 'zh',
          currentPersonaIndex: streamNewActivePersonaIndex, scenarioPersonas: allSPs,
        });
        if (tr.success && tr.personaSwitched) {
          const sw = tr.personaSwitched;
          const toP = allSPs[sw.toIndex];
          if (toP) {
            streamSwitchFromPersona = allSPs[sw.fromIndex];
            streamNewActivePersonaIndex = sw.toIndex;
            streamNewPersonaSwitchLog.push({ turn: currentTurnIndex, fromPersonaIndex: sw.fromIndex, toPersonaIndex: sw.toIndex, fromPersonaId: sw.fromPersonaId, toPersonaId: sw.toPersonaId, reason: sw.reason, transitionLine: sw.transitionLine, timestamp: new Date().toISOString() });
            streamSwitchToPersona = toP;
          }
        }
      }

      const streamIsCompleted = metaParsed.complete === true;
      const streamUpdatedPersonaRun = await storage.updatePersonaRun(personaRunId, {
        turnCount: newTurnCount,
        status: streamIsCompleted ? 'completed' : 'active',
        completedAt: streamIsCompleted ? new Date() : null,
        ...(streamSwitchToPersona ? { activePersonaIndex: streamNewActivePersonaIndex, personaSwitchLog: streamNewPersonaSwitchLog } : {}),
      });

      // Completion side effects (mirrors non-streaming path exactly)
      if (streamIsCompleted) {
        await checkAndCompleteScenario(personaRun!.scenarioRunId);
        const finalSimState = getSessionState(personaRunId);
        if (finalSimState) {
          storage.createSimulationEvent({
            personaRunId, scenarioRunId: personaRun!.scenarioRunId,
            turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'session_end',
            toolName: null, args: null, result: { reason: 'conversation_completed' },
            stateBefore: null, stateAfter: finalSimState,
            stateVersionBefore: null, stateVersionAfter: finalSimState.version,
            includeInReport: false,
          }).catch(e => console.warn('[streaming] Failed to log session_end event:', e));
        }
        if (scenarioObjRef && persona) {
          const _convForFeedback = { messages: [...existingMessages.map(m => ({ sender: m.sender, message: m.message, timestamp: m.createdAt?.toISOString() ?? new Date().toISOString() })), { sender: 'user' as const, message, timestamp: new Date().toISOString() }] };
          setImmediate(() => {
            generateAndSaveFeedback(personaRunId, _convForFeedback, scenarioObjRef, persona, userLanguage)
              .catch(e => console.warn('[streaming] Auto-feedback generation failed:', e));
          });
        }
      }

      // Simulation state resolution (fast mode only; quality state already applied above)
      let streamSimulationState: import('../services/simulation/simulationTypes').SimulationState | null = null;
      let streamSimTurnScore: TurnScore | null = null;
      let streamFastEvalFailed = false;
      if (shouldEval && evalState) {
        if (evalMode === 'quality' && qualityEvalResult && qualityFinalState) {
          try {
            await storage.saveSimulationState(personaRunId, qualityFinalState as unknown as Record<string, unknown>);
            storage.createSimulationEvent({ personaRunId, scenarioRunId: personaRun!.scenarioRunId, turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'auto_evaluation', toolName: null, args: { userTextLength: message.length, method: qualityEvalResult.method, evalMode: 'quality' }, result: { turnScore: qualityEvalResult.turnScore }, stateBefore: evalState, stateAfter: qualityFinalState, stateVersionBefore: evalState.version, stateVersionAfter: qualityFinalState.version, includeInReport: true }).catch(e => console.warn('[streaming] Failed to log quality eval event:', e));
          } catch (e) { console.warn('[streaming] Quality eval DB persist failed:', e); }
          streamSimulationState = qualityFinalState;
          streamSimTurnScore = qualityEvalResult.turnScore;
        } else if (fastEvalInput && fastEvalPromise) {
          try {
            const er = await fastEvalPromise;
            if (!er.skipped) {
              let ns = applySimulationPatch(personaRunId, { source: 'server_evaluation', priority: 'normal', turnId: evalTurnId, patch: { turnScoresToAdd: [er.turnScore], npcEmotionDelta: er.emotionDelta } });
              const rp = buildRuleFallbackPatch(er.turnScore, ns, 0);
              if (rp) ns = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'low', turnId: evalTurnId, patch: rp });
              const st = resolveStageTransition(ns, getSessionFlowGraph(personaRunId));
              if (st) ns = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'normal', turnId: evalTurnId, patch: { targetStage: st } });
              const fInc = inferIncidentCandidate(ns, personaRunId, currentTurnIndex, userLanguage, scenarioRun!.scenarioId);
              if (fInc && evaluateIncidentProbability(true, scenarioDifficultyProfile)) { const fCool = checkIncidentCooldown(personaRunId, fInc.type); if (fCool.allowed) { recordIncidentCooldown(personaRunId, fInc.type); ns = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'normal', turnId: evalTurnId, patch: { incidentsToAdd: [fInc] } }); } }
              await storage.saveSimulationState(personaRunId, ns as unknown as Record<string, unknown>);
              storage.createSimulationEvent({ personaRunId, scenarioRunId: personaRun!.scenarioRunId, turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'auto_evaluation', toolName: null, args: { userTextLength: message.length, method: er.method, evalMode: 'fast' }, result: { turnScore: er.turnScore }, stateBefore: evalState, stateAfter: ns, stateVersionBefore: evalState!.version, stateVersionAfter: ns.version, includeInReport: true }).catch(e => console.warn('[streaming] Failed to log fast eval event:', e));
              streamSimulationState = ns;
              streamSimTurnScore = er.turnScore;
            } else {
              streamSimulationState = evalState;
            }
          } catch (e) {
            console.warn('[streaming] Fast mode eval failed:', e);
            streamSimulationState = evalState;
            streamFastEvalFailed = true;
          }
        }
      } else if (!isPersonaX) {
        streamSimulationState = getSessionState(personaRunId);
      }

      const streamEvalSkipped = (!isPersonaX && !isSkipTurn && !shouldEval) || streamFastEvalFailed;

      // Check if terminationRules fired in streaming path
      const streamTerminationReason = streamSimulationState?.terminationReason;
      let streamIsTerminated = false;
      if (streamTerminationReason && !streamIsCompleted && personaRun!.status !== 'completed') {
        streamIsTerminated = true;
        await storage.updatePersonaRun(personaRunId, { status: 'completed', completedAt: new Date(), terminationReason: streamTerminationReason as string });
        await checkAndCompleteScenario(personaRun!.scenarioRunId);
        if (streamSimulationState) {
          storage.createSimulationEvent({
            personaRunId, scenarioRunId: personaRun!.scenarioRunId,
            turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'session_end',
            toolName: null, args: null, result: { reason: `termination_${streamTerminationReason}` },
            stateBefore: null, stateAfter: streamSimulationState,
            stateVersionBefore: null, stateVersionAfter: streamSimulationState.version,
            includeInReport: true,
          }).catch(e => console.warn('[streaming] Failed to log termination session_end event:', e));
        }
        console.log(`[streaming] terminationRules fired: reason=${streamTerminationReason}, personaRunId=${personaRunId}`);
      }

      const streamJoinSegments = (scenarioWithUserDifficulty as any)?.personaSwitchMode === 'join'
        ? parseJoinModeSpeakerSegments(streamAiMessageContent)
        : null;

      writeEvent({
        type: 'done',
        message: streamAiMessageContent,
        emotion: streamEmotion,
        emotionReason: streamEmotionReason,
        isCompleted: streamIsCompleted || streamIsTerminated,
        turnCount: newTurnCount,
        personaRun: streamUpdatedPersonaRun,
        messages: [{ sender: 'ai', message: streamAiMessageContent, timestamp: new Date().toISOString(), emotion: streamEmotion, emotionReason: streamEmotionReason, turnIndex: currentTurnIndex, ...(streamJoinSegments ? { speakerSegments: streamJoinSegments } : {}) }],
        simulationState: streamSimulationState,
        turnScore: streamSimTurnScore,
        ...(streamTerminationReason ? { terminationReason: streamTerminationReason } : {}),
        ...(streamEvalSkipped ? { evaluationSkipped: true } : {}),
        ...(streamJoinSegments ? { speakerSegments: streamJoinSegments } : {}),
        ...(streamSwitchToPersona ? {
          personaSwitched: {
            fromIndex: (personaRun!.activePersonaIndex as number | null) ?? 0,
            toIndex: streamNewActivePersonaIndex,
            fromPersonaName: streamSwitchFromPersona?.name,
            reason: streamSwitchPersonaInfo?.reason ?? '',
            transitionLine: streamSwitchPersonaInfo?.transitionLine ?? '',
            turnIndex: currentTurnIndex,
            newPersonaName: streamSwitchToPersona.name,
            newPersona: { id: streamSwitchToPersona.id, name: streamSwitchToPersona.name, role: streamSwitchToPersona.position, image: streamSwitchToPersona.image },
          },
        } : {}),
      });

      res.end();
      return;
    }
    // ── End of SSE Streaming path ────────────────────────────────────────────────

    const aiResult = await generateAIResponse(
      scenarioForAI,
      messagesForAI,
      persona,
      undefined,
      userLanguage,
      userName
    );

    const isCompleted = (aiResult as any).isCompleted || false;
    const switchPersonaInfo = (aiResult as any).switchPersona as { targetPersonaIndex: number; reason?: string; transitionLine?: string } | undefined;
    // Use transitionLine as the persisted AI message when a persona switch occurs
    const aiMessageContent = switchPersonaInfo?.transitionLine?.trim() || aiResult.content;

    await storage.createChatMessage({
      personaRunId,
      sender: "ai",
      message: aiMessageContent,
      turnIndex: currentTurnIndex,
      emotion: aiResult.emotion || null,
      emotionReason: aiResult.emotionReason || null
    });
    let newActivePersonaIndex: number = (personaRun!.activePersonaIndex as number | null) ?? 0;
    let newPersonaSwitchLog = Array.isArray(personaRun!.personaSwitchLog) ? [...(personaRun!.personaSwitchLog as any[])] : [];
    let switchToPersona: any = null;
    let switchFromPersona: any = null;
    if (switchPersonaInfo && typeof switchPersonaInfo.targetPersonaIndex === 'number') {
      const allScenarioPersonasForSwitch = (scenarioWithUserDifficulty as any)?.allPersonas ?? (scenarioWithUserDifficulty as any)?.personas ?? [];
      const toolResult = handleToolCall('switch_persona', {
        targetPersonaIndex: switchPersonaInfo.targetPersonaIndex,
        reason: switchPersonaInfo.reason ?? '',
        transitionLine: switchPersonaInfo.transitionLine ?? '',
      }, {
        personaRunId,
        turnId: evalTurnId,
        turnIndex: currentTurnIndex,
        currentTurnIncidentFired: false,
        toolCallCountThisTurn: 0,
        emotionCallCountThisTurn: 0,
        language: userLanguage as 'ko' | 'en' | 'ja' | 'zh',
        currentPersonaIndex: newActivePersonaIndex,
        scenarioPersonas: allScenarioPersonasForSwitch,
      });
      if (toolResult.success && toolResult.personaSwitched) {
        const switched = toolResult.personaSwitched;
        const toPersona = allScenarioPersonasForSwitch[switched.toIndex];
        if (toPersona) {
          const switchEntry = {
            turn: currentTurnIndex,
            fromPersonaIndex: switched.fromIndex,
            toPersonaIndex: switched.toIndex,
            fromPersonaId: switched.fromPersonaId,
            toPersonaId: switched.toPersonaId,
            reason: switched.reason,
            transitionLine: switched.transitionLine,
            timestamp: new Date().toISOString(),
          };
          switchFromPersona = allScenarioPersonasForSwitch[switched.fromIndex];
          newActivePersonaIndex = switched.toIndex;
          newPersonaSwitchLog.push(switchEntry);
          switchToPersona = toPersona;
          console.log(`🔄 [Text/TTS] Persona switch via handleToolCall: ${switched.fromIndex} → ${switched.toIndex} (${toPersona.name})`);
        }
      }
    }
    const updatedPersonaRun = await storage.updatePersonaRun(personaRunId, {
      turnCount: newTurnCount,
      status: isCompleted ? "completed" : "active",
      completedAt: isCompleted ? new Date() : null,
      ...(switchPersonaInfo ? { activePersonaIndex: newActivePersonaIndex, personaSwitchLog: newPersonaSwitchLog } : {}),
    });

    if (isCompleted) {
      await checkAndCompleteScenario(personaRun!.scenarioRunId);
      // Log session_end simulation event so audit trail is complete
      const finalSimState = getSessionState(personaRunId);
      if (finalSimState) {
        storage.createSimulationEvent({
          personaRunId, scenarioRunId: personaRun!.scenarioRunId,
          turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'session_end',
          toolName: null, args: null, result: { reason: 'conversation_completed' },
          stateBefore: null, stateAfter: finalSimState,
          stateVersionBefore: null, stateVersionAfter: finalSimState.version,
          includeInReport: false,
        }).catch(e => console.warn('[conversations] Failed to log session_end event:', e));
      }
      // Auto-generate feedback server-side so it is ready before the client navigates to results
      if (scenarioObjRef && persona) {
        const _convForFeedback = { messages: [...existingMessages, { sender: 'user', message, timestamp: new Date().toISOString() }] };
        setImmediate(() => {
          generateAndSaveFeedback(personaRunId, _convForFeedback as any, scenarioObjRef, persona, userLanguage)
            .catch(e => console.warn('[conversations] Auto-feedback generation failed:', e));
        });
      }
    }

    let simulationState: import('../services/simulation/simulationTypes').SimulationState | null = null;
    let simTurnScore: any = null;
    let fastEvalFailed = false;

    if (shouldEval && evalState) {
      if (evalMode === 'quality' && qualityEvalResult && qualityFinalState) {
        // Quality mode: patches already applied before AI generation; persist to DB
        try {
          await storage.saveSimulationState(personaRunId, qualityFinalState as unknown as Record<string, unknown>);
          storage.createSimulationEvent({
            personaRunId, scenarioRunId: personaRun!.scenarioRunId,
            turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'auto_evaluation',
            toolName: null,
            args: { userTextLength: message.length, method: qualityEvalResult.method, evalMode: 'quality' },
            result: { turnScore: qualityEvalResult.turnScore },
            stateBefore: evalState, stateAfter: qualityFinalState,
            stateVersionBefore: evalState.version, stateVersionAfter: qualityFinalState.version,
            includeInReport: true,
          }).catch(e => console.warn('[conversations] Failed to log quality eval event:', e));
        } catch (e) {
          console.warn('[conversations] Quality eval DB persist failed:', e);
        }
        simulationState = qualityFinalState;
        simTurnScore = qualityEvalResult.turnScore;
      } else if (fastEvalInput && fastEvalPromise) {
        // Fast mode: await the evaluation that was already started in parallel with AI generation
        try {
          const er = await fastEvalPromise;
          if (!er.skipped) {
            let ns = applySimulationPatch(personaRunId, { source: 'server_evaluation', priority: 'normal', turnId: evalTurnId, patch: { turnScoresToAdd: [er.turnScore], npcEmotionDelta: er.emotionDelta } });
            const rp = buildRuleFallbackPatch(er.turnScore, ns, 0);
            if (rp) ns = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'low', turnId: evalTurnId, patch: rp });
            const st = resolveStageTransition(ns, getSessionFlowGraph(personaRunId));
            if (st) ns = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'normal', turnId: evalTurnId, patch: { targetStage: st } });
            // Server-rule incident inference for fast mode (text/TTS path)
            const fInc = inferIncidentCandidate(ns, personaRunId, currentTurnIndex, userLanguage as any, scenarioRun!.scenarioId);
            if (fInc && evaluateIncidentProbability(true, scenarioDifficultyProfile)) {
              const fCool = checkIncidentCooldown(personaRunId, fInc.type);
              if (fCool.allowed) {
                recordIncidentCooldown(personaRunId, fInc.type);
                ns = applySimulationPatch(personaRunId, { source: 'server_rule', priority: 'normal', turnId: evalTurnId, patch: { incidentsToAdd: [fInc] } });
              }
            }
            await storage.saveSimulationState(personaRunId, ns as unknown as Record<string, unknown>);
            storage.createSimulationEvent({ personaRunId, scenarioRunId: personaRun!.scenarioRunId, turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'auto_evaluation', toolName: null, args: { userTextLength: message.length, method: er.method, evalMode: 'fast' }, result: { turnScore: er.turnScore }, stateBefore: evalState, stateAfter: ns, stateVersionBefore: evalState!.version, stateVersionAfter: ns.version, includeInReport: true }).catch(e => console.warn('[conversations] Failed to log fast eval event:', e));
            simulationState = ns;
            simTurnScore = er.turnScore;
          } else {
            simulationState = evalState;
          }
        } catch (e) {
          const fastEvalError = e instanceof Error ? e : new Error(String(e));
          console.error('[conversations] Fast mode synchronous evaluation failed', {
            personaRunId,
            turnIndex: currentTurnIndex,
            evaluationMode: 'fast',
            errorMessage: fastEvalError.message,
            errorStack: fastEvalError.stack,
          });
          simulationState = evalState;
          fastEvalFailed = true;
        }
      }
    } else if (!isPersonaX) {
      simulationState = getSessionState(personaRunId);
    }

    // Check if terminationRules fired; if so, complete the persona run
    const terminationReason = simulationState?.terminationReason;
    let isTerminated = false;
    if (terminationReason && !isCompleted && personaRun!.status !== 'completed') {
      isTerminated = true;
      await storage.updatePersonaRun(personaRunId, {
        status: 'completed',
        completedAt: new Date(),
        terminationReason: terminationReason as string,
      });
      await checkAndCompleteScenario(personaRun!.scenarioRunId);
      if (simulationState) {
        storage.createSimulationEvent({
          personaRunId, scenarioRunId: personaRun!.scenarioRunId,
          turnIndex: currentTurnIndex, turnId: evalTurnId, eventType: 'session_end',
          toolName: null, args: null, result: { reason: `termination_${terminationReason}` },
          stateBefore: null, stateAfter: simulationState,
          stateVersionBefore: null, stateVersionAfter: simulationState.version,
          includeInReport: true,
        }).catch(e => console.warn('[conversations] Failed to log termination session_end event:', e));
      }
      console.log(`[conversations] terminationRules fired: reason=${terminationReason}, personaRunId=${personaRunId}`);
    }

    // Signal to the client that evaluation was skipped due to a short message or a failed eval
    const evaluationSkipped = (!isPersonaX && !isSkipTurn && !shouldEval) || fastEvalFailed;

    const joinModeSpeakerSegments = (scenarioWithUserDifficulty as any)?.personaSwitchMode === 'join'
      ? parseJoinModeSpeakerSegments(aiMessageContent)
      : null;

    res.json({
      message: aiMessageContent,
      emotion: aiResult.emotion,
      emotionReason: aiResult.emotionReason,
      isCompleted: isCompleted || isTerminated,
      turnCount: newTurnCount,
      personaRun: updatedPersonaRun,
      messages: [{
        sender: "ai",
        message: aiMessageContent,
        timestamp: new Date().toISOString(),
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
        turnIndex: currentTurnIndex,
        ...(joinModeSpeakerSegments ? { speakerSegments: joinModeSpeakerSegments } : {}),
      }],
      simulationState,
      turnScore: simTurnScore,
      ...(terminationReason ? { terminationReason } : {}),
      ...(evaluationSkipped ? { evaluationSkipped: true } : {}),
      ...(joinModeSpeakerSegments ? { speakerSegments: joinModeSpeakerSegments } : {}),
      ...(switchToPersona ? {
        personaSwitched: {
          fromIndex: (personaRun!.activePersonaIndex as number | null) ?? 0,
          toIndex: newActivePersonaIndex,
          fromPersonaName: switchFromPersona?.name,
          reason: switchPersonaInfo?.reason ?? '',
          transitionLine: switchPersonaInfo?.transitionLine ?? '',
          turnIndex: currentTurnIndex,
          newPersonaName: switchToPersona.name,
          newPersona: { id: switchToPersona.id, name: switchToPersona.name, role: switchToPersona.position, image: switchToPersona.image },
        },
      } : {}),
    });
  }));

  router.post("/:id/realtime-messages", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    const personaRunId = req.params.id;

    const { personaRun } = await verifyPersonaRunOwnership(personaRunId, userId);

    const { messages } = req.body;
    const isFinal = req.body.isFinal === true;

    if (!Array.isArray(messages)) {
      throw createHttpError(400, "Messages must be an array");
    }

    console.log(`🎙️ 실시간 음성 대화 메시지 일괄 저장: ${personaRunId}, ${messages.length}개 메시지, isFinal=${isFinal}`);

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

    if (isFinal) {
      await storage.updatePersonaRun(personaRunId, {
        status: 'completed',
        completedAt: new Date(),
        turnCount
      });
      await checkAndCompleteScenario(personaRun!.scenarioRunId);
    } else {
      await storage.updatePersonaRun(personaRunId, {
        status: 'active',
        completedAt: null,
        turnCount
      });
    }

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
