/**
 * Agent API route integration tests.
 * Uses supertest + vi.mock for db/storage/fileManager/AI services.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const TEST_PEPPER = 'test-agent-api-pepper-32-chars!!!';

// ─── Thenable query builder helper ───────────────────────────────────────────
// Drizzle queries can be awaited directly OR chained with .limit() before await.
// This factory returns an object that satisfies both patterns.
function makeQueryResult(rows: any[]) {
  const obj: any = {
    then(resolve: (v: any) => any, reject?: (e: any) => any) {
      return Promise.resolve(rows).then(resolve, reject);
    },
    catch(fn: (e: any) => any) {
      return Promise.resolve(rows).catch(fn);
    },
    finally(fn: () => void) {
      return Promise.resolve(rows).finally(fn);
    },
    limit(n: number) {
      return makeQueryResult(rows.slice(0, n));
    },
  };
  return obj;
}

// ─── Hoisted mutable DB state ─────────────────────────────────────────────────
// Each test pushes expected query results in order; the mock pops them.
const dbQueue = vi.hoisted(() => {
  const queue: any[][] = [];
  return {
    push(rows: any[]) { queue.push(rows); },
    shift() { return queue.shift() ?? []; },
    clear() { queue.length = 0; },
    get length() { return queue.length; },
  };
});

vi.mock('../../server/storage', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => makeQueryResult(dbQueue.shift()),
      }),
    }),
    insert: () => ({
      values: (_vals: any) => ({
        onConflictDoNothing: () => Promise.resolve(),
        onConflictDoUpdate: () => Promise.resolve(),
        catch: () => Promise.resolve(),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ catch: () => {} }),
      }),
    }),
  },
  storage: {
    createScenarioRun: vi.fn().mockResolvedValue({ id: 'srun-1' }),
    createPersonaRun: vi.fn().mockResolvedValue({ id: 'prun-1' }),
    createChatMessage: vi.fn().mockResolvedValue({}),
    getChatMessagesByPersonaRun: vi.fn().mockResolvedValue([]),
    updatePersonaRun: vi.fn().mockResolvedValue({}),
    getSimulationState: vi.fn().mockResolvedValue(null),
    saveSimulationState: vi.fn().mockResolvedValue(undefined),
    getPersonaRun: vi.fn().mockResolvedValue(null),
    createSimulationEvent: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getAllScenarios: vi.fn().mockResolvedValue([]),
    getPersonaByMBTI: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../server/services/aiServiceFactory', () => ({
  generateAIResponse: vi.fn().mockResolvedValue({
    content: 'AI reply text',
    emotion: '중립',
    emotionReason: 'neutral',
  }),
}));

vi.mock('../../server/services/simulation/simulationEngine', () => ({
  applySimulationPatch: vi.fn().mockReturnValue({
    version: 1, stage: 'intro', npcEmotions: { anger: 30, trust: 50, confusion: 20, interest: 50 },
    currentScore: 0, recentTurnScores: [], recentIncidents: [], simulationDirectives: [],
    summary: { totalTurns: 0, totalIncidents: 0, averageScore: 0, maxAnger: 30, minTrust: 50 },
  }),
  getOrCreateSessionContext: vi.fn().mockReturnValue({ simulationState: {} }),
  getSessionState: vi.fn().mockReturnValue(null),
}));

vi.mock('../../server/services/simulation/evaluateUserResponse', () => ({
  evaluateUserResponse: vi.fn().mockResolvedValue({
    turnScore: { turnId: 't-1', turnIndex: 0, clarity: 60, empathy: 60, logic: 60, ownership: 60, actionPlan: 60, total: 60, evaluationMethod: 'rule', evaluationConfidence: 40 },
    emotionDelta: {}, skipped: false, method: 'rule',
  }),
}));

vi.mock('../../server/routes/routerHelpers', () => ({
  generateAndSaveFeedback: vi.fn().mockResolvedValue(null),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { generateAgentApiKey } from '../../server/utils/agentApiKey';
import agentApiRouter from '../../server/routes/agentApi';
import { fileManager } from '../../server/services/fileManager';

// ─── Constants ────────────────────────────────────────────────────────────────
const SCENARIO_ID = 'scenario-abc';
const PERSONA_ID = 'persona-xyz';
const ORG_ID = 'org-test-1';
const KEY_ID = 'agent-key-id-1';

const MOCK_SCENARIO = {
  id: SCENARIO_ID,
  title: 'Test Scenario',
  description: 'A test scenario',
  category: 'sales',
  tags: ['communication'],
  difficulty: 3,
  targetTurns: 10,
  isDeleted: false,
  personas: [
    { id: PERSONA_ID, name: 'Test Persona', role: 'Manager', mbti: 'INTJ', position: 'Manager', department: 'Sales' },
  ],
};

function makeAgentKeyRecord(overrides: Partial<any> = {}) {
  process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  const { fullKey, keyHash, keyPrefix } = generateAgentApiKey('live');
  return {
    fullKey,
    record: {
      id: KEY_ID,
      keyHash,
      keyPrefix,
      isActive: true,
      revokedAt: null,
      expiresAt: null,
      allowedIps: [],
      scopes: ['scenarios:read', 'personas:read', 'sessions:create', 'sessions:read', 'sessions:message', 'sessions:end'],
      organizationId: ORG_ID,
      rateLimitPerMinute: 60,
      ...overrides,
    },
  };
}

function makeActiveSession(agentKeyId = KEY_ID, id = 'ags_testsession01234') {
  return {
    id,
    agentKeyId,
    organizationId: ORG_ID,
    externalUserId: 'ext-user-1',
    externalSessionId: null,
    personaRunId: 'prun-1',
    scenarioId: SCENARIO_ID,
    personaId: PERSONA_ID,
    language: 'ko',
    difficulty: 3,
    status: 'active',
    metadata: null,
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 86400 * 1000),
    createdAt: new Date(),
    endedAt: null,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/agent', agentApiRouter);
  return app;
}

beforeEach(() => {
  process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  dbQueue.clear();
  vi.mocked(fileManager.getAllScenarios).mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.AGENT_API_KEY_PEPPER;
});

// ─── Auth-layer checks (middleware integration) ───────────────────────────────
describe('Authentication via agent route', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(buildApp()).get('/api/v1/agent/scenarios');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when Bearer token has invalid format', async () => {
    const res = await request(buildApp())
      .get('/api/v1/agent/scenarios')
      .set('Authorization', 'Bearer bad-format');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when DB has no matching key prefix', async () => {
    const { fullKey } = makeAgentKeyRecord();
    dbQueue.push([]); // auth middleware: no candidates found
    const res = await request(buildApp())
      .get('/api/v1/agent/scenarios')
      .set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 for a revoked key (revokedAt set)', async () => {
    const { fullKey, record } = makeAgentKeyRecord({ revokedAt: new Date(Date.now() - 1000) });
    dbQueue.push([record]);
    const res = await request(buildApp())
      .get('/api/v1/agent/scenarios')
      .set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('revoked_api_key');
  });

  it('returns 401 for an expired key', async () => {
    const { fullKey, record } = makeAgentKeyRecord({ expiresAt: new Date(Date.now() - 1000) });
    dbQueue.push([record]);
    const res = await request(buildApp())
      .get('/api/v1/agent/scenarios')
      .set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('expired_api_key');
  });
});

// ─── Scope enforcement ────────────────────────────────────────────────────────
describe('Scope enforcement', () => {
  it('returns 403 when key lacks scenarios:read for GET /scenarios', async () => {
    const { fullKey, record } = makeAgentKeyRecord({ scopes: ['sessions:read'] });
    dbQueue.push([record]);
    const res = await request(buildApp())
      .get('/api/v1/agent/scenarios')
      .set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('returns 403 when key lacks sessions:create for POST /sessions', async () => {
    const { fullKey, record } = makeAgentKeyRecord({ scopes: ['scenarios:read'] });
    dbQueue.push([record]);
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({ scenarioId: SCENARIO_ID, personaId: PERSONA_ID, externalUserId: 'user-1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('returns 403 when key lacks sessions:message for POST /sessions/:id/messages', async () => {
    const { fullKey, record } = makeAgentKeyRecord({ scopes: ['sessions:read'] });
    dbQueue.push([record]);
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions/ags_testsession01234/messages')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({ message: 'Hello' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('returns 403 when key lacks sessions:end for POST /sessions/:id/end', async () => {
    const { fullKey, record } = makeAgentKeyRecord({ scopes: ['sessions:read'] });
    dbQueue.push([record]);
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions/ags_testsession01234/end')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });
});

// ─── GET /scenarios ───────────────────────────────────────────────────────────
describe('GET /api/v1/agent/scenarios', () => {
  it('returns empty list when no scenarios are assigned to the key', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    dbQueue.push([record]);  // auth
    dbQueue.push([]);         // agentKeyScenarios (no scenarios assigned)
    const res = await request(buildApp())
      .get('/api/v1/agent/scenarios')
      .set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(200);
    expect(res.body.scenarios).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('returns filtered scenarios when key has scenario access', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    vi.mocked(fileManager.getAllScenarios).mockResolvedValue([MOCK_SCENARIO] as any);
    dbQueue.push([record]);  // auth
    dbQueue.push([{ agentKeyId: KEY_ID, scenarioId: SCENARIO_ID }]); // agentKeyScenarios
    const res = await request(buildApp())
      .get('/api/v1/agent/scenarios')
      .set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(200);
    expect(res.body.scenarios).toHaveLength(1);
    expect(res.body.scenarios[0].id).toBe(SCENARIO_ID);
  });
});

// ─── POST /sessions ───────────────────────────────────────────────────────────
describe('POST /api/v1/agent/sessions', () => {
  it('returns 400 on missing required fields', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    dbQueue.push([record]); // auth
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('returns 404 when scenarioId is not in key allowlist', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    dbQueue.push([record]); // auth
    dbQueue.push([]);        // agentKeyScenarios check → no access
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({ scenarioId: SCENARIO_ID, personaId: PERSONA_ID, externalUserId: 'user-1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('scenario_not_found');
  });

  it('returns 404 when scenario is in allowlist but fileManager has no matching scenario', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    vi.mocked(fileManager.getAllScenarios).mockResolvedValue([]);
    dbQueue.push([record]); // auth
    dbQueue.push([{ agentKeyId: KEY_ID, scenarioId: SCENARIO_ID }]); // allowlist ✓
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({ scenarioId: SCENARIO_ID, personaId: PERSONA_ID, externalUserId: 'user-1' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('scenario_not_found');
  });
});

// ─── Happy-path end-to-end flow ───────────────────────────────────────────────
describe('Happy-path: create → message → end session flow', () => {
  it('creates a session, sends a message, and ends the session successfully', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    const SESSION_ID = 'ags_happypath01234567';
    const session = { ...makeActiveSession(KEY_ID, SESSION_ID), externalUserId: 'user-happy-1' };
    vi.mocked(fileManager.getAllScenarios).mockResolvedValue([MOCK_SCENARIO] as any);

    // ── Step 1: Create session ─────────────────────────────────────────────
    dbQueue.push([record]);  // auth
    dbQueue.push([{ agentKeyId: KEY_ID, scenarioId: SCENARIO_ID }]); // scenario allowlist
    dbQueue.push([session]); // re-fetch created session

    const createRes = await request(buildApp())
      .post('/api/v1/agent/sessions')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({ scenarioId: SCENARIO_ID, personaId: PERSONA_ID, externalUserId: 'user-happy-1' });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('sessionId', SESSION_ID);
    expect(createRes.body).toHaveProperty('status', 'active');
    expect(createRes.body).toHaveProperty('scenarioId', SCENARIO_ID);
    expect(createRes.body).toHaveProperty('personaId', PERSONA_ID);
    expect(createRes.body).toHaveProperty('externalUserId', 'user-happy-1');

    // ── Step 2: Send a message ─────────────────────────────────────────────
    dbQueue.push([record]);   // auth
    dbQueue.push([session]);  // getSessionForKey

    const msgRes = await request(buildApp())
      .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
      .set('Authorization', `Bearer ${fullKey}`)
      .send({ message: 'I understand the situation and will take ownership of this issue right away.' });

    expect(msgRes.status).toBe(200);
    expect(msgRes.body).toHaveProperty('reply');
    expect(msgRes.body.reply.text).toBe('AI reply text');
    expect(msgRes.body.reply).toHaveProperty('emotionLabel');
    expect(msgRes.body).toHaveProperty('sessionId', SESSION_ID);
    expect(msgRes.body).toHaveProperty('turnId');

    // ── Step 3: End session ────────────────────────────────────────────────
    dbQueue.push([record]);   // auth
    dbQueue.push([session]);  // getSessionForKey

    const endRes = await request(buildApp())
      .post(`/api/v1/agent/sessions/${SESSION_ID}/end`)
      .set('Authorization', `Bearer ${fullKey}`)
      .send({});

    expect(endRes.status).toBe(200);
    expect(endRes.body.sessionId).toBe(SESSION_ID);
    expect(endRes.body.status).toBe('ended');
    expect(endRes.body).toHaveProperty('endedAt');
  });
});

// ─── POST /sessions/:id/messages ─────────────────────────────────────────────
describe('POST /api/v1/agent/sessions/:id/messages', () => {
  it('returns 400 when message body is empty', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    const session = makeActiveSession();
    dbQueue.push([record]);   // auth
    dbQueue.push([session]);  // getSessionForKey (has .limit(1))
    const res = await request(buildApp())
      .post(`/api/v1/agent/sessions/${session.id}/messages`)
      .set('Authorization', `Bearer ${fullKey}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // Security design: getSessionForKey() queries WHERE id=? AND agentKeyId=?.
  // If no row matches (session belongs to a different key), it returns 404 rather
  // than 403 to avoid leaking information about session existence to other callers.
  it('returns 404 (security: resource hiding) when session belongs to a different key', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    dbQueue.push([record]); // auth
    dbQueue.push([]);        // getSessionForKey → empty (different key → same as not found)
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions/ags_notmine000001/messages')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({ message: 'Hello there' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });
});

// ─── POST /sessions/:id/end ───────────────────────────────────────────────────
describe('POST /api/v1/agent/sessions/:id/end', () => {
  // Same resource-hiding pattern: 404 (not 403) for cross-key session access
  it('returns 404 (security: resource hiding) when session does not exist for this key', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    dbQueue.push([record]); // auth
    dbQueue.push([]);        // getSessionForKey → empty
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions/ags_ghost_session0000/end')
      .set('Authorization', `Bearer ${fullKey}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('session_not_found');
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────
describe('Idempotency-Key handling', () => {
  it('returns 409 on idempotency key reuse with a different request body', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    dbQueue.push([record]); // auth
    // Idempotency lookup returns an existing record with a DIFFERENT body hash
    dbQueue.push([{
      key: 'idem-key-conflict',
      agentKeyId: KEY_ID,
      requestHash: 'completelydifferenthash0000000000000000000000000000000000000000',
      responseBody: {},
      statusCode: 201,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    }]);
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions')
      .set('Authorization', `Bearer ${fullKey}`)
      .set('Idempotency-Key', 'idem-key-conflict')
      .send({ scenarioId: SCENARIO_ID, personaId: PERSONA_ID, externalUserId: 'user-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('idempotency_key_conflict');
  });

  it('replays cached response on idempotency key reuse with same body', async () => {
    const { fullKey, record } = makeAgentKeyRecord();
    const cachedBody = { sessionId: 'ags_cached000000000', status: 'active' };
    // Build body hash matching the actual request body
    const { createHash } = await import('crypto');
    const requestBody = { scenarioId: SCENARIO_ID, personaId: PERSONA_ID, externalUserId: 'user-1', difficulty: 4, language: 'ko' };
    const bodyHash = createHash('sha256').update(JSON.stringify(requestBody)).digest('hex');

    dbQueue.push([record]); // auth
    dbQueue.push([{
      key: 'idem-key-replay',
      agentKeyId: KEY_ID,
      requestHash: bodyHash,
      responseBody: cachedBody,
      statusCode: 201,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    }]);
    const res = await request(buildApp())
      .post('/api/v1/agent/sessions')
      .set('Authorization', `Bearer ${fullKey}`)
      .set('Idempotency-Key', 'idem-key-replay')
      .send(requestBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(cachedBody);
  });
});
