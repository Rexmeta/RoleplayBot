/**
 * Tests that `generateIntroVideo` and `generateAvatarClip` correctly forward
 * the Lite model name to the Veo API, and that both functions return a
 * non-empty videoUrl on success.
 *
 * Note: `generateAudio` is NOT passed — the @google/genai SDK v1.15+ throws
 * "generateAudio parameter is not supported in Gemini API" when it is present.
 *
 * The @google/genai SDK, aiServiceFactory, mediaStorage, and aiUsageTracker
 * are all stubbed so no real network calls are made.
 *
 * IMPORTANT: `gemini-video-generator.ts` captures `apiKey` at module load time
 * (`const apiKey = process.env.GEMINI_API_KEY || ...`).  We therefore set the
 * env var inside vi.hoisted() — which runs *before* any module is imported —
 * so the guard `if (!apiKey)` branch is never hit regardless of the CI
 * environment's actual secrets.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted setup — runs before any module import ────────────────────────────

const mockGenerateVideos = vi.hoisted(() => {
  // Ensure the API-key guard in the SUT never fires.
  process.env.GEMINI_API_KEY = 'test-api-key-hoisted';
  return vi.fn();
});

const mockGetVideosOperation = vi.hoisted(() => vi.fn());
const mockGetModelForFeature  = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@google/genai', () => ({
  // Must use a regular function (not an arrow) so `new GoogleGenAI(...)` works.
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      models:     { generateVideos:      mockGenerateVideos      },
      operations: { getVideosOperation:  mockGetVideosOperation  },
    };
  }),
}));

vi.mock('../../server/services/aiServiceFactory', () => ({
  getModelForFeature: mockGetModelForFeature,
}));

vi.mock('../../server/services/mediaStorage', () => ({
  mediaStorage: {
    saveVideo:        vi.fn().mockResolvedValue('/videos/intro-test.webm'),
    saveToFixedPath:  vi.fn().mockResolvedValue('/videos/avatar-test.webm'),
    readImageBuffer:  vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../server/services/aiUsageTracker', () => ({
  trackVideoUsage: vi.fn(),
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────

import {
  generateIntroVideo,
  generateAvatarClip,
} from '../../server/services/gemini-video-generator';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal done-operation response with one video whose bytes are inline. */
function makeDoneOperation() {
  const fakeBase64 = btoa('\x00\x01\x02'); // 3-byte payload
  return {
    name: 'operations/fake-op-id',
    done: true,
    error: null,
    response: {
      generatedVideos: [{ video: { videoBytes: fakeBase64 } }],
    },
  };
}

const LITE_MODEL = 'veo-3.1-generate-lite-preview';

// ── generateIntroVideo ────────────────────────────────────────────────────────

describe('generateIntroVideo — Lite model, no audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
    mockGenerateVideos.mockResolvedValue(makeDoneOperation());
  });

  it('calls generateVideos with the Lite model', async () => {
    await generateIntroVideo({ scenarioId: 'sc-001', scenarioTitle: '프로젝트 킥오프' });

    expect(mockGenerateVideos).toHaveBeenCalledTimes(1);
    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0]).toMatchObject({ model: LITE_MODEL });
  });

  it('calls generateVideos without a config block (generateAudio not supported by SDK)', async () => {
    await generateIntroVideo({ scenarioId: 'sc-001', scenarioTitle: '프로젝트 킥오프' });

    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0].config?.generateAudio).toBeUndefined();
  });

  it('returns success: true with a non-empty videoUrl', async () => {
    const result = await generateIntroVideo({
      scenarioId: 'sc-001',
      scenarioTitle: '프로젝트 킥오프',
    });

    expect(result.success).toBe(true);
    expect(typeof result.videoUrl).toBe('string');
    expect(result.videoUrl!.length).toBeGreaterThan(0);
  });

  it('returns the Lite model name in metadata', async () => {
    const result = await generateIntroVideo({
      scenarioId: 'sc-001',
      scenarioTitle: '프로젝트 킥오프',
    });

    expect(result.metadata?.model).toBe(LITE_MODEL);
  });

  it('does not call getVideosOperation when operation is already done', async () => {
    await generateIntroVideo({ scenarioId: 'sc-001', scenarioTitle: '프로젝트 킥오프' });

    expect(mockGetVideosOperation).not.toHaveBeenCalled();
  });
});

