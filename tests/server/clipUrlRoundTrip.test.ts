/**
 * Tests for the video-clip URL round-trip:
 *   POST generate-clip → background auto-save → GET personas → toMediaUrl()
 *
 * Covers:
 *   1. Full round-trip: the generate endpoint fires the background job which
 *      calls generateAvatarClip, gets back a raw storage key, and auto-saves it
 *      via storage.updateMbtiPersona.
 *   2. Reload path: GET /api/admin/personas returns the stored raw storage key;
 *      applying toMediaUrl() on the client converts it to a browser-accessible URL.
 *   3. toMediaUrl() unit cases: all URL formats the API might return are handled.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { toMediaUrl } from '../../client/src/lib/mediaUrl';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockGenerateAvatarClip = vi.hoisted(() => vi.fn());
const mockGetAllMBTIPersonas  = vi.hoisted(() => vi.fn());
const mockGetMbtiPersona      = vi.hoisted(() => vi.fn());
const mockUpdateMbtiPersona   = vi.hoisted(() => vi.fn());
const mockVideoJobStore = vi.hoisted(() => ({
  create:     vi.fn(),
  get:        vi.fn(),
  setRunning: vi.fn(),
  setDone:    vi.fn(),
  setError:   vi.fn(),
}));

vi.mock('../../server/middleware/authMiddleware', () => ({
  isOperatorOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getAllPersonaTranslationLocales: vi.fn().mockResolvedValue([]),
    getMbtiPersona:    mockGetMbtiPersona,
    updateMbtiPersona: mockUpdateMbtiPersona,
  },
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getAllMBTIPersonas:  mockGetAllMBTIPersonas,
    createMBTIPersona:  vi.fn(),
    updateMBTIPersona:  vi.fn(),
    deleteMBTIPersona:  vi.fn(),
    getAllScenarios:     vi.fn().mockResolvedValue([]),
  },
}));

// Replit-mode pass-through: raw storage keys are returned unchanged by the server.
vi.mock('../../server/services/gcsStorage', () => ({
  transformPersonasMedia:    vi.fn().mockImplementation((p: any) => Promise.resolve(p)),
  transformPersonaMedia:     vi.fn().mockImplementation((p: any) => Promise.resolve(p)),
  safeTransformToSignedUrl:  vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}));

vi.mock('../../server/services/gemini-video-generator', () => ({
  generateAvatarClip: mockGenerateAvatarClip,
}));

vi.mock('../../server/utils/videoJobStore', () => ({
  videoJobStore: mockVideoJobStore,
}));

// ─── Import router after mocks ────────────────────────────────────────────────
import createAdminPersonasRouter from '../../server/routes/adminPersonas';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAuthenticated(_req: any, _res: any, next: any) { next(); }

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createAdminPersonasRouter(isAuthenticated));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

/** Wait for the setImmediate background job and its mocked async calls to finish. */
function waitForBackground(): Promise<void> {
  return new Promise(resolve => setImmediate(() => setTimeout(resolve, 20)));
}

const PERSONA_ID   = 'persona-abc';
const RAW_CLIP_KEY = 'videos/avatar-persona-abc-male-idle-uuid.webm';

// ─── Section 1: Full generate → auto-save round-trip ─────────────────────────

