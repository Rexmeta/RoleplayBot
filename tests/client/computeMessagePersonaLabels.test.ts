import { describe, it, expect } from 'vitest';
import { computeMessagePersonaLabels } from '../../client/src/components/chat/computeMessagePersonaLabels';
import type { PersonaSwitchEvent } from '../../client/src/components/chat/PersonaSwitchCard';
import type { ConversationMessage } from '../../shared/schema';

function makeAiMsg(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    sender: 'ai',
    message: 'hello',
    emotion: null,
    emotionReason: null,
    turnIndex: null,
    ...overrides,
  } as ConversationMessage;
}

function makeUserMsg(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    sender: 'user',
    message: 'hi',
    emotion: null,
    emotionReason: null,
    turnIndex: null,
    ...overrides,
  } as ConversationMessage;
}

function makeSwitchEvent(partial: Partial<PersonaSwitchEvent> & Pick<PersonaSwitchEvent, 'toIndex' | 'newPersonaName'>): PersonaSwitchEvent {
  return {
    fromIndex: 0,
    fromPersonaName: 'Alice',
    reason: 'test reason',
    transitionLine: '',
    timestamp: new Date().toISOString(),
    turnIndex: undefined,
    ...partial,
  };
}

describe('computeMessagePersonaLabels', () => {
  it('labels all AI messages with personaName when there are no switch events', () => {
    const messages = [makeAiMsg(), makeUserMsg(), makeAiMsg()];
    const labels = computeMessagePersonaLabels(messages, [], 'Alice');
    expect(labels.get(0)).toBe('Alice');
    expect(labels.get(2)).toBe('Alice');
    expect(labels.has(1)).toBe(false);
  });

  it('labels messages before a switch with the original persona and after with the new one', () => {
    const messages = [makeAiMsg(), makeAiMsg(), makeAiMsg(), makeAiMsg()];
    const switchEvents: PersonaSwitchEvent[] = [
      makeSwitchEvent({
        fromPersonaName: 'Alice',
        toIndex: 2,
        newPersonaName: 'Bob',
        timestamp: '2024-01-01T00:00:01Z',
      }),
    ];
    const labels = computeMessagePersonaLabels(messages, switchEvents, 'Alice');
    expect(labels.get(0)).toBe('Alice');
    expect(labels.get(1)).toBe('Alice');
    expect(labels.get(2)).toBe('Alice');
    expect(labels.get(3)).toBe('Bob');
  });

  it('handles multiple switches correctly', () => {
    const messages = [makeAiMsg(), makeAiMsg(), makeAiMsg(), makeAiMsg(), makeAiMsg()];
    const switchEvents: PersonaSwitchEvent[] = [
      makeSwitchEvent({
        fromPersonaName: 'Alice',
        toIndex: 1,
        newPersonaName: 'Bob',
        timestamp: '2024-01-01T00:00:01Z',
      }),
      makeSwitchEvent({
        fromPersonaName: 'Bob',
        toIndex: 3,
        newPersonaName: 'Carol',
        timestamp: '2024-01-01T00:00:02Z',
      }),
    ];
    const labels = computeMessagePersonaLabels(messages, switchEvents, 'Alice');
    expect(labels.get(0)).toBe('Alice');
    expect(labels.get(1)).toBe('Alice');
    expect(labels.get(2)).toBe('Bob');
    expect(labels.get(3)).toBe('Bob');
    expect(labels.get(4)).toBe('Carol');
  });

  it('is deterministic even when switch events are supplied out of timestamp order', () => {
    const messages = [makeAiMsg(), makeAiMsg(), makeAiMsg(), makeAiMsg()];
    const switchEvents: PersonaSwitchEvent[] = [
      makeSwitchEvent({
        fromPersonaName: 'Bob',
        toIndex: 3,
        newPersonaName: 'Carol',
        timestamp: '2024-01-01T00:00:02Z',
      }),
      makeSwitchEvent({
        fromPersonaName: 'Alice',
        toIndex: 1,
        newPersonaName: 'Bob',
        timestamp: '2024-01-01T00:00:01Z',
      }),
    ];
    const labels = computeMessagePersonaLabels(messages, switchEvents, 'Alice');
    expect(labels.get(0)).toBe('Alice');
    expect(labels.get(1)).toBe('Alice');
    expect(labels.get(2)).toBe('Bob');
    expect(labels.get(3)).toBe('Bob');
  });

  it('uses turnIndex for placement when both message and event have turnIndex', () => {
    const messages = [
      makeAiMsg({ turnIndex: 0 }),
      makeAiMsg({ turnIndex: 1 }),
      makeAiMsg({ turnIndex: 2 }),
    ];
    const switchEvents: PersonaSwitchEvent[] = [
      makeSwitchEvent({
        fromPersonaName: 'Alice',
        toIndex: 0,
        newPersonaName: 'Bob',
        turnIndex: 1,
        timestamp: '2024-01-01T00:00:01Z',
      }),
    ];
    const labels = computeMessagePersonaLabels(messages, switchEvents, 'Alice');
    expect(labels.get(0)).toBe('Alice');
    expect(labels.get(1)).toBe('Alice');
    expect(labels.get(2)).toBe('Bob');
  });

  it('falls back to personaName when fromPersonaName is missing on the first switch event', () => {
    // Switch is placed AFTER message at toIndex, so that message still has the old label;
    // only subsequent messages carry the new persona name.
    const messages = [makeAiMsg(), makeAiMsg(), makeAiMsg()];
    const switchEvents: PersonaSwitchEvent[] = [
      makeSwitchEvent({
        fromPersonaName: undefined,
        toIndex: 1,
        newPersonaName: 'Bob',
        timestamp: '2024-01-01T00:00:01Z',
      }),
    ];
    const labels = computeMessagePersonaLabels(messages, switchEvents, 'Alice');
    expect(labels.get(0)).toBe('Alice');
    expect(labels.get(1)).toBe('Alice');
    expect(labels.get(2)).toBe('Bob');
  });
});
