import WebSocket from 'ws';

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const MAX_TRANSCRIPT_LENGTH = 50000;
export const CLEANUP_INTERVAL_MS = 60 * 1000;
export const MAX_CONCURRENT_SESSIONS = 100;
export const MAX_PENDING_MESSAGES = 100;

export interface PendingOutgoingMessage {
  index: number;
  payload: any;
}

export interface RealtimeSession {
  id: string;
  conversationId: string;
  scenarioId: string;
  personaId: string;
  personaName: string;
  userId: string;
  userName: string;
  clientWs: WebSocket;
  geminiSession: any | null;
  currentTranscript: string;
  userTranscriptBuffer: string;
  audioBuffer: string[];
  startTime: number;
  lastActivityTime: number;
  totalUserTranscriptLength: number;
  totalAiTranscriptLength: number;
  realtimeModel: string;
  hasReceivedFirstAIResponse: boolean;
  hasReceivedFirstAIAudio: boolean;
  hasTriggeredFirstGreeting: boolean;
  firstGreetingRetryCount: number;
  isInterrupted: boolean;
  turnSeq: number;
  cancelledTurnSeq: number;
  sessionResumptionToken: string | null;
  isReconnecting: boolean;
  reconnectAttempts: number;
  systemInstructions: string;
  voiceGender: 'male' | 'female';
  recentMessages: Array<{ role: 'user' | 'ai'; text: string }>;
  selectedVoice: string | null;
  goAwayWarningTime: number | null;
  pendingClientReady: any | null;
  userLanguage: 'ko' | 'en' | 'ja' | 'zh';
  pendingMessages: PendingOutgoingMessage[];
  outgoingMessageIndex: number;
}
