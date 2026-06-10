import WebSocket from 'ws';
import { fileManager } from './fileManager';
import { GoogleGenAI, Modality, ActivityHandling } from '@google/genai';
import { storage } from '../storage';
import {
  RealtimeSession,
  CLEANUP_INTERVAL_MS,
  MAX_CONCURRENT_SESSIONS,
} from './voice/types';
import { buildSystemInstructions, buildReconnectSystemInstructions } from './voice/systemPromptBuilder';
import { applyScenarioOverride } from './scenarios/overrideResolver';
import { getSessionState } from './simulation/simulationEngine';
import { applyHarnessToSession, readScenarioHarness } from './simulation/harnessReader';
import { handleGeminiMessage } from './voice/geminiMessageHandler';
import { handleClientMessage as processClientMessage } from './voice/clientMessageHandler';
import { handleGeminiClose } from './voice/geminiReconnector';
import { connectOpenAIRealtime } from './voice/openaiRealtimeAdapter';
import { handleOpenAIClose } from './voice/openaiReconnector';
import {
  startCleanupScheduler,
  trackSessionUsage,
  getActiveSessionCount,
  getSessionStatus,
} from './voice/sessionManager';
import { buildUserPersonaInstructions } from './voice/prompts/userPersonaPrompt';
import { normalizeProfileName } from './conversationContextBuilder';
import { SIMULATION_TOOLS, SWITCH_PERSONA_TOOL } from './simulation/simulationTools';
import { db } from '../storage';
import { personaRuns } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getOrCreateSessionContext } from './simulation/simulationEngine';
import { createDefaultSimulationState } from './simulation/simulationTypes';

// Per Google official docs (ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview):
// 'gemini-3.1-flash-live-preview' is the current supported model for v1beta bidiGenerateContent.
// All previous names ('gemini-live-2.5-flash-preview', 'gemini-live-2.5-flash-native-audio', etc.) fail.
const DEFAULT_REALTIME_MODEL = 'gemini-3.1-flash-live-preview';

// All Gemini Live models use v1beta. v1alpha is never used.
const VALID_GEMINI_REALTIME_MODELS = [
  'gemini-3.1-flash-live-preview', // v1beta — Google AI official docs confirmed
];
const VALID_OPENAI_REALTIME_MODELS = ['gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview'];

function isOpenAIRealtimeModel(model: string): boolean {
  return VALID_OPENAI_REALTIME_MODELS.includes(model);
}

async function preloadRecentMessages(
  conversationId: string,
  sessionId: string,
  label = ''
): Promise<Array<{ role: 'user' | 'ai'; text: string }>> {
  try {
    const dbMessages = await storage.getChatMessagesByPersonaRun(conversationId);
    const last30 = dbMessages.slice(-30);
    const messages = last30.map(m => ({
      role: (m.sender === 'ai' ? 'ai' : 'user') as 'user' | 'ai',
      text: m.message.slice(0, 300),
    }));
    if (messages.length > 0) {
      console.log(`📚 ${label}Preloaded ${messages.length} messages from DB for session context`);
    }
    return messages;
  } catch (error) {
    console.warn(`⚠️ ${label}Failed to preload conversation history for session ${sessionId}:`, error);
    return [];
  }
}

// Always use v1beta for all Gemini Live models.
// v1alpha is not used — production services must target minimum v1beta.
function geminiLiveApiVersion(_model: string): 'v1beta' {
  return 'v1beta';
}

