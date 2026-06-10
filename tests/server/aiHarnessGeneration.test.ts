/**
 * Unit tests for the AI harness/constraints generation endpoints:
 *   POST /api/admin/generate-evaluation-harness
 *   POST /api/admin/generate-player-constraints
 *
 * Mocks GoogleGenAI and the two AI generator functions so no live API key is needed.
 * Endpoints now respond with SSE (text/event-stream) — helper parseSseResult() extracts payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { EvaluationHarness, PlayerConstraints } from '@shared/schema/scenarios';

// ─── Hoist mocks before any imports ──────────────────────────────────────────

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../server/services/aiScenarioGenerator', () => ({
  generateScenarioWithAI: vi.fn(),
  enhanceScenarioWithAI: vi.fn(),
  fillScenarioFieldsWithAI: vi.fn(),
  generateEvaluationHarnessWithAI: vi.fn(),
  generatePlayerConstraintsWithAI: vi.fn(),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getOperatorAssignment: vi.fn().mockResolvedValue(null),
    getUser: vi.fn(),
  },
  db: {},
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getAllScenarios: vi.fn().mockResolvedValue([]),
    getScenario: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../server/services/gemini-video-generator', () => ({
  generateIntroVideo: vi.fn(),
  deleteIntroVideo: vi.fn(),
  getVideoGenerationStatus: vi.fn(),
  getDefaultVideoPrompt: vi.fn(),
}));

vi.mock('../../server/routes/imageGeneration', () => ({
  generateImagePrompt: vi.fn(),
}));

vi.mock('../../server/services/gcsStorage', () => ({
  transformScenariosMedia: vi.fn(async (s: unknown) => s),
  transformScenarioMedia: vi.fn(async (s: unknown) => s),
  transformToSignedUrl: vi.fn(async (u: unknown) => u),
  listGCSFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../server/middleware/authMiddleware', () => ({
  isOperatorOrAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../server/services/scenarios/scenarioValidator', () => ({
  validateScenario: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock('../../server/services/mediaStorage', () => ({
  mediaStorage: {
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}));

vi.mock('../../server/services/aiServiceFactory', () => ({
  getModelForFeature: vi.fn().mockResolvedValue('gemini-2.5-flash'),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { generateEvaluationHarnessWithAI, generatePlayerConstraintsWithAI } from '../../server/services/aiScenarioGenerator';
import createAdminScenariosRouter from '../../server/routes/adminScenarios';

// ─── SSE helper ───────────────────────────────────────────────────────────────

/**
 * Parse the SSE text/event-stream body and return the first non-heartbeat payload.
 * Returns null if no such event is found.
 */
function parseSseResult(text: string): Record<string, any> | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (!raw) continue;
    try {
      const payload = JSON.parse(raw);
      if (payload.type !== 'heartbeat') return payload;
    } catch { continue; }
  }
  return null;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_HARNESS: EvaluationHarness = {
  dimensions: [
    {
      key: 'clarity',
      weight: 3,
      scenarioSpecificDefinition: 'Communicates the issue clearly and concisely.',
      positiveSignals: ['Uses clear language', 'Structures the message well'],
      negativeSignals: ['Speaks vaguely', 'Contradicts earlier statements'],
    },
    {
      key: 'empathy',
      weight: 2,
      scenarioSpecificDefinition: 'Acknowledges counterpart feelings.',
      positiveSignals: ['Validates emotions'],
      negativeSignals: ['Dismisses concerns'],
    },
  ],
  passingRule: {
    minAverageScore: 60,
    requiredDimensions: [{ key: 'clarity', minScore: 50 }],
  },
};

const VALID_CONSTRAINTS: PlayerConstraints = {
  authorityLevel: 'Team lead — no budget approval rights',
  canOffer: ['Extended deadline', 'Additional resources'],
  cannotOffer: ['Salary increase', 'Permanent policy change'],
  requiredBehaviors: ['Acknowledge the problem', 'Propose a concrete action plan'],
  forbiddenBehaviors: ['Make promises outside authority', 'Blame other teams'],
};

