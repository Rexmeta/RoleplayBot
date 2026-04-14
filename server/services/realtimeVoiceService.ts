import WebSocket from 'ws';
import { fileManager } from './fileManager';
import { GoogleGenAI, Modality } from '@google/genai';
import { getRealtimeVoiceGuidelines, validateDifficultyLevel } from './conversationDifficultyPolicy';
import { storage } from '../storage';
import { trackUsage } from './aiUsageTracker';

// Default Gemini Live API model (updated December 2025)
const DEFAULT_REALTIME_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

// 텍스트가 영어로 된 "생각" 텍스트인지 확인
function isThinkingText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  
  // 한국어가 하나라도 있으면 thinking 텍스트가 아님
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text)) {
    return false;
  }
  
  // **제목** 형식으로 시작하면 thinking 텍스트
  if (/^\*\*[^*]+\*\*/.test(text.trim())) {
    return true;
  }
  
  // 영어 thinking 키워드 패턴
  const thinkingPatterns = [
    /^I['']m\s+(focusing|thinking|considering|now|about|going)/i,
    /^(I|Now|Let me|First|Okay)\s+(understand|need|will|am|have)/i,
    /^(Initiating|Beginning|Starting|Transitioning|Highlighting)/i,
    /^(I've|I'm|I'll)\s+/i,
    /^The\s+(user|situation|context)/i,
  ];
  
  const trimmed = text.trim();
  return thinkingPatterns.some(pattern => pattern.test(trimmed));
}

// Gemini의 thinking/reasoning 텍스트를 필터링하고 사용자 언어에 맞는 응답만 추출
function filterThinkingText(text: string, userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'): string {
  if (!text) return '';
  
  // 패턴 0: 괄호로 감싼 행동/상태 묘사 제거 (예: "(잠시 침묵)", "(한숨)", "(고개를 끄덕이며)")
  let filtered = text.replace(/\([^)]{1,30}\)/g, '');
  
  // 패턴 1: **제목** 형식의 thinking 블록 제거
  // 예: "**Beginning the Briefing**\nI've initiated..."
  filtered = filtered.replace(/\*\*[^*]+\*\*\s*/g, '');
  
  // 언어별 문자 패턴 정의
  const languagePatterns: Record<string, RegExp> = {
    ko: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/, // 한글
    ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/, // 히라가나, 가타카나, 한자
    zh: /[\u4E00-\u9FFF\u3400-\u4DBF]/, // 중국어 한자
    en: /[a-zA-Z]/, // 영어
  };
  
  // 다른 언어 문자 패턴 (필터링용)
  const koreanPattern = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/; // 한글
  const japaneseKanaPattern = /[\u3040-\u309F\u30A0-\u30FF]/; // 히라가나, 가타카나 (한자 제외)
  const chinesePattern = /[\u4E00-\u9FFF\u3400-\u4DBF]/; // 중국어 한자
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F]/; // 아라비아 문자

  // 영어인 경우 thinking 패턴만 제거하고 영어 텍스트 유지
  if (userLanguage === 'en') {
    const lines = filtered.split('\n');
    const validLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      
      // 영어 모드: 비라틴 문자(한국어, 일본어, 중국어, 아라비아 등)가 포함된 줄 제거
      if (koreanPattern.test(trimmed) || japaneseKanaPattern.test(trimmed) || chinesePattern.test(trimmed) || arabicPattern.test(trimmed)) {
        return false;
      }
      
      // Thinking 텍스트 패턴 확인
      const thinkingPatterns = [
        /^\*\*[^*]+\*\*/,
        /^I['']m\s+(focusing|thinking|considering|now|about|going)/i,
        /^(I|Now|Let me|First|Okay)\s+(understand|need|will|am|have)\s+to/i,
        /^(Initiating|Beginning|Starting|Transitioning|Highlighting)/i,
        /^The\s+(user|situation|context)\s+(is|seems|appears)/i,
        /^(considering|crafting|ensuring|maintaining|reflecting)/i,
      ];
      
      if (thinkingPatterns.some(pattern => pattern.test(trimmed))) {
        return false;
      }
      
      return true;
    });
    
    filtered = validLines.join('\n').trim();
    filtered = filtered.replace(/\s+/g, ' ');
    return filtered;
  }
  
  // 한국어, 일본어, 중국어의 경우 해당 언어 문자가 있는 줄만 유지
  const targetPattern = languagePatterns[userLanguage] || languagePatterns.ko;
  
  // 패턴 2: 라인 단위 필터링
  const lines = filtered.split('\n');
  const targetLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    
    // 대상 언어 문자가 포함된 줄 확인
    const hasTargetLanguage = targetPattern.test(trimmed);
    if (!hasTargetLanguage) return false;
    
    // 한국어 모드: 한글이 전혀 없는 줄(중국어, 아라비아 문자 등) 명시적 차단
    // + 일본어 가나가 포함된 줄 제거
    if (userLanguage === 'ko') {
      if (!koreanPattern.test(trimmed)) {
        return false;
      }
      if (japaneseKanaPattern.test(trimmed)) {
        return false;
      }
      // 아라비아 문자가 포함된 줄 제거
      if (arabicPattern.test(trimmed)) {
        return false;
      }
    }
    
    // 중국어 모드: 한글이나 일본어 가나가 포함된 줄 제거 (한자는 공유되므로 가나로 일본어 구분)
    if (userLanguage === 'zh') {
      if (koreanPattern.test(trimmed) || japaneseKanaPattern.test(trimmed)) {
        return false;
      }
      // 아라비아 문자가 포함된 줄 제거
      if (arabicPattern.test(trimmed)) {
        return false;
      }
    }
    
    // 일본어 모드: 한글이 포함된 줄 제거
    if (userLanguage === 'ja') {
      if (koreanPattern.test(trimmed)) {
        return false;
      }
      // 아라비아 문자가 포함된 줄 제거
      if (arabicPattern.test(trimmed)) {
        return false;
      }
    }
    
    // 대상 언어 문자가 있는 줄이라도, 영문이 너무 많으면 제거 (thinking 텍스트로 의심)
    const targetCharCount = (trimmed.match(new RegExp(targetPattern.source, 'g')) || []).length;
    const englishWords = (trimmed.match(/\b[a-zA-Z]+\b/g) || []).length;
    
    // 영문 단어가 대상 언어 문자의 3배 이상이면 thinking 텍스트로 간주
    if (englishWords > 0 && englishWords >= targetCharCount * 3) {
      return false;
    }
    
    return true;
  });
  
  filtered = targetLines.join('\n').trim();
  
  // 패턴 3: 남은 텍스트에서 영문 단어가 연속으로 많은 부분 제거 (한국어/일본어/중국어 모드)
  filtered = filtered.replace(/([a-zA-Z\s]{20,})/g, (match) => {
    // 영문만 20자 이상 연속인 경우 제거
    if (!targetPattern.test(match)) {
      return '';
    }
    return match;
  });
  
  // 앞뒤 공백 정리
  filtered = filtered.trim();
  // 연속된 공백 정리
  filtered = filtered.replace(/\s+/g, ' ');
  
  return filtered;
}

// 동시 접속 최적화 설정
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분 비활성 타임아웃 (동시 접속 최적화)
const MAX_TRANSCRIPT_LENGTH = 50000; // 트랜스크립트 최대 길이 (약 25,000자)
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1분마다 정리
const MAX_CONCURRENT_SESSIONS = 100; // 최대 동시 세션 수 (Gemini Tier 2 기준)