export class RealtimeVoiceService {
  private sessions: Map<string, RealtimeSession> = new Map();
  private genAI: GoogleGenAI | null = null;
  private genAILiveAlpha: GoogleGenAI | null = null;
  private genAILiveBeta: GoogleGenAI | null = null;
  private isAvailable: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (geminiApiKey) {
      this.genAI = new GoogleGenAI({ apiKey: geminiApiKey });
      // Preview models (e.g. gemini-3.1-flash-live-preview) require v1alpha.
      this.genAILiveAlpha = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: { apiVersion: 'v1alpha' },
      });
      // GA models (e.g. gemini-2.0-flash-live-001) require v1beta.
      this.genAILiveBeta = new GoogleGenAI({
        apiKey: geminiApiKey,
        httpOptions: { apiVersion: 'v1beta' },
      });
      this.isAvailable = true;
      console.log('✅ Gemini Live API Service initialized (live: v1alpha + v1beta, other: v1beta)');
    } else if (openaiApiKey) {
      // OpenAI Realtime-only environment — Gemini not needed for voice sessions
      this.isAvailable = true;
      console.log('✅ Realtime Voice Service initialized (OpenAI Realtime only — no Gemini key)');
    } else {
      console.warn('⚠️  No GOOGLE_API_KEY or OPENAI_API_KEY set - Realtime Voice features disabled');
    }

    if (this.isAvailable) {
      this.startCleanupScheduler();
    }
  }

  private startCleanupScheduler(): void {
    this.cleanupInterval = startCleanupScheduler(
      CLEANUP_INTERVAL_MS, this.sessions, this.closeSession.bind(this)
    );
  }

  isServiceAvailable(): boolean {
    return this.isAvailable;
  }

  private getProviderAwareDefault(): string {
    const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    if (!hasGemini && process.env.OPENAI_API_KEY) {
      // OpenAI-only environment: default to gpt-4o-mini-realtime-preview
      return 'gpt-4o-mini-realtime-preview';
    }
    return DEFAULT_REALTIME_MODEL;
  }

  private async getRealtimeModel(): Promise<string> {
    const fallback = this.getProviderAwareDefault();
    try {
      const timeoutPromise = new Promise<undefined>((_, reject) =>
        setTimeout(() => reject(new Error('DB setting fetch timeout')), 2000)
      );
      const settingPromise = storage.getSystemSetting('ai', 'model_realtime');
      const setting = await Promise.race([settingPromise, timeoutPromise]);
      const allValidModels = [...VALID_GEMINI_REALTIME_MODELS, ...VALID_OPENAI_REALTIME_MODELS];
      const model = setting?.value;
      if (model && allValidModels.includes(model)) {
        if (isOpenAIRealtimeModel(model) && !process.env.OPENAI_API_KEY) {
          console.warn(`⚠️ OpenAI Realtime model ${model} selected but OPENAI_API_KEY is not set — falling back to ${fallback}`);
          return fallback;
        }
        const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
        if (!isOpenAIRealtimeModel(model) && !hasGemini) {
          console.warn(`⚠️ Gemini Realtime model ${model} selected but no Gemini key — falling back to ${fallback}`);
          return fallback;
        }
        console.log(`🤖 Using realtime model from DB: ${model}`);
        return model;
      }
      console.log(`🤖 Using default realtime model: ${fallback}`);
      return fallback;
    } catch (error) {
      console.warn(`⚠️ Failed to get realtime model from DB, using default: ${fallback}`);
      return fallback;
    }
  }

  private async connectToOpenAI(
    session: RealtimeSession,
    systemInstructions?: string,
    gender?: 'male' | 'female'
  ): Promise<void> {
    if (systemInstructions) {
      session.systemInstructions = systemInstructions;
    }
    if (gender) {
      session.voiceGender = gender;
    }
    session.selectedVoice = null;

    const model = session.realtimeModel;

    const adapter = await connectOpenAIRealtime(
      model,
      session,
      this.sendToClient.bind(this),
      (event) => {
        handleOpenAIClose(
          event,
          session,
          this.sessions,
          this.sendToClient.bind(this),
          (sess) => this.connectToOpenAI(sess),
          trackSessionUsage
        );
      }
    );

    session.geminiSession = adapter;

    if (session.pendingClientReady) {
      console.log(`▶️ [OpenAI] Replaying buffered client.ready for session: ${session.id}`);
      const buffered = session.pendingClientReady;
      session.pendingClientReady = null;
      this.handleClientMessage(session.id, buffered);
    }

    if (session.greetingTimeoutId !== null) {
      clearTimeout(session.greetingTimeoutId);
      session.greetingTimeoutId = null;
    }

    session.greetingTimeoutId = setTimeout(() => {
      session.greetingTimeoutId = null;
      const currentSession = this.sessions.get(session.id);
      const pendingHasExisting = currentSession?.pendingClientReady?.hasExistingConversation === true;
      const pendingIsResuming = currentSession?.pendingClientReady?.isResuming === true;
      if (
        currentSession &&
        !currentSession.hasTriggeredFirstGreeting &&
        !currentSession.hasReceivedFirstAIResponse &&
        !pendingHasExisting &&
        !pendingIsResuming &&
        currentSession.geminiSession
      ) {
        console.log('⏰ [OpenAI] client.ready timeout (3s) — auto-triggering first greeting...');
        currentSession.hasTriggeredFirstGreeting = true;
        const greetingPayload = {
          turns: [{ role: 'user', parts: [{ text: '안녕하세요' }] }],
          turnComplete: true,
        };
        currentSession.pendingMessages.push({ index: currentSession.outgoingMessageIndex++, payload: { type: 'clientContent', data: greetingPayload } });
        currentSession.geminiSession.sendClientContent(greetingPayload);
      }
    }, 3000);
  }

  async createSession(
    sessionId: string,
    conversationId: string,
    scenarioId: string,
    personaId: string,
    userId: string,
    clientWs: WebSocket,
    userSelectedDifficulty?: number,
    userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
  ): Promise<void> {
    const sessionStartTime = Date.now();
    console.log(`⏱️ [TIMING] createSession 시작: ${new Date(sessionStartTime).toISOString()}`);

    if (!this.isAvailable) {
      throw new Error('Realtime Voice Service is not available. Please configure GOOGLE_API_KEY or OPENAI_API_KEY.');
    }

    const currentSessionCount = this.sessions.size;
    if (currentSessionCount >= MAX_CONCURRENT_SESSIONS) {
      console.warn(`⚠️ Max concurrent sessions reached: ${currentSessionCount}/${MAX_CONCURRENT_SESSIONS}`);
      throw new Error(`현재 동시 접속자가 많아 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요. (${currentSessionCount}/${MAX_CONCURRENT_SESSIONS})`);
    }

    console.log(`🎙️ Creating realtime voice session: ${sessionId} (${currentSessionCount + 1}/${MAX_CONCURRENT_SESSIONS})`);

    if (scenarioId.startsWith('__user_persona__:')) {
      return this.createUserPersonaSession(
        sessionId, conversationId, scenarioId, personaId, userId, clientWs, userLanguage, sessionStartTime
      );
    }

    const scenarios = await fileManager.getAllScenarios();
    const scenarioObj = scenarios.find(s => s.id === scenarioId);
    if (!scenarioObj) throw new Error(`Scenario not found: ${scenarioId}`);

    const scenarioPersona: any = scenarioObj.personas.find((p: any) => p.id === personaId);
    if (!scenarioPersona) throw new Error(`Persona not found: ${personaId}`);

    const mbtiType: string = scenarioPersona.personaRef?.replace('.json', '') || '';
    const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

    let userName = '사용자';
    let activeScenarioOverride = null;
    let resolvedScenarioObj: any = scenarioObj;
    try {
      const user = await storage.getUser(userId);
      userName = normalizeProfileName(user?.name) || '사용자';
      if (user?.organizationId) {
        try {
          const overrideRecord = await storage.getScenarioOverrideByOrgAndScenario(user.organizationId, scenarioId);
          if (overrideRecord) {
            activeScenarioOverride = overrideRecord.override;
            resolvedScenarioObj = applyScenarioOverride(scenarioObj, activeScenarioOverride);
            console.log(`[realtimeVoice] Applied scenario override for org=${user.organizationId}, scenario=${scenarioId}`);
          }
        } catch (err) {
          console.warn('[realtimeVoice] Failed to load scenario override (ignored):', err);
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load user info for userId ${userId}:`, error);
    }

    const playerRole = resolvedScenarioObj.context?.playerRole || {};
    const userRoleInfo = {
      name: userName,
      position: playerRole.position || '담당자',
      department: playerRole.department || '',
      experience: playerRole.experience || '',
      responsibility: playerRole.responsibility || ''
    };

    console.log(`👤 사용자 정보: ${userRoleInfo.name} (${userRoleInfo.position}${userRoleInfo.department ? ', ' + userRoleInfo.department : ''})`);

    const scenarioWithUserDifficulty = {
      ...resolvedScenarioObj,
      difficulty: userSelectedDifficulty || 4
    };

    const allPersonas = resolvedScenarioObj.personas || [];

    // Bug 3 fix: Restore activePersonaIndex from DB on reconnect so voice session
    // starts with the correct persona instead of always defaulting to the original one.
    let dbActivePersonaIndex: number | null = null;
    try {
      const personaRunRecord = await storage.getPersonaRun(conversationId);
      const dbIdx = personaRunRecord?.activePersonaIndex as number | null | undefined;
      if (typeof dbIdx === 'number' && dbIdx >= 0 && dbIdx < allPersonas.length) {
        dbActivePersonaIndex = dbIdx;
        console.log(`🔄 [Voice] Restoring activePersonaIndex from DB: ${dbIdx} for personaRunId=${conversationId}`);
      }
    } catch (e) {
      console.warn('[realtimeVoice] Failed to fetch personaRun for activePersonaIndex restore (ignored):', e);
    }

    // Resolve the initial active persona index:
    // 1. DB activePersonaIndex (restored after reconnect / prior switch)
    // 2. personaId lookup in allPersonas
    // 3. isPrimary flag
    // 4. fallback to 0
    const initialPersonaIndex = (() => {
      if (dbActivePersonaIndex !== null) return dbActivePersonaIndex;
      const byId = allPersonas.findIndex((p: any) => p.id === personaId);
      if (byId >= 0) return byId;
      const byPrimary = allPersonas.findIndex((p: any) => p.isPrimary === true);
      return byPrimary >= 0 ? byPrimary : 0;
    })();

    // Realtime voice always uses replace mode for persona switching — join mode is
    // text/TTS-only. Hard-force 'replace' here to prevent join-mode multi-speaker
    // instructions from leaking into voice prompts.
    const initialFlowGraph = (resolvedScenarioObj as any).flowGraph ?? null;
    const initialStageGoal: string | undefined = initialFlowGraph?.stages?.find((s: any) => s.id === 'intro')?.goal;
    const scenarioPlayerConstraints = (resolvedScenarioObj as any).playerConstraints ?? null;
    const systemInstructions = buildSystemInstructions(
      scenarioWithUserDifficulty, scenarioPersona, mbtiPersona, userRoleInfo, userLanguage,
      true, allPersonas, initialPersonaIndex, resolvedScenarioObj.targetTurns, 'replace', initialStageGoal,
      scenarioPlayerConstraints, activeScenarioOverride
    );

    // Pre-build system instructions for every persona so switching rebuilds the full prompt
    const personaSystemInstructions: string[] = [systemInstructions];
    if (allPersonas.length > 1) {
      for (let pIdx = 1; pIdx < allPersonas.length; pIdx++) {
        const sp = allPersonas[pIdx] as any;
        const mbtiT = sp.personaRef?.replace('.json', '');
        const mbtiP = mbtiT ? await fileManager.getPersonaByMBTI(mbtiT) : null;
        personaSystemInstructions.push(buildSystemInstructions(
          scenarioWithUserDifficulty, sp, mbtiP, userRoleInfo, userLanguage,
          true, allPersonas, pIdx, resolvedScenarioObj.targetTurns, 'replace', initialStageGoal,
          scenarioPlayerConstraints, activeScenarioOverride
        ));
      }
    }

    // Bug 3 fix (continued): Use the persona-specific system instructions for the active persona.
    // If initialPersonaIndex > 0 (e.g. after reconnect post-switch), override systemInstructions
    // with the pre-built prompt for that persona so Gemini Live starts in the right character.
    const activeSystemInstructions = personaSystemInstructions[initialPersonaIndex] ?? systemInstructions;

    // Resolve the active persona object for session initialization
    const activeInitialPersona = (initialPersonaIndex > 0 && allPersonas[initialPersonaIndex])
      ? allPersonas[initialPersonaIndex] as any
      : scenarioPersona;

    console.log('\n' + '='.repeat(80));
    console.log('🎯 실시간 대화 시작 - 전달되는 명령 및 컨텍스트');
    console.log('='.repeat(80));
    console.log('📋 시나리오:', scenarioObj.title);
    console.log('👤 페르소나:', activeInitialPersona.name ?? scenarioPersona.name, `(${activeInitialPersona.position ?? scenarioPersona.position})`);
    console.log('🎭 MBTI:', mbtiType.toUpperCase());
    if (initialPersonaIndex > 0) console.log(`🔄 [Voice] Reconnect: restored to persona[${initialPersonaIndex}] ${activeInitialPersona.name}`);
    console.log('='.repeat(80));
    console.log('📝 시스템 명령 (SYSTEM INSTRUCTIONS):\n');
    console.log(activeSystemInstructions);
    console.log('='.repeat(80) + '\n');

    const realtimeModel = await this.getRealtimeModel();
    const gender: 'male' | 'female' = (activeInitialPersona.gender === 'female') ? 'female' : (scenarioPersona.gender === 'female' ? 'female' : 'male');
    console.log(`👤 페르소나 성별 설정: ${scenarioPersona.name} → ${gender} (시나리오 정의값: ${scenarioPersona.gender})`);

    const preloadedMessages = await preloadRecentMessages(conversationId, sessionId);

    const session: RealtimeSession = {
      id: sessionId, personaRunId: conversationId, scenarioId, personaId,
      // Bug 3 fix: use the active persona's name/voiceId when restored from DB
      personaName: activeInitialPersona.name ?? scenarioPersona.name,
      userId, userName, clientWs,
      geminiSession: null,
      currentTranscript: '', userTranscriptBuffer: '', audioBuffer: [],
      startTime: Date.now(), lastActivityTime: Date.now(),
      totalUserTranscriptLength: 0, totalAiTranscriptLength: 0, totalCachedTokens: 0,
      realtimeModel,
      hasReceivedFirstAIResponse: false, hasReceivedFirstAIAudio: false, hasTriggeredFirstGreeting: false,
      firstGreetingRetryCount: 0, isInterrupted: false,
      turnSeq: 0, cancelledTurnSeq: -1,
      sessionResumptionToken: null, isReconnecting: false, reconnectAttempts: 0,
      // Bug 3 fix: use the active persona's system instructions
      systemInstructions: activeSystemInstructions,
      voiceGender: gender, recentMessages: preloadedMessages,
      selectedVoice: null, goAwayWarningTime: null, pendingClientReady: null,
      userLanguage,
      pendingMessages: [], outgoingMessageIndex: 0,
      hasReceivedFirstTranscriptDelta: false, greetingResponseCount: 0, userTurnsCompleted: 0,
      userSpeechStarted: false,
      simulationState: null, scenarioRunId: null, toolCallCountThisTurn: 0, emotionCallCountThisTurn: 0,
      currentTurnIncidentFired: false,
      lastEvaluatedUserTurnIndex: -1, lastEvaluatedUserTurnId: null, lastFinalizedUserTranscriptHash: null,
      lastClientContentSentAt: 0,
      greetingTimeoutId: null,
      pendingIsResuming: false,
      pendingHasExistingConversation: false,
      usingReconnectInstructions: false,
      activePersonaIndex: initialPersonaIndex,
      // Bug 3 fix: use active persona's voiceId when restored from DB
      voiceId: (activeInitialPersona as any).voiceId ?? (scenarioPersona as any).voiceId ?? null,
      scenarioPersonas: allPersonas.length > 0 ? allPersonas : null,
      personaSystemInstructions: personaSystemInstructions.length > 1 ? personaSystemInstructions : undefined,
      targetTurns: scenarioObj.targetTurns,
      softCloseSent: false,
      personaSwitchPending: false,
      awaitingPersonaSwitch: false,
      simulationHarness: (scenarioObj as any).simulationHarness ?? null,
    };

    // Lookup scenarioRunId from DB for simulation event audit linkage
    try {
      const rows = await db.select({ scenarioRunId: personaRuns.scenarioRunId }).from(personaRuns).where(eq(personaRuns.id, conversationId)).limit(1);
      session.scenarioRunId = rows[0]?.scenarioRunId ?? null;
    } catch (e) {
      console.warn(`⚠️ [createSession] Failed to lookup scenarioRunId for ${conversationId}:`, e);
    }

    // Pre-initialize simulation state with timer config if scenario defines one
    const timerCfg = (scenarioObj as any)?.simulationConfig?.timer;
    if (timerCfg?.enabled && timerCfg.timeLimitSec > 0) {
      const initState = createDefaultSimulationState();
      initState.timer = { enabled: true, timeLimitSec: timerCfg.timeLimitSec, startedAt: new Date().toISOString(), pausedAt: null, elapsedSec: 0 };
      getOrCreateSessionContext(conversationId, initState);
      session.simulationState = initState;
      console.log(`⏱️ [createSession] Simulation timer initialized: ${timerCfg.timeLimitSec}s`);
    }

    // Apply all declarative harness fields to the engine session in one call
    const activePersonaNpcHarness = scenarioPersona?.npcBehaviorHarness ?? null;
    const harnessConfig = readScenarioHarness({ ...scenarioObj as any, npcBehaviorHarness: activePersonaNpcHarness });
    applyHarnessToSession(conversationId, harnessConfig);
    console.log(`🎛️ [createSession] Harness applied: flowGraph=${!!harnessConfig.flowGraph}, terminationRules=${!!harnessConfig.terminationRules}, difficultyProfile=${!!harnessConfig.difficultyProfile}, npcBehaviorHarness=${!!harnessConfig.npcBehaviorHarness}, evaluationHarness=${!!harnessConfig.evaluationHarness}`);

    this.sessions.set(sessionId, session);
    console.log(`⏱️ [TIMING] 세션 객체 생성 완료: ${Date.now() - sessionStartTime}ms`);

    if (isOpenAIRealtimeModel(realtimeModel)) {
      // Route to OpenAI Realtime API
      await this.connectToOpenAI(session, activeSystemInstructions, gender);
    } else {
      // Bug 3 fix: pass activeSystemInstructions (not the base systemInstructions) so that
      // on reconnect after a persona switch, Gemini Live starts with the correct persona prompt.
      await this.connectToGemini(session, activeSystemInstructions, gender, { isResume: preloadedMessages.length > 0 });

      // If client.ready.isResuming arrived during the Gemini connect window (buffered) but
      // no preloaded messages existed (so we used original greeting instructions), immediately
      // proactive-reconnect to apply reconnect-safe system instructions.
      if (session.pendingIsResuming && preloadedMessages.length === 0) {
        console.log('🔀 [createSession] pendingIsResuming with empty preload — proactive reconnect to apply reconnect instructions');
        session.pendingIsResuming = false;
        await this.proactiveReconnect(session);
      }

      // Same guard for text→voice transitions: if client.ready.hasExistingConversation
      // arrived during the connect window and the DB preload was empty (timing race),
      // trigger proactiveReconnect now so the greeting system prompt is replaced before
      // the user speaks.  session.recentMessages was already updated from the client-
      // supplied previousMessages inside the buffered client.ready handler (Fix 1), so
      // injectReconnectContext will have the correct conversation history.
      if (session.pendingHasExistingConversation && preloadedMessages.length === 0) {
        console.log('🔀 [createSession] pendingHasExistingConversation with empty preload — proactive reconnect to apply reconnect instructions');
        session.pendingHasExistingConversation = false;
        await this.proactiveReconnect(session);
      }
    }

    console.log(`⏱️ [TIMING] createSession 완료 (총): ${Date.now() - sessionStartTime}ms`);
  }

  private async createUserPersonaSession(
    sessionId: string, conversationId: string, scenarioId: string, personaId: string,
    userId: string, clientWs: WebSocket, userLanguage: 'ko' | 'en' | 'ja' | 'zh',
    sessionStartTime: number
  ): Promise<void> {
    const userPersonaId = scenarioId.split(':')[1];
    const userPersonaData = await storage.getUserPersonaById(userPersonaId);
    if (!userPersonaData) throw new Error(`UserPersona not found: ${userPersonaId}`);

    let userName = '사용자';
    try {
      const user = await storage.getUser(userId);
      userName = normalizeProfileName(user?.name) || '사용자';
    } catch {}

    const systemInstructions = buildUserPersonaInstructions(userPersonaData, userName, userLanguage);

    console.log('🎭 [UserPersona] 실시간 음성 세션:', userPersonaData.name);

    const gender: 'male' | 'female' = userPersonaData.gender === 'female' ? 'female' : 'male';
    const realtimeModel = await this.getRealtimeModel();

    const preloadedMessagesUserPersona = await preloadRecentMessages(conversationId, sessionId, '[UserPersona] ');

    const session: RealtimeSession = {
      id: sessionId, personaRunId: conversationId, scenarioId, personaId,
      personaName: userPersonaData.name, userId, userName, clientWs,
      geminiSession: null,
      currentTranscript: '', userTranscriptBuffer: '', audioBuffer: [],
      startTime: Date.now(), lastActivityTime: Date.now(),
      totalUserTranscriptLength: 0, totalAiTranscriptLength: 0, totalCachedTokens: 0,
      realtimeModel,
      hasReceivedFirstAIResponse: false, hasReceivedFirstAIAudio: false, hasTriggeredFirstGreeting: false,
      firstGreetingRetryCount: 0, isInterrupted: false,
      turnSeq: 0, cancelledTurnSeq: -1,
      sessionResumptionToken: null, isReconnecting: false, reconnectAttempts: 0,
      systemInstructions, voiceGender: gender, recentMessages: preloadedMessagesUserPersona,
      selectedVoice: null, goAwayWarningTime: null, pendingClientReady: null,
      userLanguage,
      pendingMessages: [], outgoingMessageIndex: 0,
      hasReceivedFirstTranscriptDelta: false, greetingResponseCount: 0, userTurnsCompleted: 0,
      userSpeechStarted: false,
      simulationState: null, scenarioRunId: null, toolCallCountThisTurn: 0, emotionCallCountThisTurn: 0,
      currentTurnIncidentFired: false,
      lastEvaluatedUserTurnIndex: -1, lastEvaluatedUserTurnId: null, lastFinalizedUserTranscriptHash: null,
      lastClientContentSentAt: 0,
      greetingTimeoutId: null,
      pendingIsResuming: false,
      pendingHasExistingConversation: false,
      usingReconnectInstructions: false,
      activePersonaIndex: 0,
      voiceId: null,
      scenarioPersonas: null,
    };

    this.sessions.set(sessionId, session);
    if (isOpenAIRealtimeModel(realtimeModel)) {
      await this.connectToOpenAI(session, systemInstructions, gender);
    } else {
      await this.connectToGemini(session, systemInstructions, gender, { isResume: preloadedMessagesUserPersona.length > 0 });
    }
    console.log(`⏱️ [TIMING] UserPersona createSession 완료: ${Date.now() - sessionStartTime}ms`);
  }

  private static readonly MALE_VOICES = ['Puck', 'Charon', 'Fenrir', 'Orus'];
  private static readonly FEMALE_VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr'];

  private getRandomVoice(gender: 'male' | 'female'): string {
    const voices = gender === 'female' ? RealtimeVoiceService.FEMALE_VOICES : RealtimeVoiceService.MALE_VOICES;
    return voices[Math.floor(Math.random() * voices.length)];
  }

  private getPersonaVoice(gender: 'male' | 'female', personaIndex: number): string {
    const voices = gender === 'female' ? RealtimeVoiceService.FEMALE_VOICES : RealtimeVoiceService.MALE_VOICES;
    return voices[personaIndex % voices.length];
  }

  private async connectToGemini(
    session: RealtimeSession,
    systemInstructions: string,
    gender: 'male' | 'female' = 'male',
    options?: { isResume?: boolean }
  ): Promise<void> {
    if (!this.genAILiveAlpha || !this.genAILiveBeta) throw new Error('Gemini AI not initialized');

    const connectStartTime = Date.now();
    console.log(`⏱️ [TIMING] connectToGemini 시작: ${new Date(connectStartTime).toISOString()}`);

    const simState = options?.isResume ? getSessionState(session.personaRunId) : null;
    const effectiveInstructions = options?.isResume
      ? buildReconnectSystemInstructions(systemInstructions, session.userLanguage, simState?.currentStageGoal)
      : systemInstructions;

    try {
      let voiceName: string;
      if (session.selectedVoice) {
        voiceName = session.selectedVoice;
        console.log(`🎤 Reusing session voice for ${gender} persona[${session.activePersonaIndex}]: ${voiceName}`);
      } else {
        voiceName = this.getPersonaVoice(gender, session.activePersonaIndex);
        session.selectedVoice = voiceName;
        console.log(`🎤 Setting voice for ${gender} persona[${session.activePersonaIndex}]: ${voiceName}`);
      }

      const langCodeMap: Record<'ko' | 'en' | 'ja' | 'zh', string> = {
        ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
      };
      const langCode = langCodeMap[session.userLanguage] || 'ko-KR';

      const isPersonaXSession = session.scenarioId.startsWith('__user_persona__:');
      const hasMultiplePersonas = session.scenarioPersonas && session.scenarioPersonas.length > 1;
      const allSimulationTools = hasMultiplePersonas
        ? [...SIMULATION_TOOLS, SWITCH_PERSONA_TOOL]
        : SIMULATION_TOOLS;
      const simulationToolDeclarations = isPersonaXSession
        ? []
        : [{ functionDeclarations: allSimulationTools }];

      const config: any = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: effectiveInstructions,
        inputAudioTranscription: { languageCode: langCode },
        outputAudioTranscription: { languageCode: langCode },
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: session.sessionResumptionToken
          ? { handle: session.sessionResumptionToken }
          : {},
        tools: simulationToolDeclarations.length > 0 ? simulationToolDeclarations : undefined,
        realtimeInputConfig: {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        },
      };

      const realtimeModel = session.realtimeModel || await this.getRealtimeModel();
      const apiVersion = geminiLiveApiVersion(realtimeModel);
      const genAILive = apiVersion === 'v1alpha' ? this.genAILiveAlpha : this.genAILiveBeta;
      console.log(`🔌 Connecting to Gemini Live API for session: ${session.id} using model: ${realtimeModel} (${apiVersion})`);

      const geminiSession = await genAILive.live.connect({
        model: realtimeModel,
        callbacks: {
          onopen: () => {
            console.log(`✅ Gemini Live API connected for session: ${session.id} (${Date.now() - connectStartTime}ms)`);
            this.sendToClient(session, { type: 'session.ready', sessionId: session.id });
            this.sendToClient(session, { type: 'session.configured' });
          },
          onmessage: (message: any) => {
            handleGeminiMessage(session, message, this.sendToClient.bind(this), this.genAI, this.proactiveReconnect.bind(this));
          },
          onerror: (error: any) => {
            console.error(`Gemini WebSocket error for session ${session.id}:`, error);
            this.sendToClient(session, { type: 'error', error: 'Gemini connection error' });
          },
          onclose: (event: any) => {
            handleGeminiClose(
              event, session, this.sessions,
              this.sendToClient.bind(this),
              this.connectToGemini.bind(this),
              trackSessionUsage
            );
          },
        },
        config: config,
      });

      session.geminiSession = geminiSession;
      session.usingReconnectInstructions = options?.isResume === true;

      if (session.pendingClientReady) {
        console.log(`▶️ Replaying buffered client.ready message for session: ${session.id}`);
        const bufferedMessage = session.pendingClientReady;
        session.pendingClientReady = null;
        this.handleClientMessage(session.id, bufferedMessage);
      }

      console.log('⏳ Gemini connected — waiting for user to speak first (no auto-greeting).');

    } catch (error) {
      console.error(`Failed to connect to Gemini Live API:`, error);
      throw error;
    }
  }

  private sendToClient(session: RealtimeSession, message: any): void {
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.send(JSON.stringify(message));
    }
  }

  handleClientMessage(sessionId: string, message: any): void {
    processClientMessage(sessionId, message, this.sessions, this.sendToClient.bind(this), this.proactiveReconnect.bind(this));
  }

  private injectReconnectContext(session: RealtimeSession): void {
    if (!session.geminiSession) return;
    const recentMsgs = session.recentMessages || [];
    const userLabel = session.userName && session.userName !== '사용자' ? session.userName : '사용자';
    const personaLabel = session.personaName || 'AI';
    let reconnectText: string;
    if (recentMsgs.length > 0) {
      const historyText = recentMsgs.map(m =>
        `${m.role === 'user' ? userLabel : personaLabel}: ${m.text}`
      ).join('\n');
      reconnectText = `[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD. 당신은 ${personaLabel}입니다. 연결이 자동으로 갱신되었습니다. 방금 전 나눈 대화 내용을 기억하세요:\n${historyText}\n\n${personaLabel}으로서 이 대화를 자연스럽게 이어서 진행하세요. 연결 갱신에 대해 언급하지 말고 사용자가 먼저 발화할 때까지 침묵을 유지하세요.]`;
      console.log(`📜 injectReconnectContext: ${recentMsgs.length}개 메시지`);
    } else {
      reconnectText = `[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD. 당신은 ${personaLabel}입니다. 연결이 자동으로 갱신되었습니다. 인사하지 말고 사용자가 먼저 발화할 때까지 침묵을 유지하세요.]`;
    }
    const ctxPayload = { turns: [{ role: 'user', parts: [{ text: reconnectText }] }], turnComplete: false };
    session.pendingMessages.push({ index: session.outgoingMessageIndex++, payload: { type: 'clientContent', data: ctxPayload } });
    session.geminiSession.sendClientContent(ctxPayload);
  }

  private proactiveReconnect(session: RealtimeSession): Promise<void> | void {
    if (session.isReconnecting) {
      console.log('⚠️ proactiveReconnect: 이미 재연결 중');
      return;
    }

    // Guard: session is already on reconnect-safe instructions with a live Gemini connection.
    // Skip expensive close/reconnect; just inject context directly to avoid churn.
    if (session.usingReconnectInstructions && session.geminiSession) {
      console.log('⏭️ proactiveReconnect: already on reconnect-safe prompt — injecting context only');
      session.hasTriggeredFirstGreeting = true;
      this.injectReconnectContext(session);
      return;
    }

    session.isReconnecting = true;
    const sessionId = session.id;
    console.log(`🔄 proactiveReconnect: 새 Gemini 세션 준비 시작 (sessionId=${sessionId})`);

    if (session.geminiSession) {
      try { session.geminiSession.close(); } catch (e) {}
      session.geminiSession = null;
    }

    const reconnectSimState = getSessionState(session.personaRunId);
    const reconnectInstructions = buildReconnectSystemInstructions(session.systemInstructions, session.userLanguage, reconnectSimState?.currentStageGoal ?? undefined);
    const connectFn = isOpenAIRealtimeModel(session.realtimeModel)
      ? () => this.connectToOpenAI(session, reconnectInstructions, session.voiceGender)
      : () => this.connectToGemini(session, reconnectInstructions, session.voiceGender);
    return connectFn()
      .then(() => {
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession) return;
        currentSession.isReconnecting = false;
        currentSession.reconnectAttempts = 0;
        currentSession.isInterrupted = false;
        currentSession.cancelledTurnSeq = -1;
        currentSession.currentTranscript = '';
        currentSession.usingReconnectInstructions = true;
        console.log(`✅ proactiveReconnect 성공: 새 Gemini 세션 활성화`);
        this.sendToClient(currentSession, { type: 'session.reconnected' });

        if (currentSession.geminiSession) {
          if (currentSession.pendingMessages.length > 0) {
            const isGreetingTrigger = (msg: any) =>
              msg.payload.type === 'clientContent' &&
              msg.payload.data?.turns?.length === 1 &&
              msg.payload.data.turns[0]?.parts?.length === 1 &&
              /^안녕하세요\s*$/.test(msg.payload.data.turns[0].parts[0]?.text ?? '');
            const isEndOfTurnInput = (msg: any) =>
              msg.payload.type === 'realtimeInput' &&
              msg.payload.data?.event === 'END_OF_TURN';
            const filteredPending: typeof currentSession.pendingMessages = [];
            let skipNextEot = false;
            for (const msg of currentSession.pendingMessages) {
              if (skipNextEot) {
                skipNextEot = false;
                if (isEndOfTurnInput(msg)) continue;
              }
              if (isGreetingTrigger(msg)) {
                skipNextEot = true;
                continue;
              }
              filteredPending.push(msg);
            }
            const removed = currentSession.pendingMessages.length - filteredPending.length;
            if (removed > 0) {
              console.log(`🚫 proactiveReconnect: 인사 트리거+EOT ${removed}개 필터링`);
            }
            if (filteredPending.length > 0) {
              console.log(`📤 proactiveReconnect 후 미확인 메시지 ${filteredPending.length}개 재전송...`);
              for (const pending of filteredPending) {
                try {
                  if (pending.payload.type === 'realtimeInput') {
                    currentSession.geminiSession.sendRealtimeInput(pending.payload.data);
                  } else if (pending.payload.type === 'clientContent') {
                    currentSession.geminiSession.sendClientContent(pending.payload.data);
                  }
                } catch (replayErr) {
                  console.warn(`⚠️ proactiveReconnect 메시지 재전송 실패 (index=${pending.index}):`, replayErr);
                }
              }
            } else {
              console.log('🔀 proactiveReconnect: 모든 pending 메시지 필터링됨 — 컨텍스트 복원으로 폴백');
              this.injectReconnectContext(currentSession);
            }
          } else {
            console.log('📤 proactiveReconnect 후 대화 컨텍스트 복원...');
            this.injectReconnectContext(currentSession);
          }
        }
      })
      .catch((error) => {
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession) return;
        currentSession.isReconnecting = false;
        console.error(`❌ proactiveReconnect 실패:`, error);
        this.sendToClient(currentSession, {
          type: 'session.warning',
          message: '연결 갱신에 실패했습니다. 잠시 후 자동으로 재시도합니다.',
          timeLeft: 0,
        });
      });
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(`🔚 Closing realtime voice session: ${sessionId}`);
      trackSessionUsage(session);

      const pendingUserText = session.userTranscriptBuffer.trim();
      if (pendingUserText && session.personaRunId) {
        const clientWsOpen = session.clientWs && session.clientWs.readyState === WebSocket.OPEN;
        if (clientWsOpen) {
          console.log(`🎤 [closeSession] Flushing pending user buffer to client: "${pendingUserText.substring(0, 60)}"`);
          this.sendToClient(session, { type: 'user.transcription', transcript: pendingUserText });
          session.recentMessages.push({ role: 'user', text: pendingUserText.slice(0, 300) });
        } else {
          console.log(`💾 [closeSession] Flushing pending user buffer to DB: "${pendingUserText.substring(0, 60)}"`);
          storage.getChatMessagesByPersonaRun(session.personaRunId).then(existing => {
            storage.createChatMessage({
              personaRunId: session.personaRunId,
              sender: 'user',
              message: pendingUserText,
              turnIndex: Math.floor(existing.length / 2),
              emotion: null,
              emotionReason: null,
              createdAt: new Date(),
            }).catch(err => console.error('❌ Failed to save orphaned user transcript:', err));
          }).catch(err => console.error('❌ Failed to fetch messages for orphan save:', err));
        }
        session.userTranscriptBuffer = '';
      }

      // Log session_end simulation event to complete the audit trail
      if (session.personaRunId && session.simulationState) {
        const finalState = session.simulationState;
        setImmediate(async () => {
          try {
            await storage.saveSimulationState(session.personaRunId, finalState as unknown as Record<string, unknown>);
            await storage.createSimulationEvent({
              personaRunId: session.personaRunId,
              scenarioRunId: session.scenarioRunId ?? null,
              turnIndex: session.userTurnsCompleted,
              turnId: null,
              eventType: 'session_end',
              toolName: null,
              args: null,
              result: { reason: 'voice_session_closed', userTurnsCompleted: session.userTurnsCompleted },
              stateBefore: null,
              stateAfter: finalState,
              stateVersionBefore: null,
              stateVersionAfter: finalState.version,
              includeInReport: false,
            });
          } catch (e) {
            console.warn('[closeSession] Failed to log session_end event:', e);
          }
        });
      }

      if (session.greetingTimeoutId !== null) {
        clearTimeout(session.greetingTimeoutId);
        session.greetingTimeoutId = null;
      }

      if (session.geminiSession) {
        session.geminiSession.close();
      }
      this.sessions.delete(sessionId);
    }
  }

  getActiveSessionCount(): number {
    return getActiveSessionCount(this.sessions);
  }

  getSessionStatus() {
    return getSessionStatus(this.sessions);
  }
}

export const realtimeVoiceService = new RealtimeVoiceService();
