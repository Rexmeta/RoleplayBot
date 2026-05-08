import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { EvaluationCriteriaSet } from '@shared/schema';

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────────────

vi.mock('../../server/storage', () => ({
  storage: {
    getEvaluationCriteriaSet: vi.fn(),
    getAllEvaluationCriteriaSets: vi.fn(),
    getActiveEvaluationCriteriaSets: vi.fn(),
    getDefaultEvaluationCriteriaSet: vi.fn(),
    getEvaluationCriteriaSetByCategory: vi.fn(),
    createEvaluationCriteriaSet: vi.fn(),
    updateEvaluationCriteriaSet: vi.fn(),
    deleteEvaluationCriteriaSet: vi.fn(),
    setDefaultEvaluationCriteriaSet: vi.fn(),
    updateEvaluationCriteriaSetStatus: vi.fn(),
    getEvaluationCriteriaSetVersionHistory: vi.fn(),
    getEvaluationDimensionsByCriteriaSet: vi.fn(),
    createEvaluationDimension: vi.fn(),
    getEvaluationCriteriaSetWithDimensions: vi.fn(),
    getActiveEvaluationCriteriaSetWithDimensions: vi.fn(),
    getEvaluationCriteriaSetTranslation: vi.fn(),
    getEvaluationDimensionTranslation: vi.fn(),
    getActiveSupportedLanguages: vi.fn(),
    getCategory: vi.fn(),
  },
}));

vi.mock('../../server/services/evaluationEngine', () => ({
  validateEvaluationCriteriaSet: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  validateEvaluationDimension: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  calculateRubricQualityScore: vi.fn().mockReturnValue({
    totalScore: 92,
    breakdown: {
      scoreConsistency: { score: 20, maxScore: 20, issues: [] },
      weightAccuracy: { score: 20, maxScore: 20, issues: [] },
      behaviorAnchorSpecificity: { score: 25, maxScore: 25, issues: [] },
      rubricStageCompleteness: { score: 20, maxScore: 20, issues: [] },
      evaluationPromptQuality: { score: 7, maxScore: 15, issues: [] },
    },
    recommendations: [],
  }),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({})),
}));

// DB mock for direct storage-layer tests — supports fluent drizzle chains
vi.mock('../../server/storage/db', () => {
  const makeThenableChain = (resolveWith: unknown[]) => {
    const chain: Record<string, unknown> = {
      then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(resolveWith).then(resolve, reject);
      },
      catch(onRejected: (e: unknown) => unknown) {
        return Promise.resolve(resolveWith).catch(onRejected);
      },
    };
    for (const method of ['from', 'where', 'orderBy', 'limit', 'set', 'returning', 'values']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    return chain;
  };

  const dbMock = {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    _setSelectResult(rows: unknown[]) {
      dbMock.select.mockReturnValue(makeThenableChain(rows));
    },
    _setUpdateResult(rows: unknown[]) {
      dbMock.update.mockReturnValue(makeThenableChain(rows));
    },
  };

  return {
    db: dbMock,
    pool: {},
    checkDatabaseConnection: vi.fn().mockResolvedValue(true),
  };
});

// ─── Imports (after mock declarations) ───────────────────────────────────────

