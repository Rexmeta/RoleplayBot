import { describe, it, expect } from 'vitest';
import { transition } from '../avatarStateMachine';
import type { AvatarState, AvatarEvent } from '../types';

// Helper to build events concisely
const ev = (type: AvatarEvent['type']): AvatarEvent => ({ type } as AvatarEvent);

describe('avatarStateMachine – transition()', () => {
  // ── Global overrides ──────────────────────────────────────────────────────

  it('ConversationEnd resets to idle from any state', () => {
    const states: AvatarState[] = ['idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause'];
    for (const s of states) {
      expect(transition(s, ev('ConversationEnd'))).toBe('idle');
    }
  });

  it('UserSpeechStart moves to listening from any state', () => {
    const states: AvatarState[] = ['idle', 'listening_nod', 'thinking', 'speaking', 'speaking_pause'];
    for (const s of states) {
      expect(transition(s, ev('UserSpeechStart'))).toBe('listening');
    }
  });

  it('TTSStart moves to speaking from any state', () => {
    const states: AvatarState[] = ['idle', 'listening', 'listening_nod', 'thinking', 'speaking_pause'];
    for (const s of states) {
      expect(transition(s, ev('TTSStart'))).toBe('speaking');
    }
  });

  it('LLMResponseStart moves to speaking from any state', () => {
    const states: AvatarState[] = ['idle', 'listening', 'thinking', 'speaking_pause'];
    for (const s of states) {
      expect(transition(s, ev('LLMResponseStart'))).toBe('speaking');
    }
  });

  // ── idle ──────────────────────────────────────────────────────────────────

  it('idle + LLMThinkingStart → thinking', () => {
    expect(transition('idle', ev('LLMThinkingStart'))).toBe('thinking');
  });

  it('idle stays idle on unknown/inapplicable events', () => {
    expect(transition('idle', ev('TTSEnd'))).toBe('idle');
    expect(transition('idle', ev('TTSPause'))).toBe('idle');
    expect(transition('idle', ev('TTSResume'))).toBe('idle');
    expect(transition('idle', ev('UserSpeechEnd'))).toBe('idle');
  });

  // ── listening ─────────────────────────────────────────────────────────────

  it('listening + UserSpeechEnd → thinking', () => {
    expect(transition('listening', ev('UserSpeechEnd'))).toBe('thinking');
  });

  it('listening + LLMThinkingStart → thinking', () => {
    expect(transition('listening', ev('LLMThinkingStart'))).toBe('thinking');
  });

  it('listening stays listening on other events', () => {
    expect(transition('listening', ev('TTSEnd'))).toBe('listening');
    expect(transition('listening', ev('TTSPause'))).toBe('listening');
  });

  // ── listening_nod ─────────────────────────────────────────────────────────

  it('listening_nod + UserSpeechEnd → thinking', () => {
    expect(transition('listening_nod', ev('UserSpeechEnd'))).toBe('thinking');
  });

  it('listening_nod + LLMThinkingStart → thinking', () => {
    expect(transition('listening_nod', ev('LLMThinkingStart'))).toBe('thinking');
  });

  // ── thinking ─────────────────────────────────────────────────────────────

  it('thinking + LLMThinkingStart stays thinking (re-entry)', () => {
    expect(transition('thinking', ev('LLMThinkingStart'))).toBe('thinking');
  });

  it('thinking + TTSStart → speaking (via global override)', () => {
    expect(transition('thinking', ev('TTSStart'))).toBe('speaking');
  });

  // ── speaking ─────────────────────────────────────────────────────────────

  it('speaking + TTSPause → speaking_pause', () => {
    expect(transition('speaking', ev('TTSPause'))).toBe('speaking_pause');
  });

  it('speaking + TTSEnd → idle', () => {
    expect(transition('speaking', ev('TTSEnd'))).toBe('idle');
  });

  it('speaking + LLMThinkingStart stays speaking (no regression)', () => {
    expect(transition('speaking', ev('LLMThinkingStart'))).toBe('speaking');
  });

  it('speaking + UserSpeechStart → listening (barge-in, via global override)', () => {
    expect(transition('speaking', ev('UserSpeechStart'))).toBe('listening');
  });

  // ── speaking_pause ────────────────────────────────────────────────────────

  it('speaking_pause + TTSResume → speaking', () => {
    expect(transition('speaking_pause', ev('TTSResume'))).toBe('speaking');
  });

  it('speaking_pause + TTSEnd → idle', () => {
    expect(transition('speaking_pause', ev('TTSEnd'))).toBe('idle');
  });

  it('speaking_pause + LLMThinkingStart stays speaking_pause', () => {
    expect(transition('speaking_pause', ev('LLMThinkingStart'))).toBe('speaking_pause');
  });

  // ── EmotionChange is a pass-through (no state change) ────────────────────

  it('EmotionChange does not change state', () => {
    const e: AvatarEvent = { type: 'EmotionChange', emotion: 'happy' };
    const states: AvatarState[] = ['idle', 'listening', 'thinking', 'speaking', 'speaking_pause'];
    for (const s of states) {
      expect(transition(s, e)).toBe(s);
    }
  });

  // ── Typical conversation flow ─────────────────────────────────────────────

  it('models a typical conversation flow', () => {
    let state: AvatarState = 'idle';
    state = transition(state, ev('UserSpeechStart'));   // idle → listening
    expect(state).toBe('listening');
    state = transition(state, ev('UserSpeechEnd'));     // listening → thinking
    expect(state).toBe('thinking');
    state = transition(state, ev('TTSStart'));          // thinking → speaking
    expect(state).toBe('speaking');
    state = transition(state, ev('TTSPause'));          // speaking → speaking_pause
    expect(state).toBe('speaking_pause');
    state = transition(state, ev('TTSResume'));         // speaking_pause → speaking
    expect(state).toBe('speaking');
    state = transition(state, ev('TTSEnd'));            // speaking → idle
    expect(state).toBe('idle');
  });

  it('models barge-in correctly', () => {
    let state: AvatarState = 'speaking';
    state = transition(state, ev('UserSpeechStart'));   // barge-in → listening
    expect(state).toBe('listening');
    state = transition(state, ev('TTSStart'));          // AI resumes → speaking
    expect(state).toBe('speaking');
  });
});
