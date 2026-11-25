import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  audits: [] as any[],
  dryRunCount: 0,
  categories: ['cat-1'] as string[],
  sets: new Map<string, any>(),
  dims: new Map<string, any[]>(),
  scopes: ['rubrics:write', 'scenarios:write'] as string[],
  scenario: undefined as any,
  published: false,
  keyId: 'k0',
}));

vi.mock('../../server/storage', () => ({
  db: {
    insert: () => ({ values: (v: any) => { h.audits.push(v); return Promise.resolve(); } }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ n: h.dryRunCount }]) }) }),
  },
  storage: {
    getUser: async () => ({ id: 'op-1', role: 'operator', isActive: true }),
    getAllEvaluationCriteriaSets: async () => [...h.sets.values()],
    getEvaluationCriteriaSet: async (id: string) => h.sets.get(id),
    getEvaluationCriteriaSetWithDimensions: async (id: string) => ({ ...h.sets.get(id), dimensions: h.dims.get(id) ?? [] }),
    getEvaluationDimensionsByCriteriaSet: async (id: string) => h.dims.get(id) ?? [],
    getEvaluationDimension: async (id: string) => [...h.dims.values()].flat().find((d) => d.id === id),
    createEvaluationCriteriaSet: vi.fn(async (s: any) => { const n = { ...s, id: `set-${h.sets.size + 1}`, version: 1 }; h.sets.set(n.id, n); h.dims.set(n.id, []); return n; }),
    updateEvaluationCriteriaSet: vi.fn(async (id: string, u: any) => { const n = { ...h.sets.get(id), ...u }; h.sets.set(id, n); return n; }),
    updateEvaluationCriteriaSetStatus: vi.fn(async (id: string, status: string) => { const n = { ...h.sets.get(id), status }; h.sets.set(id, n); return n; }),
    createEvaluationDimension: vi.fn(async (d: any) => { const n = { ...d, id: `dim-${Math.random().toString(36).slice(2, 8)}` }; h.dims.set(d.criteriaSetId, [...(h.dims.get(d.criteriaSetId) ?? []), n]); return n; }),
    updateEvaluationDimension: vi.fn(async (id: string, u: any) => {
      for (const [sid, list] of h.dims) { const i = list.findIndex((d) => d.id === id); if (i >= 0) { list[i] = { ...list[i], ...u }; h.dims.set(sid, list); return list[i]; } }
    }),
    deleteEvaluationDimension: vi.fn(async (id: string) => { for (const [sid, list] of h.dims) h.dims.set(sid, list.filter((d) => d.id !== id)); }),
    getScenario: async () => h.scenario,
    getLatestPublishedVersion: async () => (h.published ? { id: 'v1' } : undefined),
    saveScenarioDraftVersion: vi.fn(async () => ({ id: 'dv', version: 2, status: 'draft' })),
  },
}));
vi.mock('../../server/routes/routerHelpers', () => ({ getOperatorAccessibleCategoryIds: async () => h.categories }));
vi.mock('../../server/routes/evaluationCriteria', () => ({
  createForkOfApprovedSet: vi.fn(async (id: string) => {
    const src = h.sets.get(id);
    const forkId = 'fork-1';
    h.sets.set(forkId, { ...src, id: forkId, status: 'draft', version: 2, parentSetId: id });
    const map = new Map<string, string>();
    h.dims.set(forkId, (h.dims.get(id) ?? []).map((d) => { const n = { ...d, id: `f-${d.id}`, criteriaSetId: forkId }; map.set(d.key, n.id); return n; }));
    return { forkId, forkSet: h.sets.get(forkId), dimKeyToForkId: map };
  }),
}));
vi.mock('../../server/services/aiServiceFactory', () => ({ generateFeedback: vi.fn(async () => ({ overallScore: 70 })) }));
vi.mock('../../server/services/fileManager', () => ({ fileManager: { updateScenario: vi.fn(async () => ({})) } }));

