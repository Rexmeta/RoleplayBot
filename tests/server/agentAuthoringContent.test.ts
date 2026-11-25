import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => ({
  audits: [] as any[],
  categories: ['cat-1'] as string[],
  scenarios: new Map<string, any>(),
  personas: new Map<string, any>(),
  published: new Set<string>(),
  keyId: 'k0',
  scopes: ['scenarios:write', 'personas:write'] as string[],
}));

vi.mock('../../server/storage', () => ({
  db: { insert: () => ({ values: (v: any) => { h.audits.push(v); return Promise.resolve(); } }) },
  storage: {
    getUser: async () => ({ id: 'op-1', role: 'operator', isActive: true }),
    getAllScenarios: async () => [...h.scenarios.values()],
    getScenario: async (id: string) => h.scenarios.get(id),
    getLatestPublishedVersion: async (id: string) => (h.published.has(id) ? { id: 'v1', version: 1, status: 'published' } : undefined),
    getAllMbtiPersonas: async () => [...h.personas.values()],
    getMbtiPersona: async (id: string) => h.personas.get(id),
    createMbtiPersona: vi.fn(async (p: any) => { h.personas.set(p.id, p); return p; }),
    updateMbtiPersona: vi.fn(async (id: string, u: any) => { const n = { ...h.personas.get(id), ...u }; h.personas.set(id, n); return n; }),
    getActiveSupportedLanguages: async () => [{ code: 'ko' }],
    getScenarioTranslations: async () => [],
    upsertScenarioTranslation: vi.fn(async () => undefined),
    saveScenarioDraftVersion: vi.fn(async (id: string) => ({ id: 'dv1', version: 2, status: 'draft', scenarioId: id })),
  },
}));
vi.mock('../../server/routes/routerHelpers', () => ({
  getOperatorAccessibleCategoryIds: async () => h.categories,
}));
vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    createScenario: vi.fn(async (d: any) => { const s = { ...d, id: 'sc-new' }; h.scenarios.set(s.id, s); return s; }),
    updateScenario: vi.fn(async (id: string, patch: any) => { const s = { ...h.scenarios.get(id), ...patch }; h.scenarios.set(id, s); return s; }),
  },
}));
vi.mock('../../server/services/aiScenarioGenerator', () => ({
  fillScenarioFieldsWithAI: vi.fn(async () => ({ title: 'AI title' })),
}));

import router from '../../server/routes/agentAuthoringContent';
import { storage } from '../../server/storage';
import { fileManager } from '../../server/services/fileManager';
import { attachAgentRequestId } from '../../server/middleware/agentApiKeyMiddleware';

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

const AUTHORSHIP = { agentKeyId: 'k', agentKeyName: 'Other', ownerUserId: 'op-1' };
const validScenario = (over: any = {}) => ({
  title: '고객 불만 대응', description: '화난 고객 응대', categoryId: 'cat-1',
  personas: [{ name: '김 팀장', personaRef: 'intp' }], ...over,
});

let n = 0;
beforeEach(() => {
  h.keyId = `k${++n}`;
  h.scopes = ['scenarios:write', 'personas:write'];
  h.categories = ['cat-1'];
  h.audits = [];
  h.scenarios = new Map();
  h.personas = new Map([['intp', { id: 'intp', mbti: 'INTP', images: { base: 'x.webp' }, videos: { clips: 1 }, liveAvatar: { kind: 'stock' } }]]);
  h.published = new Set();
  vi.clearAllMocks();
});

