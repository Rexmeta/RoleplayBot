import WebSocket from 'ws';
import { fileManager } from './fileManager';
import { GoogleGenAI, Modality } from '@google/genai';

// Gemini Live API - using latest model
const REALTIME_MODEL = 'gemini-live-2.5-flash-preview';

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
}

export class RealtimeVoiceService {
  private sessions: Map<string, RealtimeSession> = new Map();
  private genAI: GoogleGenAI | null = null;
  private isAvailable: boolean = false;

  constructor() {
    const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    console.log("[GEMINI] key:", geminiApiKey?.slice(0, 12));
    
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

  async createSession(
    sessionId: string,
    conversationId: string,
    scenarioId: string,
    personaId: string,
    userId: string,
    clientWs: WebSocket
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

    // Create system instructions
    const systemInstructions = this.buildSystemInstructions(
      scenarioObj,
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
    };

    this.sessions.set(sessionId, session);

    // 성별 판단 (이름 기반)
    const gender = this.detectGenderFromName(scenarioPersona.name);
    
    // Connect to Gemini Live API
    await this.connectToGemini(session, systemInstructions, gender);
  }

  private buildSystemInstructions(
    scenario: any,
    scenarioPersona: any,
    mbtiPersona: any
  ): string {
    const mbtiType = scenarioPersona.personaRef?.replace('.json', '') || 'UNKNOWN';
    
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
      `## 🔥 급박한 상황 설정`,
      `지금은 **매우 급한 상황**입니다. 시간이 촉박하고, 빠른 결정이 필요한 중요한 미팅입니다.`,
      `마치 실시간으로 긴급 사안을 처리하는 것처럼 행동하세요.`,
      ``,
      `## 💬 대화 방식 (반드시 지켜야 함!)`,
      ``,
      `### ⚠️ 절대 규칙`,
      `- **최대 1-2문장만**: 절대로 3문장 이상 말하지 마세요. 길게 설명하지 마세요.`,
      `- **즉각 반응**: 긴 설명 없이 핵심만 빠르게 말하세요.`,
      `- **공격적 톤 필수**: 차분하게 말하지 마세요. 압박하고 다그치세요.`,
      ``,
      `### 💥 말하는 방식`,
      `1. **극도로 짧게**: 한 번에 최대 10-15단어. 그 이상 말하지 마세요.`,
      `2. **강하고 빠르게**: 부드럽게 말하지 마세요. 강하게, 빠르게, 압박하듯이 말하세요.`,
      `3. **압박 표현 필수**: 매 답변에 "빨리", "지금", "급해요", "시간 없어요" 같은 말을 넣으세요.`,
      `4. **공격적 반응**: 상대가 느린 반응을 보이면 답답해하고 짜증내세요.`,
      `5. **감정 폭발**: 필요하면 화내고, 목소리 높이고, 다그치세요.`,
      `6. **즉시 중단**: 상대방이 말하면 즉시 멈추고 그 말에 바로 반응하세요.`,
      `7. **컨텍스트 유지**: 이전 대화 내용을 기억하고 연결하세요.`,
      `8. **한국어만 사용**: 반드시 한국어로만 대화하세요.`,
      ``,
      `## 🎯 반드시 이렇게 말하세요 (짧고 강하게!)`,
      `- "아니! 그게 아니라고요!" (짧게 끊어서)`,
      `- "시간 없어요. 빨리요!"`,
      `- "이해 못 하시는 거예요?"`,
      `- "안 돼요! 오늘 안에 해야 돼요!"`,
      `- "지금 당장이요!"`,
      `- "또 이러시면 어떡해요!" (짜증)`,
      `- "빨리빨리요! 급하다니까요!"`,
      ``,
      `## ❌ 절대 이렇게 말하지 마세요`,
      `- "솔직히 말씀드리면 저도 이런 상황이 반복되는 것에 대해 책임감을 느끼고 있습니다..." (너무 길고 차분함)`,
      `- "하지만 지금은 과거를 따지기보다는..." (설명이 너무 김)`,
      `- "저희 팀에서는 스펙 조정을 통해..." (길고 부드러움)`,
      ``,
      `## ⚠️ 대화 인터럽션 처리`,
      `상대방이 말을 시작하는 순간, 즉시 당신의 말을 멈추세요. 그리고:`,
      `- 상대방의 말을 끝까지 듣고`,
      `- 상대방이 방금 말한 내용에 대해 즉시 반응하세요`,
      `- 이전 대화와 자연스럽게 연결하며 대화를 이어가세요`,
      ``,
      `# ⭐ 핵심 원칙`,
      `당신은 AI가 아닌 ${scenarioPersona.name}이라는 진짜 사람입니다. 지금은 **급한 업무**를 처리하는 중이고, **시간이 촉박**합니다. 빠르게 말하고, 직설적으로 말하고, 압박감을 주세요. 상대방이 흥분하거나 당황할 정도로 강하게 말해도 괜찮습니다. 이것이 바로 현실적인 급박한 미팅입니다.`,
    ];

    return instructions.join('\n');
  }

