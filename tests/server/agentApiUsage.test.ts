import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks must be declared before any import of the modules they replace ──────

vi.mock('../../server/storage', () => {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
  };
  return {
    db: { select: vi.fn().mockReturnValue(chain) },
    storage: {},
  };
});

vi.mock('../../server/middleware/agentApiKeyMiddleware', () => ({
  attachAgentRequestId: (req: any, res: any, next: any) => {
    req.agentRequestId = 'req_test';
    res.setHeader('X-Request-Id', 'req_test');
    next();
  },
  isAgentApiKey: (req: any, _res: any, next: any) => {
    req.agentKey = { id: 'key-001', scopes: ['usage:read'], rateLimitPerMinute: 60 };
    req.agentOrgId = 'org-001';
    next();
  },
  requireScope: (_scope: string) => (_req: any, _res: any, next: any) => next(),
  agentError: (res: any, status: number, code: string, message: string, details?: any) => {
    res.status(status).json({ error: { code, message, details: details ?? null }, requestId: 'req_test' });
  },
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: { getAllScenarios: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../server/services/aiServiceFactory', () => ({
  generateAIResponse: vi.fn(),
}));

vi.mock('../../server/services/simulation/simulationEngine', () => ({
  applySimulationPatch: vi.fn(),
  getOrCreateSessionContext: vi.fn(),
  getSessionState: vi.fn(),
}));

vi.mock('../../server/services/simulation/simulationTypes', () => ({
  createDefaultSimulationState: vi.fn(),
}));

vi.mock('../../server/services/simulation/evaluateUserResponse', () => ({
  evaluateUserResponse: vi.fn(),
}));

vi.mock('../../server/routes/routerHelpers', () => ({
  generateAndSaveFeedback: vi.fn(),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import { db } from '../../server/storage';
import agentRouter from '../../server/routes/agentApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/agent', agentRouter);
  return app;
}

function makeDbChain(rows: any[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.select).mockReturnValue(chain as any);
  return chain;
}

function usageRow(overrides: Partial<{
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}> = {}) {
  return {
    date: '2026-05-10',
    requestCount: 1,
    inputTokens: 100,
    outputTokens: 200,
    totalTokens: 300,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/agent/usage', () => {
  let app: express.Express;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();
  });

  describe('default date range', () => {
    it('returns 200 with rows and summary when no date params are given', async () => {
      makeDbChain([usageRow()]);

      const res = await request(app).get('/api/v1/agent/usage');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('rows');
      expect(res.body).toHaveProperty('summary');
      expect(Array.isArray(res.body.rows)).toBe(true);
    });

    it('issues a db query using the current month as the default range', async () => {
      const chain = makeDbChain([]);

      await request(app).get('/api/v1/agent/usage');

      expect(db.select).toHaveBeenCalledOnce();
      expect(chain.from).toHaveBeenCalledOnce();
      expect(chain.where).toHaveBeenCalledOnce();
      expect(chain.orderBy).toHaveBeenCalledOnce();
    });
  });

  describe('custom from / to params', () => {
    it('returns 200 when valid from and to are provided', async () => {
      makeDbChain([usageRow({ date: '2026-04-15' })]);

      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2026-04-01', to: '2026-04-30' });

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].date).toBe('2026-04-15');
    });

    it('accepts a single-day range (from === to)', async () => {
      makeDbChain([usageRow({ date: '2026-05-01' })]);

      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2026-05-01', to: '2026-05-01' });

      expect(res.status).toBe(200);
    });
  });

  describe('reversed date range (from > to)', () => {
    it('returns 400 when from is strictly after to', async () => {
      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2026-05-31', to: '2026-05-01' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.message).toMatch(/from date must not be after to date/i);
    });

    it('does not call the database when dates are reversed', async () => {
      makeDbChain([]);

      await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2026-12-31', to: '2026-01-01' });

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('malformed date params', () => {
    it('returns 400 for a non-date from value', async () => {
      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: 'not-a-date', to: '2026-05-01' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 for a non-date to value', async () => {
      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2026-05-01', to: 'yesterday' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('returns 400 when from uses MM-DD-YYYY instead of YYYY-MM-DD', async () => {
      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '05-01-2026', to: '2026-05-31' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('does not call the database when params are malformed', async () => {
      makeDbChain([]);

      await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: 'bad', to: 'worse' });

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('empty result set', () => {
    it('returns rows:[] and zero-value summary when no usage records exist', async () => {
      makeDbChain([]);

      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2025-01-01', to: '2025-01-31' });

      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([]);
      expect(res.body.summary).toEqual({
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      });
    });
  });

  describe('multi-row summary aggregation', () => {
    it('sums requestCount, inputTokens, and outputTokens across all rows', async () => {
      makeDbChain([
        usageRow({ date: '2026-05-01', requestCount: 3, inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
        usageRow({ date: '2026-05-02', requestCount: 7, inputTokens: 400, outputTokens: 600, totalTokens: 1000 }),
        usageRow({ date: '2026-05-03', requestCount: 1, inputTokens: 50,  outputTokens: 50,  totalTokens: 100 }),
      ]);

      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2026-05-01', to: '2026-05-31' });

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(3);
      expect(res.body.summary).toEqual({
        totalRequests: 11,
        totalInputTokens: 550,
        totalOutputTokens: 850,
      });
    });

    it('preserves individual row fields in the rows array', async () => {
      const row1 = usageRow({ date: '2026-05-05', requestCount: 2, inputTokens: 10, outputTokens: 20, totalTokens: 30 });
      const row2 = usageRow({ date: '2026-05-06', requestCount: 4, inputTokens: 40, outputTokens: 60, totalTokens: 100 });
      makeDbChain([row1, row2]);

      const res = await request(app)
        .get('/api/v1/agent/usage')
        .query({ from: '2026-05-01', to: '2026-05-31' });

      expect(res.body.rows[0]).toMatchObject({
        date: '2026-05-05',
        requestCount: 2,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });
      expect(res.body.rows[1]).toMatchObject({
        date: '2026-05-06',
        requestCount: 4,
        inputTokens: 40,
        outputTokens: 60,
        totalTokens: 100,
      });
    });

    it('handles a single row summary correctly', async () => {
      makeDbChain([
        usageRow({ requestCount: 5, inputTokens: 123, outputTokens: 456, totalTokens: 579 }),
      ]);

      const res = await request(app).get('/api/v1/agent/usage');

      expect(res.body.summary).toEqual({
        totalRequests: 5,
        totalInputTokens: 123,
        totalOutputTokens: 456,
      });
    });
  });
});