// ─── App factory ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as any).user = { id: 'admin-user', role: 'admin' };
    next();
  };

  const router = createAdminScenariosRouter(isAuthenticated);
  app.use(router);

  app.use(
    (
      err: { status?: number; message: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.status ?? 500).json({ error: err.message });
    },
  );

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/generate-evaluation-harness', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it('returns 400 when both title and description are omitted', async () => {
    const res = await request(app)
      .post('/api/admin/generate-evaluation-harness')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  it('returns 400 when title is empty string and description is absent', async () => {
    const res = await request(app)
      .post('/api/admin/generate-evaluation-harness')
      .send({ title: '' });

    expect(res.status).toBe(400);
  });

  it('returns 200 with properly shaped evaluationHarness for valid context', async () => {
    vi.mocked(generateEvaluationHarnessWithAI).mockResolvedValue(VALID_HARNESS);

    const res = await request(app)
      .post('/api/admin/generate-evaluation-harness')
      .send({ title: 'Project Delay Negotiation', description: 'Handle a delayed delivery scenario' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(payload?.success).toBe(true);
    expect(payload?.evaluationHarness).toEqual(VALID_HARNESS);
  });

  it('accepts context with only title (no description)', async () => {
    vi.mocked(generateEvaluationHarnessWithAI).mockResolvedValue(VALID_HARNESS);

    const res = await request(app)
      .post('/api/admin/generate-evaluation-harness')
      .send({ title: 'Conflict Resolution' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(payload?.evaluationHarness?.dimensions).toHaveLength(2);
  });

  it('accepts context with only description (no title)', async () => {
    vi.mocked(generateEvaluationHarnessWithAI).mockResolvedValue(VALID_HARNESS);

    const res = await request(app)
      .post('/api/admin/generate-evaluation-harness')
      .send({ description: 'A customer complaint escalation scenario' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(payload?.evaluationHarness?.passingRule?.minAverageScore).toBe(60);
  });

  it('forwards optional fields (objectives, situation, playerRole) to the generator', async () => {
    vi.mocked(generateEvaluationHarnessWithAI).mockResolvedValue(VALID_HARNESS);

    const payload = {
      title: 'Supply Crisis',
      objectives: ['Negotiate new delivery date', 'Maintain supplier relationship'],
      situation: 'Supplier missed critical shipment',
      playerRole: { position: 'Manager', department: 'Procurement', experience: '5 years', responsibility: 'Vendor management' },
    };

    await request(app).post('/api/admin/generate-evaluation-harness').send(payload);

    expect(vi.mocked(generateEvaluationHarnessWithAI)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Supply Crisis',
        objectives: payload.objectives,
        situation: payload.situation,
        playerRole: payload.playerRole,
      }),
    );
  });

  it('streams an error event when the AI generator throws', async () => {
    vi.mocked(generateEvaluationHarnessWithAI).mockRejectedValue(
      new Error('AI가 반환한 evaluationHarness 형식이 잘못되었습니다: Invalid enum value'),
    );

    const res = await request(app)
      .post('/api/admin/generate-evaluation-harness')
      .send({ title: 'Bad AI Response' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(payload?.type).toBe('error');
    expect(payload?.message).toMatch(/evaluationHarness/i);
  });
});

describe('POST /api/admin/generate-player-constraints', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it('returns 400 when both title and description are omitted', async () => {
    const res = await request(app)
      .post('/api/admin/generate-player-constraints')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  it('returns 400 when title is empty string and description is absent', async () => {
    const res = await request(app)
      .post('/api/admin/generate-player-constraints')
      .send({ title: '' });

    expect(res.status).toBe(400);
  });

  it('returns 200 with properly shaped playerConstraints for valid context', async () => {
    vi.mocked(generatePlayerConstraintsWithAI).mockResolvedValue(VALID_CONSTRAINTS);

    const res = await request(app)
      .post('/api/admin/generate-player-constraints')
      .send({ title: 'Delivery Negotiation', description: 'Negotiate a delayed delivery timeline' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(payload?.success).toBe(true);
    expect(payload?.playerConstraints).toEqual(VALID_CONSTRAINTS);
  });

  it('accepts context with only title (no description)', async () => {
    vi.mocked(generatePlayerConstraintsWithAI).mockResolvedValue(VALID_CONSTRAINTS);

    const res = await request(app)
      .post('/api/admin/generate-player-constraints')
      .send({ title: 'Conflict Resolution' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(Array.isArray(payload?.playerConstraints?.canOffer)).toBe(true);
  });

  it('accepts context with only description (no title)', async () => {
    vi.mocked(generatePlayerConstraintsWithAI).mockResolvedValue(VALID_CONSTRAINTS);

    const res = await request(app)
      .post('/api/admin/generate-player-constraints')
      .send({ description: 'Customer service escalation' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(payload?.playerConstraints?.authorityLevel).toBeTruthy();
  });

  it('forwards optional fields (objectives, situation, playerRole) to the generator', async () => {
    vi.mocked(generatePlayerConstraintsWithAI).mockResolvedValue(VALID_CONSTRAINTS);

    const payload = {
      title: 'Budget Cut Discussion',
      objectives: ['Explain budget rationale', 'Retain team morale'],
      situation: 'Annual budget reduced by 20%',
      playerRole: { position: 'Director', department: 'Finance', experience: '10 years', responsibility: 'Budget allocation' },
    };

    await request(app).post('/api/admin/generate-player-constraints').send(payload);

    expect(vi.mocked(generatePlayerConstraintsWithAI)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Budget Cut Discussion',
        objectives: payload.objectives,
        situation: payload.situation,
        playerRole: payload.playerRole,
      }),
    );
  });

  it('streams an error event when the AI generator throws', async () => {
    vi.mocked(generatePlayerConstraintsWithAI).mockRejectedValue(
      new Error('AI가 반환한 playerConstraints 형식이 잘못되었습니다: Required field missing'),
    );

    const res = await request(app)
      .post('/api/admin/generate-player-constraints')
      .send({ title: 'Bad AI Response' });

    expect(res.status).toBe(200);
    const payload = parseSseResult(res.text);
    expect(payload?.type).toBe('error');
    expect(payload?.message).toMatch(/playerConstraints/i);
  });

  it('playerConstraints shape includes all expected keys', async () => {
    vi.mocked(generatePlayerConstraintsWithAI).mockResolvedValue(VALID_CONSTRAINTS);

    const res = await request(app)
      .post('/api/admin/generate-player-constraints')
      .send({ title: 'Any Scenario' });

    const payload = parseSseResult(res.text);
    const pc = payload?.playerConstraints as PlayerConstraints;
    expect(pc).toHaveProperty('authorityLevel');
    expect(pc).toHaveProperty('canOffer');
    expect(pc).toHaveProperty('cannotOffer');
    expect(pc).toHaveProperty('requiredBehaviors');
    expect(pc).toHaveProperty('forbiddenBehaviors');
    expect(Array.isArray(pc.canOffer)).toBe(true);
    expect(Array.isArray(pc.cannotOffer)).toBe(true);
    expect(Array.isArray(pc.requiredBehaviors)).toBe(true);
    expect(Array.isArray(pc.forbiddenBehaviors)).toBe(true);
  });
});
