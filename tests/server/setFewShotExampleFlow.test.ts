import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { EvaluationCriteriaSet } from '@shared/schema';

// ─── Mocks (hoisted by vitest) ────────────────────────────────────────────────

vi.mock('../../server/storage', () => ({
  storage: {
    getEvaluationCriteriaSet: vi.fn(),
    getEvaluationCriteriaSetVersionHistory: vi.fn(),
    getEvaluationDimensionsByCriteriaSet: vi.fn(),
    updateEvaluationDimension: vi.fn(),
    getAllFeedbacks: vi.fn(),
    getCategory: vi.fn(),
    createCriteriaSetFewShotExample: vi.fn(),
    getCriteriaSetFewShotExampleById: vi.fn(),
    getCriteriaSetFewShotExamples: vi.fn(),
    getActiveCriteriaSetFewShotExamples: vi.fn(),
    updateCriteriaSetFewShotExample: vi.fn(),
    deleteCriteriaSetFewShotExample: vi.fn(),
  },
}));

vi.mock('../../server/services/evaluationEngine', () => ({
  validateEvaluationCriteriaSet: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  validateEvaluationDimension: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  calculateRubricQualityScore: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../server/services/aiServiceFactory', () => ({
  generateFeedback: vi.fn(),
  getAIServiceForFeature: vi.fn(),
  getModelForFeature: vi.fn().mockResolvedValue('gemini-2.5-flash'),
}));

vi.mock('../../server/services/aiUsageTracker', () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/middleware/tokenQuotaMiddleware', () => ({
  checkTokenQuota: vi.fn((_req: any, _res: any, next: any) => next()),
}));

// ─── Imports (after mock declarations) ───────────────────────────────────────

import { storage } from '../../server/storage';
import createEvaluationCriteriaRouter from '../../server/routes/evaluationCriteria';
import { getAIServiceForFeature } from '../../server/services/aiServiceFactory';
import { trackUsage } from '../../server/services/aiUsageTracker';

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
  } as EvaluationCriteriaSet;
}

