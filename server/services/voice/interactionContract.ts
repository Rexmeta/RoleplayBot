import { VOICE_OUTPUT_EVENT_TYPES, type VoiceInteractionEvent, type VoiceOutputIdentity } from '@shared/voiceInteraction';
import type { RealtimeSession } from './types';
import { acceptCharacterEmotion } from './duplexRuntime';

type Send = (session: RealtimeSession, message: any) => void;
const OUTPUT_EVENTS = new Set(VOICE_OUTPUT_EVENT_TYPES);

/**
 * Capture at provider/client callback ENTRY, before turnSeq can advance.
 * Deferred analysis inherits its original output rather than whichever output
 * happens to be current when a promise settles.
 */
export function bindVoiceInteraction(session: RealtimeSession, send: Send): Send {
  if (session.duplexRuntime && !session.duplexRuntime.config.interaction) return send;
  const causeSequence = session.characterCauseSequence = (session.characterCauseSequence ?? 0) + 1;
  const personaGeneration = session.duplexRuntime?.personaGeneration ?? 0;
  const origin: VoiceOutputIdentity = {
    runId: session.personaRunId,
    sessionId: session.id,
    providerConnectionGeneration: session.providerConnectionGeneration ?? 0,
    personaId: session.personaId,
    personaIndex: session.activePersonaIndex,
    personaGeneration,
    logicalTurnId: session.activeUserTranscriptTurnId ?? session.lastEvaluatedUserTurnId ??
      `response:${session.id}:${session.turnSeq}`,
    outputGeneration: session.turnSeq,
  };
  return (current, message) => {
    if (!OUTPUT_EVENTS.has(message.type)) {
      send(current, message);
      return;
    }
    // A reconnect or persona replacement cannot publish an earlier promise's
    // expression/audio into the new renderer. Durable Ledger finality is
    // committed independently by the provider handler.
    if (current.id !== origin.sessionId ||
        (current.providerConnectionGeneration ?? 0) !== origin.providerConnectionGeneration ||
        current.personaId !== origin.personaId ||
        (current.duplexRuntime?.personaGeneration ?? 0) !== origin.personaGeneration ||
        current.activePersonaIndex !== origin.personaIndex) return;
    const sequence = current.interactionEventSequence = (current.interactionEventSequence ?? 0) + 1;
    const outputGeneration = message.type === 'response.ready' && Number.isSafeInteger(message.turnSeq)
      ? message.turnSeq : origin.outputGeneration;
    const key = `${origin.providerConnectionGeneration}:${personaGeneration}:${outputGeneration}`;
    const links = current.outputLogicalTurns ??= new Map();
    if (message.type !== 'response.ready' && !links.has(key)) links.set(key, origin.logicalTurnId);
    if (links.size > 512) {
      const oldest = links.keys().next().value;
      if (oldest) links.delete(oldest);
    }
    const interaction: VoiceInteractionEvent = {
      ...origin,
      // ready is a boundary for the NEXT permissible output.
      outputGeneration,
      logicalTurnId: links.get(key) ?? origin.logicalTurnId,
      version: 1,
      eventId: `${origin.sessionId}:${sequence}`,
      sequence,
      serverTimeMs: Date.now(),
    };
    send(current, { ...message, interaction });
    if (message.type === 'ai.transcription.done' && message.emotion && !message.interrupted &&
        current.duplexRuntime?.config.characterEmotion) {
      const work = acceptCharacterEmotion(current, origin, {
        emotion: message.emotion, intensity: 0.5,
        // Existing response analysis has no calibrated confidence output.
        // 0.5 explicitly represents unknown/moderate evidence, not a measurement.
        confidence: 0.5, source: 'character_response_analysis', revision: 0, personaGeneration,
        cause: {
          kind: 'output', id: message.utteranceId ?? interaction.eventId,
          sequence: causeSequence, outputGeneration: origin.outputGeneration,
          providerConnectionGeneration: origin.providerConnectionGeneration,
        },
      }).then(character => {
        if (!character || current.duplexRuntime?.personaGeneration !== character.personaGeneration ||
            current.duplexRuntime.character.revision !== character.revision) return;
        send(current, {
          type: 'character.emotion', character,
          expression: current.duplexRuntime?.config.expressionSync ? { output: origin, emotion: character.emotion } : undefined,
        });
      }).catch(() => send(current, { type: 'character.error', error: 'character_state_update_failed' }));
      current.ledgerAdapter?.track(work);
    }
  };
}
