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

import { mediaStorage } from '../../server/services/mediaStorage';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal done-operation response with one video whose bytes are inline. */
function makeDoneOperation() {
  // Payload starts with the EBML magic (0x1A45DFA3) so the intro pipeline's
  // WebM check passes it through without invoking a real ffmpeg transcode.
  const fakeBase64 = btoa('\x1a\x45\xdf\xa3\x00\x01\x02');
  return {
    name: 'operations/fake-op-id',
    done: true,
    error: null,
    response: {
      generatedVideos: [{ video: { videoBytes: fakeBase64 } }],
    },
  };
}

const LITE_MODEL = 'veo-3.1-lite-generate-preview';

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

  it('does not send config.personGeneration (not supported by Gemini API)', async () => {
    await generateIntroVideo({ scenarioId: 'sc-001', scenarioTitle: '프로젝트 킥오프' });

    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0].config?.personGeneration).toBeUndefined();
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
    await generateAvatarClip({ personaId: 'persona-x', behavior: 'listening' });

    expect(mockGenerateVideos).toHaveBeenCalledTimes(1);
    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0]).toMatchObject({ model: LITE_MODEL });
  });

  it('calls generateVideos without generateAudio in config (not supported by SDK)', async () => {
    await generateAvatarClip({ personaId: 'persona-x', behavior: 'speaking' });

    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0].config?.generateAudio).toBeUndefined();
  });

  it('does not send config.personGeneration (not supported by Gemini API)', async () => {
    await generateAvatarClip({ personaId: 'persona-x', behavior: 'listening' });

    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0].config?.personGeneration).toBeUndefined();
  });

  it('returns success: true with a non-empty videoUrl', async () => {
    const result = await generateAvatarClip({ personaId: 'persona-x', behavior: 'listening' });

    expect(result.success).toBe(true);
    expect(typeof result.videoUrl).toBe('string');
    expect(result.videoUrl!.length).toBeGreaterThan(0);
  });

  it('returns the Lite model name in metadata', async () => {
    const result = await generateAvatarClip({ personaId: 'persona-x', behavior: 'listening', emotion: 'positive' });

    expect(result.metadata?.model).toBe(LITE_MODEL);
  });

  it('does not call getVideosOperation when operation is already done', async () => {
    await generateAvatarClip({ personaId: 'persona-x', behavior: 'listening' });

    expect(mockGetVideosOperation).not.toHaveBeenCalled();
  });

  it('uses the Lite model for every behaviour × emotion slot without generateAudio', async () => {
    const BEHAVIORS = ['listening', 'speaking'] as const;
    const EMOTIONS = ['positive', 'neutral', 'negative'] as const;

    for (const behavior of BEHAVIORS) for (const emotion of EMOTIONS) {
      vi.clearAllMocks();
      mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
      mockGenerateVideos.mockResolvedValue(makeDoneOperation());

      await generateAvatarClip({ personaId: 'persona-x', behavior, emotion });

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

    const result = await generateAvatarClip({ personaId: 'persona-x', behavior: 'listening' });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('returns success: false when every poll attempt returns done: false (timeout path)', async () => {
    const neverDone = { name: 'operations/never-done', done: false, error: null, response: null };
    mockGenerateVideos.mockResolvedValue(neverDone);
    mockGetVideosOperation.mockResolvedValue(neverDone);

    const promise = generateAvatarClip({ personaId: 'persona-x', behavior: 'speaking' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  });
});

// ── generateAvatarClip — seed image fallback ──────────────────────────────────

describe('generateAvatarClip — seed image fallback when neutralImageUrl is provided', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
    mockGenerateVideos.mockResolvedValue(makeDoneOperation());
  });

  it('still calls generateVideos without an image param when readImageBuffer throws', async () => {
    vi.mocked(mediaStorage.readImageBuffer).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );

    const result = await generateAvatarClip({
      personaId: 'persona-x',
      behavior: 'listening',
      neutralImageUrl: '/images/persona-x-neutral.jpg',
    });

    expect(mockGenerateVideos).toHaveBeenCalledTimes(1);
    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0].image).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('still calls generateVideos without an image param when readImageBuffer returns null', async () => {
    vi.mocked(mediaStorage.readImageBuffer).mockResolvedValueOnce(null);

    const result = await generateAvatarClip({
      personaId: 'persona-x',
      behavior: 'listening',
      neutralImageUrl: '/images/persona-x-neutral.jpg',
    });

    expect(mockGenerateVideos).toHaveBeenCalledTimes(1);
    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0].image).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('forwards the seed image to generateVideos when readImageBuffer returns a valid buffer', async () => {
    const fakeBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // non-empty JPEG-like bytes
    vi.mocked(mediaStorage.readImageBuffer).mockResolvedValueOnce(fakeBuffer);

    const result = await generateAvatarClip({
      personaId: 'persona-x',
      behavior: 'listening',
      neutralImageUrl: '/images/persona-x-neutral.jpg',
    });

    expect(mockGenerateVideos).toHaveBeenCalledTimes(1);
    const [args] = mockGenerateVideos.mock.calls;

    // image (first frame) must be present with base64 payload + mimeType
    expect(args[0].image).toBeDefined();
    expect(typeof args[0].image.imageBytes).toBe('string');
    expect(args[0].image.imageBytes.length).toBeGreaterThan(0);
    expect(args[0].image.imageBytes).toBe(fakeBuffer.toString('base64'));
    expect(typeof args[0].image.mimeType).toBe('string');
    expect(args[0].image.mimeType.length).toBeGreaterThan(0);

    expect(result.success).toBe(true);
  });
});
