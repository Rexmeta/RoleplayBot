import WebSocket from 'ws';
import { fileManager } from './fileManager';
import { GoogleGenAI, Modality } from '@google/genai';
import { storage } from '../storage';
import {
  RealtimeSession,
  CLEANUP_INTERVAL_MS,
  MAX_CONCURRENT_SESSIONS,
} from './voice/types';
import { buildSystemInstructions } from './voice/systemPromptBuilder';
import { handleGeminiMessage } from './voice/geminiMessageHandler';
import { handleClientMessage as processClientMessage } from './voice/clientMessageHandler';
import { handleGeminiClose } from './voice/geminiReconnector';
import {
  startCleanupScheduler,
  trackSessionUsage,
  getActiveSessionCount,
  getSessionStatus,
} from './voice/sessionManager';
import { buildUserPersonaInstructions } from './voice/prompts/userPersonaPrompt';

const DEFAULT_REALTIME_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

export class RealtimeVoiceService {
  private sessions: Map<string, RealtimeSession> = new Map();
  private genAI: GoogleGenAI | null = null;
  private isAvailable: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

    if (geminiApiKey) {
      this.genAI = new GoogleGenAI({ apiKey: geminiApiKey });
      this.isAvailable = true;
      console.log('✅ Gemini Live API Service initialized');
      this.startCleanupScheduler();
    } else {
      console.warn('⚠️  GOOGLE_API_KEY not set - Realtime Voice features disabled');
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

  private async getRealtimeModel(): Promise<string> {
    try {
      const timeoutPromise = new Promise<undefined>((_, reject) =>
        setTimeout(() => reject(new Error('DB setting fetch timeout')), 2000)
      );
      const settingPromise = storage.getSystemSetting('ai', 'model_realtime');
      const setting = await Promise.race([settingPromise, timeoutPromise]);
      const validModels = ['gemini-2.5-flash-native-audio-preview-09-2025'];
      const model = setting?.value;
      if (model && validModels.includes(model)) {
        console.log(`🤖 Using realtime model from DB: ${model}`);
        return model;
      }
      console.log(`🤖 Using default realtime model: ${DEFAULT_REALTIME_MODEL}`);
      return DEFAULT_REALTIME_MODEL;
    } catch (error) {
      console.warn(`⚠️ Failed to get realtime model from DB, using default: ${DEFAULT_REALTIME_MODEL}`);
      return DEFAULT_REALTIME_MODEL;
    }
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

    if (!this.isAvailable || !this.genAI) {
      throw new Error('Gemini Live API Service is not available. Please configure GOOGLE_API_KEY.');
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
    try {
      const user = await storage.getUser(userId);
      if (user?.name) userName = user.name;
    } catch (error) {
      console.warn(`⚠️ Failed to load user info for userId ${userId}:`, error);
    }

    const playerRole = scenarioObj.context?.playerRole || {};
    const userRoleInfo = {
      name: userName,
      position: playerRole.position || '담당자',
      department: playerRole.department || '',
      experience: playerRole.experience || '',
      responsibility: playerRole.responsibility || ''
    };

    console.log(`👤 사용자 정보: ${userRoleInfo.name} (${userRoleInfo.position}${userRoleInfo.department ? ', ' + userRoleInfo.department : ''})`);

    const scenarioWithUserDifficulty = {
      ...scenarioObj,
      difficulty: userSelectedDifficulty || 4
    };

    const systemInstructions = buildSystemInstructions(
      scenarioWithUserDifficulty, scenarioPersona, mbtiPersona, userRoleInfo, userLanguage
    );

    console.log('\n' + '='.repeat(80));
    console.log('🎯 실시간 대화 시작 - 전달되는 명령 및 컨텍스트');
    console.log('='.repeat(80));
    console.log('📋 시나리오:', scenarioObj.title);
    console.log('👤 페르소나:', scenarioPersona.name, `(${scenarioPersona.position})`);
    console.log('🎭 MBTI:', mbtiType.toUpperCase());
    console.log('='.repeat(80));
    console.log('📝 시스템 명령 (SYSTEM INSTRUCTIONS):\n');
    console.log(systemInstructions);
    console.log('='.repeat(80) + '\n');

    const realtimeModel = await this.getRealtimeModel();
    const gender: 'male' | 'female' = scenarioPersona.gender === 'female' ? 'female' : 'male';
    console.log(`👤 페르소나 성별 설정: ${scenarioPersona.name} → ${gender} (시나리오 정의값: ${scenarioPersona.gender})`);

    const session: RealtimeSession = {
      id: sessionId, conversationId, scenarioId, personaId,
      personaName: scenarioPersona.name, userId, clientWs,
      geminiSession: null, isConnected: false,
      currentTranscript: '', userTranscriptBuffer: '', audioBuffer: [],
      startTime: Date.now(), lastActivityTime: Date.now(),
      totalUserTranscriptLength: 0, totalAiTranscriptLength: 0,
      realtimeModel,
      hasReceivedFirstAIResponse: false, hasTriggeredFirstGreeting: false,
      firstGreetingRetryCount: 0, isInterrupted: false,
      turnSeq: 0, cancelledTurnSeq: -1,
      sessionResumptionToken: null, isReconnecting: false, reconnectAttempts: 0,
      systemInstructions, voiceGender: gender, recentMessages: [],
      selectedVoice: null, goAwayWarningTime: null, pendingClientReady: null,
      userLanguage,
    };

    this.sessions.set(sessionId, session);
    console.log(`⏱️ [TIMING] 세션 객체 생성 완료: ${Date.now() - sessionStartTime}ms`);

    await this.connectToGemini(session, systemInstructions, gender);
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
      if (user?.name) userName = user.name;
    } catch {}

    const systemInstructions = buildUserPersonaInstructions(userPersonaData, userName, userLanguage);

    console.log('🎭 [UserPersona] 실시간 음성 세션:', userPersonaData.name);

    const gender: 'male' | 'female' = userPersonaData.gender === 'female' ? 'female' : 'male';
    const realtimeModel = await this.getRealtimeModel();

    const session: RealtimeSession = {
      id: sessionId, conversationId, scenarioId, personaId,
      personaName: userPersonaData.name, userId, clientWs,
      geminiSession: null, isConnected: false,
      currentTranscript: '', userTranscriptBuffer: '', audioBuffer: [],
      startTime: Date.now(), lastActivityTime: Date.now(),
      totalUserTranscriptLength: 0, totalAiTranscriptLength: 0,
      realtimeModel,
      hasReceivedFirstAIResponse: false, hasTriggeredFirstGreeting: false,
      firstGreetingRetryCount: 0, isInterrupted: false,
      turnSeq: 0, cancelledTurnSeq: -1,
      sessionResumptionToken: null, isReconnecting: false, reconnectAttempts: 0,
      systemInstructions, voiceGender: gender, recentMessages: [],
      selectedVoice: null, goAwayWarningTime: null, pendingClientReady: null,
      userLanguage,
    };

    this.sessions.set(sessionId, session);
    await this.connectToGemini(session, systemInstructions, gender);
    console.log(`⏱️ [TIMING] UserPersona createSession 완료: ${Date.now() - sessionStartTime}ms`);
  }

  private static readonly MALE_VOICES = ['Puck', 'Charon', 'Fenrir', 'Orus'];
  private static readonly FEMALE_VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr'];

  private getRandomVoice(gender: 'male' | 'female'): string {
    const voices = gender === 'female' ? RealtimeVoiceService.FEMALE_VOICES : RealtimeVoiceService.MALE_VOICES;
    return voices[Math.floor(Math.random() * voices.length)];
  }

  private async connectToGemini(
    session: RealtimeSession,
    systemInstructions: string,
    gender: 'male' | 'female' = 'male'
  ): Promise<void> {
    if (!this.genAI) throw new Error('Gemini AI not initialized');

    const connectStartTime = Date.now();
    console.log(`⏱️ [TIMING] connectToGemini 시작: ${new Date(connectStartTime).toISOString()}`);

    try {
      let voiceName: string;
      if (session.selectedVoice) {
        voiceName = session.selectedVoice;
        console.log(`🎤 Reusing session voice for ${gender}: ${voiceName}`);
      } else {
        voiceName = this.getRandomVoice(gender);
        session.selectedVoice = voiceName;
        console.log(`🎤 Setting voice for ${gender}: ${voiceName} (초기 선택)`);
      }

      const langCodeMap: Record<'ko' | 'en' | 'ja' | 'zh', string> = {
        ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
      };
      const langCode = langCodeMap[session.userLanguage] || 'ko-KR';

      const config: any = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemInstructions,
        inputAudioTranscription: { languageCode: langCode },
        outputAudioTranscription: { languageCode: langCode },
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          languageCode: langCode,
        },
        thinkingConfig: { thinkingBudget: 0 },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: session.sessionResumptionToken
          ? { handle: session.sessionResumptionToken }
          : {},
      };

      const realtimeModel = session.realtimeModel || await this.getRealtimeModel();
      console.log(`🔌 Connecting to Gemini Live API for session: ${session.id} using model: ${realtimeModel}`);

      const geminiSession = await this.genAI.live.connect({
        model: realtimeModel,
        callbacks: {
          onopen: () => {
            console.log(`✅ Gemini Live API connected for session: ${session.id} (${Date.now() - connectStartTime}ms)`);
            session.isConnected = true;
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

      if (session.pendingClientReady) {
        console.log(`▶️ Replaying buffered client.ready message for session: ${session.id}`);
        const bufferedMessage = session.pendingClientReady;
        session.pendingClientReady = null;
        this.handleClientMessage(session.id, bufferedMessage);
      }

      console.log('⏳ Waiting for client.ready signal before triggering first greeting...');

      setTimeout(() => {
        const currentSession = this.sessions.get(session.id);
        const pendingHasExisting = currentSession?.pendingClientReady?.hasExistingConversation === true;
        if (currentSession &&
          !currentSession.hasTriggeredFirstGreeting &&
          !currentSession.hasReceivedFirstAIResponse &&
          !pendingHasExisting &&
          currentSession.geminiSession) {
          console.log('⏰ client.ready timeout (3s) - auto-triggering first greeting...');
          currentSession.hasTriggeredFirstGreeting = true;

          const greetingTrigger = `안녕하세요`;
          console.log(`📤 Sending greeting trigger: "${greetingTrigger}"`);
          currentSession.geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: greetingTrigger }] }],
            turnComplete: true,
          });
          currentSession.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
        } else if (pendingHasExisting) {
          console.log('⏭️ Timeout skipped - pending client.ready has hasExistingConversation flag');
        } else if (currentSession?.hasTriggeredFirstGreeting) {
          console.log('⏭️ Timeout skipped - first greeting already triggered');
        }
      }, 3000);

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
    processClientMessage(sessionId, message, this.sessions, this.sendToClient.bind(this));
  }

  private proactiveReconnect(session: RealtimeSession): void {
    if (session.isReconnecting) {
      console.log('⚠️ proactiveReconnect: 이미 재연결 중');
      return;
    }

    session.isReconnecting = true;
    const sessionId = session.id;
    console.log(`🔄 proactiveReconnect: 새 Gemini 세션 준비 시작 (sessionId=${sessionId})`);

    if (session.geminiSession) {
      try { session.geminiSession.close(); } catch (e) {}
      session.geminiSession = null;
    }

    this.connectToGemini(session, session.systemInstructions, session.voiceGender)
      .then(() => {
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession) return;
        currentSession.isReconnecting = false;
        currentSession.reconnectAttempts = 0;
        console.log(`✅ proactiveReconnect 성공: 새 Gemini 세션 활성화`);
        this.sendToClient(currentSession, { type: 'session.reconnected' });
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
      if (pendingUserText && session.conversationId) {
        const clientWsOpen = session.clientWs && session.clientWs.readyState === WebSocket.OPEN;
        if (clientWsOpen) {
          console.log(`🎤 [closeSession] Flushing pending user buffer to client: "${pendingUserText.substring(0, 60)}"`);
          this.sendToClient(session, { type: 'user.transcription', transcript: pendingUserText });
          session.recentMessages.push({ role: 'user', text: pendingUserText.slice(0, 300) });
        } else {
          console.log(`💾 [closeSession] Flushing pending user buffer to DB: "${pendingUserText.substring(0, 60)}"`);
          storage.getChatMessagesByPersonaRun(session.conversationId).then(existing => {
            storage.createChatMessage({
              personaRunId: session.conversationId,
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