import { storage } from '../../server/storage';
import createEvaluationCriteriaRouter from '../../server/routes/evaluationCriteria';
import { AnalyticsMixin } from '../../server/storage/analytics';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSet(overrides: Partial<EvaluationCriteriaSet> = {}): EvaluationCriteriaSet {
  return {
    id: 'set-1',
    name: 'Test Rubric',
    description: null,
    isDefault: false,
    isActive: true,
    categoryId: null,
    createdBy: null,
    ownerOperatorId: null,
    status: 'draft',
    approvedBy: null,
    approvedAt: null,
    version: 1,
    parentSetId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user: { id: string; role: string } }).user = { id: 'admin-user', role: 'admin' };
    next();
  };

  const router = createEvaluationCriteriaRouter(isAuthenticated);
  app.use(router);

  app.use((err: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return app;
}

// ─── API Endpoint Tests (router-level, storage mocked) ───────────────────────

describe('Rubric Approval Workflow — API Endpoints', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([]);
    vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([makeSet()]);
  });

  // ─── request-review ─────────────────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/request-review', () => {
    it('transitions a draft rubric to review status', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'draft' }));
      vi.mocked(storage.updateEvaluationCriteriaSetStatus).mockResolvedValue(makeSet({ status: 'review' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/request-review');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('review');
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).toHaveBeenCalledWith('set-1', 'review');
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).post('/api/admin/evaluation-criteria/nonexistent/request-review');

      expect(res.status).toBe(404);
    });

    it('blocks request-review on an already-approved rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'approved' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/request-review');

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).not.toHaveBeenCalled();
    });

    it('blocks request-review on an archived rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'archived' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/request-review');

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).not.toHaveBeenCalled();
    });
  });

  // ─── approve ────────────────────────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/approve', () => {
    it('approves a rubric in review status and records the approver', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'review' }));
      vi.mocked(storage.updateEvaluationCriteriaSetStatus).mockResolvedValue(
        makeSet({ status: 'approved', approvedBy: 'admin-user', approvedAt: new Date() }),
      );

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/approve');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).toHaveBeenCalledWith(
        'set-1', 'approved', 'admin-user',
      );
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).post('/api/admin/evaluation-criteria/nonexistent/approve');

      expect(res.status).toBe(404);
    });

    it('blocks approval when status is draft (not review)', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'draft' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/approve');

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).not.toHaveBeenCalled();
    });

    it('blocks approval when rubric is already approved', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'approved' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/approve');

      expect(res.status).toBe(400);
    });

    it('blocks approval when rubric is archived', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'archived' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/approve');

      expect(res.status).toBe(400);
    });
  });

  // ─── reject ─────────────────────────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/reject', () => {
    it('reverts a review-status rubric back to draft', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'review' }));
      vi.mocked(storage.updateEvaluationCriteriaSetStatus).mockResolvedValue(makeSet({ status: 'draft' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/reject');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('draft');
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).toHaveBeenCalledWith('set-1', 'draft');
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).post('/api/admin/evaluation-criteria/nonexistent/reject');

      expect(res.status).toBe(404);
    });

    it('blocks rejection when status is draft (not in review)', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'draft' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/reject');

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).not.toHaveBeenCalled();
    });

    it('blocks rejection when status is approved', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'approved' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/reject');

      expect(res.status).toBe(400);
    });
  });

  // ─── archive ────────────────────────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/archive', () => {
    it('archives an approved rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'approved' }));
      vi.mocked(storage.updateEvaluationCriteriaSetStatus).mockResolvedValue(makeSet({ status: 'archived' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/archive');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('archived');
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).toHaveBeenCalledWith('set-1', 'archived');
    });

    it('archives a draft rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'draft' }));
      vi.mocked(storage.updateEvaluationCriteriaSetStatus).mockResolvedValue(makeSet({ status: 'archived' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/archive');

      expect(res.status).toBe(200);
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).post('/api/admin/evaluation-criteria/nonexistent/archive');

      expect(res.status).toBe(404);
    });

    it('prevents archiving the default rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(
        makeSet({ status: 'approved', isDefault: true }),
      );

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/archive');

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.updateEvaluationCriteriaSetStatus)).not.toHaveBeenCalled();
    });
  });

  // ─── fork-version ───────────────────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/fork-version', () => {
    it('forks an approved rubric into a new draft at the next version number', async () => {
      const approved = makeSet({ id: 'set-1', status: 'approved', version: 1 });
      const forked = makeSet({ id: 'set-2', status: 'draft', version: 2, parentSetId: 'set-1' });

      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(approved);
      vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([approved]);
      vi.mocked(storage.createEvaluationCriteriaSet).mockResolvedValue(forked);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([]);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/fork-version');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('draft');
      expect(res.body.version).toBe(2);
      expect(vi.mocked(storage.createEvaluationCriteriaSet)).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', version: 2, parentSetId: 'set-1' }),
      );
    });

    it('increments version above the maximum across all existing versions', async () => {
      const approved = makeSet({ id: 'set-1', status: 'approved', version: 1 });
      const existingV2 = makeSet({ id: 'set-2', status: 'archived', version: 2, parentSetId: 'set-1' });
      const newV3 = makeSet({ id: 'set-3', status: 'draft', version: 3, parentSetId: 'set-1' });

      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(approved);
      vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([approved, existingV2]);
      vi.mocked(storage.createEvaluationCriteriaSet).mockResolvedValue(newV3);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([]);

      await request(app).post('/api/admin/evaluation-criteria/set-1/fork-version');

      expect(vi.mocked(storage.createEvaluationCriteriaSet)).toHaveBeenCalledWith(
        expect.objectContaining({ version: 3 }),
      );
    });

    it('copies existing dimensions into the forked version', async () => {
      const approved = makeSet({ id: 'set-1', status: 'approved' });
      const forked = makeSet({ id: 'set-2', status: 'draft', version: 2, parentSetId: 'set-1' });
      const dim = {
        id: 'dim-1', criteriaSetId: 'set-1', key: 'clarity', name: 'Clarity',
        description: null, icon: '🎯', color: 'blue', weight: 20, dimensionType: 'standard',
        minScore: 1, maxScore: 10, scoringRubric: null, evaluationPrompt: null,
        displayOrder: 0, isActive: true, createdAt: new Date(),
      };
      const forkedDim = { ...dim, id: 'dim-2', criteriaSetId: 'set-2' };

      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(approved);
      vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([approved]);
      vi.mocked(storage.createEvaluationCriteriaSet).mockResolvedValue(forked);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([dim]);
      vi.mocked(storage.createEvaluationDimension).mockResolvedValue(forkedDim);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/fork-version');

      expect(res.status).toBe(200);
      expect(vi.mocked(storage.createEvaluationDimension)).toHaveBeenCalledOnce();
      expect(vi.mocked(storage.createEvaluationDimension)).toHaveBeenCalledWith(
        expect.objectContaining({ criteriaSetId: 'set-2', key: 'clarity' }),
      );
      expect(res.body.dimensions).toHaveLength(1);
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).post('/api/admin/evaluation-criteria/nonexistent/fork-version');

      expect(res.status).toBe(404);
    });

    it('blocks fork when rubric is not approved (draft)', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'draft' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/fork-version');

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.createEvaluationCriteriaSet)).not.toHaveBeenCalled();
    });

    it('blocks fork when rubric is in review status', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'review' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/fork-version');

      expect(res.status).toBe(400);
    });
  });

  // ─── version history ────────────────────────────────────────────────────────

  describe('GET /api/admin/evaluation-criteria/:id/versions', () => {
    it('returns all versions sharing the same root when queried from the root set', async () => {
      const root = makeSet({ id: 'root', version: 1 });
      const v2 = makeSet({ id: 'set-2', version: 2, parentSetId: 'root' });
      const v3 = makeSet({ id: 'set-3', version: 3, parentSetId: 'root' });

      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(root);
      vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([root, v2, v3]);

      const res = await request(app).get('/api/admin/evaluation-criteria/root/versions');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(vi.mocked(storage.getEvaluationCriteriaSetVersionHistory)).toHaveBeenCalledWith('root');
    });

    it('resolves to the root id when querying from a child version', async () => {
      const child = makeSet({ id: 'set-2', version: 2, parentSetId: 'root' });
      const root = makeSet({ id: 'root', version: 1 });
      const v3 = makeSet({ id: 'set-3', version: 3, parentSetId: 'root' });

      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(child);
      vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([root, child, v3]);

      const res = await request(app).get('/api/admin/evaluation-criteria/set-2/versions');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(vi.mocked(storage.getEvaluationCriteriaSetVersionHistory)).toHaveBeenCalledWith('root');
    });

    it('returns a single-item array when there is only one version', async () => {
      const solo = makeSet({ id: 'solo', version: 1, parentSetId: null });
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(solo);
      vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([solo]);

      const res = await request(app).get('/api/admin/evaluation-criteria/solo/versions');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).get('/api/admin/evaluation-criteria/nonexistent/versions');

      expect(res.status).toBe(404);
    });
  });

  // ─── set-default guard ──────────────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/set-default', () => {
    it('allows setting default on an approved rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'approved' }));
      vi.mocked(storage.setDefaultEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/set-default');

      expect(res.status).toBe(200);
      expect(vi.mocked(storage.setDefaultEvaluationCriteriaSet)).toHaveBeenCalledWith('set-1');
    });

    it('blocks setting default on a draft rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'draft' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/set-default');

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.setDefaultEvaluationCriteriaSet)).not.toHaveBeenCalled();
    });

    it('blocks setting default on a review-status rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'review' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/set-default');

      expect(res.status).toBe(400);
    });

    it('blocks setting default on an archived rubric', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'archived' }));

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/set-default');

      expect(res.status).toBe(400);
    });
  });

  // ─── Operator Scope Enforcement ───────────────────────────────────────────

  describe('Operator scope — access control (category-scoped)', () => {
    function buildOperatorApp(assignedCategoryId: string | null, assignedOrganizationId?: string | null) {
      const operatorApp = express();
      operatorApp.use(express.json());
      const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (req as any).user = {
          id: 'op-1',
          role: 'operator',
          assignedCategoryId,
          assignedOrganizationId: assignedOrganizationId ?? null,
        };
        next();
      };
      const router = createEvaluationCriteriaRouter(auth);
      operatorApp.use(router);
      operatorApp.use((err: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(err.status ?? 500).json({ error: err.message });
      });
      return operatorApp;
    }

    it('allows category-scoped operator to access rubric in their category', async () => {
      const catApp = buildOperatorApp('cat-1');
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ id: 'set-1', status: 'draft', categoryId: 'cat-1' }));
      vi.mocked(storage.getEvaluationCriteriaSetWithDimensions).mockResolvedValue(makeSet({ id: 'set-1', status: 'draft', categoryId: 'cat-1' }) as any);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([]);

      const res = await request(catApp).get('/api/admin/evaluation-criteria/set-1');

      expect(res.status).toBe(200);
    });

    it('blocks category-scoped operator from accessing rubric in a different category', async () => {
      const catApp = buildOperatorApp('cat-1');
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ id: 'set-1', status: 'draft', categoryId: 'cat-OTHER' }));
      vi.mocked(storage.getEvaluationCriteriaSetWithDimensions).mockResolvedValue(makeSet({ categoryId: 'cat-OTHER' }) as any);

      const res = await request(catApp).get('/api/admin/evaluation-criteria/set-1');

      expect(res.status).toBe(403);
    });

    it('blocks category-scoped operator from accessing a null-category (global) rubric', async () => {
      const catApp = buildOperatorApp('cat-1');
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ id: 'set-1', categoryId: null }));
      vi.mocked(storage.getEvaluationCriteriaSetWithDimensions).mockResolvedValue(makeSet({ categoryId: null }) as any);

      const res = await request(catApp).get('/api/admin/evaluation-criteria/set-1');

      expect(res.status).toBe(403);
    });

    it('blocks category-scoped operator from creating a rubric with null categoryId', async () => {
      const catApp = buildOperatorApp('cat-1');

      const res = await request(catApp)
        .post('/api/admin/evaluation-criteria')
        .send({ name: 'Test', categoryId: null });

      expect(res.status).toBe(403);
    });

    it('blocks category-scoped operator from creating a rubric in a different category', async () => {
      const catApp = buildOperatorApp('cat-1');

      const res = await request(catApp)
        .post('/api/admin/evaluation-criteria')
        .send({ name: 'Test', categoryId: 'cat-OTHER' });

      expect(res.status).toBe(403);
    });

    it('blocks operator from approving a rubric (admin-only)', async () => {
      const catApp = buildOperatorApp('cat-1');
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'review', categoryId: 'cat-1' }));

      const res = await request(catApp).post('/api/admin/evaluation-criteria/set-1/approve');

      expect(res.status).toBe(403);
    });

    it('blocks operator from rejecting a rubric (admin-only)', async () => {
      const catApp = buildOperatorApp('cat-1');
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'review', categoryId: 'cat-1' }));

      const res = await request(catApp).post('/api/admin/evaluation-criteria/set-1/reject');

      expect(res.status).toBe(403);
    });

    it('blocks org-scoped operator from accessing a null-category (global) rubric', async () => {
      const orgApp = buildOperatorApp(null, 'org-1');
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ id: 'set-1', categoryId: null }));
      vi.mocked(storage.getEvaluationCriteriaSetWithDimensions).mockResolvedValue(makeSet({ categoryId: null }) as any);

      const res = await request(orgApp).get('/api/admin/evaluation-criteria/set-1');

      expect(res.status).toBe(403);
    });

    it('blocks org-scoped operator from creating a rubric with null categoryId', async () => {
      const orgApp = buildOperatorApp(null, 'org-1');

      const res = await request(orgApp)
        .post('/api/admin/evaluation-criteria')
        .send({ name: 'Test', categoryId: null });

      expect(res.status).toBe(403);
    });

    it('org-scoped operator list is filtered to their org categories only', async () => {
      const orgApp = buildOperatorApp(null, 'org-1');
      const inScopeSet = makeSet({ id: 'in-scope', categoryId: 'cat-org1' });
      const outScopeSet = makeSet({ id: 'out-scope', categoryId: 'cat-other' });
      vi.mocked(storage.getAllEvaluationCriteriaSets).mockResolvedValue([inScopeSet, outScopeSet]);
      vi.mocked(storage.getCategory)
        .mockImplementation(async (id: string) => {
          if (id === 'cat-org1') return { id: 'cat-org1', organizationId: 'org-1' } as any;
          if (id === 'cat-other') return { id: 'cat-other', organizationId: 'org-2' } as any;
          return null;
        });

      const res = await request(orgApp).get('/api/admin/evaluation-criteria');

      expect(res.status).toBe(200);
      const ids = res.body.map((s: any) => s.id);
      expect(ids).toContain('in-scope');
      expect(ids).not.toContain('out-scope');
    });
  });
});

