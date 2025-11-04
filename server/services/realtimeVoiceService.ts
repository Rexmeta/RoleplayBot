import WebSocket from 'ws';
import OpenAI from 'openai';
import { fileManager } from './fileManager';
import { GoogleGenerativeAI } from '@google/genai';

// OpenAI Realtime API - using GA model
const REALTIME_MODEL = 'gpt-realtime';

interface RealtimeSession {
  id: string;
  conversationId: string;
  scenarioId: string;
  personaId: string;
  personaName: string; // Store persona name for first greeting
  userId: string;
  clientWs: WebSocket;
  openaiWs: WebSocket | null;
  isConnected: boolean;
  audioBuffer: Buffer[];
}

export class RealtimeVoiceService {
  private sessions: Map<string, RealtimeSession> = new Map();
  private openai: OpenAI | null = null;
  private genAI: GoogleGenerativeAI | null = null;
  private isAvailable: boolean = false;

  constructor() {
    console.log("[OPENAI] key:", process.env.OPENAI_API_KEY?.slice(0, 12));
    console.log("[OPENAI] org:", process.env.OPENAI_ORG);
    console.log("[OPENAI] project:", process.env.OPENAI_PROJECT);
    
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      this.isAvailable = true;
      console.log('✅ OpenAI Realtime Voice Service initialized');
    } else {
      console.warn('⚠️  OPENAI_API_KEY not set - Realtime Voice features disabled');
    }

