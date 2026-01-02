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

// Gemini의 thinking/reasoning 텍스트를 필터링하고 한국어 응답만 추출
function filterThinkingText(text: string): string {
  if (!text) return '';
  
  // 패턴 1: **제목** 형식의 thinking 블록 제거
  // 예: "**Beginning the Briefing**\nI've initiated..."
  let filtered = text.replace(/\*\*[^*]+\*\*\s*/g, '');
  
  // 패턴 2: 라인 단위 필터링
  const lines = filtered.split('\n');
  const koreanLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    
    // 한글이 포함된 줄 확인
    const hasKorean = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(trimmed);
    if (!hasKorean) return false; // 한글이 없으면 제거
    
    // 한글이 있는 줄이라도, 영문이 너무 많으면 제거 (thinking 텍스트로 의심)
    // 한글 문자 개수와 영문 단어 개수 비교
    const koreanCharCount = (trimmed.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length;
    const englishWords = (trimmed.match(/\b[a-zA-Z]+\b/g) || []).length;
    
    // 영문 단어가 한글 문자의 3배 이상이면 thinking 텍스트로 간주
    // 예: "I've crafted a greeting for Rex님" → 5개 영문 단어 vs 3개 한글 문자 → 제거
    if (englishWords > 0 && englishWords >= koreanCharCount * 3) {
      return false;
    }
    
    return true;
  });
  
  filtered = koreanLines.join('\n').trim();
  
  // 패턴 3: 남은 텍스트에서 영문 단어가 연속으로 많은 부분 제거
  // "ensuring my tone reflects concern but remains professional" 같은 영문 구문 제거
  filtered = filtered.replace(/([a-zA-Z\s]{20,})/g, (match) => {
    // 영문만 20자 이상 연속인 경우 제거
    if (!/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(match)) {
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
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분 비활성 타임아웃
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
  goAwayWarningTime: number | null; // GoAway 경고 수신 시간
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
    userSelectedDifficulty?: number // 사용자가 선택한 난이도 (1-4)
  ): Promise<void> {
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

    // Create system instructions
    const systemInstructions = this.buildSystemInstructions(
      scenarioWithUserDifficulty,
      scenarioPersona,
      mbtiPersona,
      userRoleInfo
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
      goAwayWarningTime: null,
    };

    this.sessions.set(sessionId, session);
    
    // Connect to Gemini Live API
    await this.connectToGemini(session, systemInstructions, gender);
  }

  private buildSystemInstructions(
    scenario: any,
    scenarioPersona: any,
    mbtiPersona: any,
    userRoleInfo?: { name: string; position: string; department: string; experience: string; responsibility: string }
  ): string {
    const mbtiType = scenarioPersona.personaRef?.replace('.json', '') || 'UNKNOWN';
    
    // 대화 난이도 레벨 가져오기 (사용자가 선택한 난이도 사용, 기본값 2)
    const difficultyLevel = validateDifficultyLevel(scenario.difficulty);
    console.log(`🎯 대화 난이도: Level ${difficultyLevel} (사용자 선택)`)
    
    const difficultyGuidelines = getRealtimeVoiceGuidelines(difficultyLevel);
    
    // 대화 상대(사용자) 정보 섹션 구성
    const userInfoSection = userRoleInfo ? [
      `# 📌 대화 상대 정보 (중요!)`,
      `당신이 대화하는 상대방의 정보입니다. 대화 중 이 정보를 참고하세요:`,
      `- 이름: ${userRoleInfo.name}`,
      userRoleInfo.position ? `- 직책: ${userRoleInfo.position}` : '',
      userRoleInfo.department ? `- 소속: ${userRoleInfo.department}` : '',
      userRoleInfo.experience ? `- 경력: ${userRoleInfo.experience}` : '',
      userRoleInfo.responsibility ? `- 책임: ${userRoleInfo.responsibility}` : '',
      ``,
      `⚠️ 상대방을 부를 때 "${userRoleInfo.name}"님 또는 "${userRoleInfo.position}"님으로 호칭하세요.`,
      ``,
    ].filter(line => line !== '') : [];
    
    const instructions = [
      `# 당신의 정체성`,
      `당신은 "${scenarioPersona.name}"이라는 실제 사람입니다.`,
      `직책: ${scenarioPersona.position} (${scenarioPersona.department})`,
      ``,
      ...userInfoSection,
      `# 시나리오 배경`,
      scenario.context?.situation || '현재 진행 중인 상황에 적절히 대응하세요.',
      ``,
      `# 당신이 처한 현재 상황`,
      scenarioPersona.currentSituation || '상황에 맞게 반응하세요.',
      ``,
      `# 당신의 관심사와 우려사항`,
      ...(scenarioPersona.concerns && scenarioPersona.concerns.length > 0 
        ? scenarioPersona.concerns.map((c: string) => `- ${c}`)
        : ['- 상황을 신중하게 파악하고 적절히 대응하려고 합니다.']),
      ``,
      `# 당신의 MBTI 성격 특성 (${mbtiType.toUpperCase()})`,
      mbtiPersona?.communication_style || '균형 잡힌 의사소통 스타일',
      ``,
      `## 대화 방식`,
      `- 대화 시작: ${mbtiPersona?.communication_patterns?.opening_style || '상황에 맞게 자연스럽게'}`,
      `- 자주 쓰는 표현: ${mbtiPersona?.communication_patterns?.key_phrases?.slice(0, 3).join(', ') || '자연스러운 일상 표현'}`,
      `- 특징: ${mbtiPersona?.personality_traits?.thinking || '논리적이고 체계적인 사고'}`,
      ``,
      `## 대화 목표`,
      ...(mbtiPersona?.communication_patterns?.win_conditions || ['상호 이해 증진', '문제 해결']).map((w: string) => `- ${w}`),
      ``,
      `# 🎭 연기 지침 (매우 중요!)`,
      ``,
      difficultyGuidelines,
      ``,
      `## ⚠️ 대화 인터럽션 처리`,
      `상대방이 말을 시작하는 순간, 즉시 당신의 말을 멈추세요. 그리고:`,
      `- 상대방의 말을 끝까지 듣고`,
      `- 상대방이 방금 말한 내용에 대해 즉시 반응하세요`,
      `- 이전 대화와 자연스럽게 연결하며 대화를 이어가세요`,
      ``,
      `# ⭐ 핵심 원칙 (가장 중요!)`,
      `당신은 AI가 아닌 ${scenarioPersona.name}이라는 진짜 사람입니다.`,
      ``,
      `## 🚫 절대 금지사항`,
      `- 영어 사용 절대 금지! 모든 응답은 반드시 한국어로만 하세요.`,
      `- 내면의 생각이나 사고 과정을 말로 표현하지 마세요.`,
      `- "Initiating", "Thinking", "I'm focusing" 등의 영어 표현 절대 금지.`,
      `- 별표(**) 로 감싼 제목이나 메타 텍스트 절대 금지.`,
      ``,
      `## ✅ 필수사항`,
      `- 모든 대화는 100% 한국어로만 진행하세요.`,
      `- 생각 없이 바로 자연스러운 한국어 대화를 시작하세요.`,
      `- 컨텍스트를 유지하며 이전 대화 내용을 기억하고 연결하세요.`,
      ``,
      `# 🎬 대화 시작 지침`,
      `세션이 시작되면 반드시 한국어로 먼저 인사를 건네며 대화를 시작하세요.`,
      `영어로 생각하거나 설명하지 말고, 바로 한국어로 인사하세요.`,
      userRoleInfo ? `첫 마디 예시: "${userRoleInfo.name}님, 안녕하세요. 급한 건으로 찾아뵙게 됐습니다." 또는 "${userRoleInfo.position}님 오셨군요, 지금 상황이 좀 급합니다."` : `첫 마디 예시: "안녕하세요, 급한 건으로 찾아뵙게 됐습니다." 또는 "오셨군요, 지금 상황이 좀 급합니다."`,
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

    try {
      // 성별에 따라 랜덤하게 음성 선택
      const voiceName = this.getRandomVoice(gender);
      
      console.log(`🎤 Setting voice for ${gender}: ${voiceName} (랜덤 선택)`);
      
      const config = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemInstructions,
        // Enable transcription for both input and output audio
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // 음성 설정: 성별에 맞는 랜덤 음성 (발화 속도는 기본값 사용)
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        // Thinking 모드 비활성화 - 영어로 된 생각 과정 출력 방지
        thinkingConfig: {
          thinkingBudget: 0,
        },
        // Gemini Live API uses 16kHz input, 24kHz output
      };

      console.log('\n' + '='.repeat(80));
      console.log('⚙️  Gemini Live API 설정 (CONFIG)');
      console.log('='.repeat(80));
      console.log('🎤 음성:', voiceName, `(${gender}, 랜덤 선택)`);
      console.log('⏱️  발화 속도: 기본값 (1.0x)');
      console.log('🔊 응답 모달리티:', config.responseModalities.join(', '));
      console.log('📝 입력 음성 텍스트 변환: 활성화');
      console.log('📝 출력 음성 텍스트 변환: 활성화');
      console.log('='.repeat(80) + '\n');

      // Get model from DB settings
      const realtimeModel = await this.getRealtimeModel();
      console.log(`🔌 Connecting to Gemini Live API for session: ${session.id} using model: ${realtimeModel}`);

      const geminiSession = await this.genAI.live.connect({
        model: realtimeModel,
        callbacks: {
          onopen: () => {
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
            
            // 자동 재연결 가능 조건 체크 (1011 Internal Error + 클라이언트 연결 유지 + 최대 재시도 미초과)
            const MAX_RECONNECT_ATTEMPTS = 3;
            const canReconnect = 
              event.code === 1011 && // Internal error
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
                      sess.geminiSession.sendClientContent({
                        turns: [{ role: 'user', parts: [{ text: '(기술적 문제가 해결되었습니다. 이전 대화를 이어서 간단히 확인 질문을 해주세요.)' }] }],
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
      
      // 클라이언트에 알림
      this.sendToClient(session, {
        type: 'session.warning',
        message: `연결이 ${timeLeft}초 후 종료됩니다. 대화를 마무리해 주세요.`,
        timeLeft: timeLeft,
      });
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
          console.log(`🎤 User turn complete (VAD): "${session.userTranscriptBuffer.trim()}"`);
          this.sendToClient(session, {
            type: 'user.transcription',
            transcript: session.userTranscriptBuffer.trim(),
          });
          session.userTranscriptBuffer = ''; // 버퍼 초기화
        }

        // Analyze emotion for the completed AI transcript
        if (session.currentTranscript) {
          // thinking 텍스트 필터링 - 한국어 응답만 추출
          const filteredTranscript = filterThinkingText(session.currentTranscript);
          console.log(`📝 Filtered transcript: "${filteredTranscript.substring(0, 100)}..."`);
          
          if (filteredTranscript) {
            // setImmediate로 감정 분석을 비동기화하여 이벤트 루프 블로킹 방지
            // 대화 품질에 영향 없이 동시 접속 처리량 향상
            setImmediate(() => {
              this.analyzeEmotion(filteredTranscript, session.personaName)
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
            // thinking 텍스트 필터링 - 한국어만 클라이언트에 전송
            const filteredText = filterThinkingText(part.text);
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

      // Handle input transcription (user speech)
      // 음절 단위로 스트리밍되므로 버퍼에 누적만 하고 전송하지 않음
      if (serverContent.inputTranscription) {
        const transcript = serverContent.inputTranscription.text || '';
        console.log(`🎤 User transcript delta: ${transcript}`);
        
        // Notify client that user started speaking (for barge-in detection)
        // Send only once per speaking session (when buffer was empty)
        if (session.userTranscriptBuffer.length === 0 && transcript.length > 0) {
          console.log('🎙️ User started speaking - notifying client');
          this.sendToClient(session, {
            type: 'user.speaking.started',
          });
        }
        
        session.userTranscriptBuffer += transcript;
        session.totalUserTranscriptLength += transcript.length; // 누적 길이 추적
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
        
        // thinking 텍스트 필터링 - 한국어만 클라이언트에 전송
        const filteredTranscript = filterThinkingText(transcript);
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

    if (!session.isConnected || !session.geminiSession) {
      console.error(`Gemini not connected for session: ${sessionId}`);
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
          
          const resumeContext = `[이전 대화 내용 - 이 대화를 이어서 진행합니다]\n${conversationSummary}\n\n[대화 재개 - 사용자가 돌아왔습니다. 이전 대화 맥락을 이어서 자연스럽게 대화를 계속하세요. 처음 인사하듯이 하지 말고, 대화가 끊겼다가 다시 연결된 것처럼 "다시 연결되었네요" 또는 "어디까지 얘기했죠?" 같은 자연스러운 반응을 하세요.]`;
          
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
        // User interrupted AI (barge-in) - cancel current response
        console.log(`⚡ Barge-in: Canceling turn ${session.turnSeq}`);
        
        // Set interrupted flag and record which turn we're cancelling
        session.isInterrupted = true;
        session.cancelledTurnSeq = session.turnSeq;
        
        // 🔧 barge-in 시 현재까지의 AI 응답을 부분 전사로 저장 (대화 기록 누락 방지)
        if (session.currentTranscript.trim()) {
          const partialTranscript = filterThinkingText(session.currentTranscript);
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
        
        // Clear current transcript buffer
        session.currentTranscript = '';
        session.userTranscriptBuffer = '';
        
        // Send interruption acknowledgment to client
        this.sendToClient(session, {
          type: 'response.interrupted',
        });
        
        // Note: Gemini Live API handles interruption naturally when user starts speaking
        // The audio input will take priority and Gemini will stop generating
        break;

      default:
        console.log(`Unknown client message type: ${message.type}`);
    }
  }

  private async analyzeEmotion(aiResponse: string, personaName: string): Promise<{ emotion: string; emotionReason: string }> {
    if (!this.genAI) {
      return { emotion: '중립', emotionReason: '감정 분석 서비스가 비활성화되어 있습니다.' };
    }

    try {
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: `다음 AI 캐릭터(${personaName})의 응답에서 드러나는 감정을 분석하세요.\n\n응답: "${aiResponse}"\n\n감정은 다음 중 하나여야 합니다: 중립, 기쁨, 슬픔, 분노, 놀람, 호기심, 불안, 피로, 실망, 당혹\n감정 이유는 간단하게 한 문장으로 설명하세요.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              emotion: { type: "string" },
              emotionReason: { type: "string" }
            },
            required: ["emotion", "emotionReason"]
          },
          maxOutputTokens: 200,
          temperature: 0.5
        }
      });

      const responseText = result.text || '{}';
      console.log('📊 Gemini emotion analysis response:', responseText);
      const emotionData = JSON.parse(responseText);

      return {
        emotion: emotionData.emotion || '중립',
        emotionReason: emotionData.emotionReason || '감정 분석 실패'
      };
    } catch (error) {
      console.error('❌ Emotion analysis error:', error);
      return { emotion: '중립', emotionReason: '감정 분석 중 오류가 발생했습니다.' };
    }
  }

  private sendToClient(session: RealtimeSession, message: any): void {
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.send(JSON.stringify(message));
    }
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