describe('Full clip generate → auto-save → reload round-trip', () => {
  const STORED_PERSONA_BASE = {
    id: PERSONA_ID,
    videos: { enabled: true, avatarId: PERSONA_ID, clips: {} },
    images: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default job-store behavior
    mockVideoJobStore.create.mockReturnValue({
      jobId: 'job-1', status: 'pending', createdAt: Date.now(),
    });

    // generateAvatarClip returns a raw storage key (the actual path written to GCS)
    mockGenerateAvatarClip.mockResolvedValue({
      success: true,
      videoUrl: RAW_CLIP_KEY,
    });

    // storage.getMbtiPersona returns the base persona so the auto-save can update it
    mockGetMbtiPersona.mockResolvedValue({ ...STORED_PERSONA_BASE });

    // storage.updateMbtiPersona resolves successfully
    mockUpdateMbtiPersona.mockResolvedValue({ ...STORED_PERSONA_BASE });
  });

  it('POST generate-clip returns 202 and then auto-saves the raw storage key via storage.updateMbtiPersona', async () => {
    await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle', gender: 'male' });

    // Wait for the setImmediate background job + mocked async awaits to settle
    await waitForBackground();

    // The clip must have been persisted with the raw storage key
    expect(mockUpdateMbtiPersona).toHaveBeenCalledTimes(1);
    const [savedId, savedPayload] = mockUpdateMbtiPersona.mock.calls[0];
    expect(savedId).toBe(PERSONA_ID);
    expect(savedPayload.videos.clips.male.idle).toBe(RAW_CLIP_KEY);
  });

  it('the auto-saved raw storage key is accessible in the browser via toMediaUrl()', async () => {
    await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle', gender: 'male' });

    await waitForBackground();

    // Extract whatever was persisted
    const savedClipKey: string = mockUpdateMbtiPersona.mock.calls[0][1].videos.clips.male.idle;

    // The client calls toMediaUrl() at render time — the result must be a
    // browser-accessible /objects URL, not a bare key that would 404.
    const rendered = toMediaUrl(savedClipKey);
    expect(rendered).toMatch(/^\/objects\?key=/);
    expect(rendered).not.toBe(savedClipKey);
  });

  it('reload path: GET /api/admin/personas returns the stored clip; toMediaUrl() makes it accessible', async () => {
    // 1. Simulate generation completing and saving the clip
    await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle', gender: 'male' });

    await waitForBackground();

    // 2. Build the "post-save" persona that the DB would return on reload
    const savedClips = mockUpdateMbtiPersona.mock.calls[0][1].videos.clips;
    const personaAfterSave = {
      id: PERSONA_ID,
      mbti: 'INTJ',
      videos: { enabled: true, avatarId: PERSONA_ID, clips: savedClips },
      images: {},
    };

    // 3. GET /api/admin/personas simulates the page reload
    mockGetAllMBTIPersonas.mockResolvedValue([personaAfterSave]);
    const res = await request(buildApp()).get('/api/admin/personas');

    expect(res.status).toBe(200);
    const persona = res.body.find((p: any) => p.id === PERSONA_ID);
    expect(persona).toBeDefined();

    const clipUrl: string = persona.videos.clips.male.idle;
    expect(clipUrl).toBe(RAW_CLIP_KEY);

    // 4. toMediaUrl() must convert it to a browser-accessible path
    expect(toMediaUrl(clipUrl)).toMatch(/^\/objects\?key=/);
    expect(toMediaUrl(clipUrl)).not.toBe(clipUrl);
  });

  it('auto-save does not run when generateAvatarClip reports failure', async () => {
    mockGenerateAvatarClip.mockResolvedValue({
      success: false,
      error: '비디오 생성 실패',
    });

    await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle', gender: 'male' });

    await waitForBackground();

    expect(mockUpdateMbtiPersona).not.toHaveBeenCalled();
  });

  it('auto-save is skipped when the persona cannot be found in the DB', async () => {
    mockGetMbtiPersona.mockResolvedValue(null);

    await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle', gender: 'male' });

    await waitForBackground();

    expect(mockUpdateMbtiPersona).not.toHaveBeenCalled();
  });
});

// ─── Section 2: toMediaUrl() — clip URL formats the API may return ─────────────

describe('toMediaUrl — clip URL formats returned by the API', () => {
  it('converts a raw GCS storage key (videos/…) to /objects?key=…', () => {
    expect(toMediaUrl('videos/avatar-ac-male-idle-abc123.webm'))
      .toBe('/objects?key=videos%2Favatar-ac-male-idle-abc123.webm');
  });

  it('passes a signed HTTPS URL through unchanged (Cloud Run path)', () => {
    const signedUrl =
      'https://storage.googleapis.com/bucket/videos/clip.webm?X-Goog-Signature=abc';
    expect(toMediaUrl(signedUrl)).toBe(signedUrl);
  });

  it('a signed URL is NOT double-wrapped in /objects?key=', () => {
    const signedUrl =
      'https://storage.googleapis.com/bucket/videos/clip.webm?X-Goog-Signature=abc';
    expect(toMediaUrl(signedUrl)).not.toContain('/objects?key=');
  });

  it('strips query strings from a raw key before building /objects?key=', () => {
    expect(toMediaUrl('videos/clip.webm?t=1234567890'))
      .toBe('/objects?key=videos%2Fclip.webm');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(toMediaUrl(null)).toBe('');
    expect(toMediaUrl(undefined)).toBe('');
    expect(toMediaUrl('')).toBe('');
  });

  it('all six clip states produce accessible /objects URLs when stored as raw keys', () => {
    const states = ['idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause'];
    for (const state of states) {
      const url = toMediaUrl(`videos/avatar-persona-male-${state}-abc.webm`);
      expect(url).toMatch(/^\/objects\?key=/);
    }
  });
});
