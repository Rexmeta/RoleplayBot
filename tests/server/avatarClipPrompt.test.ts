/**
 * Unit tests for generateAvatarClipPrompt.
 *
 * These tests verify that none of the 6 avatar clip state prompts contain
 * terms that previously triggered Veo's content policy (face/mouth
 * references).  Any prompt regression that re-introduces banned language
 * will be caught here before it reaches the API.
 */

import { describe, it, expect } from 'vitest';
import { generateAvatarClipPrompt } from '../../server/services/gemini-video-generator';
import type { AvatarClipState, AvatarClipRequest } from '../../server/services/gemini-video-generator';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ALL_STATES: AvatarClipState[] = [
  'idle',
  'listening',
  'listening_nod',
  'thinking',
  'speaking',
  'speaking_pause',
];

function makeRequest(state: AvatarClipState, overrides: Partial<AvatarClipRequest> = {}): AvatarClipRequest {
  return { personaId: 'test-persona', state, ...overrides };
}

// Terms that triggered Veo content-policy rejections in the previous prompts.
const BANNED_TERMS: string[] = [
  'mouth moving',
  'mouth move',
  'speaking naturally',
  'facial expression',
  'close-up face',
  'close up face',
  'closeup face',
  'face close',
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('generateAvatarClipPrompt – banned-term guard', () => {
  for (const state of ALL_STATES) {
    describe(`state: "${state}"`, () => {
      it('returns a non-empty string', () => {
        const prompt = generateAvatarClipPrompt(makeRequest(state));
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(0);
      });

      for (const term of BANNED_TERMS) {
        it(`does not contain banned term: "${term}"`, () => {
          const prompt = generateAvatarClipPrompt(makeRequest(state)).toLowerCase();
          expect(prompt).not.toContain(term.toLowerCase());
        });
      }
    });
  }
});

describe('generateAvatarClipPrompt – structural requirements', () => {
  it('all 6 states produce distinct prompts', () => {
    const prompts = ALL_STATES.map(state => generateAvatarClipPrompt(makeRequest(state)));
    const unique = new Set(prompts);
    expect(unique.size).toBe(ALL_STATES.length);
  });

  it('includes "upper body" framing for every state (no full-face close-ups)', () => {
    for (const state of ALL_STATES) {
      const prompt = generateAvatarClipPrompt(makeRequest(state));
      expect(prompt.toLowerCase()).toContain('upper body');
    }
  });

  it('includes duration hint for every state', () => {
    for (const state of ALL_STATES) {
      const prompt = generateAvatarClipPrompt(makeRequest(state));
      expect(prompt).toMatch(/\d+\s*second/i);
    }
  });

  it('includes "loopable" for every state', () => {
    for (const state of ALL_STATES) {
      const prompt = generateAvatarClipPrompt(makeRequest(state));
      expect(prompt.toLowerCase()).toContain('loopable');
    }
  });

  it('ignores styleHint — appearance comes from seed image, not prompt text', () => {
    const hint = 'wearing a navy suit, Asian male';
    const prompt = generateAvatarClipPrompt(makeRequest('idle', { styleHint: hint }));
    // styleHint must NOT appear in the prompt; person appearance is supplied via seed image only.
    expect(prompt).not.toContain(hint);
  });

  it('falls back to "idle" prompt for an unknown state', () => {
    const idlePrompt = generateAvatarClipPrompt(makeRequest('idle'));
    // Cast to bypass TS – we are testing runtime fallback behaviour
    const unknownPrompt = generateAvatarClipPrompt(makeRequest('unknown_state' as AvatarClipState));
    expect(unknownPrompt).toBe(idlePrompt);
  });
});