describe('scenario authoring', () => {
  it('creates a private draft attributed to the agent, with audit and translation', async () => {
    const res = await request(app()).post('/authoring/scenarios').send(validScenario());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.authoredBy).toMatchObject({ type: 'agent', agentKeyName: 'Bot' });
    const arg = vi.mocked(fileManager.createScenario).mock.calls[0][0] as any;
    expect(arg).toMatchObject({ isPublic: false, isDemo: false, storeListed: false });
    expect(arg.personas[0]).toMatchObject({ personaRef: 'intp.json', isPrimary: true });
    expect(storage.upsertScenarioTranslation).toHaveBeenCalled();
    expect(h.audits[0].action).toBe('agent_authoring.scenario.created');
  });

  it('rejects invalid input with per-field errors', async () => {
    const res = await request(app()).post('/authoring/scenarios').send({ title: '', personas: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('authoring_validation_failed');
    expect(res.body.error.details.fields.map((f: any) => f.path)).toEqual(expect.arrayContaining(['title', 'description', 'categoryId', 'personas']));
  });

  it('rejects unknown persona references as a field error', async () => {
    const res = await request(app()).post('/authoring/scenarios').send(validScenario({ personas: [{ name: 'x', personaRef: 'nope' }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].path).toBe('personas.0.personaRef');
  });

  it('forbids creating in a category outside the owner scope', async () => {
    const res = await request(app()).post('/authoring/scenarios').send(validScenario({ categoryId: 'cat-2' }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('authoring_out_of_scope');
  });

  it('refuses to publish and ignores media fields', async () => {
    const pub = await request(app()).post('/authoring/scenarios').send(validScenario({ isPublic: true }));
    expect(pub.body.error.code).toBe('authoring_draft_only');
    const res = await request(app()).post('/authoring/scenarios').send(validScenario({ image: 'http://x', useVideoAvatar: true, introVideoUrl: 'v' }));
    expect(res.status).toBe(201);
    expect(res.body.ignoredFields).toEqual(expect.arrayContaining(['image', 'useVideoAvatar', 'introVideoUrl']));
    const arg = vi.mocked(fileManager.createScenario).mock.calls.at(-1)![0] as any;
    expect(arg.image).toBeUndefined();
    expect(arg.useVideoAvatar).toBeUndefined();
  });

  it('requires scenarios:write', async () => {
    h.scopes = ['personas:write'];
    const res = await request(app()).post('/authoring/scenarios').send(validScenario());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('lists drafts in scope with status and author, hiding other categories', async () => {
    h.scenarios.set('a', { id: 'a', title: 'A', categoryId: 'cat-1', personas: [], authoredByAgent: AUTHORSHIP });
    h.scenarios.set('b', { id: 'b', title: 'B', categoryId: 'cat-1', personas: [], isPublic: true });
    h.scenarios.set('c', { id: 'c', title: 'C', categoryId: 'cat-9', personas: [] });
    const res = await request(app()).get('/authoring/scenarios');
    const byId = Object.fromEntries(res.body.scenarios.map((s: any) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual(['a', 'b']);
    expect(byId.a).toMatchObject({ status: 'draft', authoredBy: { type: 'agent' } });
    expect(byId.b).toMatchObject({ status: 'published', authoredBy: { type: 'human' } });
  });

  it('returns 404 for scenarios outside the owner scope', async () => {
    h.scenarios.set('c', { id: 'c', title: 'C', categoryId: 'cat-9', personas: [] });
    expect((await request(app()).get('/authoring/scenarios/c')).status).toBe(404);
    const res = await request(app()).patch('/authoring/scenarios/c').send({ title: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('scenario_not_found');
  });

  it('updates an unpublished scenario in place', async () => {
    h.scenarios.set('a', { id: 'a', title: 'A', description: 'd', categoryId: 'cat-1', sourceLocale: 'ko', personas: [{ id: 'intp', name: 'n', isPrimary: true, personaRef: 'intp.json' }], authoredByAgent: AUTHORSHIP });
    const res = await request(app()).patch('/authoring/scenarios/a').send({ title: 'New' });
    expect(res.status).toBe(200);
    expect(fileManager.updateScenario).toHaveBeenCalledWith('a', { title: 'New' });
    expect(res.body.status).toBe('draft');
  });

  it('turns edits of a published scenario into a new draft version without touching the live one', async () => {
    h.scenarios.set('p', { id: 'p', title: 'P', description: 'd', categoryId: 'cat-1', personas: [{ id: 'intp', name: 'n', isPrimary: true, personaRef: 'intp.json' }] });
    h.published.add('p');
    const res = await request(app()).patch('/authoring/scenarios/p').send({ title: 'Edited' });
    expect(res.status).toBe(201);
    expect(res.body.draftVersion).toMatchObject({ version: 2, status: 'draft' });
    expect(fileManager.updateScenario).not.toHaveBeenCalled();
    expect((vi.mocked(storage.saveScenarioDraftVersion).mock.calls[0][1] as any).title).toBe('Edited');
    expect(h.audits[0].action).toBe('agent_authoring.scenario.draft_version_saved');
  });

  it('exposes text-only AI assist', async () => {
    const res = await request(app()).post('/authoring/scenarios/fill-fields').send({ idea: '신입 온보딩' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('AI title');
    expect((await request(app()).post('/authoring/scenarios/fill-fields').send({})).status).toBe(400);
  });
});

describe('persona authoring', () => {
  it('creates a draft persona with text fields only and preserves no media', async () => {
    const res = await request(app()).post('/authoring/personas').send({
      mbti: 'entj', communication_style: '직설적', images: { base: 'evil' }, videos: { a: 1 }, liveAvatar: { kind: 'stock' }, avatarMode: 'live',
    });
    expect(res.status).toBe(201);
    const arg = vi.mocked(storage.createMbtiPersona).mock.calls[0][0] as any;
    expect(arg).toMatchObject({ mbti: 'ENTJ', communicationStyle: '직설적', storeListed: false });
    expect(arg.authoredByAgent).toMatchObject({ agentKeyName: 'Bot', ownerUserId: 'op-1' });
    expect(arg.images).toBeUndefined();
    expect(arg.videos).toBeUndefined();
    expect(arg.liveAvatar).toBeUndefined();
    expect(res.body.ignoredFields).toEqual(expect.arrayContaining(['images', 'videos', 'liveAvatar', 'avatarMode']));
  });

  it('validates the mbti type', async () => {
    const res = await request(app()).post('/authoring/personas').send({ mbti: 'xx' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('authoring_validation_failed');
  });

  it('patches only agent drafts of the same owner and never writes media columns', async () => {
    h.personas.set('agent-entj-1', { id: 'agent-entj-1', mbti: 'ENTJ', images: { base: 'keep' }, authoredByAgent: AUTHORSHIP });
    const res = await request(app()).patch('/authoring/personas/agent-entj-1').send({ motivation: '성과', images: { base: 'x' }, videos: {} });
    expect(res.status).toBe(200);
    const updates = vi.mocked(storage.updateMbtiPersona).mock.calls[0][1] as any;
    expect(updates).toEqual({ motivation: '성과' });
    expect(h.personas.get('agent-entj-1').images).toEqual({ base: 'keep' });
  });

  it('hides human-authored and other owners\' persona records from edits (404)', async () => {
    h.personas.set('foreign', { id: 'foreign', mbti: 'ENTJ', authoredByAgent: { ...AUTHORSHIP, ownerUserId: 'someone-else' } });
    expect((await request(app()).patch('/authoring/personas/intp').send({ motivation: 'x' })).status).toBe(404);
    const res = await request(app()).patch('/authoring/personas/foreign').send({ motivation: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('persona_not_found');
  });

  it('lists existing records without media and hides other owners\' drafts', async () => {
    h.personas.set('foreign', { id: 'foreign', mbti: 'ENTJ', authoredByAgent: { ...AUTHORSHIP, ownerUserId: 'someone-else' } });
    const res = await request(app()).get('/authoring/personas');
    expect(res.body.personas.map((p: any) => p.id)).toEqual(['intp']);
    expect(res.body.personas[0].images).toBeUndefined();
    expect(res.body.personas[0].liveAvatar).toBeUndefined();
  });
});
