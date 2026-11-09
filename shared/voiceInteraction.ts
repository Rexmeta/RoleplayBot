/**
 * Transport identity for the existing realtime output path, not a second
 * conversation state machine. AudioContext time is deliberately absent:
 * serverTimeMs is a wall-clock diagnostic, never a browser scheduling deadline.
 */
export interface VoiceOutputIdentity {
  runId: string;
  sessionId: string;
  providerConnectionGeneration: number;
  personaId: string;
  personaIndex: number;
  personaGeneration: number;
  logicalTurnId: string;
  /** The existing server turnSeq at this output's provider boundary. */
  outputGeneration: number;
}
export const VOICE_OUTPUT_EVENT_TYPES = [
  'audio.delta', 'audio.done', 'response.done', 'response.ready', 'response.interrupted',
  'ai.transcription.delta', 'ai.transcription.done',
] as const;

export interface VoiceInteractionEvent extends VoiceOutputIdentity {
  version: 1;
  eventId: string;
  sequence: number;
  serverTimeMs: number;
}

export function sameVoiceOutput(a: VoiceOutputIdentity, b: VoiceOutputIdentity): boolean {
  return a.runId === b.runId && a.sessionId === b.sessionId &&
    a.providerConnectionGeneration === b.providerConnectionGeneration &&
    a.personaId === b.personaId && a.personaIndex === b.personaIndex && a.personaGeneration === b.personaGeneration &&
    a.outputGeneration === b.outputGeneration;
}

export function voiceOutputKey(output: VoiceOutputIdentity): string {
  return `${output.sessionId}:${output.providerConnectionGeneration}:${output.personaGeneration}:${output.personaIndex}:${output.outputGeneration}`;
}

export function isVoiceInteractionEvent(value: unknown): value is VoiceInteractionEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return event.version === 1 &&
    ['runId', 'sessionId', 'personaId', 'eventId', 'logicalTurnId'].every(key =>
      typeof event[key] === 'string' && (event[key] as string).length > 0) &&
    ['providerConnectionGeneration', 'personaIndex', 'personaGeneration', 'outputGeneration', 'sequence', 'serverTimeMs']
      .every(key => typeof event[key] === 'number' && Number.isSafeInteger(event[key]) && (event[key] as number) >= 0);
}
