/**
 * Tests that `generateIntroVideo` and `generateAvatarClip` correctly forward
 * the Lite model name and `generateAudio: false` to the Veo API, and that
 * both functions return a non-empty videoUrl on success.
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  it('calls generateVideos with generateAudio: false', async () => {
    await generateIntroVideo({ scenarioId: 'sc-001', scenarioTitle: '프로젝트 킥오프' });

    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0]).toMatchObject({ config: { generateAudio: false } });
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

  it('calls generateVideos with generateAudio: false', async () => {
    await generateAvatarClip({ personaId: 'persona-x', state: 'speaking' });

    const [args] = mockGenerateVideos.mock.calls;
    expect(args[0]).toMatchObject({ config: { generateAudio: false } });
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

  it('passes generateAudio: false for all valid clip states', async () => {
    const VALID_STATES = [
      'idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause',
    ] as const;

    for (const state of VALID_STATES) {
      vi.clearAllMocks();
      mockGetModelForFeature.mockResolvedValue(LITE_MODEL);
      mockGenerateVideos.mockResolvedValue(makeDoneOperation());

      await generateAvatarClip({ personaId: 'persona-x', state });

      const [args] = mockGenerateVideos.mock.calls;
      expect(args[0].config?.generateAudio).toBe(false);
      expect(args[0].model).toBe(LITE_MODEL);
    }
  });
});
