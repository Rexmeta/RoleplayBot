/**
 * Unit tests for per-persona / per-scenario video model override precedence.
 *
 * Verifies that:
 * 1. When `modelOverride` is set, it is used and `getModelForFeature` is NOT called.
 * 2. When `modelOverride` is absent or empty, `getModelForFeature('video')` is used.
 *
 * No real Veo API calls are made — the GoogleGenAI SDK is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock refs ───────────────────────────────────────────────────────────
const { mockGetModelForFeature, mockGenerateVideos } = vi.hoisted(() => ({
  mockGetModelForFeature: vi.fn().mockResolvedValue('veo-3.1-lite-generate-preview'),
  mockGenerateVideos: vi.fn(),
}));

// ── GoogleGenAI: must use regular function so `new` works ─────────────────────
vi.mock('@google/genai', () => {
  const fakeOp = {
    done: true,
    response: {
      generatedVideos: [{ video: { videoBytes: 'AA==' } }],
    },
  };
  mockGenerateVideos.mockResolvedValue(fakeOp);
  return {
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: { generateVideos: mockGenerateVideos },
        operations: { getVideosOperation: vi.fn().mockResolvedValue(fakeOp) },
      };
    }),
  };
});

// ── mediaStorage ──────────────────────────────────────────────────────────────
vi.mock('../../server/services/mediaStorage', () => ({
  mediaStorage: {
    saveVideo: vi.fn().mockResolvedValue('/scenarios/videos/test.webm'),
    readImageBuffer: vi.fn().mockResolvedValue(null),
  },
}));

// ── aiUsageTracker ────────────────────────────────────────────────────────────
vi.mock('../../server/services/aiUsageTracker', () => ({
  trackVideoUsage: vi.fn(),
}));

// ── aiServiceFactory.getModelForFeature ──────────────────────────────────────
vi.mock('../../server/services/aiServiceFactory', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/aiServiceFactory')>();
  return { ...original, getModelForFeature: mockGetModelForFeature };
});

process.env.GEMINI_API_KEY = 'test-key';

import { generateIntroVideo, generateAvatarClip } from '../../server/services/gemini-video-generator';

// ─────────────────────────────────────────────────────────────────────────────

function resetMocks() {
  mockGetModelForFeature.mockReset().mockResolvedValue('veo-3.1-lite-generate-preview');
  const fakeOp = {
    done: true,
    response: { generatedVideos: [{ video: { videoBytes: 'AA==' } }] },
  };
  mockGenerateVideos.mockReset().mockResolvedValue(fakeOp);
}

describe('Video model override – generateIntroVideo', () => {
  beforeEach(resetMocks);

  it('uses modelOverride and does NOT call getModelForFeature', async () => {
    await generateIntroVideo({
      scenarioId: 'test-scenario',
      scenarioTitle: 'Test Scenario',
      modelOverride: 'veo-3.1-generate-preview',
    });

    expect(mockGetModelForFeature).not.toHaveBeenCalled();
    const callArgs = mockGenerateVideos.mock.calls[0]?.[0];
    expect(callArgs?.model).toBe('veo-3.1-generate-preview');
  });

  it('falls back to getModelForFeature when modelOverride is absent', async () => {
    await generateIntroVideo({
      scenarioId: 'test-scenario',
      scenarioTitle: 'Test Scenario',
    });

    expect(mockGetModelForFeature).toHaveBeenCalledWith('video');
  });

  it('falls back to getModelForFeature when modelOverride is empty string', async () => {
    await generateIntroVideo({
      scenarioId: 'test-scenario',
      scenarioTitle: 'Test Scenario',
      modelOverride: '',
    });

    expect(mockGetModelForFeature).toHaveBeenCalledWith('video');
  });
});

describe('Video model override – generateAvatarClip', () => {
  beforeEach(resetMocks);

  it('uses modelOverride and does NOT call getModelForFeature', async () => {
    await generateAvatarClip({
      personaId: 'test-persona',
      behavior: 'listening',
      modelOverride: 'veo-3.1-generate-preview',
    });

    expect(mockGetModelForFeature).not.toHaveBeenCalled();
    const callArgs = mockGenerateVideos.mock.calls[0]?.[0];
    expect(callArgs?.model).toBe('veo-3.1-generate-preview');
  });

  it('falls back to getModelForFeature when modelOverride is absent', async () => {
    await generateAvatarClip({
      personaId: 'test-persona',
      behavior: 'listening',
    });

    expect(mockGetModelForFeature).toHaveBeenCalledWith('avatar_video');
  });

  it('falls back to getModelForFeature when modelOverride is empty string', async () => {
    await generateAvatarClip({
      personaId: 'test-persona',
      behavior: 'listening',
      modelOverride: '',
    });

    expect(mockGetModelForFeature).toHaveBeenCalledWith('avatar_video');
  });
});