import router from '../../server/routes/agentAuthoringRubrics';
import { storage } from '../../server/storage';
import { generateFeedback } from '../../server/services/aiServiceFactory';
import { fileManager } from '../../server/services/fileManager';
import { attachAgentRequestId } from '../../server/middleware/agentApiKeyMiddleware';
import { RUBRIC_TEMPLATES } from '../../server/data/rubricTemplates';

function app() {
  const a = express();
  a.use(express.json());
  a.use(attachAgentRequestId);
  a.use((req: any, _res, next) => {
    req.agentKey = { id: h.keyId, name: 'Bot', ownerUserId: 'op-1', organizationId: 'org-1', scopes: h.scopes, expiresAt: new Date(Date.now() + 1e8) };
    next();
  });
  a.use('/authoring', router);
  return a;
}

const step = (n: number) => ({ score: n, label: `L${n}`, description: `d${n}`, behaviorAnchor: `"예시 ${n}"` });
const dim = (key: string, weight: number) => ({
  key, name: key, weight, minScore: 1, maxScore: 10, evaluationPrompt: '응답의 근거와 구조를 평가하세요',
  scoringRubric: [2, 4, 6, 8, 10].map(step),
});
const seedSet = (over: any = {}, n = 3) => {
  h.sets.set('s1', { id: 's1', name: 'R', categoryId: 'cat-1', status: 'draft', version: 1, authoredByAgent: null, ...over });
  h.dims.set('s1', Array.from({ length: n }, (_, i) => ({ ...dim(`d${i}`, 100 / n), id: `x${i}`, criteriaSetId: 's1', isActive: true, displayOrder: i })));
};

let n = 0;
beforeEach(() => {
  h.keyId = `k${++n}`;
  h.audits = []; h.dryRunCount = 0; h.categories = ['cat-1']; h.sets = new Map(); h.dims = new Map();
  h.scopes = ['rubrics:write', 'scenarios:write']; h.scenario = undefined; h.published = false;
  vi.clearAllMocks();
});