function makeDimension(overrides: Record<string, any> = {}) {
  return {
    id: 'dim-1',
    criteriaSetId: 'set-1',
    key: 'clarityLogic',
    name: '명확성 & 논리성',
    description: '의사 표현의 명확성',
    icon: '🎯',
    color: 'blue',
    weight: 20,
    dimensionType: 'standard',
    minScore: 1,
    maxScore: 10,
    scoringRubric: null,
    evaluationPrompt: null,
    displayOrder: 0,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeExample(overrides: Record<string, any> = {}) {
  return {
    id: 'ex-1',
    criteriaSetId: 'set-1',
    sourceFeedbackId: null,
    context: null,
    transcript: '사용자: 안녕하세요\nAI: 반갑습니다',
    dimensionScores: [
      { key: 'clarityLogic', name: '명확성 & 논리성', score: 8, rationale: '명확했음' },
    ],
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildApp(role: string = 'admin') {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user: { id: string; role: string } }).user = { id: 'admin-user', role };
    next();
  };

  const router = createEvaluationCriteriaRouter(isAuthenticated);
  app.use(router);

  app.use((err: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return app;
}

describe('Set-level Few-shot Example → Dimension Criteria Inference Flow', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  // ─── GET set-few-shot-examples ────────────────────────────────────────────

  describe('GET /api/admin/evaluation-criteria/:id/set-few-shot-examples', () => {
    it('returns the list of few-shot examples for the set', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());
      vi.mocked(storage.getCriteriaSetFewShotExamples).mockResolvedValue([makeExample()] as any);

      const res = await request(app).get('/api/admin/evaluation-criteria/set-1/set-few-shot-examples');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(vi.mocked(storage.getCriteriaSetFewShotExamples)).toHaveBeenCalledWith('set-1');
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).get('/api/admin/evaluation-criteria/nonexistent/set-few-shot-examples');

      expect(res.status).toBe(404);
    });
  });

  // ─── POST set-few-shot-examples ───────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/set-few-shot-examples', () => {
    it('creates a manual few-shot example with valid dimension scores', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());
      vi.mocked(storage.createCriteriaSetFewShotExample).mockResolvedValue(makeExample() as any);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples')
        .send({
          context: '고객 응대 상황',
          transcript: '사용자: 안녕하세요\nAI: 반갑습니다',
          dimensionScores: [
            { key: 'clarityLogic', name: '명확성 & 논리성', score: 8, rationale: '명확했음' },
          ],
        });

      expect(res.status).toBe(201);
      expect(vi.mocked(storage.createCriteriaSetFewShotExample)).toHaveBeenCalledWith(
        expect.objectContaining({
          criteriaSetId: 'set-1',
          transcript: '사용자: 안녕하세요\nAI: 반갑습니다',
          isActive: true,
        }),
      );
    });

    it('rejects when transcript is missing', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples')
        .send({ dimensionScores: [{ key: 'clarityLogic', name: 'x', score: 5 }] });

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.createCriteriaSetFewShotExample)).not.toHaveBeenCalled();
    });

    it('rejects when dimensionScores is empty', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples')
        .send({ transcript: '대화 내용', dimensionScores: [] });

      expect(res.status).toBe(400);
    });

    it('rejects when a dimensionScore entry has an out-of-range score', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples')
        .send({
          transcript: '대화 내용',
          dimensionScores: [{ key: 'clarityLogic', name: '명확성', score: 15 }],
        });

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.createCriteriaSetFewShotExample)).not.toHaveBeenCalled();
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/nonexistent/set-few-shot-examples')
        .send({ transcript: 'x', dimensionScores: [{ key: 'a', name: 'a', score: 5 }] });

      expect(res.status).toBe(404);
    });
  });

  // ─── from-feedback import ─────────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/set-few-shot-examples/from-feedback', () => {
    const dims = [
      makeDimension({ key: 'clarityLogic', name: '명확성 & 논리성' }),
      makeDimension({ id: 'dim-2', key: 'listeningEmpathy', name: '경청 & 공감' }),
    ];

    beforeEach(() => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());
      vi.mocked(storage.getEvaluationCriteriaSetVersionHistory).mockResolvedValue([makeSet()]);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue(dims as any);
    });

    it('imports a feedback into a few-shot example, mapping dimension keys and serializing the transcript', async () => {
      vi.mocked(storage.getAllFeedbacks).mockResolvedValue([
        {
          id: 'fb-1',
          rubricSnapshot: { id: 'set-1' },
          conversationSnapshot: [
            { role: 'user', content: '안녕하세요' },
            { role: 'assistant', content: '반갑습니다' },
          ],
          scores: [
            { category: 'clarityLogic', name: '명확성 & 논리성', score: 8.6, feedback: '명확하게 전달함' },
            { category: 'listeningEmpathy', name: '경청 & 공감', score: 4.2, feedback: '공감 부족' },
            { category: 'unknownDim', name: '알 수 없음', score: 5, feedback: '해당 없음' },
          ],
        },
      ] as any);
      vi.mocked(storage.createCriteriaSetFewShotExample).mockResolvedValue(makeExample() as any);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples/from-feedback')
        .send({ feedbackId: 'fb-1' });

      expect(res.status).toBe(201);
      expect(vi.mocked(storage.createCriteriaSetFewShotExample)).toHaveBeenCalledWith(
        expect.objectContaining({
          criteriaSetId: 'set-1',
          sourceFeedbackId: 'fb-1',
          transcript: '사용자: 안녕하세요\nAI: 반갑습니다',
          dimensionScores: [
            { key: 'clarityLogic', name: '명확성 & 논리성', score: 9, rationale: '명확하게 전달함' },
            { key: 'listeningEmpathy', name: '경청 & 공감', score: 4, rationale: '공감 부족' },
          ],
        }),
      );
    });

    it('rejects when feedbackId is missing', async () => {
      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples/from-feedback')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 when the feedback does not exist or is not part of the rubric family', async () => {
      vi.mocked(storage.getAllFeedbacks).mockResolvedValue([
        { id: 'fb-2', rubricSnapshot: { id: 'other-set' }, conversationSnapshot: [], scores: [] },
      ] as any);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples/from-feedback')
        .send({ feedbackId: 'fb-2' });

      expect(res.status).toBe(404);
      expect(vi.mocked(storage.createCriteriaSetFewShotExample)).not.toHaveBeenCalled();
    });

    it('rejects with 400 when none of the feedback scores match current dimension keys', async () => {
      vi.mocked(storage.getAllFeedbacks).mockResolvedValue([
        {
          id: 'fb-3',
          rubricSnapshot: { id: 'set-1' },
          conversationSnapshot: [{ role: 'user', content: '안녕' }],
          scores: [{ category: 'unrelatedDim', name: '무관', score: 5, feedback: '' }],
        },
      ] as any);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples/from-feedback')
        .send({ feedbackId: 'fb-3' });

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.createCriteriaSetFewShotExample)).not.toHaveBeenCalled();
    });

    it('falls back to "(대화 내역 없음)" when the conversation snapshot is empty', async () => {
      vi.mocked(storage.getAllFeedbacks).mockResolvedValue([
        {
          id: 'fb-4',
          rubricSnapshot: { id: 'set-1' },
          conversationSnapshot: [],
          scores: [{ category: 'clarityLogic', name: '명확성 & 논리성', score: 7, feedback: '괜찮음' }],
        },
      ] as any);
      vi.mocked(storage.createCriteriaSetFewShotExample).mockResolvedValue(makeExample() as any);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/set-few-shot-examples/from-feedback')
        .send({ feedbackId: 'fb-4' });

      expect(res.status).toBe(201);
      expect(vi.mocked(storage.createCriteriaSetFewShotExample)).toHaveBeenCalledWith(
        expect.objectContaining({ transcript: '(대화 내역 없음)' }),
      );
    });
  });

  // ─── PATCH / DELETE example ────────────────────────────────────────────────

  describe('PATCH /api/admin/evaluation-criteria/set-few-shot-examples/:exampleId', () => {
    it('updates a few-shot example', async () => {
      vi.mocked(storage.getCriteriaSetFewShotExampleById).mockResolvedValue(makeExample() as any);
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());
      vi.mocked(storage.updateCriteriaSetFewShotExample).mockResolvedValue(makeExample({ isActive: false }) as any);

      const res = await request(app)
        .patch('/api/admin/evaluation-criteria/set-few-shot-examples/ex-1')
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(vi.mocked(storage.updateCriteriaSetFewShotExample)).toHaveBeenCalledWith('ex-1', { isActive: false });
    });

    it('returns 404 when the example does not exist', async () => {
      vi.mocked(storage.getCriteriaSetFewShotExampleById).mockResolvedValue(undefined);

      const res = await request(app)
        .patch('/api/admin/evaluation-criteria/set-few-shot-examples/nonexistent')
        .send({ isActive: false });

      expect(res.status).toBe(404);
    });

    it('rejects an empty transcript update', async () => {
      vi.mocked(storage.getCriteriaSetFewShotExampleById).mockResolvedValue(makeExample() as any);
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());

      const res = await request(app)
        .patch('/api/admin/evaluation-criteria/set-few-shot-examples/ex-1')
        .send({ transcript: '   ' });

      expect(res.status).toBe(400);
      expect(vi.mocked(storage.updateCriteriaSetFewShotExample)).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/admin/evaluation-criteria/set-few-shot-examples/:exampleId', () => {
    it('deletes a few-shot example', async () => {
      vi.mocked(storage.getCriteriaSetFewShotExampleById).mockResolvedValue(makeExample() as any);
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());

      const res = await request(app).delete('/api/admin/evaluation-criteria/set-few-shot-examples/ex-1');

      expect(res.status).toBe(200);
      expect(vi.mocked(storage.deleteCriteriaSetFewShotExample)).toHaveBeenCalledWith('ex-1');
    });

    it('returns 404 when the example does not exist', async () => {
      vi.mocked(storage.getCriteriaSetFewShotExampleById).mockResolvedValue(undefined);

      const res = await request(app).delete('/api/admin/evaluation-criteria/set-few-shot-examples/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ─── infer-dimension-criteria ──────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/infer-dimension-criteria', () => {
    const scoringRubricJson = {
      scoringRubric: [
        { score: 1, label: '매우 미흡', description: 'd1', behaviorAnchor: 'a1' },
        { score: 3, label: '미흡', description: 'd3', behaviorAnchor: 'a3' },
        { score: 5, label: '보통', description: 'd5', behaviorAnchor: 'a5' },
        { score: 7, label: '우수', description: 'd7', behaviorAnchor: 'a7' },
        { score: 10, label: '탁월', description: 'd10', behaviorAnchor: 'a10' },
      ],
      evaluationPrompt: '명확성을 평가하세요.',
    };

    beforeEach(() => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());
    });

    it('rejects when there are no active examples', async () => {
      vi.mocked(storage.getActiveCriteriaSetFewShotExamples).mockResolvedValue([]);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/infer-dimension-criteria');

      expect(res.status).toBe(400);
    });

    it('rejects when there are no dimensions', async () => {
      vi.mocked(storage.getActiveCriteriaSetFewShotExamples).mockResolvedValue([makeExample()] as any);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([]);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/infer-dimension-criteria');

      expect(res.status).toBe(400);
    });

    it('calls the AI service per dimension, parses the JSON response, and returns valid inference results', async () => {
      vi.mocked(storage.getActiveCriteriaSetFewShotExamples).mockResolvedValue([
        makeExample({
          dimensionScores: [
            { key: 'clarityLogic', name: '명확성 & 논리성', score: 8, rationale: '명확했음' },
          ],
        }),
      ] as any);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([
        makeDimension({ key: 'clarityLogic', name: '명확성 & 논리성' }),
      ] as any);

      const generateText = vi.fn().mockResolvedValue(JSON.stringify(scoringRubricJson));
      vi.mocked(getAIServiceForFeature).mockResolvedValue({ generateText } as any);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/infer-dimension-criteria');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toEqual(
        expect.objectContaining({
          dimensionKey: 'clarityLogic',
          dimensionName: '명확성 & 논리성',
          scoringRubric: scoringRubricJson.scoringRubric,
          evaluationPrompt: scoringRubricJson.evaluationPrompt,
          exampleCount: 1,
        }),
      );
      expect(generateText).toHaveBeenCalledOnce();
      expect(vi.mocked(trackUsage)).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ type: 'infer_dimension_criteria', dimensionKey: 'clarityLogic' }) }),
      );
    });

    it('skips dimensions that have no matching example scores', async () => {
      vi.mocked(storage.getActiveCriteriaSetFewShotExamples).mockResolvedValue([
        makeExample({
          dimensionScores: [
            { key: 'clarityLogic', name: '명확성 & 논리성', score: 8, rationale: '명확했음' },
          ],
        }),
      ] as any);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([
        makeDimension({ key: 'clarityLogic' }),
        makeDimension({ id: 'dim-2', key: 'listeningEmpathy' }),
      ] as any);

      const generateText = vi.fn().mockResolvedValue(JSON.stringify(scoringRubricJson));
      vi.mocked(getAIServiceForFeature).mockResolvedValue({ generateText } as any);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/infer-dimension-criteria');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].dimensionKey).toBe('clarityLogic');
      expect(generateText).toHaveBeenCalledOnce();
    });

    it('returns 500 when the AI response cannot be parsed as JSON for any dimension', async () => {
      vi.mocked(storage.getActiveCriteriaSetFewShotExamples).mockResolvedValue([
        makeExample({
          dimensionScores: [
            { key: 'clarityLogic', name: '명확성 & 논리성', score: 8, rationale: '명확했음' },
          ],
        }),
      ] as any);
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([
        makeDimension({ key: 'clarityLogic' }),
      ] as any);

      const generateText = vi.fn().mockResolvedValue('이것은 JSON이 아닙니다.');
      vi.mocked(getAIServiceForFeature).mockResolvedValue({ generateText } as any);

      const res = await request(app).post('/api/admin/evaluation-criteria/set-1/infer-dimension-criteria');

      expect(res.status).toBe(500);
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app).post('/api/admin/evaluation-criteria/nonexistent/infer-dimension-criteria');

      expect(res.status).toBe(404);
    });
  });

  // ─── apply-inferred-criteria ───────────────────────────────────────────────

  describe('POST /api/admin/evaluation-criteria/:id/apply-inferred-criteria', () => {
    beforeEach(() => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet());
      vi.mocked(storage.getEvaluationDimensionsByCriteriaSet).mockResolvedValue([
        makeDimension({ key: 'clarityLogic', evaluationPrompt: 'old prompt' }),
      ] as any);
    });

    it('applies inferred scoring rubric and evaluation prompt to the matching dimension', async () => {
      const updatedDim = makeDimension({
        key: 'clarityLogic',
        scoringRubric: [{ score: 1, label: 'x', description: 'y', behaviorAnchor: 'z' }],
        evaluationPrompt: 'new prompt',
      });
      vi.mocked(storage.updateEvaluationDimension).mockResolvedValue(updatedDim as any);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/apply-inferred-criteria')
        .send({
          criteria: [
            {
              dimensionKey: 'clarityLogic',
              scoringRubric: [{ score: 1, label: 'x', description: 'y', behaviorAnchor: 'z' }],
              evaluationPrompt: 'new prompt',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(1);
      expect(vi.mocked(storage.updateEvaluationDimension)).toHaveBeenCalledWith('dim-1', {
        scoringRubric: [{ score: 1, label: 'x', description: 'y', behaviorAnchor: 'z' }],
        evaluationPrompt: 'new prompt',
      });
    });

    it('falls back to the existing evaluationPrompt when none is provided in the criteria', async () => {
      vi.mocked(storage.updateEvaluationDimension).mockResolvedValue(makeDimension() as any);

      await request(app)
        .post('/api/admin/evaluation-criteria/set-1/apply-inferred-criteria')
        .send({
          criteria: [
            { dimensionKey: 'clarityLogic', scoringRubric: [{ score: 1, label: 'x', description: 'y', behaviorAnchor: 'z' }] },
          ],
        });

      expect(vi.mocked(storage.updateEvaluationDimension)).toHaveBeenCalledWith('dim-1', {
        scoringRubric: [{ score: 1, label: 'x', description: 'y', behaviorAnchor: 'z' }],
        evaluationPrompt: 'old prompt',
      });
    });

    it('skips criteria entries whose dimensionKey does not exist on the set', async () => {
      vi.mocked(storage.updateEvaluationDimension).mockResolvedValue(makeDimension() as any);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/apply-inferred-criteria')
        .send({
          criteria: [
            { dimensionKey: 'nonexistentDim', scoringRubric: [{ score: 1, label: 'x', description: 'y', behaviorAnchor: 'z' }] },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(0);
      expect(vi.mocked(storage.updateEvaluationDimension)).not.toHaveBeenCalled();
    });

    it('rejects when criteria array is empty', async () => {
      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/apply-inferred-criteria')
        .send({ criteria: [] });

      expect(res.status).toBe(400);
    });

    it('returns 409 when the rubric is archived', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(makeSet({ status: 'archived' }));

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/set-1/apply-inferred-criteria')
        .send({
          criteria: [
            { dimensionKey: 'clarityLogic', scoringRubric: [{ score: 1, label: 'x', description: 'y', behaviorAnchor: 'z' }] },
          ],
        });

      expect(res.status).toBe(409);
      expect(vi.mocked(storage.updateEvaluationDimension)).not.toHaveBeenCalled();
    });

    it('returns 404 when the rubric does not exist', async () => {
      vi.mocked(storage.getEvaluationCriteriaSet).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/admin/evaluation-criteria/nonexistent/apply-inferred-criteria')
        .send({ criteria: [{ dimensionKey: 'a', scoringRubric: [] }] });

      expect(res.status).toBe(404);
    });
  });
});
