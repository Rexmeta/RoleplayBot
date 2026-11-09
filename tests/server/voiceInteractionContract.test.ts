import { describe, it, expect, vi } from 'vitest';
import { bindVoiceInteraction } from '../../server/services/voice/interactionContract';
import { isVoiceInteractionEvent, sameVoiceOutput } from '../../shared/voiceInteraction';
import type { RealtimeSession } from '../../server/services/voice/types';

const session = () => ({
  id: 'session', personaRunId: 'run', personaId: 'persona',
  activePersonaIndex: 0, providerConnectionGeneration: 3, turnSeq: 4,
}) as RealtimeSession;

describe('provider-neutral output identity', () => {
  it('captures the origin of deferred results before the mutable server turn advances', () => {
    const current = session();
    const emit = vi.fn();
    const send = bindVoiceInteraction(current, emit);
    current.turnSeq++;
    send(current, { type: 'response.done' });
    send(current, { type: 'ai.transcription.done', emotion: '중립' });
    const events = emit.mock.calls.map(([, packet]) => packet.interaction);
    expect(events.every(isVoiceInteractionEvent)).toBe(true);
    expect(events[0].outputGeneration).toBe(4);
    expect(sameVoiceOutput(events[0], events[1])).toBe(true);
    expect(events[1].sequence).toBe(events[0].sequence + 1);
    expect(events[1].eventId).not.toBe(events[0].eventId);
  });

  it.each(['provider', 'persona', 'session'])('drops deferred output after a %s replacement', replacement => {
    const current = session();
    const emit = vi.fn();
    const send = bindVoiceInteraction(current, emit);
    if (replacement === 'provider') current.providerConnectionGeneration++;
    if (replacement === 'persona') current.activePersonaIndex++;
    if (replacement === 'session') current.id = 'replacement';
    send(current, { type: 'audio.delta', delta: 'opaque' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('binds response.ready to the next permissible output without retagging the interrupted output', () => {
    const current = session();
    const emit = vi.fn();
    const send = bindVoiceInteraction(current, emit);
    current.turnSeq++;
    send(current, { type: 'response.interrupted' });
    send(current, { type: 'response.ready', turnSeq: current.turnSeq });
    expect(emit.mock.calls[0][1].interaction.outputGeneration).toBe(4);
    expect(emit.mock.calls[1][1].interaction.outputGeneration).toBe(5);
  });

  it('does not promote server wall time to an AudioContext scheduling deadline', () => {
    const current = session();
    const emit = vi.fn();
    bindVoiceInteraction(current, emit)(current, { type: 'audio.delta' });
    expect(Object.keys(emit.mock.calls[0][1].interaction)).not.toContain('contextTime');
    expect(isVoiceInteractionEvent({ ...emit.mock.calls[0][1].interaction, sequence: NaN })).toBe(false);
  });
});
