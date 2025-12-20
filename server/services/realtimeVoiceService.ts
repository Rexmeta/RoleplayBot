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
  
  // 패턴 2: 영문으로만 구성된 줄 제거 (한글이 없는 줄)
  const lines = filtered.split('\n');
  const koreanLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // 한글이 포함된 줄만 유지
    return /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(trimmed);
  });
  
  filtered = koreanLines.join('\n').trim();
  
  // 패턴 3: 남은 텍스트에서 앞뒤 공백 정리
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
  firstGreetingRetryCount: number; // 첫 인사 재시도 횟수
  isInterrupted: boolean; // Barge-in flag to suppress audio until new response
  turnSeq: number; // Monotonic turn counter, incremented on each turnComplete
  cancelledTurnSeq: number; // Turn seq when cancel was issued (ignore audio from this turn)
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
      firstGreetingRetryCount: 0,
      isInterrupted: false,
      turnSeq: 0, // First turn is 0
      cancelledTurnSeq: -1, // No cancelled turn initially
    };

    this.sessions.set(sessionId, session);

    // 성별 판단 (시나리오 페르소나의 gender 속성 사용)
    const gender: 'male' | 'female' = scenarioPersona.gender === 'female' ? 'female' : 'male';
    console.log(`👤 페르소나 성별 설정: ${scenarioPersona.name} → ${gender} (시나리오 정의값: ${scenarioPersona.gender})`);
    
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
            
            if (isNormalClose) {
              // 정상 종료
              this.sendToClient(session, {
                type: 'session.terminated',
                reason: 'Gemini connection closed',
              });
            } else {
              // 비정상 종료 - 클라이언트에 에러 알림 (즉시 종료하지 않음)
              console.log(`⚠️ Unexpected Gemini disconnection: code=${event.code}, reason=${event.reason}`);
              this.sendToClient(session, {
                type: 'error',
                error: 'AI 연결이 일시적으로 끊어졌습니다. 대화를 종료하고 다시 시작해주세요.',
                recoverable: false,
              });
            }
            
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
        // 세션이 아직 존재하고, 첫 AI 응답이 없는 경우에만 자동 트리거
        const currentSession = this.sessions.get(session.id);
        if (currentSession && !currentSession.hasReceivedFirstAIResponse && currentSession.geminiSession) {
          console.log('⏰ client.ready timeout (3s) - auto-triggering first greeting...');
          const autoGreeting = `(상대방이 방금 도착했습니다. 당신이 먼저 인사를 건네세요.)`;
          currentSession.geminiSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: autoGreeting }] }],
            turnComplete: true,
          });
          
          // 🔧 sendClientContent 후 END_OF_TURN 이벤트를 보내서 Gemini가 응답하도록 강제
          console.log('📤 Sending END_OF_TURN to trigger AI greeting response (timeout)...');
          currentSession.geminiSession.sendRealtimeInput({
            event: 'END_OF_TURN'
          });
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
    
    // Gemini Live API message structure - 상세 디버깅
    const msgType = message.serverContent ? 'serverContent' : message.data ? 'audio data' : 'other';
    console.log(`📨 Gemini message type: ${msgType}`);
    
    // 디버깅: 'other' 타입이면 전체 구조 출력
    if (msgType === 'other') {
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
          
          // sendClientContent로 인사 트리거 메시지를 다시 보내서 AI가 응답하도록 강제
          if (session.geminiSession) {
            const retryMessages = [
              `(상대방이 기다리고 있습니다. 당신이 먼저 인사를 건네세요.)`,
              `(상대방이 도착했습니다. 지금 바로 인사하고 대화를 시작하세요.)`,
              `(대화를 시작해야 합니다. 한국어로 인사를 건네세요.)`
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
        console.log('🎬 Client ready signal received - triggering first greeting...');
        
        // 이미 첫 응답을 받았으면 중복 트리거 방지
        if (session.hasReceivedFirstAIResponse) {
          console.log('⏭️ First greeting already received, skipping duplicate trigger');
          break;
        }
        
        // 첫 인사를 유도하는 트리거 - 상대방이 도착했음을 알려 AI가 먼저 인사하도록 함
        const firstMessage = `(상대방이 방금 도착했습니다. 당신이 먼저 인사를 건네세요.)`;
        
        session.geminiSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: firstMessage }] }],
          turnComplete: true,
        });
        
        // 🔧 sendClientContent 후 END_OF_TURN 이벤트를 보내서 Gemini가 응답하도록 강제
        console.log('📤 Sending END_OF_TURN to trigger AI greeting response...');
        session.geminiSession.sendRealtimeInput({
          event: 'END_OF_TURN'
        });
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
