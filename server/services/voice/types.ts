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
  personaRunId: string;
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
  hasReceivedFirstTranscriptDelta: boolean;
  greetingResponseCount: number;
  userTurnsCompleted: number;
  simulationState: import('../simulation/simulationTypes').SimulationState | null;
  scenarioRunId: string | null;
  toolCallCountThisTurn: number;
  emotionCallCountThisTurn: number;
  currentTurnIncidentFired: boolean;
  lastEvaluatedUserTurnIndex: number;
  lastEvaluatedUserTurnId: string | null;
  lastFinalizedUserTranscriptHash: string | null;
  lastClientContentSentAt: number;
  greetingTimeoutId: NodeJS.Timeout | null;
  pendingIsResuming: boolean;
  usingReconnectInstructions: boolean;
  activePersonaIndex: number;
  voiceId: string | null;
  scenarioPersonas: Array<{ id: string; name: string; position?: string; department?: string; gender?: string; voiceId?: string; personaRef?: string; triggerHints?: string[]; entryLine?: string; [key: string]: any }> | null;
  personaSystemInstructions?: string[];
  pendingPersonaSwitch?: { fromIndex: number; toIndex: number; fromPersonaId: string; toPersonaId: string; reason: string; transitionLine: string };
  targetTurns?: number;
  softCloseSent?: boolean;
  personaSwitchPending?: boolean;
  awaitingPersonaSwitch?: boolean;
}
