import { describe, it, expect, vi, afterEach } from 'vitest';
import { BASELINE_DUPLEX_CONFIG, duplexConfigSchema, initialCharacterEmotion } from '../../shared/duplexMode';
import { reduceCharacterEmotion } from '../../server/services/voice/characterEmotionPolicy';
import { waitForVoiceFinalization } from '../../server/services/voice/finalizationBarrier';

describe('session-pinned feature dependencies', () => {
  it('accepts baseline and an explicitly selected supported enhanced configuration', () => {
    expect(duplexConfigSchema.parse(BASELINE_DUPLEX_CONFIG)).toEqual(BASELINE_DUPLEX_CONFIG);
    expect(duplexConfigSchema.safeParse({ ...BASELINE_DUPLEX_CONFIG,
      interaction: true, playbackLifecycle: true, characterEmotion: true,
      expressionSync: true, evaluationSnapshot: true, silentReactions: true, bargeInPolicy: 'confirmed',
    }).success).toBe(true);
  });
  it.each(['playbackLifecycle', 'characterEmotion', 'expressionSync', 'evaluationSnapshot', 'silentReactions'])('rejects %s without prerequisites', flag => {
    expect(duplexConfigSchema.safeParse({ ...BASELINE_DUPLEX_CONFIG, [flag]: true }).success).toBe(false);
  });
  it('never substitutes extra paid speech for an unverified backchannel capability', () => {
    expect(duplexConfigSchema.safeParse({ ...BASELINE_DUPLEX_CONFIG, voiceBackchannel: true }).success).toBe(false);
  });
});

describe('server-owned character emotion, independent of simulation score and user affect', () => {
  const initial = initialCharacterEmotion(3);
  const proposal = { ...initial, emotion: '단호', intensity: 5, confidence: 0.8,
    source: 'character_response_analysis' as const,
    cause: { kind: 'output' as const, id: 'output', sequence: 2, outputGeneration: 4, providerConnectionGeneration: 1 },
  };
  it('normalizes labels and bounds intensity with inertia without changing its input', () => {
    const before = structuredClone(initial);
    const accepted = reduceCharacterEmotion(initial, proposal)!;
    expect(accepted.emotion).toBe('determined');
    expect(accepted.revision).toBe(1);
    expect(accepted.intensity).toBeGreaterThan(initial.intensity);
    expect(accepted.intensity).toBeLessThan(0.85);
    expect(initial).toEqual(before);
    expect(accepted).not.toHaveProperty('score');
    expect(accepted).not.toHaveProperty('userAffect');
  });
  it('rejects duplicate, older cause and old persona results', () => {
    const next = reduceCharacterEmotion(initial, proposal)!;
    expect(reduceCharacterEmotion(next, proposal)).toBeNull();
    expect(reduceCharacterEmotion(next, { ...proposal, personaGeneration: 2 })).toBeNull();
    expect(reduceCharacterEmotion(next, { ...proposal, cause: { ...proposal.cause, sequence: 1 } })).toBeNull();
  });
  it('does not replace a label with low-confidence output and handles flat labels', () => {
    expect(reduceCharacterEmotion(initial, { ...proposal, confidence: 0.1 })!.emotion).toBe('neutral');
    expect(reduceCharacterEmotion(initial, { ...proposal, emotion: '무표정' })!.emotion).toBe('neutral');
  });
});

describe('finite evaluation barrier', () => {
  afterEach(() => vi.useRealTimers());
  it('settles on explicit readiness before the fixed ten-second deadline', async () => {
    vi.useFakeTimers();
    let ready = false;
    const barrier = waitForVoiceFinalization(async () => ready, () => false);
    await vi.advanceTimersByTimeAsync(9980);
    ready = true;
    await vi.advanceTimersByTimeAsync(19);
    // No poll after 9980 yet; the independent deadline must still win at 10000.
    await vi.advanceTimersByTimeAsync(1);
    expect((await barrier).outcome).toBe('timeout');
  });
  it('accepts final evidence on the last poll strictly before the deadline', async () => {
    vi.useFakeTimers();
    let ready = false;
    const barrier = waitForVoiceFinalization(async () => ready, () => false);
    await vi.advanceTimersByTimeAsync(9950);
    ready = true;
    await vi.advanceTimersByTimeAsync(30);
    expect((await barrier).outcome).toBe('settled');
  });
  it('does not hang on an unresolved provider/storage promise or promote it to final', async () => {
    vi.useFakeTimers();
    const barrier = waitForVoiceFinalization(() => new Promise(() => {}), () => false);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await barrier;
    expect(result.outcome).toBe('timeout');
    expect(result.deadlineAt - result.startedAt).toBe(10000);
  });
  it('preserves explicit connection loss instead of assuming playback completed', async () => {
    const result = await waitForVoiceFinalization(async () => false, () => true);
    expect(result.outcome).toBe('connection_lost');
  });
});
