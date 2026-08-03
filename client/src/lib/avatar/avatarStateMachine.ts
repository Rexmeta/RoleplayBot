/**
 * Avatar State Machine — pure transition function
 *
 * `transition(state, event)` returns the next AvatarState given the current
 * state and an incoming event.  Being a pure function makes it trivially
 * testable and renderer-agnostic.
 */

import type { AvatarState, AvatarEvent } from './types';

/**
 * Transition table expressed as a pure function.
 *
 * Rules (in priority order):
 *  1. ConversationEnd always resets to idle.
 *  2. UserSpeechStart interrupts any state → listening.
 *  3. TTSStart / LLMResponseStart from any state → speaking.
 *  4. LLMThinkingStart → thinking (except when already speaking, which takes priority).
 *  5. State-specific transitions.
 *  6. Unknown events leave the state unchanged.
 */
export function transition(state: AvatarState, event: AvatarEvent): AvatarState {
  // ── Global overrides ──────────────────────────────────────────────────────
  if (event.type === 'ConversationEnd') return 'idle';
  if (event.type === 'UserSpeechStart') return 'listening';

  // TTS / LLM response start moves us to speaking from any state
  if (event.type === 'TTSStart' || event.type === 'LLMResponseStart') return 'speaking';

  // ── State-specific transitions ────────────────────────────────────────────
  switch (state) {
    case 'idle': {
      if (event.type === 'LLMThinkingStart') return 'thinking';
      return 'idle';
    }

    case 'listening': {
      if (event.type === 'UserSpeechEnd') return 'thinking';
      if (event.type === 'LLMThinkingStart') return 'thinking';
      return 'listening';
    }

    case 'listening_nod': {
      if (event.type === 'UserSpeechEnd') return 'thinking';
      if (event.type === 'LLMThinkingStart') return 'thinking';
      return 'listening_nod';
    }

    case 'thinking': {
      if (event.type === 'LLMThinkingStart') return 'thinking'; // re-entry is fine
      return 'thinking';
    }

    case 'speaking': {
      if (event.type === 'TTSPause') return 'speaking_pause';
      if (event.type === 'TTSEnd') return 'idle';
      if (event.type === 'LLMThinkingStart') return 'speaking'; // don't regress
      return 'speaking';
    }

    case 'speaking_pause': {
      if (event.type === 'TTSResume') return 'speaking';
      if (event.type === 'TTSEnd') return 'idle';
      if (event.type === 'LLMThinkingStart') return 'speaking_pause';
      return 'speaking_pause';
    }

    default:
      return state;
  }
}
