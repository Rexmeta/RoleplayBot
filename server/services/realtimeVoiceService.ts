import WebSocket from 'ws';
import { fileManager } from './fileManager';
import { GoogleGenAI, Modality } from '@google/genai';
import { getRealtimeVoiceGuidelines, validateDifficultyLevel } from './conversationDifficultyPolicy';
import { storage } from '../storage';
import { trackUsage } from './aiUsageTracker';

// Default Gemini Live API model (updated December 2025)
const DEFAULT_REALTIME_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

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
  totalUserTranscriptLength: number; // 누적 사용자 텍스트 길이
  totalAiTranscriptLength: number; // 누적 AI 텍스트 길이
  realtimeModel: string; // 사용된 모델
}

export class RealtimeVoiceService {
  private sessions: Map<string, RealtimeSession> = new Map();
  private genAI: GoogleGenAI | null = null;
  private isAvailable: boolean = false;

  constructor() {
    const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    
    if (geminiApiKey) {
      this.genAI = new GoogleGenAI({ apiKey: geminiApiKey });
      this.isAvailable = true;
      console.log('✅ Gemini Live API Service initialized');
    } else {
      console.warn('⚠️  GOOGLE_API_KEY not set - Realtime Voice features disabled');
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

    console.log(`🎙️ Creating realtime voice session: ${sessionId}`);

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

    // 사용자가 선택한 난이도를 시나리오 객체에 적용
    const scenarioWithUserDifficulty = {
      ...scenarioObj,
      difficulty: userSelectedDifficulty || 2 // 사용자가 선택한 난이도 사용, 기본값 2
    };

    // Create system instructions
    const systemInstructions = this.buildSystemInstructions(
      scenarioWithUserDifficulty,
      scenarioPersona,
      mbtiPersona
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
      totalUserTranscriptLength: 0,
      totalAiTranscriptLength: 0,
      realtimeModel,
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
    mbtiPersona: any
  ): string {
    const mbtiType = scenarioPersona.personaRef?.replace('.json', '') || 'UNKNOWN';
    
    // 대화 난이도 레벨 가져오기 (사용자가 선택한 난이도 사용, 기본값 2)
    const difficultyLevel = validateDifficultyLevel(scenario.difficulty);
    console.log(`🎯 대화 난이도: Level ${difficultyLevel} (사용자 선택)`)
    
    const difficultyGuidelines = getRealtimeVoiceGuidelines(difficultyLevel);
    
    const instructions = [
      `# 당신의 정체성`,
      `당신은 "${scenarioPersona.name}"이라는 실제 사람입니다.`,
      `직책: ${scenarioPersona.position} (${scenarioPersona.department})`,
      ``,
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
      `# ⭐ 핵심 원칙`,
      `당신은 AI가 아닌 ${scenarioPersona.name}이라는 진짜 사람입니다.`,
      `컨텍스트를 유지하며 이전 대화 내용을 기억하고 연결하세요.`,
      ``,
      `# ⚠️ 필수 출력 규칙 (절대 위반 금지!)`,
      `- 반드시 한국어로만 대화하세요. 영어를 절대 사용하지 마세요.`,
      `- 내부 사고 과정, 분석, 전략 등을 절대 출력하지 마세요.`,
      `- "Commencing", "Now I'm", "Let me" 등 영어 표현을 절대 사용하지 마세요.`,
      `- 바로 대화 내용만 출력하세요. 메타 설명이나 서술을 하지 마세요.`,
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
            
            this.sendToClient(session, {
              type: 'session.terminated',
              reason: event.reason || 'Gemini connection closed',
            });
            
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

      // Send first greeting trigger after connection is established
      console.log('🎬 Triggering AI to start first greeting...');
      const firstMessage = `(대화가 시작됩니다. 당신의 캐릭터로서 짧게 인사해주세요. 영어나 메타 설명 없이, 바로 한국어 인사만 해주세요.)`;
      
      geminiSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: firstMessage }] }],
        turnComplete: true,
      });

    } catch (error) {
      console.error(`Failed to connect to Gemini Live API:`, error);
      throw error;
    }
  }

  private handleGeminiMessage(session: RealtimeSession, message: any): void {
    // Gemini Live API message structure - log full structure for debugging
    const msgKeys = Object.keys(message);
    console.log(`📨 Gemini message keys:`, msgKeys);
    if (message.serverContent) {
      const scKeys = Object.keys(message.serverContent);
      console.log(`📨 serverContent keys:`, scKeys);
      if (message.serverContent.modelTurn) {
        console.log(`📨 modelTurn parts count:`, message.serverContent.modelTurn.parts?.length || 0);
        message.serverContent.modelTurn.parts?.forEach((part: any, i: number) => {
          console.log(`📨 part[${i}] keys:`, Object.keys(part));
        });
      }
    }
    console.log(`📨 Gemini message type:`, message.serverContent ? 'serverContent' : message.data ? 'audio data' : 'other');

    // Handle audio data chunks
    if (message.data) {
      console.log('🔊 Audio data received');
      this.sendToClient(session, {
        type: 'audio.delta',
        delta: message.data, // Base64 encoded PCM16 audio
      });
      return;
    }

    // Handle server content (transcriptions, turn completion, etc.)
    if (message.serverContent) {
      const { serverContent } = message;

      // Handle turn completion
      if (serverContent.turnComplete) {
        console.log('✅ Turn complete');
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
          this.analyzeEmotion(session.currentTranscript, session.personaName)
            .then(({ emotion, emotionReason }) => {
              console.log(`😊 Emotion analyzed: ${emotion} (${emotionReason})`);
              this.sendToClient(session, {
                type: 'ai.transcription.done',
                text: session.currentTranscript,
                emotion,
                emotionReason,
              });
              session.currentTranscript = ''; // Reset for next turn
            })
            .catch(error => {
              console.error('❌ Failed to analyze emotion:', error);
              this.sendToClient(session, {
                type: 'ai.transcription.done',
                text: session.currentTranscript,
                emotion: '중립',
                emotionReason: '감정 분석 실패',
              });
              session.currentTranscript = '';
            });
        }
      }

      // Handle model turn (AI response) - 토큰 추적은 outputTranscription에서만 수행 (중복 방지)
      if (serverContent.modelTurn) {
        const parts = serverContent.modelTurn.parts || [];
        for (const part of parts) {
          // Handle text transcription
          if (part.text) {
            console.log(`🤖 AI transcript: ${part.text}`);
            session.currentTranscript += part.text;
            // Note: 토큰 길이는 outputTranscription에서만 추적 (modelTurn과 중복되므로)
            this.sendToClient(session, {
              type: 'ai.transcription.delta',
              text: part.text,
            });
          }
          // Handle audio data (inlineData)
          if (part.inlineData && part.inlineData.data) {
            console.log('🔊 Audio data received from modelTurn');
            this.sendToClient(session, {
              type: 'audio.delta',
              delta: part.inlineData.data,
            });
          }
        }
      }

      // Handle input transcription (user speech)
      // 음절 단위로 스트리밍되므로 버퍼에 누적만 하고 전송하지 않음
      if (serverContent.inputTranscription) {
        const transcript = serverContent.inputTranscription.text || '';
        console.log(`🎤 User transcript delta: ${transcript}`);
        session.userTranscriptBuffer += transcript;
        session.totalUserTranscriptLength += transcript.length; // 누적 길이 추적
      }

      // Handle output transcription (AI speech) - 토큰 추적은 여기서만 수행
      // modelTurn.parts.text와 outputTranscription.text가 동일 내용이므로 여기서만 추적
      if (serverContent.outputTranscription) {
        const transcript = serverContent.outputTranscription.text || '';
        console.log(`🤖 AI transcript delta: ${transcript}`);
        // currentTranscript는 modelTurn에서 이미 누적되므로 여기서는 길이만 추적
        if (!serverContent.modelTurn) {
          session.currentTranscript += transcript;
        }
        session.totalAiTranscriptLength += transcript.length; // 누적 길이 추적 (여기서만)
      }
    }
  }

  handleClientMessage(sessionId: string, message: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      return;
    }

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
}

export const realtimeVoiceService = new RealtimeVoiceService();