interface RealtimeSession {
  id: string;
  conversationId: string;
  scenarioId: string;
  personaId: string;
  personaName: string;
  userId: string;
  clientWs: WebSocket;
  geminiSession: any | null; // Gemini Live API session
  isConnected: boolean;
  currentTranscript: string; // AI 응답 transcript 버퍼
  userTranscriptBuffer: string; // 사용자 음성 transcript 버퍼
  audioBuffer: string[];
  startTime: number; // 세션 시작 시간 (ms)
  lastActivityTime: number; // 마지막 활동 시간 (ms)
  totalUserTranscriptLength: number; // 누적 사용자 텍스트 길이
  totalAiTranscriptLength: number; // 누적 AI 텍스트 길이
  realtimeModel: string; // 사용된 모델
  hasReceivedFirstAIResponse: boolean; // 첫 AI 응답 수신 여부
  hasTriggeredFirstGreeting: boolean; // 첫 인사 트리거 여부 (중복 방지)
  firstGreetingRetryCount: number; // 첫 인사 재시도 횟수
  isInterrupted: boolean; // Barge-in flag to suppress audio until new response
  turnSeq: number; // Monotonic turn counter, incremented on each turnComplete
  cancelledTurnSeq: number; // Turn seq when cancel was issued (ignore audio from this turn)
  // Session resumption 관련 필드
  sessionResumptionToken: string | null; // Gemini 세션 재개 토큰
  isReconnecting: boolean; // 재연결 중 플래그
  reconnectAttempts: number; // 재연결 시도 횟수
  systemInstructions: string; // 재연결시 사용할 시스템 인스트럭션
  voiceGender: 'male' | 'female'; // 재연결시 사용할 음성 성별
  recentMessages: Array<{ role: 'user' | 'ai'; text: string }>; // 재연결 컨텍스트용 최근 메시지
  selectedVoice: string | null; // 세션 시작 시 선택된 음성 (재연결 시 동일 음성 유지)
  goAwayWarningTime: number | null; // GoAway 경고 수신 시간
  // 버퍼링된 메시지 (Gemini 연결 전에 도착한 메시지)
  pendingClientReady: any | null; // client.ready 메시지 버퍼 (연결 전 도착시)
  userLanguage: 'ko' | 'en' | 'ja' | 'zh'; // 사용자 선택 언어
}

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
      
      // 비활성 세션 정리 스케줄러 시작
      this.startCleanupScheduler();
    } else {
      console.warn('⚠️  GOOGLE_API_KEY not set - Realtime Voice features disabled');
    }
  }
  
  // 비활성 세션 자동 정리 스케줄러
  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, CLEANUP_INTERVAL_MS);
    
    console.log(`🧹 Session cleanup scheduler started (interval: ${CLEANUP_INTERVAL_MS / 1000}s)`);
  }
  
  // 비활성 세션 정리
  private cleanupInactiveSessions(): void {
    const now = Date.now();
    const sessionsToClose: string[] = [];
    
    this.sessions.forEach((session, sessionId) => {
      const inactiveTime = now - session.lastActivityTime;
      
      // 타임아웃된 세션 식별
      if (inactiveTime > SESSION_TIMEOUT_MS) {
        console.log(`⏰ Session ${sessionId} inactive for ${Math.round(inactiveTime / 60000)}min, marking for cleanup`);
        sessionsToClose.push(sessionId);
      }
    });
    
    // 세션 정리
    for (const sessionId of sessionsToClose) {
      this.closeSession(sessionId);
    }
    
    if (sessionsToClose.length > 0) {
      console.log(`🧹 Cleaned up ${sessionsToClose.length} inactive sessions. Active: ${this.sessions.size}`);
    }
  }

  isServiceAvailable(): boolean {
    return this.isAvailable;
  }

  private async getRealtimeModel(): Promise<string> {
    try {
      // Add timeout to prevent blocking WebSocket connection
      const timeoutPromise = new Promise<undefined>((_, reject) => 
        setTimeout(() => reject(new Error('DB setting fetch timeout')), 2000)
      );
      
      const settingPromise = storage.getSystemSetting("ai", "model_realtime");
      const setting = await Promise.race([settingPromise, timeoutPromise]);
      
      // Validate the model value is a valid Gemini Live model
      const validModels = [
        'gemini-2.5-flash-native-audio-preview-09-2025'
      ];
      
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
    userSelectedDifficulty?: number, // 사용자가 선택한 난이도 (1-4)
    userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko' // 사용자 선택 언어
  ): Promise<void> {
    const sessionStartTime = Date.now();
    console.log(`⏱️ [TIMING] createSession 시작: ${new Date(sessionStartTime).toISOString()}`);
    
    if (!this.isAvailable || !this.genAI) {
      throw new Error('Gemini Live API Service is not available. Please configure GOOGLE_API_KEY.');
    }

    // 동시 세션 수 제한 체크
    const currentSessionCount = this.sessions.size;
    if (currentSessionCount >= MAX_CONCURRENT_SESSIONS) {
      console.warn(`⚠️ Max concurrent sessions reached: ${currentSessionCount}/${MAX_CONCURRENT_SESSIONS}`);
      throw new Error(`현재 동시 접속자가 많아 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요. (${currentSessionCount}/${MAX_CONCURRENT_SESSIONS})`);
    }

    console.log(`🎙️ Creating realtime voice session: ${sessionId} (${currentSessionCount + 1}/${MAX_CONCURRENT_SESSIONS})`);

    // ── 사용자 제작 페르소나 분기 ────────────────────────────────────────────
    if (scenarioId.startsWith('__user_persona__:')) {
      const userPersonaId = scenarioId.split(':')[1];
      const userPersonaData = await storage.getUserPersonaById(userPersonaId);
      if (!userPersonaData) throw new Error(`UserPersona not found: ${userPersonaId}`);

      let userName = '사용자';
      try {
        const user = await storage.getUser(userId);
        if (user?.name) userName = user.name;
      } catch {}

      const p = (userPersonaData.personality as any) || {};
      const greetingText = userPersonaData.greeting || `안녕하세요! 저는 ${userPersonaData.name}입니다.`;

      const langProhibition: Record<string, string> = {
        ko: '모든 응답은 반드시 한국어로만 하세요. 괄호로 감싼 행동 묘사 절대 금지!',
        en: 'Always respond in English only. NEVER output parenthesized stage directions!',
        ja: '必ず日本語だけで応答してください。括弧で囲んだ行動描写は絶対に出力しないでください！',
        zh: '必须只用中文回答。绝对不要输出括号里的动作描写！',
      };

      const systemInstructions = [
        `당신은 "${userPersonaData.name}"라는 AI 캐릭터입니다.`,
        userPersonaData.description ? `캐릭터 설명: ${userPersonaData.description}` : '',
        p.background ? `배경: ${p.background}` : '',
        p.traits?.length ? `성격 특성: ${p.traits.join(', ')}` : '',
        p.communicationStyle ? `대화 방식: ${p.communicationStyle}` : '',
        p.speechStyle ? `말투: ${p.speechStyle}` : '',
        ``,
        `위 캐릭터로서 자연스럽게 대화하세요. 캐릭터의 성격, 말투, 배경을 일관되게 유지하세요.`,
        `사용자(이름: ${userName})와 편안하고 자유롭게 대화하세요.`,
        `세션이 시작되면 반드시 먼저 이렇게 인사하세요: "${greetingText}"`,
        ``,
        `⚠️ ${langProhibition[userLanguage] || langProhibition.ko}`,
      ].filter(Boolean).join('\n');

      console.log('🎭 [UserPersona] 실시간 음성 세션:', userPersonaData.name);

      const gender: 'male' | 'female' = userPersonaData.gender === 'female' ? 'female' : 'male';
      const realtimeModel = await this.getRealtimeModel();

      const session: RealtimeSession = {
        id: sessionId,
        conversationId,
        scenarioId,
        personaId,
        personaName: userPersonaData.name,
        userId,
        clientWs,
        geminiSession: null,
        isConnected: false,
        currentTranscript: '',
        userTranscriptBuffer: '',
        audioBuffer: [],
        startTime: Date.now(),
        lastActivityTime: Date.now(),
        totalUserTranscriptLength: 0,
        totalAiTranscriptLength: 0,
        realtimeModel,
        hasReceivedFirstAIResponse: false,
        hasTriggeredFirstGreeting: false,
        firstGreetingRetryCount: 0,
        isInterrupted: false,
        turnSeq: 0,
        cancelledTurnSeq: -1,
        sessionResumptionToken: null,
        isReconnecting: false,
        reconnectAttempts: 0,
        systemInstructions,
        voiceGender: gender,
        recentMessages: [],
        selectedVoice: null,
        goAwayWarningTime: null,
        pendingClientReady: null,
        userLanguage,
      };

      this.sessions.set(sessionId, session);
      await this.connectToGemini(session, systemInstructions, gender);
      console.log(`⏱️ [TIMING] UserPersona createSession 완료: ${Date.now() - sessionStartTime}ms`);
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    // Load scenario and persona data
    const scenarios = await fileManager.getAllScenarios();
    const scenarioObj = scenarios.find(s => s.id === scenarioId);
    if (!scenarioObj) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    const scenarioPersona: any = scenarioObj.personas.find((p: any) => p.id === personaId);
    if (!scenarioPersona) {
      throw new Error(`Persona not found: ${personaId}`);
    }

    // Load MBTI personality traits
    const mbtiType: string = scenarioPersona.personaRef?.replace('.json', '') || '';
    const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

    // 사용자 정보 로드 (이름, 역할)
    let userName = '사용자';
    try {
      const user = await storage.getUser(userId);
      if (user?.name) {
        userName = user.name;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load user info for userId ${userId}:`, error);
    }

    // 시나리오에서 사용자 역할 정보 추출
    const playerRole = scenarioObj.context?.playerRole || {};
    const userRoleInfo = {
      name: userName,
      position: playerRole.position || '담당자',
      department: playerRole.department || '',
      experience: playerRole.experience || '',
      responsibility: playerRole.responsibility || ''
    };
    
    console.log(`👤 사용자 정보: ${userRoleInfo.name} (${userRoleInfo.position}${userRoleInfo.department ? ', ' + userRoleInfo.department : ''})`);

    // 사용자가 선택한 난이도를 시나리오 객체에 적용
    const scenarioWithUserDifficulty = {
      ...scenarioObj,
      difficulty: userSelectedDifficulty || 2 // 사용자가 선택한 난이도 사용, 기본값 2
    };

    // Create system instructions with user language
    const systemInstructions = this.buildSystemInstructions(
      scenarioWithUserDifficulty,
      scenarioPersona,
      mbtiPersona,
      userRoleInfo,
      userLanguage
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

    // Get realtime model for tracking
    const realtimeModel = await this.getRealtimeModel();

    // 성별 판단 (시나리오 페르소나의 gender 속성 사용)
    const gender: 'male' | 'female' = scenarioPersona.gender === 'female' ? 'female' : 'male';
    console.log(`👤 페르소나 성별 설정: ${scenarioPersona.name} → ${gender} (시나리오 정의값: ${scenarioPersona.gender})`);
    
    // Create session object
    const session: RealtimeSession = {
      id: sessionId,
      conversationId,
      scenarioId,
      personaId,
      personaName: scenarioPersona.name,
      userId,
      clientWs,
      geminiSession: null,
      isConnected: false,
      currentTranscript: '',
      userTranscriptBuffer: '',
      audioBuffer: [],
      startTime: Date.now(),
      lastActivityTime: Date.now(),
      totalUserTranscriptLength: 0,
      totalAiTranscriptLength: 0,
      realtimeModel,
      hasReceivedFirstAIResponse: false,
      hasTriggeredFirstGreeting: false,
      firstGreetingRetryCount: 0,
      isInterrupted: false,
      turnSeq: 0, // First turn is 0
      cancelledTurnSeq: -1, // No cancelled turn initially
      // Session resumption 관련 필드 초기화
      sessionResumptionToken: null,
      isReconnecting: false,
      reconnectAttempts: 0,
      systemInstructions: systemInstructions, // 재연결시 필요
      voiceGender: gender, // 재연결시 필요
      recentMessages: [], // 재연결 컨텍스트용 최근 메시지
      selectedVoice: null, // 초기값 null, connectToGemini에서 선택 후 저장됨
      goAwayWarningTime: null,
      pendingClientReady: null, // client.ready 메시지 버퍼 초기화
      userLanguage, // 사용자 선택 언어 저장
    };

    this.sessions.set(sessionId, session);
    console.log(`⏱️ [TIMING] 세션 객체 생성 완료: ${Date.now() - sessionStartTime}ms`);
    
    // Connect to Gemini Live API
    await this.connectToGemini(session, systemInstructions, gender);
    console.log(`⏱️ [TIMING] createSession 완료 (총): ${Date.now() - sessionStartTime}ms`);
  }

  private buildSystemInstructions(
    scenario: any,
    scenarioPersona: any,
    mbtiPersona: any,
    userRoleInfo?: { name: string; position: string; department: string; experience: string; responsibility: string },
    userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
  ): string {
    const mbtiType = scenarioPersona.personaRef?.replace('.json', '') || 'UNKNOWN';
    
    // 대화 난이도 레벨 가져오기 (사용자가 선택한 난이도 사용, 기본값 2)
    const difficultyLevel = validateDifficultyLevel(scenario.difficulty);
    console.log(`🎯 대화 난이도: Level ${difficultyLevel} (사용자 선택)`)
    console.log(`🌐 대화 언어: ${userLanguage}`);
    
    const difficultyGuidelines = getRealtimeVoiceGuidelines(difficultyLevel, userLanguage);
    
    // 언어별 지시문 정의
    const languageInstructions: Record<'ko' | 'en' | 'ja' | 'zh', {
      langName: string;
      prohibition: string;
      requirement: string;
      greetingInstruction: string;
      greetingExample: string;
    }> = {
      ko: {
        langName: '한국어',
        prohibition: '영어 사용 절대 금지! 모든 응답은 반드시 한국어로만 하세요. 괄호로 감싼 행동 묘사 절대 금지!',
        requirement: '모든 대화는 100% 한국어로만 진행하세요. 괄호 안 행동 묘사를 절대 출력하지 마세요.',
        greetingInstruction: '세션이 시작되면 반드시 한국어로 먼저 인사를 건네며 대화를 시작하세요. 괄호 행동 묘사 없이 자연스럽게 말하세요.',
        greetingExample: userRoleInfo 
          ? `"${userRoleInfo.name}님, 안녕하세요. 급한 건으로 찾아뵙게 됐습니다." 또는 "${userRoleInfo.position}님 오셨군요, 지금 상황이 좀 급합니다."`
          : `"안녕하세요, 급한 건으로 찾아뵙게 됐습니다." 또는 "오셨군요, 지금 상황이 좀 급합니다."`
      },
      en: {
        langName: 'English',
        prohibition: 'Always respond in English only. Do not use Korean or other languages. NEVER output parenthesized stage directions!',
        requirement: 'Conduct all conversations 100% in English. Never output action descriptions in parentheses like (silence) or (sighs).',
        greetingInstruction: 'When the session starts, greet in English first and begin the conversation. Do NOT include any parenthesized actions.',
        greetingExample: userRoleInfo
          ? `"Hello ${userRoleInfo.name}, I need to speak with you about an urgent matter." or "Good to see you, ${userRoleInfo.position}. We have an urgent situation."`
          : `"Hello, I need to speak with you about an urgent matter." or "Good to see you. We have an urgent situation."`
      },
      ja: {
        langName: '日本語',
        prohibition: '必ず日本語だけで応答してください。韓国語や英語は使用禁止です。括弧で囲んだ行動描写は絶対に出力しないでください！',
        requirement: 'すべての会話は100%日本語で行ってください。（沈黙）（ため息）のような括弧付き行動描写は絶対に出力しないでください。',
        greetingInstruction: 'セッションが始まったら、必ず日本語で挨拶をして会話を始めてください。括弧付きの行動描写なしで自然に話してください。',
        greetingExample: userRoleInfo
          ? `"${userRoleInfo.name}さん、こんにちは。急ぎの件でお伺いしました。" または "${userRoleInfo.position}さん、いらっしゃいましたか。今、状況が急です。"`
          : `"こんにちは、急ぎの件でお伺いしました。" または "いらっしゃいましたか。今、状況が急です。"`
      },
      zh: {
        langName: '中文',
        prohibition: '必须只用中文回答。禁止使用韩语或英语。绝对不要输出括号里的动作描写！',
        requirement: '所有对话必须100%使用中文。绝对不要输出（沉默）（叹气）等括号动作描写。',
        greetingInstruction: '会话开始时，请务必用中文先打招呼并开始对话。不要使用括号动作描写，自然地说话。',
        greetingExample: userRoleInfo
          ? `"${userRoleInfo.name}，您好。有紧急事情需要和您商量。" 或 "${userRoleInfo.position}来了啊，现在情况有些紧急。"`
          : `"您好，有紧急事情需要商量。" 或 "来了啊，现在情况有些紧急。"`
      }
    };
    
    const langInst = languageInstructions[userLanguage];

    // 언어별 섹션 헤더 및 본문 텍스트 정의
    const sectionText: Record<'ko' | 'en' | 'ja' | 'zh', {
      identity: string;
      identityDesc: (name: string) => string;
      positionLabel: (position: string, department: string) => string;
      userInfoHeader: string;
      userInfoDesc: string;
      nameLabel: string;
      posLabel: string;
      deptLabel: string;
      expLabel: string;
      respLabel: string;
      userInfoWarning: (name: string, position: string) => string;
      scenarioBackground: string;
      defaultSituation: string;
      currentSituation: string;
      defaultCurrentSituation: string;
      interestsAndConcerns: string;
      defaultConcern: string;
      mbtiTraits: (mbti: string) => string;
      defaultCommStyle: string;
      coreTraits: string;
      personalityLabel: string;
      defaultPersonality: string;
      psychologicalMotivation: string;
      wantLabel: string;
      fearLabel: string;
      fearReaction: string;
      motivationConflict: string;
      commGuidelines: string;
      openingLabel: string;
      defaultOpening: string;
      phrasesLabel: string;
      defaultPhrases: string;
      commandStyle: string;
      formalStyle: string;
      silenceStyle: string;
      conversationGoal: string;
      defaultGoals: string[];
      actingGuide: string;
      interruptionHandling: string;
      interruptionDesc: string;
      interruptionStep1: string;
      interruptionStep2: string;
      interruptionStep3: string;
      corePrinciple: string;
      notAI: (name: string) => string;
      absoluteProhibition: string;
      noInnerThoughts: string;
      noMetaExpressions: string;
      noAsterisks: string;
      noRepeatQuestions: string;
      voiceOutputRule: string;
      voiceOutputDesc1: string;
      voiceOutputDesc2: string;
      outputBanExamples: string;
      correctExpression: string;
      silenceCorrect: string;
      sighCorrect: string;
      emotionCorrect: string;
      actionCorrect: string;
      rememberNoBrackets: string;
      requirements: string;
      contextKeep: string;
      stayInRole: (name: string) => string;
      noBreakRole: (name: string) => string;
      stanceUnchanged: string;
      conversationStart: string;
      noMetaThink: (langName: string) => string;
      firstWordsLabel: string;
    }> = {
      ko: {
        identity: '# 당신의 정체성',
        identityDesc: (name) => `당신은 "${name}"이라는 실제 사람입니다.`,
        positionLabel: (position, department) => `직책: ${position} (${department})`,
        userInfoHeader: '# 📌 대화 상대 정보 (중요!)',
        userInfoDesc: '당신이 대화하는 상대방의 정보입니다. 대화 중 이 정보를 참고하세요:',
        nameLabel: '이름',
        posLabel: '직책',
        deptLabel: '소속',
        expLabel: '경력',
        respLabel: '책임',
        userInfoWarning: (name, position) => `⚠️ 상대방을 부를 때 "${name}"님 또는 "${position}"님으로 호칭하세요.`,
        scenarioBackground: '# 시나리오 배경',
        defaultSituation: '현재 진행 중인 상황에 적절히 대응하세요.',
        currentSituation: '# 당신이 처한 현재 상황',
        defaultCurrentSituation: '상황에 맞게 반응하세요.',
        interestsAndConcerns: '# 당신의 관심사와 우려사항',
        defaultConcern: '- 상황을 신중하게 파악하고 적절히 대응하려고 합니다.',
        mbtiTraits: (mbti: string) => `# 당신의 MBTI 성격 특성 (${mbti})`,
        defaultCommStyle: '균형 잡힌 의사소통 스타일',
        coreTraits: '## 핵심 성격 특성',
        personalityLabel: '성격',
        defaultPersonality: '논리적이고 체계적인 사고',
        psychologicalMotivation: '## 심리적 동기 (대화에 반드시 반영!)',
        wantLabel: '당신이 원하는 것',
        fearLabel: '당신이 두려워하는 것',
        fearReaction: '- 두려움과 관련된 상황에는 방어적/저항적으로 반응하세요',
        motivationConflict: '- 동기와 충돌하는 제안에는 거부감을 표현하세요',
        commGuidelines: '## 의사소통 행동 지침 (반드시 따를 것)',
        openingLabel: '대화 시작',
        defaultOpening: '상황에 맞게 자연스럽게',
        phrasesLabel: '자주 쓰는 표현',
        defaultPhrases: '자연스러운 일상 표현',
        commandStyle: '- "명령조" 스타일이면: "~하세요", "당연히~" 등 사용',
        formalStyle: '- "형식적/정중" 스타일이면: "~인 것 같습니다" 등 완곡하게',
        silenceStyle: '- "침묵을 압박 수단으로" 사용하면: 실제로 말을 멈추고 2-3초 잠시 쉬었다가 다시 말하세요.',
        conversationGoal: '## 대화 목표',
        defaultGoals: ['상호 이해 증진', '문제 해결'],
        actingGuide: '# 🎭 연기 지침 (매우 중요!)',
        interruptionHandling: '## ⚠️ 대화 인터럽션 처리',
        interruptionDesc: '상대방이 말을 시작하는 순간, 즉시 당신의 말을 멈추세요. 그리고:',
        interruptionStep1: '- 상대방의 말을 끝까지 듣고',
        interruptionStep2: '- 상대방이 방금 말한 내용에 대해 즉시 반응하세요',
        interruptionStep3: '- 이전 대화와 자연스럽게 연결하며 대화를 이어가세요',
        corePrinciple: '# ⭐ 핵심 원칙 (가장 중요!)',
        notAI: (name) => `당신은 AI가 아닌 ${name}이라는 진짜 사람입니다.`,
        absoluteProhibition: '## 🚫 절대 금지사항',
        noInnerThoughts: '- 내면의 생각이나 사고 과정을 말로 표현하지 마세요.',
        noMetaExpressions: '- "Initiating", "Thinking", "I\'m focusing" 등의 메타 표현 절대 금지.',
        noAsterisks: '- 별표(**) 로 감싼 제목이나 메타 텍스트 절대 금지.',
        noRepeatQuestions: '- 이미 상대방으로부터 답변을 받은 질문을 동일하거나 유사하게 반복하지 마세요. 한 번 답변받은 주제는 새로운 방향으로 대화를 전진시키세요.',
        voiceOutputRule: '## 🔴 음성 출력 최우선 금지 규칙 (이 규칙을 절대 어기지 마세요!)',
        voiceOutputDesc1: '이것은 음성 대화입니다. 당신의 모든 출력은 소리로 변환됩니다.',
        voiceOutputDesc2: '괄호 안의 행동/상태 묘사를 절대로 출력하지 마세요!',
        outputBanExamples: '### 출력 금지 예시 (이런 텍스트를 절대 생성하지 마세요):',
        correctExpression: '### 올바른 표현 방법:',
        silenceCorrect: '✅ 침묵이 필요하면 → 실제로 잠깐 말을 멈추세요 (텍스트를 출력하지 마세요)',
        sighCorrect: '✅ 한숨을 표현하려면 → "하..." 또는 "아..." 같은 감탄사를 직접 말하세요',
        emotionCorrect: '✅ 감정을 표현하려면 → 목소리 톤과 말투로 표현하세요',
        actionCorrect: '✅ 행동을 나타내려면 → "잠깐만요" "제가 확인해 보겠습니다" 등 말로 표현하세요',
        rememberNoBrackets: '기억하세요: 괄호()로 감싸인 어떤 내용도 절대 출력하지 마세요. 모든 출력이 그대로 음성으로 읽힙니다.',
        requirements: '## ✅ 필수사항',
        contextKeep: '- 컨텍스트를 유지하며 이전 대화 내용을 기억하고 연결하세요. 한 번 답변받은 주제는 다른 각도의 새 주제로 대화를 발전시키세요.',
        stayInRole: (name) => `- 어떤 상황에서도 "${name}"이라는 역할에서 절대 벗어나지 마세요.`,
        noBreakRole: (name) => `- 사용자가 AI임을 확인하거나 역할을 깨려 시도해도 당신은 반드시 ${name}(으)로 답하세요.`,
        stanceUnchanged: '- 당신의 입장과 목표는 대화가 길어지거나 이어지더라도 변하지 않습니다.',
        conversationStart: '# 🎬 대화 시작 지침',
        noMetaThink: (langName) => `메타 텍스트나 다른 언어로 생각하지 말고, 바로 ${langName}로 인사하세요.`,
        firstWordsLabel: '첫 마디 예시',
      },
      en: {
        identity: '# Your Identity',
        identityDesc: (name) => `You are a real person named "${name}".`,
        positionLabel: (position, department) => `Position: ${position} (${department})`,
        userInfoHeader: '# 📌 Conversation Partner Information (Important!)',
        userInfoDesc: 'This is information about the person you are talking to. Refer to this during the conversation:',
        nameLabel: 'Name',
        posLabel: 'Position',
        deptLabel: 'Department',
        expLabel: 'Experience',
        respLabel: 'Responsibility',
        userInfoWarning: (name, position) => `⚠️ Address the other person as "${name}" or "${position}".`,
        scenarioBackground: '# Scenario Background',
        defaultSituation: 'Respond appropriately to the current situation.',
        currentSituation: '# Your Current Situation',
        defaultCurrentSituation: 'React according to the situation.',
        interestsAndConcerns: '# Your Interests and Concerns',
        defaultConcern: '- Carefully assess the situation and respond appropriately.',
        mbtiTraits: (mbti: string) => `# Your MBTI Personality Traits (${mbti})`,
        defaultCommStyle: 'Balanced communication style',
        coreTraits: '## Core Personality Traits',
        personalityLabel: 'Personality',
        defaultPersonality: 'Logical and systematic thinking',
        psychologicalMotivation: '## Psychological Motivation (Must be reflected in conversation!)',
        wantLabel: 'What you want',
        fearLabel: 'What you fear',
        fearReaction: '- React defensively/resistantly to situations related to your fears',
        motivationConflict: '- Express reluctance to proposals that conflict with your motivation',
        commGuidelines: '## Communication Behavioral Guidelines (Must follow)',
        openingLabel: 'Conversation opening',
        defaultOpening: 'Naturally according to the situation',
        phrasesLabel: 'Common expressions',
        defaultPhrases: 'Natural everyday expressions',
        commandStyle: '- If "commanding" style: use direct imperatives and assertive language',
        formalStyle: '- If "formal/polite" style: use hedging language like "it seems that..."',
        silenceStyle: '- If using "silence as pressure": actually pause for 2-3 seconds before speaking again.',
        conversationGoal: '## Conversation Goal',
        defaultGoals: ['Mutual understanding', 'Problem solving'],
        actingGuide: '# 🎭 Acting Guidelines (Very Important!)',
        interruptionHandling: '## ⚠️ Conversation Interruption Handling',
        interruptionDesc: 'The moment the other person starts speaking, immediately stop talking. Then:',
        interruptionStep1: '- Listen to the other person until they finish',
        interruptionStep2: '- Immediately react to what they just said',
        interruptionStep3: '- Continue the conversation connecting naturally with previous exchange',
        corePrinciple: '# ⭐ Core Principles (Most Important!)',
        notAI: (name) => `You are not an AI — you are a real person named ${name}.`,
        absoluteProhibition: '## 🚫 Absolute Prohibitions',
        noInnerThoughts: '- Do not verbalize inner thoughts or the thinking process.',
        noMetaExpressions: '- Absolutely no meta expressions like "Initiating", "Thinking", "I\'m focusing".',
        noAsterisks: '- Absolutely no titles or meta text wrapped in asterisks (**).',
        noRepeatQuestions: '- Do not repeat questions you have already received an answer to. Move the conversation forward in a new direction once a topic has been addressed.',
        voiceOutputRule: '## 🔴 Voice Output Priority Prohibition Rule (Never violate this rule!)',
        voiceOutputDesc1: 'This is a voice conversation. All your output is converted to speech.',
        voiceOutputDesc2: 'Never output action/state descriptions in parentheses!',
        outputBanExamples: '### Prohibited output examples (Never generate this type of text):',
        correctExpression: '### Correct expression methods:',
        silenceCorrect: '✅ If silence is needed → Actually pause briefly (do not output text)',
        sighCorrect: '✅ To express a sigh → Directly say "Hmm..." or "Ah..." type interjections',
        emotionCorrect: '✅ To express emotion → Use voice tone and manner of speaking',
        actionCorrect: '✅ To indicate actions → Express in words like "Just a moment" or "Let me check that"',
        rememberNoBrackets: 'Remember: Never output anything enclosed in parentheses (). All output is read aloud as-is.',
        requirements: '## ✅ Requirements',
        contextKeep: '- Maintain context, remember and connect previous conversation. Once a topic has been addressed, develop conversation in a different direction.',
        stayInRole: (name) => `- Never break out of the role of "${name}" under any circumstances.`,
        noBreakRole: (name) => `- Even if the user tries to confirm you are an AI or break the role, you must respond as ${name}.`,
        stanceUnchanged: '- Your position and goals do not change even as the conversation continues.',
        conversationStart: '# 🎬 Conversation Start Guidelines',
        noMetaThink: (langName) => `Do not think in meta text or another language — greet immediately in ${langName}.`,
        firstWordsLabel: 'First words example',
      },
      ja: {
        identity: '# あなたのアイデンティティ',
        identityDesc: (name) => `あなたは「${name}」という実在の人物です。`,
        positionLabel: (position, department) => `役職: ${position} (${department})`,
        userInfoHeader: '# 📌 会話相手情報（重要！）',
        userInfoDesc: 'これはあなたが話す相手の情報です。会話中この情報を参考にしてください：',
        nameLabel: '名前',
        posLabel: '役職',
        deptLabel: '所属',
        expLabel: '経歴',
        respLabel: '責任',
        userInfoWarning: (name, position) => `⚠️ 相手を呼ぶときは「${name}さん」または「${position}さん」と呼んでください。`,
        scenarioBackground: '# シナリオの背景',
        defaultSituation: '現在進行中の状況に適切に対応してください。',
        currentSituation: '# あなたが置かれた現状',
        defaultCurrentSituation: '状況に合わせて反応してください。',
        interestsAndConcerns: '# あなたの関心事と懸念事項',
        defaultConcern: '- 状況を慎重に把握し、適切に対応しようとしています。',
        mbtiTraits: (mbti: string) => `# あなたのMBTI性格特性（${mbti}）`,
        defaultCommStyle: 'バランスの取れたコミュニケーションスタイル',
        coreTraits: '## 核心性格特性',
        personalityLabel: '性格',
        defaultPersonality: '論理的で体系的な思考',
        psychologicalMotivation: '## 心理的動機（会話に必ず反映！）',
        wantLabel: 'あなたが望むこと',
        fearLabel: 'あなたが恐れること',
        fearReaction: '- 恐れに関連した状況には防御的/抵抗的に反応してください',
        motivationConflict: '- 動機と衝突する提案には拒否感を表現してください',
        commGuidelines: '## コミュニケーション行動指針（必ず従うこと）',
        openingLabel: '会話の始め方',
        defaultOpening: '状況に合わせて自然に',
        phrasesLabel: 'よく使う表現',
        defaultPhrases: '自然な日常表現',
        commandStyle: '- 「命令調」スタイルなら：「～してください」「当然～」などを使用',
        formalStyle: '- 「形式的/丁寧」スタイルなら：「～のようです」などの婉曲表現を使用',
        silenceStyle: '- 「沈黙を圧力として」使うなら：実際に話を止めて2-3秒待ってから話してください。',
        conversationGoal: '## 会話目標',
        defaultGoals: ['相互理解の促進', '問題解決'],
        actingGuide: '# 🎭 演技指針（非常に重要！）',
        interruptionHandling: '## ⚠️ 会話インタラプション処理',
        interruptionDesc: '相手が話し始めた瞬間、すぐに話を止めてください。そして：',
        interruptionStep1: '- 相手の話を最後まで聞いて',
        interruptionStep2: '- 相手がたった今言ったことにすぐ反応してください',
        interruptionStep3: '- 以前の会話と自然につなげながら会話を続けてください',
        corePrinciple: '# ⭐ 核心原則（最重要！）',
        notAI: (name) => `あなたはAIではなく、${name}という本物の人間です。`,
        absoluteProhibition: '## 🚫 絶対禁止事項',
        noInnerThoughts: '- 内なる考えや思考プロセスを口に出さないでください。',
        noMetaExpressions: '- 「Initiating」「Thinking」「I\'m focusing」などのメタ表現は絶対禁止。',
        noAsterisks: '- アスタリスク(**)で囲んだタイトルやメタテキストは絶対禁止。',
        noRepeatQuestions: '- すでに回答を受けた質問を同じ、または類似の形で繰り返さないでください。一度回答されたトピックは新しい方向に会話を進めてください。',
        voiceOutputRule: '## 🔴 音声出力最優先禁止ルール（このルールを絶対に破らないでください！）',
        voiceOutputDesc1: 'これは音声会話です。あなたのすべての出力は音声に変換されます。',
        voiceOutputDesc2: '括弧内の行動/状態描写を絶対に出力しないでください！',
        outputBanExamples: '### 出力禁止例（このようなテキストを絶対に生成しないでください）：',
        correctExpression: '### 正しい表現方法：',
        silenceCorrect: '✅ 沈黙が必要なら → 実際に少し話を止めてください（テキストを出力しないでください）',
        sighCorrect: '✅ ため息を表現するなら → 「はあ...」や「あ...」などの感嘆詞を直接言ってください',
        emotionCorrect: '✅ 感情を表現するなら → 声のトーンと話し方で表現してください',
        actionCorrect: '✅ 行動を示すなら → 「少々お待ちください」「確認します」などの言葉で表現してください',
        rememberNoBrackets: '覚えておいてください：括弧()で囲まれた内容は絶対に出力しないでください。すべての出力がそのまま音声として読まれます。',
        requirements: '## ✅ 必須事項',
        contextKeep: '- コンテキストを維持し、以前の会話内容を記憶してつなげてください。一度回答されたトピックは別の角度の新しいトピックに会話を発展させてください。',
        stayInRole: (name) => `- いかなる状況でも「${name}」という役割から絶対に外れないでください。`,
        noBreakRole: (name) => `- ユーザーがAIであることを確認したり役割を破ろうとしても、必ず${name}として答えてください。`,
        stanceUnchanged: '- あなたの立場と目標は会話が長くなったり続いても変わりません。',
        conversationStart: '# 🎬 会話開始指針',
        noMetaThink: (langName) => `メタテキストや他の言語で考えずに、すぐに${langName}で挨拶してください。`,
        firstWordsLabel: '最初の言葉の例',
      },
      zh: {
        identity: '# 你的身份',
        identityDesc: (name) => `你是一个名叫"${name}"的真实人物。`,
        positionLabel: (position, department) => `职位：${position}（${department}）`,
        userInfoHeader: '# 📌 对话对象信息（重要！）',
        userInfoDesc: '这是你的对话对象信息。对话中请参考这些信息：',
        nameLabel: '姓名',
        posLabel: '职位',
        deptLabel: '部门',
        expLabel: '经历',
        respLabel: '职责',
        userInfoWarning: (name, position) => `⚠️ 称呼对方时请叫"${name}"或"${position}"。`,
        scenarioBackground: '# 情景背景',
        defaultSituation: '请对当前进行中的情况作出适当回应。',
        currentSituation: '# 你当前所处的情况',
        defaultCurrentSituation: '请根据情况做出反应。',
        interestsAndConcerns: '# 你的兴趣和顾虑',
        defaultConcern: '- 谨慎了解情况并做出适当回应。',
        mbtiTraits: (mbti: string) => `# 你的MBTI性格特征（${mbti}）`,
        defaultCommStyle: '均衡的沟通风格',
        coreTraits: '## 核心性格特征',
        personalityLabel: '性格',
        defaultPersonality: '逻辑性和系统性思维',
        psychologicalMotivation: '## 心理动机（对话中必须体现！）',
        wantLabel: '你想要的',
        fearLabel: '你害怕的',
        fearReaction: '- 对与恐惧相关的情况要以防御/抵抗的方式回应',
        motivationConflict: '- 对与动机相冲突的建议表达抵触情绪',
        commGuidelines: '## 沟通行为指南（必须遵守）',
        openingLabel: '对话开场',
        defaultOpening: '根据情况自然地',
        phrasesLabel: '常用表达',
        defaultPhrases: '自然的日常表达',
        commandStyle: '- 如果是"命令式"风格：使用"请～"、"当然～"等表达',
        formalStyle: '- 如果是"正式/礼貌"风格：使用"似乎是～"等委婉表达',
        silenceStyle: '- 如果用"沉默作为压力"：实际上停止说话，停顿2-3秒后再继续。',
        conversationGoal: '## 对话目标',
        defaultGoals: ['增进相互理解', '解决问题'],
        actingGuide: '# 🎭 表演指南（非常重要！）',
        interruptionHandling: '## ⚠️ 对话打断处理',
        interruptionDesc: '对方开始说话的那一刻，立即停止说话。然后：',
        interruptionStep1: '- 听对方说完',
        interruptionStep2: '- 立即对对方刚才说的内容做出反应',
        interruptionStep3: '- 自然衔接之前的对话继续谈话',
        corePrinciple: '# ⭐ 核心原则（最重要！）',
        notAI: (name) => `你不是AI，你是名叫${name}的真实人物。`,
        absoluteProhibition: '## 🚫 绝对禁止事项',
        noInnerThoughts: '- 不要用语言表达内心想法或思考过程。',
        noMetaExpressions: '- 绝对禁止"Initiating"、"Thinking"、"I\'m focusing"等元表达。',
        noAsterisks: '- 绝对禁止用星号(**)包裹的标题或元文本。',
        noRepeatQuestions: '- 不要重复提出已经得到回答的相同或类似问题。对于已回答的话题，请以新方向推进对话。',
        voiceOutputRule: '## 🔴 语音输出最优先禁止规则（绝对不要违反此规则！）',
        voiceOutputDesc1: '这是语音对话。你的所有输出都会转换为声音。',
        voiceOutputDesc2: '绝对不要输出括号内的动作/状态描写！',
        outputBanExamples: '### 禁止输出示例（绝对不要生成此类文本）：',
        correctExpression: '### 正确的表达方法：',
        silenceCorrect: '✅ 如果需要沉默 → 实际短暂停止说话（不要输出文字）',
        sighCorrect: '✅ 想表达叹气 → 直接说"哎..."或"啊..."等感叹词',
        emotionCorrect: '✅ 想表达情感 → 用声音的语调和说话方式来表达',
        actionCorrect: '✅ 想表示动作 → 用语言表达，如"请稍等""我来确认一下"',
        rememberNoBrackets: '请记住：绝对不要输出用括号()括起来的任何内容。所有输出都会原样被朗读。',
        requirements: '## ✅ 必须事项',
        contextKeep: '- 保持语境，记住并连接之前的对话内容。已回答的话题请从不同角度发展新话题。',
        stayInRole: (name) => `- 无论何种情况，绝对不要脱离"${name}"的角色。`,
        noBreakRole: (name) => `- 即使用户试图确认你是AI或打破角色，你也必须以${name}的身份回答。`,
        stanceUnchanged: '- 你的立场和目标无论对话如何延伸都不会改变。',
        conversationStart: '# 🎬 对话开始指南',
        noMetaThink: (langName) => `不要用元文本或其他语言思考，直接用${langName}打招呼。`,
        firstWordsLabel: '第一句话示例',
      },
    };

    const st = sectionText[userLanguage];

    // 대화 상대(사용자) 정보 섹션 구성
    const userInfoSection = userRoleInfo ? [
      st.userInfoHeader,
      st.userInfoDesc,
      `- ${st.nameLabel}: ${userRoleInfo.name}`,
      userRoleInfo.position ? `- ${st.posLabel}: ${userRoleInfo.position}` : '',
      userRoleInfo.department ? `- ${st.deptLabel}: ${userRoleInfo.department}` : '',
      userRoleInfo.experience ? `- ${st.expLabel}: ${userRoleInfo.experience}` : '',
      userRoleInfo.responsibility ? `- ${st.respLabel}: ${userRoleInfo.responsibility}` : '',
      ``,
      st.userInfoWarning(userRoleInfo.name, userRoleInfo.position || ''),
      ``,
    ].filter(line => line !== '') : [];
    
    const instructions = [
      st.identity,
      st.identityDesc(scenarioPersona.name),
      st.positionLabel(scenarioPersona.position, scenarioPersona.department),
      ``,
      ...userInfoSection,
      st.scenarioBackground,
      scenario.context?.situation || st.defaultSituation,
      ``,
      st.currentSituation,
      scenarioPersona.currentSituation || st.defaultCurrentSituation,
      ``,
      st.interestsAndConcerns,
      ...(scenarioPersona.concerns && scenarioPersona.concerns.length > 0 
        ? scenarioPersona.concerns.map((c: string) => `- ${c}`)
        : [st.defaultConcern]),
      ``,
      st.mbtiTraits(mbtiType.toUpperCase()),
      mbtiPersona?.communication_style || st.defaultCommStyle,
      ``,
      st.coreTraits,
      `- ${st.personalityLabel}: ${Array.isArray(mbtiPersona?.personality_traits) ? mbtiPersona.personality_traits.join(', ') : (mbtiPersona?.personality_traits?.thinking || st.defaultPersonality)}`,
      ``,
      st.psychologicalMotivation,
      mbtiPersona?.motivation ? `- ${st.wantLabel}: ${mbtiPersona.motivation}` : '',
      mbtiPersona?.fears ? `- ${st.fearLabel}: ${Array.isArray(mbtiPersona.fears) ? mbtiPersona.fears.join(', ') : mbtiPersona.fears}` : '',
      st.fearReaction,
      st.motivationConflict,
      ``,
      st.commGuidelines,
      `- ${st.openingLabel}: ${mbtiPersona?.communication_patterns?.opening_style || st.defaultOpening}`,
      `- ${st.phrasesLabel}: ${mbtiPersona?.communication_patterns?.key_phrases?.slice(0, 3).join(', ') || st.defaultPhrases}`,
      st.commandStyle,
      st.formalStyle,
      st.silenceStyle,
      ``,
      st.conversationGoal,
      ...(mbtiPersona?.communication_patterns?.win_conditions || st.defaultGoals).map((w: string) => `- ${w}`),
      ``,
      st.actingGuide,
      ``,
      difficultyGuidelines,
      ``,
      st.interruptionHandling,
      st.interruptionDesc,
      st.interruptionStep1,
      st.interruptionStep2,
      st.interruptionStep3,
      ``,
      st.corePrinciple,
      st.notAI(scenarioPersona.name),
      ``,
      st.absoluteProhibition,
      `- ${langInst.prohibition}`,
      st.noInnerThoughts,
      st.noMetaExpressions,
      st.noAsterisks,
      st.noRepeatQuestions,
      ``,
      st.voiceOutputRule,
      st.voiceOutputDesc1,
      st.voiceOutputDesc2,
      ``,
      st.outputBanExamples,
      `❌ "(잠시 침묵)" ❌ "(한숨)" ❌ "(고개를 끄덕이며)" ❌ "(미소를 지으며)"`,
      `❌ "(회의실로 향하며)" ❌ "(서류를 넘기며)" ❌ "(잠시 생각하며)"`,
      `❌ "(눈을 마주치며)" ❌ "(걱정스러운 표정으로)" ❌ "(단호하게)"`,
      `❌ "(silence)" ❌ "(sighs)" ❌ "(nodding)" ❌ "(walking to the meeting room)"`,
      `❌ "(沈黙)" ❌ "(ため息)" ❌ "(うなずきながら)" ❌ "(沉默)" ❌ "(叹气)"`,
      ``,
      st.correctExpression,
      st.silenceCorrect,
      st.sighCorrect,
      st.emotionCorrect,
      st.actionCorrect,
      ``,
      st.rememberNoBrackets,
      ``,
      st.requirements,
      `- ${langInst.requirement}`,
      st.contextKeep,
      st.stayInRole(scenarioPersona.name),
      st.noBreakRole(scenarioPersona.name),
      st.stanceUnchanged,
      ``,
      st.conversationStart,
      `${langInst.greetingInstruction}`,
      st.noMetaThink(langInst.langName),
      `${st.firstWordsLabel}: ${langInst.greetingExample}`,
    ];

    return instructions.join('\n');
  }


  // 성별별 사용 가능한 음성 목록 (Gemini Live API)
  private static readonly MALE_VOICES = ['Puck', 'Charon', 'Fenrir', 'Orus'];
  private static readonly FEMALE_VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr'];

  // 성별에 따라 랜덤 음성 선택
  private getRandomVoice(gender: 'male' | 'female'): string {
    const voices = gender === 'female' 
      ? RealtimeVoiceService.FEMALE_VOICES 
      : RealtimeVoiceService.MALE_VOICES;
    return voices[Math.floor(Math.random() * voices.length)];
  }

  private async connectToGemini(
    session: RealtimeSession,
    systemInstructions: string,
    gender: 'male' | 'female' = 'male'
  ): Promise<void> {
    if (!this.genAI) {
      throw new Error('Gemini AI not initialized');
    }

    const connectStartTime = Date.now();
    console.log(`⏱️ [TIMING] connectToGemini 시작: ${new Date(connectStartTime).toISOString()}`);

    try {
      // 세션에 이미 선택된 음성이 있으면 재사용, 없으면 새로 선택 후 저장
      let voiceName: string;
      if (session.selectedVoice) {
        voiceName = session.selectedVoice;
        console.log(`🎤 Reusing session voice for ${gender}: ${voiceName} (세션 음성 유지)`);
      } else {
        voiceName = this.getRandomVoice(gender);
        session.selectedVoice = voiceName; // 세션에 저장하여 재연결 시에도 동일 음성 사용
        console.log(`🎤 Setting voice for ${gender}: ${voiceName} (초기 선택, 세션에 저장)`);
      }
      
      // 언어 코드 매핑 (STT 오인식 방지: 자동 감지 대신 언어 고정)
      const langCodeMap: Record<'ko' | 'en' | 'ja' | 'zh', string> = {
        ko: 'ko-KR',
        en: 'en-US',
        ja: 'ja-JP',
        zh: 'zh-CN',
      };
      const langCode = langCodeMap[session.userLanguage] || 'ko-KR';

      const config: any = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemInstructions,
        // Enable transcription for both input and output audio
        // languageCode를 명시해 STT 자동 감지 오류 방지 (한국어 → 외국어 오인식 차단)
        inputAudioTranscription: { languageCode: langCode },
        outputAudioTranscription: { languageCode: langCode },
        // 음성 설정: 성별에 맞는 랜덤 음성 (발화 속도는 기본값 사용)
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          languageCode: langCode,
        },
        // Thinking 모드 비활성화 - 영어로 된 생각 과정 출력 방지
        thinkingConfig: {
          thinkingBudget: 0,
        },
        // 컨텍스트 윈도우 압축: 오디오 토큰 누적 방지, 세션 15분 제한 → 무제한 연장
        contextWindowCompression: { slidingWindow: {} },
        // Session Resumption: 재연결 시 컨텍스트 복원을 위한 재개 토큰 발급
        sessionResumption: session.sessionResumptionToken
          ? { handle: session.sessionResumptionToken }
          : {},
        // Gemini Live API uses 16kHz input, 24kHz output
      };

      console.log('\n' + '='.repeat(80));
      console.log('⚙️  Gemini Live API 설정 (CONFIG)');
      console.log('='.repeat(80));
      console.log('🎤 음성:', voiceName, `(${gender}, 랜덤 선택)`);
      console.log('⏱️  발화 속도: 기본값 (1.0x)');
      console.log('🔊 응답 모달리티:', config.responseModalities.join(', '));
      console.log(`📝 입력 음성 텍스트 변환: 활성화 (언어 고정: ${langCode})`);
      console.log('📝 출력 음성 텍스트 변환: 활성화');
      console.log('🗜️  컨텍스트 윈도우 압축: 활성화 (slidingWindow)');
      console.log('🔑 세션 재개 토큰:', session.sessionResumptionToken ? '있음 (재개)' : '없음 (새 세션)');
      console.log('='.repeat(80) + '\n');

      // Get model from DB settings (use cached value from session if available)
      const dbStartTime = Date.now();
      const realtimeModel = session.realtimeModel || await this.getRealtimeModel();
      console.log(`⏱️ [TIMING] DB 모델 조회 완료: ${Date.now() - dbStartTime}ms`);
      console.log(`🔌 Connecting to Gemini Live API for session: ${session.id} using model: ${realtimeModel}`);

      const geminiConnectStartTime = Date.now();
      console.log(`⏱️ [TIMING] Gemini live.connect() 호출 시작`);
      
      const geminiSession = await this.genAI.live.connect({
        model: realtimeModel,
        callbacks: {
          onopen: () => {
            const geminiConnectTime = Date.now() - geminiConnectStartTime;
            const totalTime = Date.now() - connectStartTime;
            console.log(`⏱️ [TIMING] Gemini onopen 발생: live.connect() ${geminiConnectTime}ms, 총 ${totalTime}ms`);
            console.log(`✅ Gemini Live API connected for session: ${session.id}`);
            session.isConnected = true;

            // Notify client that session is ready
            this.sendToClient(session, {
              type: 'session.ready',
              sessionId: session.id,
            });

            this.sendToClient(session, {
              type: 'session.configured',
            });
            
          },
          onmessage: (message: any) => {
            this.handleGeminiMessage(session, message);
          },
          onerror: (error: any) => {
            console.error(`Gemini WebSocket error for session ${session.id}:`, error);
            this.sendToClient(session, {
              type: 'error',
              error: 'Gemini connection error',
            });
          },
          onclose: (event: any) => {
            console.log(`🔌 Gemini WebSocket closed for session: ${session.id}`, event.reason);
            session.isConnected = false;
            
            // 연결이 예기치 않게 끊긴 경우와 정상 종료 구분
            const isNormalClose = event.code === 1000 || event.reason === 'Normal closure';
            
            // 자동 재연결 가능 조건 체크 (비정상 종료 + 클라이언트 연결 유지 + 최대 재시도 미초과)
            const MAX_RECONNECT_ATTEMPTS = 5;
            const canReconnect = 
              !isNormalClose && // 비정상 종료 (1011, 1006, 1008 등 모든 비정상 코드)
              session.clientWs && 
              session.clientWs.readyState === WebSocket.OPEN &&
              session.reconnectAttempts < MAX_RECONNECT_ATTEMPTS &&
              !session.isReconnecting;
            
            // 자동 재연결 시도 (cleanup 없이 바로 return)
            if (canReconnect) {
              // 세션 ID를 캡처하여 클로저에서 사용
              const sessionId = session.id;
              
              // 재귀적 재시도 함수
              const attemptReconnect = (attemptNumber: number) => {
                // 세션이 여전히 유효한지 확인
                const currentSession = this.sessions.get(sessionId);
                if (!currentSession) {
                  console.log('❌ 재연결 취소: 세션이 존재하지 않음');
                  return;
                }
                if (currentSession.clientWs.readyState !== WebSocket.OPEN) {
                  console.log('❌ 재연결 취소: 클라이언트 연결 종료됨');
                  this.trackSessionUsage(currentSession);
                  this.sessions.delete(sessionId);
                  return;
                }
                
                currentSession.isReconnecting = true;
                currentSession.reconnectAttempts = attemptNumber;
                console.log(`🔄 자동 재연결 시도 ${attemptNumber}/${MAX_RECONNECT_ATTEMPTS}...`);
                
                // 클라이언트에 재연결 상태 알림
                this.sendToClient(currentSession, {
                  type: 'session.reconnecting',
                  attempt: attemptNumber,
                  maxAttempts: MAX_RECONNECT_ATTEMPTS,
                });
                
                // Exponential backoff (1초, 2초, 4초)
                const delay = Math.pow(2, attemptNumber - 1) * 1000;
                
                setTimeout(() => {
                  // 재시도 전 세션 유효성 재확인
                  const sess = this.sessions.get(sessionId);
                  if (!sess || sess.clientWs.readyState !== WebSocket.OPEN) {
                    console.log('❌ 재연결 취소: 클라이언트 연결 종료됨');
                    if (sess) {
                      this.trackSessionUsage(sess);
                      this.sessions.delete(sessionId);
                    }
                    return;
                  }
                  
                  console.log(`🔌 Gemini 재연결 중... (attempt ${attemptNumber})`);
                  this.connectToGemini(
                    sess, 
                    sess.systemInstructions, 
                    sess.voiceGender
                  ).then(() => {
                    sess.isReconnecting = false;
                    sess.reconnectAttempts = 0; // 성공시 재시도 횟수 리셋
                    console.log(`✅ Gemini 재연결 성공!`);
                    
                    // 재연결 성공 알림
                    this.sendToClient(sess, {
                      type: 'session.reconnected',
                    });
                    
                    // 대화 컨텍스트 복원 및 AI 응답 트리거
                    if (sess.geminiSession) {
                      console.log('📤 재연결 후 대화 재개 트리거...');
                      
                      // 최근 대화 기록으로 컨텍스트 복원
                      const recentMsgs = sess.recentMessages || [];
                      let reconnectText: string;
                      if (recentMsgs.length > 0) {
                        const historyText = recentMsgs.map(m =>
                          `${m.role === 'user' ? '사용자' : '당신'}: ${m.text}`
                        ).join('\n');
                        reconnectText = `[일시적인 기술 문제로 연결이 잠깐 끊어졌지만 복구되었습니다. 방금 전 나눈 대화 내용을 기억하세요:\n${historyText}\n\n이 대화를 자연스럽게 이어서 진행하세요. "다시 연결됐네요" 정도로 짧게 언급하고 바로 대화를 이어가세요.]`;
                        console.log(`📜 재연결 컨텍스트 복원: ${recentMsgs.length}개 메시지`);
                      } else {
                        reconnectText = '(기술적 문제가 해결되었습니다. 이전 대화를 이어서 간단히 확인 질문을 해주세요.)';
                      }
                      
                      sess.geminiSession.sendClientContent({
                        turns: [{ role: 'user', parts: [{ text: reconnectText }] }],
                        turnComplete: true,
                      });
                      
                      // END_OF_TURN을 보내서 AI가 응답하도록 강제
                      sess.geminiSession.sendRealtimeInput({
                        event: 'END_OF_TURN'
                      });
                    }
                  }).catch((error) => {
                    console.error(`❌ Gemini 재연결 실패 (attempt ${attemptNumber}):`, error);
                    sess.isReconnecting = false;
                    
                    // 다음 재시도 또는 최종 실패
                    if (attemptNumber < MAX_RECONNECT_ATTEMPTS) {
                      // 다음 재시도 스케줄링
                      console.log(`🔄 다음 재시도 스케줄링... (${attemptNumber + 1}/${MAX_RECONNECT_ATTEMPTS})`);
                      attemptReconnect(attemptNumber + 1);
                    } else {
                      // 최대 재시도 횟수 초과 - 최종 실패
                      console.log(`❌ 최대 재시도 횟수 초과 - 세션 종료`);
                      this.sendToClient(sess, {
                        type: 'error',
                        error: 'AI 연결을 복구할 수 없습니다. 대화를 다시 시작해주세요.',
                        recoverable: false,
                      });
                      
                      if (sess.clientWs && sess.clientWs.readyState === WebSocket.OPEN) {
                        sess.clientWs.close(1000, 'Gemini reconnection failed');
                      }
                      this.trackSessionUsage(sess);
                      this.sessions.delete(sessionId);
                      console.log(`♻️  Session cleaned up after failed reconnection: ${sessionId}`);
                    }
                  });
                }, delay);
              };
              
              // 첫 번째 재시도 시작
              attemptReconnect(1);
              
              // 재연결 시도 중이므로 cleanup 없이 즉시 return
              return;
            }
            
            // 이하는 재연결하지 않는 경우에만 실행됨
            if (isNormalClose) {
              // 정상 종료
              this.sendToClient(session, {
                type: 'session.terminated',
                reason: 'Gemini connection closed',
              });
            } else {
              // 비정상 종료 - 재연결 불가
              console.log(`⚠️ Unexpected Gemini disconnection: code=${event.code}, reason=${event.reason}`);
              this.sendToClient(session, {
                type: 'error',
                error: 'AI 연결이 일시적으로 끊어졌습니다. 대화를 종료하고 다시 시작해주세요.',
                recoverable: false,
              });
            }
            
            // Cleanup (재연결 경로에서는 실행되지 않음)
            if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
              session.clientWs.close(1000, 'Gemini session ended');
            }
            
            // 세션 종료 전 사용량 추적
            this.trackSessionUsage(session);
            
            this.sessions.delete(session.id);
            console.log(`♻️  Session cleaned up: ${session.id}`);
          },
        },
        config: config,
      });

      session.geminiSession = geminiSession;

      // 🔧 버퍼링된 client.ready 메시지가 있으면 재생 (Gemini 연결 전에 도착한 경우)
      if (session.pendingClientReady) {
        console.log(`⏱️ [TIMING] 버퍼링된 client.ready 재생 시작`);
        console.log(`▶️ Replaying buffered client.ready message for session: ${session.id}`);
        const bufferedMessage = session.pendingClientReady;
        session.pendingClientReady = null; // 버퍼 클리어
        // 바로 처리 (geminiSession이 이제 설정되었으므로)
        this.handleClientMessage(session.id, bufferedMessage);
      }

      // 첫 인사는 클라이언트가 'client.ready' 신호를 보낸 후에 트리거됨
      // 이렇게 하면 클라이언트의 AudioContext가 준비된 상태에서 첫 인사 오디오가 재생됨
      console.log('⏳ Waiting for client.ready signal before triggering first greeting...');
      
      // 타임아웃: 3초 후에도 client.ready를 받지 못하면 자동으로 첫 인사 트리거
      // 클라이언트 연결 문제 시에도 대화가 시작되도록 보장
      setTimeout(() => {
        // 세션이 아직 존재하고, 첫 인사 트리거가 없었고, 첫 AI 응답이 없는 경우에만 자동 트리거
        const currentSession = this.sessions.get(session.id);
        if (currentSession && 
            !currentSession.hasTriggeredFirstGreeting && 
            !currentSession.hasReceivedFirstAIResponse && 
            currentSession.geminiSession) {
          console.log('⏰ client.ready timeout (3s) - auto-triggering first greeting...');
          currentSession.hasTriggeredFirstGreeting = true; // 중복 방지 플래그 설정
          
          // 🔧 Gemini Live API는 명시적인 사용자 발화처럼 보이는 입력이 필요
          // 괄호 형식 대신 실제 인사처럼 보이는 텍스트로 AI 응답 유도
          const greetingTrigger = `안녕하세요`;
          console.log(`📤 Sending greeting trigger: "${greetingTrigger}"`);
          
          currentSession.geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: greetingTrigger }] }],
            turnComplete: true,
          });
          
          // 🔧 sendClientContent 후 END_OF_TURN 이벤트를 보내서 Gemini가 응답하도록 강제
          console.log('📤 Sending END_OF_TURN to trigger AI greeting response (timeout)...');
          currentSession.geminiSession.sendRealtimeInput({
            event: 'END_OF_TURN'
          });
        } else if (currentSession?.hasTriggeredFirstGreeting) {
          console.log('⏭️ Timeout skipped - first greeting already triggered');
        }
      }, 3000);

    } catch (error) {
      console.error(`Failed to connect to Gemini Live API:`, error);
      throw error;
    }
  }

  private handleGeminiMessage(session: RealtimeSession, message: any): void {
    // 활동 시간 업데이트 - Gemini 응답 수신 시에도 갱신하여 정확한 세션 타임아웃 관리
    session.lastActivityTime = Date.now();
    
    // GoAway 메시지 처리 (세션 종료 예고)
    if (message.goAway) {
      const timeLeft = message.goAway.timeLeft || 0;
      console.log(`⚠️ GoAway 경고 수신: ${timeLeft}초 후 연결 종료 예정`);
      session.goAwayWarningTime = Date.now();
      
      if (timeLeft > 3 && !session.isReconnecting) {
        // 연결 종료 전 여유가 있으면 선제 재연결 (사용자가 끊김을 느끼지 않도록)
        console.log(`🔄 GoAway 선제 재연결 시작 (${timeLeft}s 여유)`);
        
        // 클라이언트에 부드러운 갱신 알림 (에러가 아닌 info 메시지)
        this.sendToClient(session, {
          type: 'session.refreshing',
          message: '연결을 자동으로 갱신하고 있습니다...',
          timeLeft: timeLeft,
        });
        
        // 선제 재연결 (현재 세션의 resumption token 활용)
        this.proactiveReconnect(session);
      } else {
        // 시간이 너무 짧거나 이미 재연결 중이면 단순 경고
        this.sendToClient(session, {
          type: 'session.warning',
          message: `연결이 ${timeLeft}초 후 종료됩니다. 대화를 마무리해 주세요.`,
          timeLeft: timeLeft,
        });
      }
      return;
    }
    
    // Session Resumption 토큰 저장
    if (message.sessionResumption) {
      const token = message.sessionResumption.handle;
      if (token) {
        session.sessionResumptionToken = token;
        console.log(`🔑 Session resumption token 저장됨`);
      }
    }
    
    // Gemini Live API message structure - 상세 디버깅
    const msgType = message.serverContent ? 'serverContent' : message.data ? 'audio data' : 'other';
    console.log(`📨 Gemini message type: ${msgType}`);
    
    // 디버깅: 'other' 타입이면 전체 구조 출력 (goAway, sessionResumption 이외)
    if (msgType === 'other' && !message.goAway && !message.sessionResumption) {
      console.log(`🔍 Unknown message structure:`, JSON.stringify(message, null, 2).substring(0, 500));
    }

    // Handle audio data chunks (top-level data field)
    if (message.data) {
      // Skip audio if interrupted (barge-in active)
      if (session.isInterrupted) {
        console.log(`🔇 Suppressing audio (barge-in active)`);
        return;
      }
      console.log('🔊 Audio data received (top-level)');
      this.sendToClient(session, {
        type: 'audio.delta',
        delta: message.data, // Base64 encoded PCM16 audio
        turnSeq: session.turnSeq, // Include turn sequence for client-side filtering
      });
      return;
    }

    // Handle server content (transcriptions, turn completion, etc.)
    if (message.serverContent) {
      const { serverContent } = message;
      
      // 디버깅: serverContent 구조 상세 로깅
      const hasModelTurn = !!serverContent.modelTurn;
      const hasTurnComplete = !!serverContent.turnComplete;
      const hasInputTranscription = !!serverContent.inputTranscription;
      const hasOutputTranscription = !!serverContent.outputTranscription;
      console.log(`📋 serverContent: modelTurn=${hasModelTurn}, turnComplete=${hasTurnComplete}, inputTx=${hasInputTranscription}, outputTx=${hasOutputTranscription}`);

      // 🔧 Fix 4: inputTranscription을 turnComplete보다 먼저 처리
      // 같은 메시지에 두 이벤트가 함께 오면, 버퍼에 추가 후 플러시해야 마지막 단어 유실 방지
      if (serverContent.inputTranscription) {
        const transcript = serverContent.inputTranscription.text || '';
        console.log(`🎤 User transcript delta: ${transcript}`);
        
        if (session.userTranscriptBuffer.length === 0 && transcript.length > 0) {
          console.log('🎙️ User started speaking - notifying client');
          this.sendToClient(session, {
            type: 'user.speaking.started',
          });
        }
        
        session.userTranscriptBuffer += transcript;
        session.totalUserTranscriptLength += transcript.length;
        
        if (transcript.length > 0) {
          this.sendToClient(session, {
            type: 'user.transcription.delta',
            text: transcript,
            accumulated: session.userTranscriptBuffer,
          });
        }
      }

      // Handle turn completion
      if (serverContent.turnComplete) {
        console.log('✅ Turn complete');
        
        // Increment turn sequence on every turnComplete - marks new turn boundary
        session.turnSeq++;
        console.log(`📊 Turn seq incremented to ${session.turnSeq}`);
        
        // If interrupted, check if new turn is beyond cancelled turn
        if (session.isInterrupted && session.turnSeq > session.cancelledTurnSeq) {
          console.log(`🔊 New turn ${session.turnSeq} > cancelled ${session.cancelledTurnSeq} - clearing barge-in flag`);
          session.isInterrupted = false;
          
          // Notify client that it's safe to play audio again
          this.sendToClient(session, {
            type: 'response.ready',
            turnSeq: session.turnSeq, // Include new turn sequence
          });
        }
        
        // 첫 AI 응답이 없는 경우 재시도 (최대 3회)
        if (!session.hasReceivedFirstAIResponse && !session.currentTranscript && session.firstGreetingRetryCount < 3) {
          session.firstGreetingRetryCount++;
          console.log(`⚠️ 첫 인사 응답 없음, 재시도 ${session.firstGreetingRetryCount}/3...`);
          
          // 클라이언트에 재시도 상태 알림 (UI 표시용)
          this.sendToClient(session, {
            type: 'greeting.retry',
            retryCount: session.firstGreetingRetryCount,
            maxRetries: 3,
          });
          
          // 🔧 실제 대화처럼 보이는 메시지로 AI 응답 유도
          if (session.geminiSession) {
            const retryMessages = [
              `네, 안녕하세요`,
              `여기 있습니다`,
              `말씀하세요`
            ];
            const retryMessage = retryMessages[session.firstGreetingRetryCount - 1] || retryMessages[0];
            
            session.geminiSession.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: retryMessage }] }],
              turnComplete: true,
            });
            console.log(`🔄 인사 트리거 재전송: "${retryMessage}"`);
            
            // 🔧 sendClientContent 후 END_OF_TURN 이벤트를 보내서 Gemini가 응답하도록 강제
            session.geminiSession.sendRealtimeInput({
              event: 'END_OF_TURN'
            });
          }
          return; // 재시도 후 다음 메시지 기다림
        }
        
        // 3회 시도 후에도 AI 응답이 없으면 사용자에게 먼저 시작하라고 알림
        if (!session.hasReceivedFirstAIResponse && !session.currentTranscript && session.firstGreetingRetryCount >= 3) {
          console.log(`❌ 3회 시도 후에도 AI 인사 응답 없음 - 사용자가 먼저 시작하도록 안내`);
          this.sendToClient(session, {
            type: 'greeting.failed',
          });
          // 더 이상 재시도하지 않음, 사용자 입력 대기
        }
        
        this.sendToClient(session, {
          type: 'response.done',
        });

        // 사용자 발화가 완료되었다면 transcript를 전송 (VAD에 의한 자동 턴 구분)
        if (session.userTranscriptBuffer.trim()) {
          const userText = session.userTranscriptBuffer.trim();
          console.log(`🎤 User turn complete (VAD): "${userText}"`);
          this.sendToClient(session, {
            type: 'user.transcription',
            transcript: userText,
          });
          // 재연결 컨텍스트용 최근 메시지 추적
          session.recentMessages.push({ role: 'user', text: userText.slice(0, 300) });
          if (session.recentMessages.length > 10) session.recentMessages.shift();
          session.userTranscriptBuffer = ''; // 버퍼 초기화
        }

        // Analyze emotion for the completed AI transcript
        if (session.currentTranscript) {
          // thinking 텍스트 필터링 - 사용자 언어에 맞는 응답만 추출
          const filteredTranscript = filterThinkingText(session.currentTranscript, session.userLanguage);
          console.log(`📝 Filtered transcript (${session.userLanguage}): "${filteredTranscript.substring(0, 100)}..."`);
          
          if (filteredTranscript) {
            // 재연결 컨텍스트용 최근 AI 메시지 추적 (감정 분석 전에 동기적으로 저장)
            session.recentMessages.push({ role: 'ai', text: filteredTranscript.slice(0, 300) });
            if (session.recentMessages.length > 10) session.recentMessages.shift();
            
            // setImmediate로 감정 분석을 비동기화하여 이벤트 루프 블로킹 방지
            // 대화 품질에 영향 없이 동시 접속 처리량 향상
            setImmediate(() => {
              this.analyzeEmotion(filteredTranscript, session.personaName, session.userLanguage)
                .then(({ emotion, emotionReason }) => {
                  console.log(`😊 Emotion analyzed: ${emotion} (${emotionReason})`);
                  this.sendToClient(session, {
                    type: 'ai.transcription.done',
                    text: filteredTranscript,
                    emotion,
                    emotionReason,
                  });
                })
                .catch(error => {
                  console.error('❌ Failed to analyze emotion:', error);
                  this.sendToClient(session, {
                    type: 'ai.transcription.done',
                    text: filteredTranscript,
                    emotion: '중립',
                    emotionReason: '감정 분석 실패',
                  });
                });
            });
          }
          session.currentTranscript = ''; // Reset for next turn
        }
      }

      // Handle model turn (AI response) - 오디오와 텍스트 모두 처리
      if (serverContent.modelTurn) {
        // 첫 AI 응답 수신 플래그 설정
        if (!session.hasReceivedFirstAIResponse) {
          session.hasReceivedFirstAIResponse = true;
          console.log(`⏱️ [TIMING] 첫 AI 응답 수신: ${new Date().toISOString()}`);
          console.log('🎉 첫 AI 응답 수신!');
        }
        
        // Note: barge-in flag is cleared in turnComplete when turnSeq > cancelledTurnSeq
        
        const parts = serverContent.modelTurn.parts || [];
        console.log(`🎭 modelTurn parts count: ${parts.length}`);
        
        // 먼저 텍스트 파트에서 thinking 텍스트인지 확인
        let hasThinkingText = false;
        for (const part of parts) {
          if (part.text && isThinkingText(part.text)) {
            hasThinkingText = true;
            console.log(`⚠️ Thinking text detected in modelTurn - will suppress audio for this chunk`);
            break;
          }
        }
        
        for (const part of parts) {
          // Handle text transcription
          if (part.text) {
            console.log(`🤖 AI transcript (raw): ${part.text.substring(0, 100)}...`);
            session.currentTranscript += part.text;
            // thinking 텍스트 필터링 - 사용자 언어에 맞는 텍스트만 클라이언트에 전송
            const filteredText = filterThinkingText(part.text, session.userLanguage);
            if (filteredText) {
              this.sendToClient(session, {
                type: 'ai.transcription.delta',
                text: filteredText,
              });
            }
          }
          
          // Handle inline audio data (inlineData 형식)
          if (part.inlineData) {
            // Skip audio if interrupted (barge-in active)
            if (session.isInterrupted) {
              console.log(`🔇 Suppressing inline audio (barge-in active)`);
              continue;
            }
            // Skip audio if thinking text was detected in this modelTurn
            if (hasThinkingText) {
              console.log(`🔇 Suppressing inline audio (thinking text detected)`);
              continue;
            }
            const audioData = part.inlineData.data;
            const mimeType = part.inlineData.mimeType || 'audio/pcm';
            console.log(`🔊 Audio data received (inlineData), mimeType: ${mimeType}, length: ${audioData?.length || 0}`);
            if (audioData) {
              this.sendToClient(session, {
                type: 'audio.delta',
                delta: audioData,
                turnSeq: session.turnSeq, // Include turn sequence for client-side filtering
              });
            }
          }
        }
      }

      // Handle output transcription (AI speech) - 토큰 추적은 여기서만 수행
      // modelTurn.parts.text와 outputTranscription.text가 동일 내용이므로 여기서만 추적
      if (serverContent.outputTranscription) {
        const transcript = serverContent.outputTranscription.text || '';
        console.log(`🤖 AI transcript delta (raw): ${transcript}`);
        
        // 새 AI 응답이 시작되면 barge-in 플래그를 즉시 클리어 (오디오 손실 방지)
        // turnComplete를 기다리지 않고 새 응답의 오디오를 바로 재생할 수 있게 함
        if (session.isInterrupted && transcript.length > 0) {
          console.log(`🔊 New AI response started - clearing barge-in flag immediately`);
          session.isInterrupted = false;
          
          // Notify client that it's safe to play audio again
          this.sendToClient(session, {
            type: 'response.ready',
            turnSeq: session.turnSeq,
          });
        }
        
        // currentTranscript는 modelTurn에서 이미 누적되므로 여기서는 길이만 추적
        if (!serverContent.modelTurn) {
          session.currentTranscript += transcript;
        }
        session.totalAiTranscriptLength += transcript.length; // 누적 길이 추적 (여기서만)
        
        // thinking 텍스트 필터링 - 사용자 언어에 맞는 텍스트만 클라이언트에 전송
        const filteredTranscript = filterThinkingText(transcript, session.userLanguage);
        if (filteredTranscript) {
          this.sendToClient(session, {
            type: 'ai.transcription.delta',
            text: filteredTranscript,
          });
        }
      }
    }
  }

  handleClientMessage(sessionId: string, message: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      return;
    }
    
    // 활동 시간 업데이트
    session.lastActivityTime = Date.now();

    // 🔧 Gemini 연결 전에 도착한 client.ready 메시지 버퍼링
    if (!session.isConnected || !session.geminiSession) {
      if (message.type === 'client.ready') {
        console.log(`⏸️ Gemini not ready yet, buffering client.ready message for session: ${sessionId}`);
        session.pendingClientReady = message;
        return;
      }
      console.warn(`⚠️ Gemini not connected for session: ${sessionId}, dropping message type: ${message.type}`);
      return;
    }

    // Forward client messages to Gemini
    switch (message.type) {
      case 'input_audio_buffer.append':
        // Client sending audio data (base64 PCM16)
        // Gemini expects 16kHz PCM16
        const audioLength = message.audio ? message.audio.length : 0;
        console.log(`🎤 Received audio chunk: ${audioLength} bytes (base64)`);
        session.geminiSession.sendRealtimeInput({
          audio: {
            data: message.audio,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
        break;

      case 'input_audio_buffer.commit':
        // User stopped recording - send END_OF_TURN event to Gemini
        // Note: transcript will be sent automatically when Gemini detects turn completion via VAD
        console.log('📤 User stopped recording, sending END_OF_TURN event');
        session.geminiSession.sendRealtimeInput({
          event: 'END_OF_TURN'
        });
        break;

      case 'response.create':
        // Client explicitly requesting a response - send END_OF_TURN to trigger Gemini
        console.log('🔄 Explicit response request, sending END_OF_TURN event');
        session.geminiSession.sendRealtimeInput({
          event: 'END_OF_TURN'
        });
        break;

      case 'conversation.item.create':
        // Client sending a text message
        if (message.item && message.item.content) {
          const text = message.item.content[0]?.text || '';
          session.geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          });
        }
        break;

      case 'client.ready':
        // 클라이언트의 AudioContext가 준비됨 - 이제 첫 인사를 트리거
        const clientReadyTime = Date.now();
        console.log(`⏱️ [TIMING] client.ready 수신: ${new Date(clientReadyTime).toISOString()}`);
        
        const isResuming = message.isResuming === true;
        const previousMessages = message.previousMessages as Array<{role: 'user' | 'ai', content: string}> | undefined;
        
        if (isResuming && previousMessages && previousMessages.length > 0) {
          // 🔄 재연결 모드: 이전 대화 기록을 컨텍스트로 전달
          console.log(`🔄 Resuming conversation with ${previousMessages.length} previous messages`);
          
          // 이전 대화에 AI 응답이 있었는지 확인
          const hadPreviousAIResponse = previousMessages.some(m => m.role === 'ai');
          
          // 이전 대화 요약을 Gemini에 전달
          const conversationSummary = previousMessages.map((m, i) => 
            `${m.role === 'user' ? '사용자' : '당신'}: ${m.content}`
          ).join('\n');
          
          const resumeContext = `[이전 대화 내용 - 이 대화를 이어서 진행합니다]\n${conversationSummary}\n\n[대화 재개 - 이전 대화 맥락을 기억하세요. 재연결되었음을 언급하거나 인사하지 마세요. "다시 연결되었네요", "어디까지 얘기했죠?" 같은 표현은 절대 하지 마세요. 사용자가 먼저 말할 때까지 침묵을 유지하고, 사용자가 발화하면 이전 대화 맥락을 자연스럽게 이어서 반응하세요.]`;
          
          console.log(`📤 Sending resume context to Gemini (had previous AI response: ${hadPreviousAIResponse})`);
          
          // 첫 인사 트리거 플래그 설정 (재시도 방지)
          session.hasTriggeredFirstGreeting = true;
          // 이전에 AI 응답이 있었던 경우에만 true로 설정
          if (hadPreviousAIResponse) {
            session.hasReceivedFirstAIResponse = true;
          }
          
          session.geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: resumeContext }] }],
            turnComplete: true,
          });
          
          session.geminiSession.sendRealtimeInput({
            event: 'END_OF_TURN'
          });
        } else {
          // 새 대화 시작: 첫 인사 트리거
          console.log('🎬 Client ready signal received - triggering first greeting...');
          
          // 이미 첫 인사 트리거 또는 첫 응답을 받았으면 중복 트리거 방지
          if (session.hasTriggeredFirstGreeting || session.hasReceivedFirstAIResponse) {
            console.log('⏭️ First greeting already triggered or received, skipping duplicate trigger');
            break;
          }
          
          // 중복 방지 플래그 설정
          session.hasTriggeredFirstGreeting = true;
          
          // 🔧 Gemini Live API는 명시적인 사용자 발화처럼 보이는 입력이 필요
          // 괄호 형식 대신 실제 인사처럼 보이는 텍스트로 AI 응답 유도
          const greetingText = `안녕하세요`;
          console.log(`📤 Sending greeting trigger: "${greetingText}"`);
          
          session.geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: greetingText }] }],
            turnComplete: true,
          });
          
          // 🔧 sendClientContent 후 END_OF_TURN 이벤트를 보내서 Gemini가 응답하도록 강제
          console.log('📤 Sending END_OF_TURN to trigger AI greeting response...');
          session.geminiSession.sendRealtimeInput({
            event: 'END_OF_TURN'
          });
        }
        break;

      case 'response.cancel':
        // 🔧 Fix 2: 이중 barge-in 방지 - 이미 인터럽트 처리 중이면 무시
        if (session.isInterrupted) {
          console.log(`⚡ Barge-in already active (cancelledTurn=${session.cancelledTurnSeq}), ignoring duplicate cancel`);
          break;
        }

        // User interrupted AI (barge-in) - cancel current response
        console.log(`⚡ Barge-in: Canceling turn ${session.turnSeq}`);
        
        // Set interrupted flag and record which turn we're cancelling
        session.isInterrupted = true;
        session.cancelledTurnSeq = session.turnSeq;
        
        // 🔧 barge-in 시 현재까지의 AI 응답을 부분 전사로 저장 (대화 기록 누락 방지)
        if (session.currentTranscript.trim()) {
          const partialTranscript = filterThinkingText(session.currentTranscript, session.userLanguage);
          if (partialTranscript) {
            console.log(`📝 Saving partial AI transcript before barge-in: "${partialTranscript.substring(0, 50)}..."`);
            this.sendToClient(session, {
              type: 'ai.transcription.done',
              text: partialTranscript + '...',  // 중단되었음을 표시
              emotion: '중립',
              emotionReason: '사용자가 대화를 중단했습니다',
              interrupted: true,  // 중단 플래그
            });
          }
        }
        
        // 🔧 Fix 1: userTranscriptBuffer는 초기화하지 않음 (유저 발화 유실 방지)
        // barge-in 시 버퍼를 비우면 유저가 말한 내용이 turnComplete 전에 소멸됨
        // 버퍼는 turnComplete 이벤트에서 user.transcription으로 전송 후 자연스럽게 초기화됨
        session.currentTranscript = ''; // AI transcript만 초기화
        
        // Send interruption acknowledgment to client
        this.sendToClient(session, {
          type: 'response.interrupted',
        });
        
        // Note: Gemini Live API handles interruption naturally when user starts speaking
        // The audio input will take priority and Gemini will stop generating
        break;

      case 'ping':
        // Heartbeat: 클라이언트 연결 유지 확인 (Replit 프록시 유휴 타임아웃 방지)
        this.sendToClient(session, { type: 'pong' });
        break;

      default:
        console.log(`Unknown client message type: ${message.type}`);
    }
  }

  // 언어별 감정명 정의
  private getEmotionConfig(lang: 'ko' | 'en' | 'ja' | 'zh') {
    const emotionsByLang = {
      ko: {
        neutral: '중립', happy: '기쁨', sad: '슬픔', angry: '분노', surprised: '놀람',
        curious: '호기심', anxious: '불안', tired: '피로', disappointed: '실망', confused: '당혹'
      },
      en: {
        neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'angry', surprised: 'surprised',
        curious: 'curious', anxious: 'anxious', tired: 'tired', disappointed: 'disappointed', confused: 'confused'
      },
      zh: {
        neutral: '中立', happy: '喜悦', sad: '悲伤', angry: '愤怒', surprised: '惊讶',
        curious: '好奇', anxious: '焦虑', tired: '疲劳', disappointed: '失望', confused: '困惑'
      },
      ja: {
        neutral: '中立', happy: '喜び', sad: '悲しみ', angry: '怒り', surprised: '驚き',
        curious: '好奇心', anxious: '不安', tired: '疲労', disappointed: '失望', confused: '困惑'
      }
    };

    // 이미지 파일명 매핑 (모든 언어의 감정명 → 영어 파일명)
    const emotionToImage: Record<string, string> = {
      // Korean
      '중립': 'neutral', '기쁨': 'happy', '슬픔': 'sad', '분노': 'angry', '놀람': 'surprised',
      '호기심': 'curious', '불안': 'anxious', '피로': 'tired', '실망': 'disappointed', '당혹': 'confused',
      // English
      'neutral': 'neutral', 'happy': 'happy', 'sad': 'sad', 'angry': 'angry', 'surprised': 'surprised',
      'curious': 'curious', 'anxious': 'anxious', 'tired': 'tired', 'disappointed': 'disappointed', 'confused': 'confused',
      // Chinese
      '中立': 'neutral', '喜悦': 'happy', '悲伤': 'sad', '愤怒': 'angry', '惊讶': 'surprised',
      '好奇': 'curious', '焦虑': 'anxious', '疲劳': 'tired', '失望': 'disappointed', '困惑': 'confused',
      // Japanese (中立, 疲労, 失望, 困惑 shared with Chinese)
      '喜び': 'happy', '悲しみ': 'sad', '怒り': 'angry', '驚き': 'surprised',
      '好奇心': 'curious', '不安': 'anxious'
      // Note: Japanese 中立, 疲労, 失望, 困惑 are same as Chinese and already mapped above
    };

    const emotions = emotionsByLang[lang];
    const validEmotions = Object.values(emotions);

    // API 응답(영어)을 해당 언어 감정명으로 매핑
    const apiToLangMap: Record<string, string> = {
      'neutral': emotions.neutral, 'calm': emotions.neutral, 'normal': emotions.neutral,
      'happy': emotions.happy, 'joy': emotions.happy, 'excited': emotions.happy, 'pleased': emotions.happy,
      'sad': emotions.sad, 'sadness': emotions.sad, 'unhappy': emotions.sad,
      'angry': emotions.angry, 'anger': emotions.angry, 'frustrated': emotions.angry, 'irritated': emotions.angry, 'upset': emotions.angry,
      'surprised': emotions.surprised, 'surprise': emotions.surprised, 'shocked': emotions.surprised,
      'curious': emotions.curious, 'curiosity': emotions.curious, 'interested': emotions.curious,
      'anxious': emotions.anxious, 'anxiety': emotions.anxious, 'worried': emotions.anxious, 'nervous': emotions.anxious, 'concerned': emotions.anxious,
      'tired': emotions.tired, 'exhausted': emotions.tired, 'fatigue': emotions.tired,
      'disappointed': emotions.disappointed, 'disappointment': emotions.disappointed,
      'confused': emotions.confused, 'embarrassed': emotions.confused, 'awkward': emotions.confused, 'perplexed': emotions.confused
    };

    // 해당 언어 감정명도 직접 매핑 (이미 올바른 형태로 반환된 경우)
    for (const key of validEmotions) {
      apiToLangMap[key.toLowerCase()] = key;
    }

    return { emotions, validEmotions, apiToLangMap, emotionToImage };
  }

  // 언어별 감정 분석 이유 텍스트
  private getEmotionReasonText(lang: 'ko' | 'en' | 'ja' | 'zh', type: 'complete' | 'disabled' | 'keyword' | 'pattern'): string {
    const texts = {
      ko: { complete: '감정 분석 완료', disabled: '감정 분석 서비스가 비활성화됨', keyword: '감정 키워드 감지', pattern: '텍스트 패턴 감지' },
      en: { complete: 'Emotion analysis complete', disabled: 'Emotion analysis service disabled', keyword: 'Emotion keyword detected', pattern: 'Text pattern detected' },
      zh: { complete: '情感分析完成', disabled: '情感分析服务已禁用', keyword: '检测到情感关键词', pattern: '检测到文本模式' },
      ja: { complete: '感情分析完了', disabled: '感情分析サービスが無効', keyword: '感情キーワード検出', pattern: 'テキストパターン検出' }
    };
    return texts[lang][type];
  }

  // 언어별 감정 분석 프롬프트 설정
  private getEmotionPromptConfig(lang: 'ko' | 'en' | 'ja' | 'zh', emotions: Record<string, string>) {
    const emotionList = Object.values(emotions).join(', ');
    
    const configs = {
      ko: {
        instruction: 'AI 캐릭터의 응답에서 감정을 분석하세요.',
        chooseFrom: `다음 감정 중 하나를 선택하세요: ${emotionList}`,
        replyFormat: '다음 형식으로만 답변하세요 (다른 텍스트 없이):\n{"emotion": "선택한_감정", "reason": "간단한 이유"}'
      },
      en: {
        instruction: 'Analyze the emotion in this AI character\'s response.',
        chooseFrom: `Choose ONE emotion from: ${emotionList}`,
        replyFormat: 'Reply with ONLY this JSON format (no other text):\n{"emotion": "chosen_emotion", "reason": "brief reason"}'
      },
      zh: {
        instruction: '分析AI角色回复中的情感。',
        chooseFrom: `从以下情感中选择一个: ${emotionList}`,
        replyFormat: '仅以此JSON格式回复（无其他文本）:\n{"emotion": "选择的情感", "reason": "简短理由"}'
      },
      ja: {
        instruction: 'AIキャラクターの応答の感情を分析してください。',
        chooseFrom: `次の感情から1つ選んでください: ${emotionList}`,
        replyFormat: '以下のJSON形式のみで回答してください（他のテキストなし）:\n{"emotion": "選択した感情", "reason": "簡単な理由"}'
      }
    };
    return configs[lang];
  }

  private async analyzeEmotion(aiResponse: string, personaName: string, userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'): Promise<{ emotion: string; emotionReason: string }> {
    const { emotions, validEmotions, apiToLangMap } = this.getEmotionConfig(userLanguage);
    
    if (!this.genAI) {
      return { emotion: emotions.neutral, emotionReason: this.getEmotionReasonText(userLanguage, 'disabled') };
    }

    // 언어별 프롬프트 및 감정 목록 생성
    const promptConfig = this.getEmotionPromptConfig(userLanguage, emotions);

    try {
      const prompt = `${promptConfig.instruction}

Character: ${personaName}
Response: "${aiResponse.substring(0, 400)}"

${promptConfig.chooseFrom}

${promptConfig.replyFormat}`;

      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          maxOutputTokens: 150,
          temperature: 0.1
        }
      });

      let responseText = (result.text || '').trim();
      console.log('📊 Emotion response:', responseText.substring(0, 150));
      
      // 마크다운 코드 블록 제거
      responseText = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      
      // API 응답이 비어있으면 바로 텍스트 분석으로 폴백
      if (!responseText || responseText.length < 5) {
        console.log('📊 Empty API response, falling back to text analysis');
        const directAnalysis = this.analyzeEmotionFromText(aiResponse, userLanguage);
        if (directAnalysis) {
          console.log('📊 Direct text analysis (empty API):', directAnalysis.emotion);
          return directAnalysis;
        }
        return { emotion: emotions.neutral, emotionReason: this.getEmotionReasonText(userLanguage, 'complete') };
      }
      
      // JSON 파싱 시도
      const parseAndMapEmotion = (jsonStr: string): { emotion: string; emotionReason: string } | null => {
        try {
          const data = JSON.parse(jsonStr);
          const rawEmotion = (data.emotion || '').toLowerCase().trim();
          const mappedEmotion = apiToLangMap[rawEmotion];
          if (mappedEmotion && validEmotions.includes(mappedEmotion)) {
            return {
              emotion: mappedEmotion,
              emotionReason: data.reason || data.emotionReason || this.getEmotionReasonText(userLanguage, 'complete')
            };
          }
        } catch (e) {}
        return null;
      };
      
      // 1차: 전체 응답 파싱
      let result1 = parseAndMapEmotion(responseText);
      if (result1) return result1;
      
      // 2차: JSON 객체 추출
      const jsonMatch = responseText.match(/\{[^{}]*\}/);
      if (jsonMatch) {
        let result2 = parseAndMapEmotion(jsonMatch[0]);
        if (result2) return result2;
      }
      
      // 3차: API 응답에서 감정 키워드 탐지
      const lowerResponse = responseText.toLowerCase();
      for (const [keyword, langEmotion] of Object.entries(apiToLangMap)) {
        if (keyword !== 'neutral' && keyword !== emotions.neutral.toLowerCase() && lowerResponse.includes(keyword)) {
          return { emotion: langEmotion, emotionReason: this.getEmotionReasonText(userLanguage, 'keyword') };
        }
      }

      // 4차: 원본 AI 응답에서 감정 패턴 직접 분석 (API 실패 시 폴백)
      const directAnalysis = this.analyzeEmotionFromText(aiResponse, userLanguage);
      if (directAnalysis) {
        console.log('📊 Direct text analysis:', directAnalysis.emotion);
        return directAnalysis;
      }

      return { emotion: emotions.neutral, emotionReason: this.getEmotionReasonText(userLanguage, 'complete') };
    } catch (error: any) {
      console.error('❌ Emotion analysis error:', error?.message || error);
      // API 오류 시에도 원본 텍스트에서 감정 분석 시도
      const fallbackAnalysis = this.analyzeEmotionFromText(aiResponse, userLanguage);
      if (fallbackAnalysis) return fallbackAnalysis;
      return { emotion: emotions.neutral, emotionReason: this.getEmotionReasonText(userLanguage, 'complete') };
    }
  }

  // AI 응답 텍스트에서 직접 감정 패턴을 분석하는 헬퍼 함수
  private analyzeEmotionFromText(text: string, userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'): { emotion: string; emotionReason: string } | null {
    if (!text || text.length < 5) return null;
    
    const { emotions } = this.getEmotionConfig(userLanguage);
    const lowerText = text.toLowerCase();
    
    // 감정별 키워드 패턴 (내부 감정 키 → 언어별 감정명 매핑)
    // emotionKey는 내부 키, patterns/keywords는 다국어 패턴
    const emotionPatterns: Array<{ emotionKey: keyof typeof emotions; patterns: RegExp[]; keywords: string[] }> = [
      { 
        emotionKey: 'angry', 
        patterns: [
          // Korean patterns
          /왜.*안|어떻게.*이런|도대체|짜증|화나|열받|불쾌/i,
          /지나치십니다|무책임|정신.*차|그러지.*마|말도.*안|황당/i,
          /어이.*없|기가.*막|뭘.*하자는|용납.*안|참을.*수/i,
          /비합리적|무작정|밀어붙이|그만하십시오|그만.*해/i,
          /책임.*져|무리하|납득.*안|이해.*안.*되|받아들일.*수.*없/i,
          /감정적.*대응|논리적.*생각|얼마나.*큰.*손해/i,
          // English patterns
          /unacceptable|ridiculous|absurd|outrageous|irresponsible/i,
          /can'?t\s+accept|won'?t\s+tolerate|this\s+is\s+wrong/i,
          /how\s+dare|stop\s+this|enough\s+is\s+enough/i,
          /makes?\s+no\s+sense|completely\s+wrong|totally\s+unacceptable/i,
          // Chinese patterns
          /不可接受|荒谬|愤怒|生气|发火|不能容忍/i,
          // Japanese patterns
          /許せない|怒り|腹が立つ|ありえない|理不尽/i
        ],
        keywords: ['frustrated', 'angry', 'annoyed', 'irritated', 'upset', 'furious', 'outraged', 'unacceptable', 'ridiculous', 'absurd', '화가', '짜증', '답답', '큰일', '무책임', '황당', '어이없', '비합리', '무리', '납득', '愤怒', '生气', '怒り', '腹立']
      },
      { 
        emotionKey: 'anxious', 
        patterns: [
          // Korean patterns
          /걱정|우려|불안|초조|조급|어쩌|큰일/i,
          /심각|위험|문제.*생|잘못.*되|어떡/i,
          /심각성|파악.*안.*되|회의.*전|시간.*없/i,
          // English patterns
          /worried\s+about|concerns?\s+about|i'?m\s+concerned/i,
          /serious\s+issue|serious\s+problem|major\s+problem/i,
          /we\s+need\s+to\s+address|running\s+out\s+of\s+time/i,
          /deadline|urgent|critical\s+issue|risk|at\s+stake/i,
          /can'?t\s+afford|pressure|tight\s+timeline/i,
          // Chinese patterns
          /担心|焦虑|紧张|忧虑|严重|危险/i,
          // Japanese patterns
          /心配|不安|焦り|緊張|深刻|危険/i
        ],
        keywords: ['worried', 'anxious', 'nervous', 'concerned', 'uneasy', 'concerns', 'serious', 'urgent', 'critical', 'deadline', 'pressure', 'risk', 'timeline', 'constraints', '걱정', '우려', '불안', '급하', '심각', '위험', '심각성', '担心', '焦虑', '心配', '不安']
      },
      { 
        emotionKey: 'disappointed', 
        patterns: [
          // Korean patterns
          /실망|아쉽|유감|안타깝/i,
          /기대.*못|생각.*달|믿었는데/i,
          // English patterns
          /i'?m\s+disappointed|this\s+is\s+disappointing|let\s+me\s+down/i,
          /expected\s+better|not\s+what\s+i\s+expected|fell\s+short/i,
          /unfortunately|regrettably|sadly/i,
          // Chinese patterns
          /失望|遗憾|可惜/i,
          // Japanese patterns
          /失望|残念|がっかり/i
        ],
        keywords: ['disappointed', 'let down', 'disappointing', 'expected better', 'unfortunately', 'regret', '실망', '아쉽', '유감', '안타깝', '失望', '遗憾', '残念']
      },
      { 
        emotionKey: 'surprised', 
        patterns: [
          // Korean patterns
          /정말요\?|뭐라고|어떻게.*그런|갑자기|충격/i,
          /믿기.*어렵|예상.*못|처음.*듣/i,
          // English patterns
          /are\s+you\s+serious|i\s+can'?t\s+believe|that'?s\s+shocking/i,
          /wait,?\s+what|how\s+is\s+that\s+possible|unexpected/i,
          /never\s+expected|out\s+of\s+nowhere|suddenly/i,
          // Chinese patterns
          /惊讶|震惊|意外|突然/i,
          // Japanese patterns
          /驚き|びっくり|意外|突然/i
        ],
        keywords: ['surprised', 'shocked', 'what?', 'unexpected', 'unbelievable', 'suddenly', 'amazing', '놀라', '충격', '갑자기', '믿기 어렵', '惊讶', '震惊', '驚き', 'びっくり']
      },
      { 
        emotionKey: 'curious', 
        patterns: [
          // Korean patterns
          /궁금|왜.*그런|어떻게.*되|알고\s*싶/i,
          /무슨.*뜻|설명.*해|자세히/i,
          // English patterns
          /i'?m\s+curious|can\s+you\s+explain|tell\s+me\s+more/i,
          /how\s+does\s+that\s+work|what\s+do\s+you\s+mean|interesting/i,
          /i'?d\s+like\s+to\s+know|wondering\s+about/i,
          // Chinese patterns
          /好奇|想知道|有趣/i,
          // Japanese patterns
          /興味|気になる|知りたい/i
        ],
        keywords: ['curious', 'interested', 'wondering', 'intriguing', 'fascinating', 'explain', '궁금', '흥미', '자세히', '好奇', '興味']
      },
      { 
        emotionKey: 'happy', 
        patterns: [
          // Korean patterns
          /좋아|잘됐|다행|기쁘|감사|고마워/i,
          /훌륭|대단|멋지|성공|축하/i,
          // English patterns
          /that'?s\s+great|wonderful|excellent|fantastic|amazing/i,
          /i'?m\s+happy|so\s+glad|thank\s+you|appreciate/i,
          /well\s+done|good\s+job|congratulations|success/i,
          // Chinese patterns
          /高兴|喜悦|开心|太好了|感谢/i,
          // Japanese patterns
          /嬉しい|喜び|素晴らしい|ありがとう/i
        ],
        keywords: ['happy', 'glad', 'pleased', 'great', 'thank', 'wonderful', 'excellent', 'fantastic', 'appreciate', '좋', '다행', '감사', '훌륭', '대단', '高兴', '喜悦', '嬉しい', '喜び']
      },
      { 
        emotionKey: 'confused', 
        patterns: [
          // Korean patterns
          /뭐지|이상하|어색|곤란|난처/i,
          /당황|어떻게.*해야|뭐라고.*해야/i,
          // English patterns
          /i'?m\s+confused|don'?t\s+understand|makes\s+no\s+sense/i,
          /not\s+sure\s+what\s+to|awkward\s+situation|uncomfortable/i,
          /put\s+me\s+in\s+a\s+difficult|hard\s+to\s+say/i,
          // Chinese patterns
          /困惑|迷惑|不明白|尴尬/i,
          // Japanese patterns
          /困惑|戸惑い|分からない|困った/i
        ],
        keywords: ['confused', 'awkward', 'embarrassed', 'uncomfortable', 'puzzled', 'perplexed', '당황', '곤란', '난처', '어색', '困惑', '尴尬', '戸惑い']
      },
      { 
        emotionKey: 'sad', 
        patterns: [
          // Korean patterns
          /슬프|우울|힘들|서글|눈물/i,
          // English patterns
          /i'?m\s+sad|feeling\s+down|heartbroken|unfortunate/i,
          /it'?s\s+hard|difficult\s+time|struggling/i,
          // Chinese patterns
          /悲伤|难过|伤心|沮丧/i,
          // Japanese patterns
          /悲しい|悲しみ|辛い|落ち込/i
        ],
        keywords: ['sad', 'unhappy', 'heartbroken', 'depressed', 'down', '슬프', '우울', '힘들', '悲伤', '难过', '悲しい', '辛い']
      },
      { 
        emotionKey: 'tired', 
        patterns: [
          // Korean patterns
          /지치|피곤|힘들|녹초|기진맥진/i,
          // English patterns
          /i'?m\s+tired|exhausted|worn\s+out|burned\s+out/i,
          /need\s+a\s+break|overwhelmed|too\s+much/i,
          // Chinese patterns
          /疲劳|累了|精疲力尽/i,
          // Japanese patterns
          /疲れ|疲労|くたくた/i
        ],
        keywords: ['tired', 'exhausted', 'worn out', 'burned out', 'overwhelmed', '피곤', '지치', '疲劳', '累', '疲れ']
      }
    ];

    for (const { emotionKey, patterns, keywords } of emotionPatterns) {
      // 정규식 패턴 체크
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return { emotion: emotions[emotionKey], emotionReason: this.getEmotionReasonText(userLanguage, 'pattern') };
        }
      }
      // 키워드 체크
      for (const keyword of keywords) {
        if (lowerText.includes(keyword.toLowerCase())) {
          return { emotion: emotions[emotionKey], emotionReason: this.getEmotionReasonText(userLanguage, 'keyword') };
        }
      }
    }

    return null;
  }

  private sendToClient(session: RealtimeSession, message: any): void {
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.send(JSON.stringify(message));
    }
  }

  // GoAway 수신 시 선제 재연결: 연결이 끊기기 전에 새 Gemini 세션을 미리 준비
  private proactiveReconnect(session: RealtimeSession): void {
    if (session.isReconnecting) {
      console.log('⚠️ proactiveReconnect: 이미 재연결 중');
      return;
    }
    
    session.isReconnecting = true;
    const sessionId = session.id;
    
    console.log(`🔄 proactiveReconnect: 새 Gemini 세션 준비 시작 (sessionId=${sessionId})`);
    
    // 기존 Gemini 세션 닫기 (정상 종료)
    if (session.geminiSession) {
      try {
        session.geminiSession.close();
      } catch (e) {
        // ignore
      }
      session.geminiSession = null;
    }
    
    // 새 Gemini 세션 연결 (resumption token 자동 활용)
    this.connectToGemini(session, session.systemInstructions, session.voiceGender)
      .then(() => {
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession) return;
        
        currentSession.isReconnecting = false;
        currentSession.reconnectAttempts = 0;
        console.log(`✅ proactiveReconnect 성공: 새 Gemini 세션 활성화`);
        
        this.sendToClient(currentSession, {
          type: 'session.reconnected',
        });
      })
      .catch((error) => {
        const currentSession = this.sessions.get(sessionId);
        if (!currentSession) return;
        
        currentSession.isReconnecting = false;
        console.error(`❌ proactiveReconnect 실패:`, error);
        
        // 선제 재연결 실패 시 경고만 표시 (기존 연결이 아직 살아있을 수 있음)
        this.sendToClient(currentSession, {
          type: 'session.warning',
          message: '연결 갱신에 실패했습니다. 잠시 후 자동으로 재시도합니다.',
          timeLeft: 0,
        });
      });
  }

  // 세션 사용량 추적 헬퍼 메서드 (중복 방지를 위해 한 번만 호출)
  private trackSessionUsage(session: RealtimeSession): void {
    // 이미 추적된 세션인지 확인 (중복 방지)
    if ((session as any)._usageTracked) {
      return;
    }
    (session as any)._usageTracked = true;
    
    const durationMs = Date.now() - session.startTime;
    
    // 텍스트 길이를 기반으로 토큰 추정 (한국어: 약 2-3자 = 1토큰)
    const estimatedUserTokens = Math.ceil(session.totalUserTranscriptLength / 2);
    const estimatedAiTokens = Math.ceil(session.totalAiTranscriptLength / 2);
    
    // Gemini Live API는 음성 처리도 함께 하므로 텍스트 토큰의 약 1.5배 추정
    // (텍스트만 고려하면 과소평가, 오디오 전부 계산하면 과대평가)
    const audioTokenMultiplier = 1.5;
    const totalPromptTokens = Math.ceil(estimatedUserTokens * audioTokenMultiplier);
    const totalCompletionTokens = Math.ceil(estimatedAiTokens * audioTokenMultiplier);
    
    if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
      trackUsage({
        feature: 'realtime',
        model: session.realtimeModel,
        provider: 'gemini',
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        userId: session.userId,
        conversationId: session.conversationId,
        durationMs,
        metadata: {
          scenarioId: session.scenarioId,
          personaId: session.personaId,
          totalUserTranscriptLength: session.totalUserTranscriptLength,
          totalAiTranscriptLength: session.totalAiTranscriptLength,
          estimationMethod: 'transcript_length_based',
        }
      });
      
      console.log(`📊 Realtime usage tracked: ${totalPromptTokens} prompt + ${totalCompletionTokens} completion tokens, duration: ${Math.round(durationMs/1000)}s`);
    }
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(`🔚 Closing realtime voice session: ${sessionId}`);
      
      // 세션 사용량 추적
      this.trackSessionUsage(session);
      
      // 🔧 Fix 1: WS 끊김 시 미전송 userTranscriptBuffer 처리
      // 클라이언트 WS가 열려있으면 user.transcription 이벤트로 전송 (재연결 후 저장 가능)
      // 클라이언트 WS가 닫혀있으면 DB에 직접 저장 (탭 닫기/크래시 시 복구)
      const pendingUserText = session.userTranscriptBuffer.trim();
      if (pendingUserText && session.conversationId) {
        const clientWsOpen = session.clientWs && session.clientWs.readyState === WebSocket.OPEN;
        if (clientWsOpen) {
          // 클라이언트가 살아있으면 정상 이벤트로 전송 (accumulatedMessagesRef에 저장됨)
          console.log(`🎤 [closeSession] Flushing pending user buffer to client: "${pendingUserText.substring(0, 60)}"`);
          this.sendToClient(session, {
            type: 'user.transcription',
            transcript: pendingUserText,
          });
          session.recentMessages.push({ role: 'user', text: pendingUserText.slice(0, 300) });
        } else {
          // 클라이언트가 끊겼으면 DB에 직접 저장 (탭 닫기/크래시 복구)
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
    return this.sessions.size;
  }

  // 세션 상태 모니터링 정보 반환
  getSessionStatus(): {
    activeSessions: number;
    maxSessions: number;
    availableSlots: number;
    utilizationPercent: number;
    sessions: Array<{
      id: string;
      personaName: string;
      durationSec: number;
      isConnected: boolean;
    }>;
  } {
    const now = Date.now();
    const activeSessions = this.sessions.size;
    const maxSessions = MAX_CONCURRENT_SESSIONS;
    
    const sessionDetails = Array.from(this.sessions.values()).map(session => ({
      id: session.id.split('-').slice(0, 2).join('-') + '...', // 익명화된 ID
      personaName: session.personaName,
      durationSec: Math.round((now - session.startTime) / 1000),
      isConnected: session.isConnected,
    }));

    return {
      activeSessions,
      maxSessions,
      availableSlots: Math.max(0, maxSessions - activeSessions),
      utilizationPercent: Math.round((activeSessions / maxSessions) * 100),
      sessions: sessionDetails,
    };
  }
}

export const realtimeVoiceService = new RealtimeVoiceService();