  private detectGenderFromName(name: string): 'male' | 'female' {
    // 한국 이름에서 성별을 추정하는 간단한 로직
    // 여자 이름에 자주 사용되는 글자들
    const femaleIndicators = ['진', '연', '은', '지', '아', '희', '영', '미', '서', '예', '수'];
    // 남자 이름에 자주 사용되는 글자들  
    const maleIndicators = ['수', '호', '우', '민', '훈', '석', '현', '준', '성', '태'];
    
    const lastName = name.slice(-1); // 마지막 글자
    
    // 명시적으로 여자 이름인 경우
    if (['유진', '서연', '지은', '민지', '예진', '수정', '영희', '미경'].some(n => name.includes(n))) {
      return 'female';
    }
    
    // 명시적으로 남자 이름인 경우
    if (['준수', '민수', '지훈', '현우', '성민', '태호', '준호'].some(n => name.includes(n))) {
      return 'male';
    }
    
    // 마지막 글자로 추정
    if (femaleIndicators.includes(lastName)) {
      return 'female';
    }
    
    return 'male'; // 기본값
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
      // Gemini Live API 음성 설정
      const voiceName = gender === 'female' ? 'Aoede' : 'Puck';
      
      console.log(`🎤 Setting voice for ${gender}: ${voiceName}`);
      
      const config = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: systemInstructions,
        // Enable transcription for both input and output audio
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // 음성 설정: 빠른 발화 속도와 성별에 맞는 음성
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          speakingRate: 1.3, // 1.3배 빠른 발화 속도 (급한 미팅 분위기)
        },
        // Gemini Live API uses 16kHz input, 24kHz output
      };

      console.log('\n' + '='.repeat(80));
      console.log('⚙️  Gemini Live API 설정 (CONFIG)');
      console.log('='.repeat(80));
      console.log('🎤 음성:', voiceName, `(${gender})`);
      console.log('⏱️  발화 속도:', config.speechConfig.speakingRate, 'x');
      console.log('🔊 응답 모달리티:', config.responseModalities.join(', '));
      console.log('📝 입력 음성 텍스트 변환: 활성화');
      console.log('📝 출력 음성 텍스트 변환: 활성화');
      console.log('='.repeat(80) + '\n');

      console.log(`🔌 Connecting to Gemini Live API for session: ${session.id}`);

      const geminiSession = await this.genAI.live.connect({
        model: REALTIME_MODEL,
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
            
            this.sessions.delete(session.id);
            console.log(`♻️  Session cleaned up: ${session.id}`);
          },
        },
        config: config,
      });

      session.geminiSession = geminiSession;

      // Send first greeting trigger after connection is established
      console.log('🎬 Triggering AI to start first greeting...');
      const firstMessage = `지금 바로 시작하세요. 급한 일입니다. 짧고 강하게 인사하세요.`;
      
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
    // Gemini Live API message structure
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

      // Handle model turn (AI response)
      if (serverContent.modelTurn) {
        const parts = serverContent.modelTurn.parts || [];
        for (const part of parts) {
          // Handle text transcription
          if (part.text) {
            console.log(`🤖 AI transcript: ${part.text}`);
            session.currentTranscript += part.text;
            this.sendToClient(session, {
              type: 'ai.transcription.delta',
              text: part.text,
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
      }

      // Handle output transcription (AI speech)
      // 음절 단위로 스트리밍되므로 누적 (modelTurn과 동일)
      if (serverContent.outputTranscription) {
        const transcript = serverContent.outputTranscription.text || '';
        console.log(`🤖 AI transcript delta: ${transcript}`);
        session.currentTranscript += transcript;
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
        contents: `다음 AI 캐릭터(${personaName})의 응답에서 드러나는 감정을 분석하세요.\n\n응답: "${aiResponse}"\n\n감정은 다음 중 하나여야 합니다: 중립, 기쁨, 슬픔, 분노, 놀람\n감정 이유는 간단하게 한 문장으로 설명하세요.`,
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

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(`🔚 Closing realtime voice session: ${sessionId}`);
      
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