// ─── Storage-layer Tests (direct AnalyticsMixin invocation, DB mocked) ────────

// Import the db mock so tests can configure its return values per scenario.
// Using dynamic import inside the describe keeps things readable while still
// benefiting from the module-level vi.mock() hoisting above.

type DbMock = {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  _setSelectResult(rows: EvaluationCriteriaSet[]): void;
  _setUpdateResult(rows: EvaluationCriteriaSet[]): void;
};

describe('Storage-layer — AnalyticsMixin direct invocation', () => {
  const TestStorage = AnalyticsMixin(class {});
  let store: InstanceType<typeof TestStorage>;
  let dbMock: DbMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new TestStorage();
    const { db } = await import('../../server/storage/db');
    dbMock = db as unknown as DbMock;
  });

  // ── getDefaultEvaluationCriteriaSet ────────────────────────────────────────
  // The query includes a WHERE clause: isDefault=true AND isActive=true AND
  // (status='approved' OR status IS NULL). These tests verify both the happy
  // path and the exclusion path (DB returns no rows because draft/review/archived
  // rows were filtered by the WHERE clause).

  describe('getDefaultEvaluationCriteriaSet', () => {
    it('returns the approved default set when one exists', async () => {
      const approvedDefault = makeSet({ isDefault: true, isActive: true, status: 'approved' });
      dbMock._setSelectResult([approvedDefault]);

      const result = await store.getDefaultEvaluationCriteriaSet();

      expect(result).toEqual(approvedDefault);
    });

    it('returns the legacy null-status default set (pre-workflow rubrics)', async () => {
      const legacyDefault = makeSet({ isDefault: true, isActive: true, status: null as unknown as string });
      dbMock._setSelectResult([legacyDefault]);

      const result = await store.getDefaultEvaluationCriteriaSet();

      expect(result).toEqual(legacyDefault);
    });

    it('returns undefined when DB yields an empty result set', async () => {
      dbMock._setSelectResult([]);

      const result = await store.getDefaultEvaluationCriteriaSet();

      expect(result).toBeUndefined();
    });

    it('returns the first result when multiple rows are returned', async () => {
      const first = makeSet({ id: 'first', status: 'approved', isDefault: true, isActive: true });
      const second = makeSet({ id: 'second', status: 'approved', isDefault: true, isActive: true });
      dbMock._setSelectResult([first, second]);

      const result = await store.getDefaultEvaluationCriteriaSet();

      expect(result?.id).toBe('first');
    });

    // Exclusion-path tests: simulate the DB applying the approval WHERE clause
    // and returning no rows because the default set has a non-qualifying status.
    it('returns undefined when the default set is in draft status (excluded by approval filter)', async () => {
      // The WHERE clause (status='approved' OR status IS NULL) excludes draft rows.
      // DB returns empty — simulating that the draft record was filtered out.
      dbMock._setSelectResult([]);

      const result = await store.getDefaultEvaluationCriteriaSet();

      expect(result).toBeUndefined();
    });

    it('returns undefined when the default set is in review status (excluded by approval filter)', async () => {
      dbMock._setSelectResult([]);

      const result = await store.getDefaultEvaluationCriteriaSet();

      expect(result).toBeUndefined();
    });

    it('returns undefined when the default set is archived (excluded by approval filter)', async () => {
      dbMock._setSelectResult([]);

      const result = await store.getDefaultEvaluationCriteriaSet();

      expect(result).toBeUndefined();
    });

    it('passes a WHERE predicate to the database query', async () => {
      dbMock._setSelectResult([]);

      await store.getDefaultEvaluationCriteriaSet();

      // Verify a WHERE clause was applied — i.e. the chain's where() was invoked
      // with at least one argument (the approval predicate object).
      const chain = vi.mocked(dbMock.select).mock.results[0].value;
      const whereArgs = chain.where.mock.calls[0] as unknown[];
      expect(whereArgs.length).toBeGreaterThan(0);
      expect(whereArgs[0]).toBeDefined();
    });
  });

  // ── getEvaluationCriteriaSetByCategory ─────────────────────────────────────
  // WHERE clause: categoryId=? AND isActive=true AND (status='approved' OR status IS NULL).
  // Exclusion-path tests simulate the DB filtering out draft/review/archived rows.

  describe('getEvaluationCriteriaSetByCategory', () => {
    it('returns the approved set for the requested category', async () => {
      const approvedForCat = makeSet({ categoryId: 'cat-1', isActive: true, status: 'approved' });
      dbMock._setSelectResult([approvedForCat]);

      const result = await store.getEvaluationCriteriaSetByCategory('cat-1');

      expect(result).toEqual(approvedForCat);
    });

    it('returns the legacy null-status set for the requested category', async () => {
      const legacyForCat = makeSet({ categoryId: 'cat-1', isActive: true, status: null as unknown as string });
      dbMock._setSelectResult([legacyForCat]);

      const result = await store.getEvaluationCriteriaSetByCategory('cat-1');

      expect(result).toEqual(legacyForCat);
    });

    it('returns undefined when DB yields an empty result for the category', async () => {
      dbMock._setSelectResult([]);

      const result = await store.getEvaluationCriteriaSetByCategory('cat-1');

      expect(result).toBeUndefined();
    });

    it('returns undefined for a draft category set (excluded by approval filter)', async () => {
      // The approval WHERE clause filters out draft rows — DB returns empty.
      dbMock._setSelectResult([]);

      const result = await store.getEvaluationCriteriaSetByCategory('cat-1');

      expect(result).toBeUndefined();
    });

    it('returns undefined for a review-status category set (excluded by approval filter)', async () => {
      dbMock._setSelectResult([]);

      const result = await store.getEvaluationCriteriaSetByCategory('cat-1');

      expect(result).toBeUndefined();
    });

    it('returns undefined for an archived category set (excluded by approval filter)', async () => {
      dbMock._setSelectResult([]);

      const result = await store.getEvaluationCriteriaSetByCategory('cat-1');

      expect(result).toBeUndefined();
    });

    it('passes a WHERE predicate to the database query', async () => {
      dbMock._setSelectResult([]);

      await store.getEvaluationCriteriaSetByCategory('cat-1');

      const chain = vi.mocked(dbMock.select).mock.results[0].value;
      const whereArgs = chain.where.mock.calls[0] as unknown[];
      expect(whereArgs.length).toBeGreaterThan(0);
      expect(whereArgs[0]).toBeDefined();
    });
  });

  // ── updateEvaluationCriteriaSetStatus ──────────────────────────────────────

  describe('updateEvaluationCriteriaSetStatus', () => {
    it('sets status to review without setting approvedBy or approvedAt', async () => {
      const updated = makeSet({ id: 'set-1', status: 'review' });
      dbMock._setUpdateResult([updated]);

      const result = await store.updateEvaluationCriteriaSetStatus('set-1', 'review');

      expect(result.status).toBe('review');

      const setCall = vi.mocked(dbMock.update).mock.results[0].value.set as ReturnType<typeof vi.fn>;
      const setArg = setCall.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.status).toBe('review');
      expect(setArg).not.toHaveProperty('approvedBy');
      expect(setArg).not.toHaveProperty('approvedAt');
    });

    it('sets approvedBy and approvedAt when transitioning to approved', async () => {
      const updated = makeSet({ id: 'set-1', status: 'approved', approvedBy: 'user-99' });
      dbMock._setUpdateResult([updated]);

      const result = await store.updateEvaluationCriteriaSetStatus('set-1', 'approved', 'user-99');

      expect(result.status).toBe('approved');

      const setCall = vi.mocked(dbMock.update).mock.results[0].value.set as ReturnType<typeof vi.fn>;
      const setArg = setCall.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.status).toBe('approved');
      expect(setArg.approvedBy).toBe('user-99');
      expect(setArg.approvedAt).toBeInstanceOf(Date);
    });

    it('stores null for approvedBy when no approver is supplied on approve', async () => {
      const updated = makeSet({ status: 'approved', approvedBy: null });
      dbMock._setUpdateResult([updated]);

      await store.updateEvaluationCriteriaSetStatus('set-1', 'approved');

      const setCall = vi.mocked(dbMock.update).mock.results[0].value.set as ReturnType<typeof vi.fn>;
      const setArg = setCall.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.approvedBy).toBeNull();
    });

    it('sets status to draft without setting approvedBy or approvedAt', async () => {
      const updated = makeSet({ status: 'draft' });
      dbMock._setUpdateResult([updated]);

      await store.updateEvaluationCriteriaSetStatus('set-1', 'draft');

      const setCall = vi.mocked(dbMock.update).mock.results[0].value.set as ReturnType<typeof vi.fn>;
      const setArg = setCall.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.status).toBe('draft');
      expect(setArg).not.toHaveProperty('approvedBy');
      expect(setArg).not.toHaveProperty('approvedAt');
    });

    it('sets status to archived without setting approvedBy or approvedAt', async () => {
      const updated = makeSet({ status: 'archived' });
      dbMock._setUpdateResult([updated]);

      await store.updateEvaluationCriteriaSetStatus('set-1', 'archived');

      const setCall = vi.mocked(dbMock.update).mock.results[0].value.set as ReturnType<typeof vi.fn>;
      const setArg = setCall.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.status).toBe('archived');
      expect(setArg).not.toHaveProperty('approvedBy');
      expect(setArg).not.toHaveProperty('approvedAt');
    });

    it('always updates the updatedAt timestamp', async () => {
      const updated = makeSet({ status: 'review' });
      dbMock._setUpdateResult([updated]);

      await store.updateEvaluationCriteriaSetStatus('set-1', 'review');

      const setCall = vi.mocked(dbMock.update).mock.results[0].value.set as ReturnType<typeof vi.fn>;
      const setArg = setCall.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.updatedAt).toBeInstanceOf(Date);
    });

    it('returns the persisted record from the database', async () => {
      const persistedRecord = makeSet({ id: 'set-42', status: 'approved', approvedBy: 'u1' });
      dbMock._setUpdateResult([persistedRecord]);

      const result = await store.updateEvaluationCriteriaSetStatus('set-42', 'approved', 'u1');

      expect(result).toEqual(persistedRecord);
    });
  });

  // ── getEvaluationCriteriaSetVersionHistory ─────────────────────────────────

  describe('getEvaluationCriteriaSetVersionHistory', () => {
    it('returns all versions including the root and its children', async () => {
      const root = makeSet({ id: 'root', version: 1, parentSetId: null });
      const v2 = makeSet({ id: 'v2', version: 2, parentSetId: 'root' });
      const v3 = makeSet({ id: 'v3', version: 3, parentSetId: 'root' });
      dbMock._setSelectResult([root, v2, v3]);

      const results = await store.getEvaluationCriteriaSetVersionHistory('root');

      expect(results).toHaveLength(3);
      expect(results.map(r => r.id)).toEqual(['root', 'v2', 'v3']);
    });

    it('returns an empty array when the root has no versions', async () => {
      dbMock._setSelectResult([]);

      const results = await store.getEvaluationCriteriaSetVersionHistory('nonexistent');

      expect(results).toEqual([]);
    });

    it('returns a single-item array for a standalone rubric with no children', async () => {
      const standalone = makeSet({ id: 'solo', version: 1, parentSetId: null });
      dbMock._setSelectResult([standalone]);

      const results = await store.getEvaluationCriteriaSetVersionHistory('solo');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('solo');
    });

    it('returns versions spanning multiple statuses (draft, review, approved, archived)', async () => {
      const sets = [
        makeSet({ id: 'v1', version: 1, status: 'archived', parentSetId: null }),
        makeSet({ id: 'v2', version: 2, status: 'approved', parentSetId: 'v1' }),
        makeSet({ id: 'v3', version: 3, status: 'review', parentSetId: 'v1' }),
        makeSet({ id: 'v4', version: 4, status: 'draft', parentSetId: 'v1' }),
      ];
      dbMock._setSelectResult(sets);

      const results = await store.getEvaluationCriteriaSetVersionHistory('v1');

      expect(results).toHaveLength(4);
      expect(results.map(r => r.status)).toEqual(['archived', 'approved', 'review', 'draft']);
    });
  });
});
