/**
 * Unit tests for generateAvatarClipPrompt.
 *
 * These tests verify that none of the 6 avatar clip state prompts contain
 * terms that previously triggered Veo's content policy (face/mouth
 * references).  Any prompt regression that re-introduces banned language
 * will be caught here before it reaches the API.
 */

import { describe, it, expect } from 'vitest';
import {
  generateAvatarClipPrompt,
  validateStyleHint,
  AVATAR_PROMPT_BANNED_TERMS,
} from '../../server/services/gemini-video-generator';
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

// ── styleHint policy-safety tests ────────────────────────────────────────────

describe('validateStyleHint – banned-term rejection', () => {
  it('accepts an empty styleHint without throwing', () => {
    expect(() => validateStyleHint('')).not.toThrow();
  });

  it('accepts a clean styleHint without throwing', () => {
    expect(() => validateStyleHint('wearing a navy suit, professional lighting')).not.toThrow();
  });

  for (const term of AVATAR_PROMPT_BANNED_TERMS) {
    it(`rejects styleHint containing banned term: "${term}"`, () => {
      expect(() => validateStyleHint(`some text ${term} more text`)).toThrow(/policy-violating term/i);
    });

    it(`rejects styleHint case-insensitively for: "${term}"`, () => {
      expect(() => validateStyleHint(term.toUpperCase())).toThrow(/policy-violating term/i);
    });
  }
});

describe('generateAvatarClipPrompt – styleHint policy guard', () => {
  it('throws when styleHint contains a banned term', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('idle', { styleHint: 'close-up face portrait' }))
    ).toThrow(/policy-violating term/i);
  });

  it('throws when styleHint contains "facial expression"', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('speaking', { styleHint: 'detailed facial expression visible' }))
    ).toThrow(/policy-violating term/i);
  });

  it('throws when styleHint contains "mouth moving"', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('speaking', { styleHint: 'mouth moving naturally' }))
    ).toThrow(/policy-violating term/i);
  });

  it('does not throw when styleHint is clean', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('idle', { styleHint: 'soft studio lighting, business casual' }))
    ).not.toThrow();
  });

  it('does not throw when styleHint is undefined', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('idle'))
    ).not.toThrow();
  });

  it('the error message names the offending term', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('idle', { styleHint: 'close-up face portrait' }))
    ).toThrow(/close-up face/i);
  });

  it('clean styleHint does not appear in the returned prompt (appearance comes from seed image)', () => {
    const hint = 'wearing a white blazer';
    const prompt = generateAvatarClipPrompt(makeRequest('idle', { styleHint: hint }));
    expect(prompt).not.toContain(hint);
  });
});
