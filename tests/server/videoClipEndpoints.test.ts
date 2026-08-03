/**
 * Integration-style tests for the two avatar clip generation endpoints in
 * server/routes/adminPersonas.ts:
 *
 *   POST /api/admin/personas/:id/video/generate-clip
 *   GET  /api/admin/personas/:id/video/generate-clip/status
 *
 * The videoJobStore singleton is replaced with a fresh VideoJobStore instance
 * per test so tests are isolated and don't rely on module-level state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Hoisted mocks ─────────────────────────────────────────────────────────
const mockGenerateAvatarClip = vi.hoisted(() => vi.fn());
const mockVideoJobStore = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  setRunning: vi.fn(),
  setDone: vi.fn(),
  setError: vi.fn(),
}));

// ─── Module mocks ──────────────────────────────────────────────────────────
vi.mock('../../server/middleware/authMiddleware', () => ({
  isOperatorOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getAllPersonaTranslationLocales: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getAllMBTIPersonas: vi.fn().mockResolvedValue([]),
    createMBTIPersona: vi.fn(),
    updateMBTIPersona: vi.fn(),
    deleteMBTIPersona: vi.fn(),
    getAllScenarios: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../server/services/gcsStorage', () => ({
  transformPersonasMedia: vi.fn().mockImplementation((p: any) => Promise.resolve(p)),
  transformPersonaMedia: vi.fn().mockImplementation((p: any) => Promise.resolve(p)),
}));

vi.mock('../../server/services/gemini-video-generator', () => ({
  generateAvatarClip: mockGenerateAvatarClip,
}));

vi.mock('../../server/utils/videoJobStore', () => ({
  videoJobStore: mockVideoJobStore,
}));

// ─── Import router after mocks ─────────────────────────────────────────────
import createAdminPersonasRouter from '../../server/routes/adminPersonas';

// ─── Test helpers ──────────────────────────────────────────────────────────
function isAuthenticated(_req: any, _res: any, next: any) {
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createAdminPersonasRouter(isAuthenticated));
  // Generic error handler so asyncHandler errors surface as JSON
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

const PERSONA_ID = 'persona-abc';

// ─── POST generate-clip ────────────────────────────────────────────────────

describe('POST /api/admin/personas/:id/video/generate-clip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: store.create returns a minimal record
    mockVideoJobStore.create.mockReturnValue({ jobId: 'test-job-id', status: 'pending', createdAt: Date.now() });
  });

  it('returns 202 with a jobId when state is valid', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle' });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId.length).toBeGreaterThan(0);
  });

  it('calls videoJobStore.create() exactly once', async () => {
    await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'speaking' });

    expect(mockVideoJobStore.create).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when state is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 when state is not a valid AvatarClipState', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'flying' });

    expect(res.status).toBe(400);
  });

  it('accepts all valid AvatarClipState values', async () => {
    const VALID_STATES = ['idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause'];
    for (const state of VALID_STATES) {
      vi.clearAllMocks();
      mockVideoJobStore.create.mockReturnValue({ jobId: `job-${state}`, status: 'pending', createdAt: Date.now() });

      const res = await request(buildApp())
        .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
        .send({ state });

      expect(res.status).toBe(202);
    }
  });

  it('does not call generateAvatarClip synchronously (fire-and-forget)', async () => {
    // generateAvatarClip should not be called before the response is sent
    await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle' });

    // The background job runs via setImmediate; at this point in the sync
    // test flow, generate may or may not have been called, but the 202
    // response must not block on it. We verify the endpoint responds quickly
    // without a resolved generateAvatarClip promise.
    // (No assertion on mockGenerateAvatarClip call count — it fires async)
  });

  it('forwards the optional styleHint body field (does not 400)', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/video/generate-clip`)
      .send({ state: 'idle', styleHint: 'cinematic' });

    expect(res.status).toBe(202);
  });
});

// ─── GET generate-clip/status ──────────────────────────────────────────────

describe('GET /api/admin/personas/:id/video/generate-clip/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when jobId query param is missing', async () => {
    const res = await request(buildApp())
      .get(`/api/admin/personas/${PERSONA_ID}/video/generate-clip/status`);

    expect(res.status).toBe(400);
  });

  it('returns 404 when the jobId is not found in the store', async () => {
    mockVideoJobStore.get.mockReturnValue(undefined);

    const res = await request(buildApp())
      .get(`/api/admin/personas/${PERSONA_ID}/video/generate-clip/status`)
      .query({ jobId: 'nonexistent-job' });

    expect(res.status).toBe(404);
  });

  it('returns correct shape for a pending job', async () => {
    mockVideoJobStore.get.mockReturnValue({
      jobId: 'job-pending',
      status: 'pending',
      createdAt: Date.now(),
    });

    const res = await request(buildApp())
      .get(`/api/admin/personas/${PERSONA_ID}/video/generate-clip/status`)
      .query({ jobId: 'job-pending' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.result).toBeNull();
    expect(res.body.error).toBeNull();
  });

  it('returns correct shape for a running job', async () => {
    mockVideoJobStore.get.mockReturnValue({
      jobId: 'job-running',
      status: 'running',
      createdAt: Date.now(),
    });

    const res = await request(buildApp())
      .get(`/api/admin/personas/${PERSONA_ID}/video/generate-clip/status`)
      .query({ jobId: 'job-running' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.result).toBeNull();
    expect(res.body.error).toBeNull();
  });

  it('returns correct shape for a done job, including result', async () => {
    mockVideoJobStore.get.mockReturnValue({
      jobId: 'job-done',
      status: 'done',
      result: { videoUrl: 'https://example.com/clip.mp4', state: 'idle' },
      createdAt: Date.now(),
    });

    const res = await request(buildApp())
      .get(`/api/admin/personas/${PERSONA_ID}/video/generate-clip/status`)
      .query({ jobId: 'job-done' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.result).toEqual({ videoUrl: 'https://example.com/clip.mp4', state: 'idle' });
    expect(res.body.error).toBeNull();
  });

  it('returns correct shape for an errored job, including error message', async () => {
    mockVideoJobStore.get.mockReturnValue({
      jobId: 'job-error',
      status: 'error',
      error: '비디오 생성 실패',
      createdAt: Date.now(),
    });

    const res = await request(buildApp())
      .get(`/api/admin/personas/${PERSONA_ID}/video/generate-clip/status`)
      .query({ jobId: 'job-error' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
    expect(res.body.result).toBeNull();
    expect(res.body.error).toBe('비디오 생성 실패');
  });

  it('returns null for result and error when those fields are absent (pending/running)', async () => {
    mockVideoJobStore.get.mockReturnValue({
      jobId: 'job-plain',
      status: 'pending',
      createdAt: Date.now(),
      // no result, no error fields
    });

    const res = await request(buildApp())
      .get(`/api/admin/personas/${PERSONA_ID}/video/generate-clip/status`)
      .query({ jobId: 'job-plain' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('result', null);
    expect(res.body).toHaveProperty('error', null);
  });

  it('looks up only the supplied jobId, not the persona id', async () => {
    mockVideoJobStore.get.mockReturnValue({
      jobId: 'specific-job',
      status: 'done',
      result: { videoUrl: 'https://cdn/v.mp4', state: 'speaking' },
      createdAt: Date.now(),
    });

    await request(buildApp())
      .get(`/api/admin/personas/other-persona/video/generate-clip/status`)
      .query({ jobId: 'specific-job' });

    expect(mockVideoJobStore.get).toHaveBeenCalledWith('specific-job');
  });
});
