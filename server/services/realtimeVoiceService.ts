import WebSocket from 'ws';
import OpenAI from 'openai';
import { fileManager } from './fileManager';

// OpenAI Realtime API GA version (not beta)
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
  private isAvailable: boolean = false;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      this.isAvailable = true;
      console.log('✅ OpenAI Realtime Voice Service initialized');
    } else {
      console.warn('⚠️  OPENAI_API_KEY not set - Realtime Voice features disabled');
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
        // No OpenAI-Beta header needed for GA version
      },
    });

    session.openaiWs = openaiWs;

    openaiWs.on('open', () => {
      console.log(`✅ OpenAI Realtime API connected for session: ${session.id}`);
      session.isConnected = true;

      // Configure session (GA API format)
      this.sendToOpenAI(session, {
        type: 'session.update',
        session: {
          type: 'realtime', // Required for GA version
          model: REALTIME_MODEL,
          instructions: systemInstructions,
          audio: {
            input: { 
              format: 'pcm16',
              transcription: {
                model: 'whisper-1',
              },
            },
            output: { 
              format: 'pcm16',
              voice: 'alloy' 
            },
          },
          turn_detection: null, // Disable server VAD, use manual control
          temperature: 0.8,
          max_response_output_tokens: 4096,
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
        
        // Then request audio response with explicit modalities
        this.sendToOpenAI(session, {
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            // instructions field is not supported in response.create
          },
        });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log(`🎤 User said: ${event.transcript}`);
        this.sendToClient(session, {
          type: 'user.transcription',
          transcript: event.transcript,
        });
        break;

      case 'response.output_audio.delta':
        // GA API: Forward audio chunks to client
        console.log('🔊 Audio delta received');
        this.sendToClient(session, {
          type: 'audio.delta',
          delta: event.delta,
        });
        break;

      case 'response.output_audio_transcript.delta':
        // GA API: Forward transcript to client
        console.log(`🤖 AI transcript: ${event.delta}`);
        this.sendToClient(session, {
          type: 'ai.transcription.delta',
          delta: event.delta,
        });
        break;

      case 'response.output_audio_transcript.done':
        // GA API: Complete transcript
        console.log(`✅ AI full transcript: ${event.transcript}`);
        this.sendToClient(session, {
          type: 'ai.transcription.done',
          transcript: event.transcript,
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

      default:
        // Forward other events as-is for debugging
        this.sendToClient(session, event);
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
