/**
 * Unit tests for generateAvatarClipPrompt.
 *
 * The clip library is behaviour (audio stream) × emotion (LLM), so these tests
 * cover both behaviours across all three affect groups and verify that no
 * prompt contains terms that previously triggered Veo's content policy
 * (face/mouth references).
 */

import { describe, it, expect } from 'vitest';
import {
  generateAvatarClipPrompt,
  validateStyleHint,
  avatarClipSlot,
  AVATAR_PROMPT_BANNED_TERMS,
  AVATAR_CLIP_ASPECT_RATIO,
  AVATAR_CLIP_BEHAVIORS,
  AVATAR_CLIP_EMOTIONS,
  AVATAR_CLIP_SLOTS,
} from '../../server/services/gemini-video-generator';
import type {
  AvatarClipBehavior,
  AvatarClipEmotion,
  AvatarClipRequest,
} from '../../server/services/gemini-video-generator';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  behavior: AvatarClipBehavior,
  overrides: Partial<AvatarClipRequest> = {},
): AvatarClipRequest {
  return { personaId: 'test-persona', behavior, ...overrides };
}

// Terms that triggered Veo content-policy rejections in the previous prompts.
// `facial expression` is intentionally allowed for the current listening
// prompt because it was supplied verbatim for that behavior.
const BANNED_TERMS: string[] = [
  'mouth moving',
  'mouth move',
  'speaking naturally',
  'close-up face',
  'close up face',
  'closeup face',
  'face close',
];

// ── Slot model ───────────────────────────────────────────────────────────────

