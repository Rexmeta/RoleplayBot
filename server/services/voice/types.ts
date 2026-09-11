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
  totalCachedTokens: number;
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
  userSpeechStarted: boolean;
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
  pendingHasExistingConversation: boolean;
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
  personaSwitchMode?: 'replace' | 'join' | 'none';
  simulationHarness?: import('@shared/schema/scenarios').SimulationHarness | null;
  terminationHandled?: boolean;
  evaluationInProgress?: boolean;
  suppressAIUntilUserSpeaks?: boolean;
  suppressedTurnStarted?: boolean;
  suppressTimeoutId?: ReturnType<typeof setTimeout>;
  lastAudioCommitSentAt: number;
  audioSourceThisTurn: 'top' | 'inline' | null;
  // Cross-frame transcript source dedup: gemini-live can deliver modelTurn
  // part.text and outputTranscription for the SAME turn in DIFFERENT frames.
  // Accumulating both doubles the transcript. Once outputTranscription is seen
  // for a turn it is authoritative; any modelTurn text already accumulated for
  // that turn is discarded. Reset to null at each turn boundary.
  transcriptSourceThisTurn?: 'model' | 'output' | null;
  lastUserAffect?: import('./emotionAnalyzer').UserAffectState;
  /** Stable logical identity for the in-progress provider user transcript. */
  activeUserTranscriptTurnId?: string | null;
  userTranscriptTurnCounter?: number;
  finalizedUserTranscriptTurnIds?: string[];
  /** Provider event ID -> logical turn ID, used to reject reconnect/replay duplicates. */
  finalizedUserTranscriptProviderEvents?: Record<string, string>;
  /** Provider event/item identity to stable logical turn identity, including provisional flushes. */
  userTranscriptProviderEventTurns?: Record<string, string>;
  /** OpenAI item_id associated with the active transcription delta stream. */
  activeUserTranscriptProviderEventId?: string | null;
  /** Gemini has no item ID, so a forced flush keeps this turn until provider turnComplete. */
  pendingGeminiProvisionalTurnId?: string | null;
  pendingGeminiProvisionalTranscript?: string | null;
  currentClientSpeechSeq?: number | null;
  pendingGeminiProvisionalSpeechSeq?: number | null;
  /** Monotonic client capture lifetime; rejects delayed audio from an older connection. */
  currentClientCaptureGeneration?: number;
  /** Monotonic provider socket lifetime; stale callbacks must not mutate the session. */
  providerConnectionGeneration?: number;
}