    // Initialize Gemini for emotion analysis
    if (process.env.GOOGLE_GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
      console.log('✅ Gemini API initialized for emotion analysis');
    } else {
      console.warn('⚠️  GOOGLE_GEMINI_API_KEY not set - Emotion analysis disabled');
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
    if (!this.isAvailable || !this.openai) {
      throw new Error('OpenAI Realtime Voice Service is not available. Please configure OPENAI_API_KEY.');
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

    // Create system instructions combining scenario context and MBTI traits
    const systemInstructions = this.buildSystemInstructions(
      scenarioObj,
      scenarioPersona,
      mbtiPersona
    );

    // Create session object
    const session: RealtimeSession = {
      id: sessionId,
      conversationId,
      scenarioId,
      personaId,
      personaName: scenarioPersona.name, // Store persona name
      userId,
      clientWs,
      openaiWs: null,
      isConnected: false,
      audioBuffer: [],
    };

    this.sessions.set(sessionId, session);

    // Connect to OpenAI Realtime API
    await this.connectToOpenAI(session, systemInstructions);
  }

  private buildSystemInstructions(
    scenario: any,
    scenarioPersona: any,
    mbtiPersona: any
  ): string {
    const mbtiType = scenarioPersona.personaRef?.replace('.json', '') || 'UNKNOWN';
    
    const instructions = [
      `당신은 "${scenarioPersona.name}"입니다.`,
      `역할: ${scenarioPersona.position} (${scenarioPersona.department})`,
      ``,
      `# 시나리오 배경`,
      scenario.context?.situation || '',
      ``,
      `# 현재 상황`,
      scenarioPersona.currentSituation || '',
      ``,
      `# 당신의 성격 특성 (MBTI: ${mbtiType})`,
      mbtiPersona?.communication_style || '균형 잡힌 의사소통 스타일',
      ``,
      `# 대화 패턴`,
      `- 시작 스타일: ${mbtiPersona?.communication_patterns?.opening_style || '상황에 맞게 대화 시작'}`,
      `- 주요 표현: ${mbtiPersona?.communication_patterns?.key_phrases?.slice(0, 3).join(', ') || ''}`,
      ``,
      `# 당신의 관심사와 우려사항`,
      ...(scenarioPersona.concerns || []).map((c: string) => `- ${c}`),
      ``,
      `# 대화 목표`,
      ...(mbtiPersona?.communication_patterns?.win_conditions || []).map((w: string) => `- ${w}`),
      ``,
      `# 중요 지시사항`,
      `- 반드시 한국어로만 대화하세요`,
      `- 자연스러운 음성 톤과 억양을 사용하세요`,
      `- 당신의 감정 상태를 음성에 반영하세요`,
      `- 짧고 간결하게 응답하세요 (1-3문장)`,
      `- 사용자의 말을 경청하고 적절히 반응하세요`,
    ];

    return instructions.join('\n');
  }

  private async connectToOpenAI(
    session: RealtimeSession,
    systemInstructions: string
  ): Promise<void> {
    const url = 'wss://api.openai.com/v1/realtime?model=' + REALTIME_MODEL;
    
    const openaiWs = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    session.openaiWs = openaiWs;

    openaiWs.on('open', () => {
      console.log(`✅ OpenAI Realtime API connected for session: ${session.id}`);
      session.isConnected = true;

      // Configure session (API format - no type field needed)
      this.sendToOpenAI(session, {
        type: 'session.update',
        session: {
          model: REALTIME_MODEL,
          instructions: systemInstructions,
          voice: 'alloy',
          input_audio_transcription: {
            model: 'whisper-1', // Enable user speech transcription
          },
        },
      });

      // Notify client that session is ready
      this.sendToClient(session, {
        type: 'session.ready',
        sessionId: session.id,
      });
    });

    openaiWs.on('message', (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleOpenAIEvent(session, event);
      } catch (error) {
        console.error('Error parsing OpenAI message:', error);
      }
    });

    openaiWs.on('error', (error) => {
      console.error(`OpenAI WebSocket error for session ${session.id}:`, error);
      this.sendToClient(session, {
        type: 'error',
        error: 'OpenAI connection error',
      });
    });

    openaiWs.on('close', () => {
      console.log(`🔌 OpenAI WebSocket closed for session: ${session.id}`);
      session.isConnected = false;
      
      // Notify client that OpenAI connection was closed
      this.sendToClient(session, {
        type: 'session.terminated',
        reason: 'OpenAI connection closed',
      });
      
      // Close client connection and clean up session
      if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
        session.clientWs.close(1000, 'OpenAI session ended');
      }
      
      this.sessions.delete(session.id);
      console.log(`♻️  Session cleaned up: ${session.id}`);
    });
  }

  private handleOpenAIEvent(session: RealtimeSession, event: any): void {
    console.log(`📨 OpenAI event: ${event.type}`);

    switch (event.type) {
      case 'session.created':
        this.sendToClient(session, {
          type: 'session.configured',
          ...event,
        });
        break;
      
      case 'session.updated':
        console.log('✅ Session updated with our settings');
        console.log('📋 Updated session config:', JSON.stringify(event.session, null, 2));
        this.sendToClient(session, {
          type: 'session.configured',
          ...event,
        });
        // 세션이 업데이트되면 AI가 자동으로 첫 인사를 시작
        console.log('🎬 Triggering AI to start first greeting with full context...');
        
        // Create a contextual first message using stored persona name
        const firstMessage = `[시작] 대화를 시작합니다. 당신은 ${session.personaName}입니다. 상황에 맞게 자연스럽게 인사하고 대화를 시작해주세요. 반드시 음성으로 응답하세요.`;
        
        console.log('📝 First message context:', firstMessage);
        
        // Add a conversation item first to prompt the AI
        this.sendToOpenAI(session, {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: firstMessage,
              },
            ],
          },
        });
        
        // Then request audio response (GA API - no modalities parameter)
        this.sendToOpenAI(session, {
          type: 'response.create',
        });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log(`🎤 User said: ${event.transcript}`);
        this.sendToClient(session, {
          type: 'user.transcription',
          transcript: event.transcript,
        });
        break;

      case 'response.audio.delta':
        // Forward audio chunks to client
        console.log('🔊 Audio delta received');
        this.sendToClient(session, {
          type: 'audio.delta',
          delta: event.delta,
        });
        break;

      case 'response.output_audio.delta':
        // 이미 audio.delta를 보내고 있다면 이건 무시
        // console.log('ignore response.output_audio.delta');
        break;

      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
        // Forward transcript to client (both event formats supported)
        console.log(`🤖 AI transcript: ${event.delta}`);
        this.sendToClient(session, {
          type: 'ai.transcription.delta',
          text: event.delta,  // ✅ text 필드 사용 (delta 아님)
        });
        break;

      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
        // Complete transcript (both event formats supported)
        console.log(`✅ AI full transcript: ${event.transcript}`);
        
        // 감정 분석을 비동기로 수행하고 결과 전송
        this.analyzeEmotion(event.transcript, session.personaName)
          .then(({ emotion, emotionReason }) => {
            console.log(`😊 Emotion analyzed: ${emotion} (${emotionReason})`);
            this.sendToClient(session, {
              type: 'ai.transcription.done',
              text: event.transcript,
              emotion,
              emotionReason,
            });
          })
          .catch(error => {
            console.error('❌ Failed to analyze emotion:', error);
            // 감정 분석 실패 시 기본값으로 전송
            this.sendToClient(session, {
              type: 'ai.transcription.done',
              text: event.transcript,
              emotion: '중립',
              emotionReason: '감정 분석 실패',
            });
          });
        break;

      case 'response.done':
        console.log(`✅ Response complete`);
        console.log(`📊 Response details:`, JSON.stringify(event.response, null, 2));
        this.sendToClient(session, {
          type: 'response.done',
        });
        break;

      case 'error':
        console.error(`❌ OpenAI error:`, event.error);
        // Don't close session on empty buffer errors (recoverable)
        if (event.error?.code === 'input_audio_buffer_commit_empty') {
          console.log('⚠️  Empty audio buffer - ignoring');
          return;
        }
        this.sendToClient(session, {
          type: 'error',
          error: event.error,
        });
        break;

      // Events to ignore (already handled or not needed by client)
      case 'conversation.item.created':
      case 'response.created':
      case 'response.output_item.added':
      case 'response.content_part.added':
      case 'response.content_part.done':
      case 'response.output_item.done':
      case 'response.audio.done':
      case 'response.output_audio.done':
      case 'rate_limits.updated':
      case 'input_audio_buffer.speech_started':
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        // Silently ignore these events (already processed or not needed)
        break;

      default:
        // Log unknown events but don't forward (prevents duplicate audio)
        console.log(`📨 Unhandled OpenAI event: ${event.type}`);
        break;
    }
  }

  handleClientMessage(sessionId: string, message: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      return;
    }

    if (!session.isConnected || !session.openaiWs) {
      console.error(`OpenAI not connected for session: ${sessionId}`);
      return;
    }

    // Forward client messages to OpenAI
    switch (message.type) {
      case 'input_audio_buffer.append':
        // Client sending audio data
        this.sendToOpenAI(session, {
          type: 'input_audio_buffer.append',
          audio: message.audio,
        });
        break;

      case 'input_audio_buffer.commit':
        // Client finished speaking
        this.sendToOpenAI(session, {
          type: 'input_audio_buffer.commit',
        });
        break;

      case 'response.create':
        // Client requesting a response
        this.sendToOpenAI(session, {
          type: 'response.create',
        });
        break;

      case 'conversation.item.create':
        // Client sending a text message
        this.sendToOpenAI(session, {
          type: 'conversation.item.create',
          item: message.item,
        });
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
      const model = this.genAI.models.generateContent({
        model: 'gemini-2.0-flash-exp',
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
        },
        contents: [
          { 
            role: "user", 
            parts: [{ 
              text: `다음 AI 캐릭터(${personaName})의 응답에서 드러나는 감정을 분석하세요.\n\n응답: "${aiResponse}"\n\n감정은 다음 중 하나여야 합니다: 중립, 기쁨, 슬픔, 분노, 놀람\n감정 이유는 간단하게 한 문장으로 설명하세요.` 
            }] 
          }
        ],
      });

      const response = await model;
      const responseText = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
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

  private sendToOpenAI(session: RealtimeSession, message: any): void {
    if (session.openaiWs && session.isConnected) {
      session.openaiWs.send(JSON.stringify(message));
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
      
      if (session.openaiWs) {
        session.openaiWs.close();
      }
      
      this.sessions.delete(sessionId);
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}

export const realtimeVoiceService = new RealtimeVoiceService();