describe('avatar clip slots', () => {
  it('exposes exactly two behaviours and three emotions', () => {
    expect([...AVATAR_CLIP_BEHAVIORS]).toEqual(['listening', 'speaking']);
    expect([...AVATAR_CLIP_EMOTIONS]).toEqual(['positive', 'neutral', 'negative']);
  });

  it('produces six behaviour × emotion slots', () => {
    expect([...AVATAR_CLIP_SLOTS]).toEqual([
      'listening_positive',
      'listening_neutral',
      'listening_negative',
      'speaking_positive',
      'speaking_neutral',
      'speaking_negative',
    ]);
  });

  it('builds a slot key from a behaviour and an emotion', () => {
    expect(avatarClipSlot('speaking', 'negative')).toBe('speaking_negative');
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('generateAvatarClipPrompt – banned-term guard', () => {
  for (const behavior of AVATAR_CLIP_BEHAVIORS) {
    for (const emotion of AVATAR_CLIP_EMOTIONS) {
      describe(`slot: "${avatarClipSlot(behavior, emotion)}"`, () => {
        it('returns a non-empty string', () => {
          const prompt = generateAvatarClipPrompt(makeRequest(behavior, { emotion }));
          expect(typeof prompt).toBe('string');
          expect(prompt.length).toBeGreaterThan(0);
        });

        for (const term of BANNED_TERMS) {
          it(`does not contain banned term: "${term}"`, () => {
            const prompt = generateAvatarClipPrompt(
              makeRequest(behavior, { emotion }),
            ).toLowerCase();
            expect(prompt).not.toContain(term.toLowerCase());
          });
        }
      });
    }
  }
});

describe('generateAvatarClipPrompt – structural requirements', () => {
  it('all six slots produce distinct prompts', () => {
    const prompts = AVATAR_CLIP_BEHAVIORS.flatMap(behavior =>
      AVATAR_CLIP_EMOTIONS.map(emotion =>
        generateAvatarClipPrompt(makeRequest(behavior, { emotion })),
      ),
    );
    expect(new Set(prompts).size).toBe(AVATAR_CLIP_SLOTS.length);
  });

  it('includes "static camera" for every behaviour', () => {
    for (const behavior of AVATAR_CLIP_BEHAVIORS) {
      const prompt = generateAvatarClipPrompt(makeRequest(behavior));
      expect(prompt.toLowerCase()).toContain('static camera');
    }
  });

  it('describes lip movement only for the speaking behaviour', () => {
    expect(generateAvatarClipPrompt(makeRequest('speaking')).toLowerCase())
      .toContain('lip movement');
    expect(generateAvatarClipPrompt(makeRequest('listening')).toLowerCase())
      .not.toContain('lip movement');
  });

  it('uses the supplied listening prompt in every emotion slot', () => {
    for (const emotion of AVATAR_CLIP_EMOTIONS) {
      const prompt = generateAvatarClipPrompt(makeRequest('listening', { emotion })).toLowerCase();
      expect(prompt).toContain('calm eye contact while attentively listening');
      expect(prompt).toContain('natural blinking');
      expect(prompt).toContain('minimal natural breathing');
      expect(prompt).toContain('relaxed attentive posture');
      expect(prompt).toContain('mouth closed naturally');
      expect(prompt).toContain('static camera');
    }
  });

  it('does not add unrelated listening instructions', () => {
    const prompt = generateAvatarClipPrompt(makeRequest('listening')).toLowerCase();
    expect(prompt).not.toContain('mouth resting naturally');
    expect(prompt).not.toContain('gentle attentive eyes');
    expect(prompt).not.toContain('professional and composed demeanor');
    expect(prompt).not.toContain('soft indoor office lighting');
  });

  it('defaults to the neutral emotion when none is supplied', () => {
    expect(generateAvatarClipPrompt(makeRequest('listening')))
      .toBe(generateAvatarClipPrompt(makeRequest('listening', { emotion: 'neutral' })));
  });

  it('ignores styleHint — appearance comes from seed image, not prompt text', () => {
    const hint = 'wearing a navy suit, Asian male';
    const prompt = generateAvatarClipPrompt(makeRequest('listening', { styleHint: hint }));
    // styleHint must NOT appear in the prompt; person appearance is supplied via seed image only.
    expect(prompt).not.toContain(hint);
  });

  it('falls back to the listening prompt for an unknown behaviour', () => {
    const listeningPrompt = generateAvatarClipPrompt(makeRequest('listening'));
    // Cast to bypass TS – we are testing runtime fallback behaviour
    const unknownPrompt = generateAvatarClipPrompt(
      makeRequest('hovering' as AvatarClipBehavior),
    );
    expect(unknownPrompt).toBe(listeningPrompt);
  });

  it('keeps avatar generation pinned to a 9:16 portrait frame', () => {
    expect(AVATAR_CLIP_ASPECT_RATIO).toBe('9:16');
  });

  it('adds a distinct affect direction for each compact video emotion group', () => {
    const positive = generateAvatarClipPrompt(makeRequest('listening', { emotion: 'positive' }));
    const neutral = generateAvatarClipPrompt(makeRequest('listening', { emotion: 'neutral' }));
    const negative = generateAvatarClipPrompt(makeRequest('listening', { emotion: 'negative' }));

    expect(positive).toContain('Warm, encouraging demeanor');
    expect(neutral).toContain('Calm, composed neutral demeanor');
    expect(negative).toContain('Quietly concerned, empathetic demeanor');
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
      generateAvatarClipPrompt(makeRequest('listening', { styleHint: 'close-up face portrait' }))
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
      generateAvatarClipPrompt(makeRequest('listening', { styleHint: 'soft studio lighting, business casual' }))
    ).not.toThrow();
  });

  it('does not throw when styleHint is undefined', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('listening'))
    ).not.toThrow();
  });

  it('the error message names the offending term', () => {
    expect(() =>
      generateAvatarClipPrompt(makeRequest('listening', { styleHint: 'close-up face portrait' }))
    ).toThrow(/close-up face/i);
  });

  it('clean styleHint does not appear in the returned prompt (appearance comes from seed image)', () => {
    const hint = 'wearing a white blazer';
    const prompt = generateAvatarClipPrompt(makeRequest('listening', { styleHint: hint }));
    expect(prompt).not.toContain(hint);
  });
});