describe('rubric create', () => {
  it('creates a draft from a template attributed to the agent', async () => {
    const t = RUBRIC_TEMPLATES[0];
    const res = await request(app()).post('/authoring/rubrics').send({ name: '보고', categoryId: 'cat-1', templateId: t.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'draft', isDefault: false, authoredBy: { type: 'agent', agentKeyName: 'Bot' } });
    expect(res.body.dimensions).toHaveLength(t.dimensions.length);
    const arg = vi.mocked(storage.createEvaluationCriteriaSet).mock.calls[0][0] as any;
    expect(arg).toMatchObject({ status: 'draft', isDefault: false, approvedBy: null, authoredByAgent: { agentKeyName: 'Bot' } });
    expect(h.audits[0].action).toBe('agent_authoring.rubric.created');
  });

  it('creates from scratch and rejects bad dimensions (missing behavior anchors / too many)', async () => {
    const ok = await request(app()).post('/authoring/rubrics').send({ name: 'x', categoryId: 'cat-1', dimensions: [dim('a', 50), dim('b', 50)] });
    expect(ok.status).toBe(201);
    const bad = await request(app()).post('/authoring/rubrics').send({
      name: 'x', categoryId: 'cat-1', dimensions: [{ ...dim('a', 100), scoringRubric: [step(2)] }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.errors.length).toBeGreaterThan(0);
    const many = await request(app()).post('/authoring/rubrics').send({
      name: 'x', categoryId: 'cat-1', dimensions: Array.from({ length: 13 }, (_, i) => dim(`k${i}`, 5)),
    });
    expect(many.status).toBe(400);
  });

  it('needs templateId or dimensions, and refuses out-of-scope categories and publish fields', async () => {
    expect((await request(app()).post('/authoring/rubrics').send({ name: 'x', categoryId: 'cat-1' })).status).toBe(400);
    const oos = await request(app()).post('/authoring/rubrics').send({ name: 'x', categoryId: 'cat-9', templateId: RUBRIC_TEMPLATES[0].id });
    expect(oos.status).toBe(403);
    expect(oos.body.error.code).toBe('authoring_out_of_scope');
    const pub = await request(app()).post('/authoring/rubrics').send({ name: 'x', categoryId: 'cat-1', templateId: RUBRIC_TEMPLATES[0].id, status: 'approved', isDefault: true });
    expect(pub.status).toBe(403);
    expect(pub.body.error.code).toBe('authoring_draft_only');
  });

  it('requires rubrics:write', async () => {
    h.scopes = ['scenarios:write'];
    const res = await request(app()).post('/authoring/rubrics').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });
});

describe('scope and editing', () => {
  it('hides out-of-scope rubrics', async () => {
    seedSet({ categoryId: 'cat-9' });
    expect((await request(app()).get('/authoring/rubrics/s1')).status).toBe(404);
    expect((await request(app()).patch('/authoring/rubrics/s1').send({ name: 'x' })).status).toBe(404);
    expect((await request(app()).get('/authoring/rubrics')).body.rubrics).toEqual([]);
  });

  it('edits drafts in place and edits dimensions', async () => {
    seedSet();
    const r = await request(app()).patch('/authoring/rubrics/s1').send({ name: '새 이름' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('새 이름');
    const d = await request(app()).patch('/authoring/rubrics/s1/dimensions/x0').send({ weight: 50 });
    expect(d.status).toBe(200);
    expect(d.body.dimension.weight).toBe(50);
    const add = await request(app()).post('/authoring/rubrics/s1/dimensions').send(dim('extra', 10));
    expect(add.status).toBe(201);
    const dup = await request(app()).post('/authoring/rubrics/s1/dimensions').send(dim('extra', 10));
    expect(dup.status).toBe(400);
    const del = await request(app()).delete('/authoring/rubrics/s1/dimensions/x1');
    expect(del.status).toBe(200);
  });

  it('rejects invalid dimension edits', async () => {
    seedSet();
    const res = await request(app()).patch('/authoring/rubrics/s1/dimensions/x0').send({ scoringRubric: [step(2)] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('authoring_validation_failed');
  });

  it('forks approved rubrics into a new draft version instead of editing them', async () => {
    seedSet({ status: 'approved' });
    const res = await request(app()).patch('/authoring/rubrics/s1').send({ name: '개정' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ autoForked: true, forkedFromId: 's1', status: 'draft', authoredBy: { type: 'agent' } });
    expect(h.sets.get('s1').name).toBe('R');
    expect(h.sets.get('s1').status).toBe('approved');

    h.sets.delete('fork-1');
    const dres = await request(app()).patch('/authoring/rubrics/s1/dimensions/x0').send({ weight: 40 });
    expect(dres.status).toBe(201);
    expect(h.dims.get('s1')![0].weight).toBeCloseTo(100 / 3);
    expect(h.dims.get('fork-1')![0].weight).toBe(40);
  });

  it('refuses edits to archived rubrics', async () => {
    seedSet({ status: 'archived' });
    expect((await request(app()).patch('/authoring/rubrics/s1').send({ name: 'x' })).status).toBe(409);
  });
});

describe('review gate', () => {
  it('rejects review when weights do not sum to 100', async () => {
    seedSet();
    h.dims.get('s1')![0].weight = 10;
    const res = await request(app()).post('/authoring/rubrics/s1/request-review');
    expect(res.status).toBe(400);
    expect(res.body.error.details.errors.join(' ')).toContain('가중치');
    expect(storage.updateEvaluationCriteriaSetStatus).not.toHaveBeenCalled();
  });

  it('moves a valid draft to review only', async () => {
    seedSet();
    h.dims.get('s1')!.forEach((d, i) => (d.weight = [34, 33, 33][i]));
    const res = await request(app()).post('/authoring/rubrics/s1/request-review');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('review');
    expect(h.audits.at(-1).action).toBe('agent_authoring.rubric.review_requested');
  });

  it('has no approve, reject, default, archive or delete endpoints for agents', async () => {
    seedSet({ status: 'review' });
    for (const path of ['approve', 'reject', 'set-default', 'archive']) {
      expect((await request(app()).post(`/authoring/rubrics/s1/${path}`)).status).toBe(404);
    }
    expect((await request(app()).delete('/authoring/rubrics/s1')).status).toBe(404);
    expect((await request(app()).post('/authoring/rubrics/s1').send({ status: 'approved' })).status).toBe(404);
  });

  it('does not allow review for approved rubrics', async () => {
    seedSet({ status: 'approved' });
    expect((await request(app()).post('/authoring/rubrics/s1/request-review')).status).toBe(400);
  });
});

describe('quality score and dry-run', () => {
  const body = { messages: [{ sender: 'ai', message: '안녕하세요' }, { sender: 'user', message: '보고드립니다' }] };

  it('returns the quality score', async () => {
    seedSet();
    const res = await request(app()).get('/authoring/rubrics/s1/quality-score');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalScore).toBe('number');
    expect(res.body.approvalThreshold).toBe(80);
  });

  it('runs a dry-run and records it', async () => {
    seedSet();
    const res = await request(app()).post('/authoring/rubrics/s1/dry-run').send(body);
    expect(res.status).toBe(200);
    expect(res.body.isDryRun).toBe(true);
    expect(generateFeedback).toHaveBeenCalledTimes(1);
    expect(h.audits[0].action).toBe('agent_authoring.rubric.dry_run');
  });

  it('blocks the call once the daily cap is reached without calling the AI', async () => {
    seedSet();
    h.dryRunCount = 10;
    const res = await request(app()).post('/authoring/rubrics/s1/dry-run').send(body);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('authoring_dry_run_limit_exceeded');
    expect(generateFeedback).not.toHaveBeenCalled();
    expect(h.audits).toHaveLength(0);
  });

  it('validates the dry-run body and scope', async () => {
    seedSet();
    expect((await request(app()).post('/authoring/rubrics/s1/dry-run').send({ messages: [] })).status).toBe(400);
    h.categories = [];
    expect((await request(app()).post('/authoring/rubrics/s1/dry-run').send(body)).status).toBe(404);
    expect(generateFeedback).not.toHaveBeenCalled();
  });
});

describe('scenario link', () => {
  const sc = (over: any = {}) => ({ id: 'sc1', categoryId: 'cat-1', isPublic: false, ...over });

  it('links a rubric to a draft scenario and notes that unapproved rubrics are not used live', async () => {
    seedSet({ status: 'review' });
    h.scenario = sc();
    const res = await request(app()).put('/authoring/scenarios/sc1/rubric').send({ rubricId: 's1' });
    expect(res.status).toBe(200);
    expect(res.body.note).toContain('not approved');
    expect(fileManager.updateScenario).toHaveBeenCalledWith('sc1', { evaluationCriteriaSetId: 's1' });
  });

  it('turns the link on a published scenario into a draft version', async () => {
    seedSet({ status: 'approved' });
    h.scenario = sc({ isPublic: true });
    const res = await request(app()).put('/authoring/scenarios/sc1/rubric').send({ rubricId: 's1' });
    expect(res.status).toBe(201);
    expect(res.body.draftVersion.version).toBe(2);
    expect(fileManager.updateScenario).not.toHaveBeenCalled();
  });

  it('refuses out-of-scope rubrics/scenarios and missing scenarios:write', async () => {
    seedSet({ categoryId: 'cat-9' });
    h.scenario = sc();
    expect((await request(app()).put('/authoring/scenarios/sc1/rubric').send({ rubricId: 's1' })).status).toBe(404);
    h.scenario = sc({ categoryId: 'cat-9' });
    seedSet();
    expect((await request(app()).put('/authoring/scenarios/sc1/rubric').send({ rubricId: 's1' })).status).toBe(404);
    h.scopes = ['rubrics:write'];
    expect((await request(app()).put('/authoring/scenarios/sc1/rubric').send({ rubricId: 's1' })).status).toBe(403);
  });
});
