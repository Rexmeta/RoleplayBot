/**
 * External roleplay integration: game context, result endpoint, hosted play links.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const TEST_PEPPER = 'test-roleplay-pepper-32-chars!!!!';

function makeQueryResult(rows: any[]) {
  const obj: any = {
    then(resolve: any, reject?: any) { return Promise.resolve(rows).then(resolve, reject); },
    catch(fn: any) { return Promise.resolve(rows).catch(fn); },
    finally(fn: any) { return Promise.resolve(rows).finally(fn); },
    limit(n: number) { return makeQueryResult(rows.slice(0, n)); },
    returning() { return makeQueryResult(rows); },
  };
  return obj;
}

const dbState = vi.hoisted(() => {
  const selects: any[][] = [];
  const updateReturns: any[][] = [];
  return {
    selects, updateReturns,
    inserts: [] as Array<{ values: any }>,
    updates: [] as any[],
    deletes: 0,
    reset() { selects.length = 0; updateReturns.length = 0; this.inserts = []; this.updates = []; this.deletes = 0; },
  };
});

vi.mock('../../server/storage', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => makeQueryResult(dbState.selects.shift() ?? []) }) }),
    insert: () => ({
      values: (values: any) => {
        dbState.inserts.push({ values });
        const r: any = makeQueryResult([]);
        r.onConflictDoNothing = () => Promise.resolve();
        r.onConflictDoUpdate = () => Promise.resolve();
        return r;
      },
    }),
    update: () => ({
      set: (vals: any) => ({
        where: () => { dbState.updates.push(vals); return makeQueryResult(dbState.updateReturns.shift() ?? []); },
      }),
    }),
    delete: () => ({ where: () => { dbState.deletes += 1; return Promise.resolve(); } }),
  },
  storage: {
    getScenario: vi.fn(),
    getLatestPublishedVersion: vi.fn().mockResolvedValue(null),
    getOrganization: vi.fn().mockResolvedValue({ id: 'org-1', companyId: 'company-1', isActive: true }),
    getCompany: vi.fn().mockResolvedValue({ id: 'company-1', isActive: true }),
    getCategory: vi.fn().mockResolvedValue(null),
    getScenarioOverrideByOrgAndScenario: vi.fn().mockResolvedValue(null),
    getActiveEvaluationCriteriaSetWithDimensions: vi.fn().mockResolvedValue(null),
    createScenarioRun: vi.fn().mockResolvedValue({ id: 'srun-1' }),
    createPersonaRun: vi.fn().mockResolvedValue({ id: 'prun-1' }),
    createChatMessage: vi.fn().mockResolvedValue({}),
    getChatMessagesByPersonaRun: vi.fn().mockResolvedValue([]),
    getFeedbackByConversationId: vi.fn().mockResolvedValue(null),
    getSimulationState: vi.fn().mockResolvedValue(null),
    saveSimulationState: vi.fn().mockResolvedValue(undefined),
    getPersonaRun: vi.fn().mockResolvedValue(null),
    getScenarioRun: vi.fn().mockResolvedValue(null),
    createSimulationEvent: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getAllScenarios: vi.fn().mockResolvedValue([]),
    getPersonaByMBTI: vi.fn().mockResolvedValue(null),
    getPersonaAvatarSettings: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../server/services/aiServiceFactory', () => ({
  generateAIResponse: vi.fn().mockResolvedValue({ content: 'AI reply text', emotion: '중립', emotionReason: 'n' }),
  generateStreamingAIResponse: vi.fn(),
}));

const feedbackMocks = vi.hoisted(() => ({
  enqueueFeedbackJob: vi.fn().mockResolvedValue({ status: 'queued' }),
  getFeedbackJobStatus: vi.fn().mockResolvedValue({ status: 'queued' }),
}));
vi.mock('../../server/services/feedbackGenerationService', () => feedbackMocks);

vi.mock('../../server/services/simulation/simulationEngine', () => ({
  applySimulationPatch: vi.fn().mockReturnValue({ version: 1, stage: 'intro' }),
  getOrCreateSessionContext: vi.fn().mockReturnValue({}),
  getSessionState: vi.fn().mockReturnValue(null),
}));
vi.mock('../../server/services/simulation/evaluateUserResponse', () => ({
  evaluateUserResponse: vi.fn().mockResolvedValue({ skipped: true }),
}));
vi.mock('../../server/routes/routerHelpers', () => ({
  generateAndSaveFeedback: vi.fn().mockResolvedValue(null),
  loadEvaluationCriteria: vi.fn().mockResolvedValue(null),
  createHttpError: (status: number, message: string) => Object.assign(new Error(message), { status }),
}));

import { generateAgentApiKey } from '../../server/utils/agentApiKey';
import agentApiRouter from '../../server/routes/agentApi';
import { agentPlayPageRouter, agentPlayApiRouter } from '../../server/routes/agentPlay';
import { fileManager } from '../../server/services/fileManager';
import { storage } from '../../server/storage';
import { generateAIResponse } from '../../server/services/aiServiceFactory';

const SCENARIO_ID = 'scenario-rp';
const PERSONA_ID = 'persona-rp';
const KEY_ID = 'key-rp';
const ORG_ID = 'org-rp';
const SESSION_ID = 'ags_roleplay000000001';
const MOCK_SCENARIO = {
  id: SCENARIO_ID, title: 'Scn', description: 'desc', category: 'c', tags: [], difficulty: 3, targetTurns: 5,
  isDeleted: false, context: { situation: 'Base situation' },
  personas: [{ id: PERSONA_ID, name: 'Guild Master', role: 'Boss', mbti: 'INTJ' }],
};

function makeKey(overrides: Partial<any> = {}) {
  process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  const { fullKey, keyHash, keyPrefix } = generateAgentApiKey('live');
  return {
    fullKey,
    record: {
      id: KEY_ID, keyHash, keyPrefix, isActive: true, revokedAt: null, expiresAt: null, allowedIps: [],
      allowedOrigins: ['https://game.example.com'],
      scopes: ['scenarios:read', 'sessions:create', 'sessions:read', 'sessions:message', 'sessions:end'],
      organizationId: ORG_ID, rateLimitPerMinute: 1000, ...overrides,
    },
  };
}
function makeSession(overrides: Partial<any> = {}) {
  return {
    id: SESSION_ID, agentKeyId: KEY_ID, organizationId: ORG_ID, externalUserId: 'u1', externalSessionId: 'ext-1',
    personaRunId: 'prun-1', scenarioId: SCENARIO_ID, personaId: PERSONA_ID, language: 'ko', difficulty: 3,
    status: 'active', metadata: null, lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(), endedAt: null, ...overrides,
  };
}
function makeLink(overrides: Partial<any> = {}) {
  return {
    id: 'link-1', sessionId: SESSION_ID, agentKeyId: KEY_ID, linkTokenHash: 'h', linkExpiresAt: new Date(Date.now() + 60_000),
    redeemedAt: null, accessTokenHash: null, accessExpiresAt: null, createdAt: new Date(), ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/play', agentPlayPageRouter);
  app.use('/api/v1/agent/play', agentPlayApiRouter);
  app.use('/api/v1/agent', agentApiRouter);
  return app;
}

beforeEach(() => {
  process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  dbState.reset();
  vi.mocked(fileManager.getAllScenarios).mockResolvedValue([MOCK_SCENARIO] as any);
  vi.mocked(storage.getScenario).mockResolvedValue(MOCK_SCENARIO as any);
  vi.mocked(storage.getScenarioOverrideByOrgAndScenario).mockResolvedValue(undefined as any);
  vi.mocked(generateAIResponse).mockClear();
  feedbackMocks.enqueueFeedbackJob.mockClear();
});
afterEach(() => { delete process.env.AGENT_API_KEY_PEPPER; });

describe('gameContext at session creation', () => {
  async function create(body: any, key = makeKey()) {
    dbState.selects.length = 0;
    dbState.selects.push([key.record]);                                   // auth
    dbState.selects.push([{ agentKeyId: KEY_ID, scenarioId: SCENARIO_ID }]); // allowlist
    dbState.selects.push([makeSession()]);                                // re-fetch
    return request(buildApp()).post('/api/v1/agent/sessions').set('Authorization', `Bearer ${key.fullKey}`)
      .send({ scenarioId: SCENARIO_ID, personaId: PERSONA_ID, externalUserId: 'u1', ...body });
  }
  const sessionInsert = () => dbState.inserts.find((i) => i.values?.scenarioId === SCENARIO_ID)?.values;

  it('stores a sanitised context under the reserved metadata key and keeps user metadata', async () => {
    const res = await create({
      metadata: { a: 1 },
      gameContext: { contextId: 'scene-1', sceneSummary: 'Loan\ntalk <b>', playerState: { gold: 5 } },
    });
    expect(res.status).toBe(201);
    expect(sessionInsert().metadata).toEqual({
      a: 1, _gameContext: { contextId: 'scene-1', sceneSummary: 'Loan talk b', playerState: { gold: 5 } },
    });
    expect(res.body).toHaveProperty('gameContextId');
  });

  it('rejects unknown gameContext fields, reserved metadata key and oversized contexts', async () => {
    expect((await create({ gameContext: { evil: 'x' } })).status).toBe(400);
    expect((await create({ metadata: { _gameContext: {} } })).status).toBe(400);
    const big = await create({
      gameContext: {
        sceneSummary: '가'.repeat(1000), objective: '나'.repeat(300), recentEvents: Array(10).fill('다'.repeat(200)),
      },
    });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('game_context_too_large');
  });

  it('still creates sessions without gameContext (backward compatible)', async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(sessionInsert().metadata).toBeNull();
  });

  it('injects the stored context into the persona prompt scenario', async () => {
    const key = makeKey();
    const session = makeSession({ metadata: { _gameContext: { contextId: 'c', sceneSummary: 'Caravan lost' } } });
    dbState.selects.push([key.record], [session]);
    const res = await request(buildApp()).post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
      .set('Authorization', `Bearer ${key.fullKey}`).send({ message: 'hello there' });
    expect(res.status).toBe(200);
    const scenarioArg: any = vi.mocked(generateAIResponse).mock.calls.at(-1)![0];
    expect(scenarioArg.context.situation).toContain('Base situation');
    expect(scenarioArg.context.situation).toContain('Caravan lost');
  });

  it('passes the context into the feedback evaluation scenario when the session ends', async () => {
    const key = makeKey();
    const session = makeSession({ metadata: { _gameContext: { sceneSummary: 'Caravan lost' } } });
    dbState.selects.push([key.record], [session]);
    const res = await request(buildApp()).post(`/api/v1/agent/sessions/${SESSION_ID}/end`)
      .set('Authorization', `Bearer ${key.fullKey}`).send({});
    expect(res.status).toBe(200);
    expect(feedbackMocks.enqueueFeedbackJob.mock.calls.at(-1)![0].scenario.context.situation).toContain('Caravan lost');
  });
});

describe('GET /sessions/:id/result', () => {
  it('returns in_progress while feedback is generating and requires sessions:read', async () => {
    const noScope = makeKey({ scopes: ['sessions:create'] });
    dbState.selects.push([noScope.record]);
    expect((await request(buildApp()).get(`/api/v1/agent/sessions/${SESSION_ID}/result`)
      .set('Authorization', `Bearer ${noScope.fullKey}`)).status).toBe(403);

    const key = makeKey();
    dbState.selects.push([key.record], [makeSession({ status: 'ended' })]);
    feedbackMocks.getFeedbackJobStatus.mockResolvedValueOnce({ status: 'generating' });
    const res = await request(buildApp()).get(`/api/v1/agent/sessions/${SESSION_ID}/result`)
      .set('Authorization', `Bearer ${key.fullKey}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'in_progress', result: null, sessionId: SESSION_ID, externalSessionId: 'ext-1' });
  });

  it('returns the game result with context id when completed', async () => {
    const key = makeKey();
    dbState.selects.push([key.record], [makeSession({ status: 'ended', metadata: { _gameContext: { contextId: 'scene-7' } } })]);
    feedbackMocks.getFeedbackJobStatus.mockResolvedValueOnce({ status: 'completed' });
    vi.mocked(storage.getFeedbackByConversationId).mockResolvedValueOnce({
      overallScore: 91, detailedFeedback: { overallScore: 91, strengths: ['s'], improvements: ['i'], scores: [], harnessPassResult: { passed: true } },
    } as any);
    vi.mocked(storage.getChatMessagesByPersonaRun).mockResolvedValueOnce([
      { sender: 'ai', emotion: '분노' }, { sender: 'ai', emotion: '기쁨' },
    ] as any);
    const res = await request(buildApp()).get(`/api/v1/agent/sessions/${SESSION_ID}/result`)
      .set('Authorization', `Bearer ${key.fullKey}`);
    expect(res.status).toBe(200);
    expect(res.body.gameContextId).toBe('scene-7');
    expect(res.body.result).toMatchObject({ passed: true, overallScore: 91, scenarioSuccessLevel: 'excellent' });
    expect(res.body.result.emotionFlow).toMatchObject({ start: '분노', end: '기쁨' });
    expect(res.body.result.narrativeHook).toContain('Guild Master');
  });

  it('hides sessions that do not belong to the key', async () => {
    const key = makeKey();
    dbState.selects.push([key.record], []);
    const res = await request(buildApp()).get(`/api/v1/agent/sessions/${SESSION_ID}/result`)
      .set('Authorization', `Bearer ${key.fullKey}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /sessions/:id/play-link', () => {
  it('issues a single-use link, supersedes older unredeemed links and never stores the raw token', async () => {
    const key = makeKey();
    dbState.selects.push([key.record], [makeSession()]);
    const res = await request(buildApp()).post(`/api/v1/agent/sessions/${SESSION_ID}/play-link`)
      .set('Authorization', `Bearer ${key.fullKey}`).send({ ttlSeconds: 120 });
    expect(res.status).toBe(201);
    expect(res.body.singleUse).toBe(true);
    const token = res.body.playUrl.split('/play/')[1];
    expect(token).toMatch(/^pll_/);
    expect(dbState.deletes).toBe(1);
    const stored = dbState.inserts.at(-1)!.values;
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.sessionId).toBe(SESSION_ID);
    const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(100_000);
    expect(ttl).toBeLessThanOrEqual(120_000);
  });

  it('validates ttl, scope and session state', async () => {
    let key = makeKey();
    dbState.selects.push([key.record]);
    expect((await request(buildApp()).post(`/api/v1/agent/sessions/${SESSION_ID}/play-link`)
      .set('Authorization', `Bearer ${key.fullKey}`).send({ ttlSeconds: 5000 })).status).toBe(400);

    key = makeKey({ scopes: ['sessions:read'] });
    dbState.selects.push([key.record]);
    expect((await request(buildApp()).post(`/api/v1/agent/sessions/${SESSION_ID}/play-link`)
      .set('Authorization', `Bearer ${key.fullKey}`).send({})).status).toBe(403);

    key = makeKey();
    dbState.selects.push([key.record], [makeSession({ status: 'ended' })]);
    const ended = await request(buildApp()).post(`/api/v1/agent/sessions/${SESSION_ID}/play-link`)
      .set('Authorization', `Bearer ${key.fullKey}`).send({});
    expect(ended.status).toBe(400);
    expect(ended.body.error.code).toBe('session_ended');

    key = makeKey();
    dbState.selects.push([key.record], []);
    expect((await request(buildApp()).post(`/api/v1/agent/sessions/other/play-link`)
      .set('Authorization', `Bearer ${key.fullKey}`).send({})).status).toBe(404);
  });
});

describe('hosted play page', () => {
  it('restricts framing to the key allowed origins', async () => {
    const { record } = makeKey({ allowedOrigins: ['https://game.example.com', 'javascript:alert(1)', 'https://a.com; script-src *'] });
    dbState.selects.push([makeLink()], [makeSession()], [record]);
    const res = await request(buildApp()).get('/play/pll_validtoken');
    expect(res.status).toBe(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('frame-ancestors https://game.example.com');
    expect(csp).not.toContain('script-src *');
    expect(csp).not.toContain('javascript');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.text).not.toContain('pll_validtoken');
  });

  it('cannot be framed anywhere when no origin is configured', async () => {
    const { record } = makeKey({ allowedOrigins: [] });
    dbState.selects.push([makeLink()], [makeSession()], [record]);
    const res = await request(buildApp()).get('/play/pll_validtoken');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('does not consume the link on page load, and shows an error page for invalid/used/expired links', async () => {
    const { record } = makeKey();
    dbState.selects.push([makeLink()], [makeSession()], [record]);
    await request(buildApp()).get('/play/pll_validtoken');
    expect(dbState.updates).toHaveLength(0);

    for (const link of [[], [makeLink({ redeemedAt: new Date() })], [makeLink({ linkExpiresAt: new Date(Date.now() - 1000) })]]) {
      dbState.selects.push(link);
      const res = await request(buildApp()).get('/play/pll_validtoken');
      expect(res.status).toBe(410);
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    }
    expect((await request(buildApp()).get('/play/not-a-link')).status).toBe(410);
  });
});

describe('POST /play/redeem', () => {
  const redeem = () => request(buildApp()).post('/api/v1/agent/play/redeem').send({ token: 'pll_validtoken' });

  it('exchanges a valid link once for a session-bound access token', async () => {
    const { record } = makeKey();
    dbState.selects.push([makeLink()], [makeSession()], [record]);
    dbState.updateReturns.push([makeLink({ redeemedAt: new Date(), accessExpiresAt: new Date(Date.now() + 1000) })]);
    const res = await redeem();
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toMatch(/^pla_/);
    expect(res.body).toMatchObject({ sessionId: SESSION_ID, personaName: 'Guild Master', allowedOrigins: ['https://game.example.com'] });
    const stored = dbState.updates.at(-1);
    expect(stored.accessTokenHash).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(res.body.accessToken);
    // access never outlives the session
    expect(new Date(stored.accessExpiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 2 * 3600_000);
  });

  it('rejects reuse, expiry, lost races, ended sessions and revoked keys', async () => {
    const { record } = makeKey();
    dbState.selects.push([makeLink({ redeemedAt: new Date() })]);
    expect((await redeem()).status).toBe(401);

    dbState.selects.push([makeLink({ linkExpiresAt: new Date(Date.now() - 1) })]);
    expect((await redeem()).status).toBe(401);

    // concurrent redeem: atomic UPDATE matches no row
    dbState.selects.push([makeLink()], [makeSession()], [record]);
    dbState.updateReturns.push([]);
    expect((await redeem()).status).toBe(401);

    dbState.selects.push([makeLink()], [makeSession({ status: 'ended' })], [record]);
    expect((await redeem()).status).toBe(401);

    dbState.selects.push([makeLink()], [makeSession()], [{ ...record, revokedAt: new Date() }]);
    expect((await redeem()).status).toBe(401);

    dbState.selects.push([makeLink()], [makeSession({ agentKeyId: 'someone-else' })], [record]);
    expect((await redeem()).status).toBe(401);
  });
});

describe('play access token endpoints', () => {
  const access = (extra: Partial<any> = {}) => makeLink({
    redeemedAt: new Date(), accessTokenHash: 'a', accessExpiresAt: new Date(Date.now() + 60_000), ...extra,
  });
  const post = (path: string, token: string | null, body: any = {}) => {
    const r = request(buildApp()).post(`/api/v1/agent/play/${path}`);
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r.send(body);
  };

  it('requires a valid, unexpired access token (a link token is not an access token)', async () => {
    expect((await post('messages', null, { message: 'hi' })).status).toBe(401);
    expect((await post('messages', 'pll_validtoken', { message: 'hi' })).status).toBe(401);
    dbState.selects.push([access({ accessExpiresAt: new Date(Date.now() - 1) })]);
    expect((await post('messages', 'pla_expired', { message: 'hi' })).status).toBe(401);
    dbState.selects.push([]);
    expect((await post('end', 'pla_unknown')).status).toBe(401);
  });

  it('runs the normal message handler for the token session only', async () => {
    const { record } = makeKey();
    const session = makeSession({ metadata: { _gameContext: { sceneSummary: 'Caravan lost' } } });
    dbState.selects.push([access()], [session], [record]); // resolveAccessToken
    dbState.selects.push([session]);                       // handler getSessionForKey
    const res = await post('messages', 'pla_valid', { message: 'hello from the player', sessionId: 'other-session' });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(SESSION_ID);
    expect(res.body.reply.text).toBe('AI reply text');
    expect((vi.mocked(generateAIResponse).mock.calls.at(-1)![0] as any).context.situation).toContain('Caravan lost');
  });

  it('enforces the key scopes on the play endpoints', async () => {
    const { record } = makeKey({ scopes: ['sessions:create'] });
    dbState.selects.push([access()], [makeSession()], [record]);
    expect((await post('messages', 'pla_valid', { message: 'hi' })).status).toBe(403);
  });

  it('ends the session through the normal handler', async () => {
    const { record } = makeKey();
    const session = makeSession();
    dbState.selects.push([access()], [session], [record], [session]);
    const res = await post('end', 'pla_valid');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: SESSION_ID, status: 'ended', feedbackStatus: 'queued' });
  });

  it('exposes no session id in the play API path', async () => {
    const res = await request(buildApp()).post('/api/v1/agent/play/sessions/other/messages').send({});
    expect([401, 404]).toContain(res.status);
  });
});