// ── generateAvatarClip ────────────────────────────────────────────────────────

describe('generateAvatarClip — Lite model, no audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
    mockGenerateVideos.mockResolvedValue(makeDoneOperation());
  });

  it('calls generateVideos with the Lite model', async () => {
    await generateAvatarClip({ personaId: 'persona-x', state: 'idle' });

    expect(mockGenerateVideos).toHaveBeenCalledTimes(1);
    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0]).toMatchObject({ model: LITE_MODEL });
  });

  it('calls generateVideos without generateAudio in config (not supported by SDK)', async () => {
    await generateAvatarClip({ personaId: 'persona-x', state: 'speaking' });

    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0].config?.generateAudio).toBeUndefined();
  });

  it('returns success: true with a non-empty videoUrl', async () => {
    const result = await generateAvatarClip({ personaId: 'persona-x', state: 'listening' });

    expect(result.success).toBe(true);
    expect(typeof result.videoUrl).toBe('string');
    expect(result.videoUrl!.length).toBeGreaterThan(0);
  });

  it('returns the Lite model name in metadata', async () => {
    const result = await generateAvatarClip({ personaId: 'persona-x', state: 'thinking' });

    expect(result.metadata?.model).toBe(LITE_MODEL);
  });

  it('does not call getVideosOperation when operation is already done', async () => {
    await generateAvatarClip({ personaId: 'persona-x', state: 'idle' });

    expect(mockGetVideosOperation).not.toHaveBeenCalled();
  });

  it('uses the Lite model for all valid clip states without generateAudio', async () => {
    const VALID_STATES = [
      'idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause',
    ] as const;

    for (const state of VALID_STATES) {
      vi.clearAllMocks();
      mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
      mockGenerateVideos.mockResolvedValue(makeDoneOperation());

      await generateAvatarClip({ personaId: 'persona-x', state });

      const [args] = mockGenerateVideos.mock.calls;
      expect(args[0].config?.generateAudio).toBeUndefined();
      expect(args[0].model).toBe(LITE_MODEL);
    }
  });
});

// ── generateIntroVideo — error and timeout paths ──────────────────────────────

describe('generateIntroVideo — error and timeout paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success: false with a non-empty error when the operation resolves with result.error set', async () => {
    mockGenerateVideos.mockResolvedValue({
      name: 'operations/fake-error-op',
      done: true,
      error: { message: 'Veo content policy violation' },
      response: null,
    });

    const result = await generateIntroVideo({ scenarioId: 'sc-err', scenarioTitle: '오류 시나리오' });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('returns success: false when every poll attempt returns done: false (timeout path)', async () => {
    const neverDone = { name: 'operations/never-done', done: false, error: null, response: null };
    mockGenerateVideos.mockResolvedValue(neverDone);
    mockGetVideosOperation.mockResolvedValue(neverDone);

    const promise = generateIntroVideo({ scenarioId: 'sc-timeout', scenarioTitle: '타임아웃 시나리오' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ── generateAvatarClip — error and timeout paths ──────────────────────────────

describe('generateAvatarClip — error and timeout paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success: false with a non-empty error when the operation resolves with result.error set', async () => {
    mockGenerateVideos.mockResolvedValue({
      name: 'operations/fake-error-op',
      done: true,
      error: { message: 'Avatar generation failed due to policy' },
      response: null,
    });

    const result = await generateAvatarClip({ personaId: 'persona-x', state: 'idle' });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('returns success: false when every poll attempt returns done: false (timeout path)', async () => {
    const neverDone = { name: 'operations/never-done', done: false, error: null, response: null };
    mockGenerateVideos.mockResolvedValue(neverDone);
    mockGetVideosOperation.mockResolvedValue(neverDone);

    const promise = generateAvatarClip({ personaId: 'persona-x', state: 'speaking' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });
});
