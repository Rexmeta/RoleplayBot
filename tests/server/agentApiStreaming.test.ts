/**
 * SSE streaming tests for POST /api/v1/agent/sessions/:id/messages
 *
 * Covers:
 *  - Non-streaming requests still return JSON (backward-compat)
 *  - Accept: text/event-stream triggers SSE headers and event format
 *  - event: delta chunks are emitted correctly
 *  - event: done includes emotion, turnId, usage, tokensEstimated: true
 *  - event: error is emitted and response closed when AI call throws
 *  - Messages are persisted to persona_runs chat history after stream
 *  - sessionUsage accumulates correctly in session metadata
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const TEST_PEPPER = 'test-streaming-pepper-32chars!!!';

// ─── Thenable query builder helper ───────────────────────────────────────────
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
const dbQueue = vi.hoisted(() => {
  const queue: any[][] = [];
  return {
    push(rows: any[]) { queue.push(rows); },
    shift() { return queue.shift() ?? []; },
    clear() { queue.length = 0; },
    get length() { return queue.length; },
  };
});

// Captured update args so tests can inspect what was written to DB
const dbUpdateCalls = vi.hoisted(() => ({ calls: [] as any[] }));

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
      set: (vals: any) => ({
        where: () => {
          dbUpdateCalls.calls.push(vals);
          return { catch: () => {} };
        },
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

// generateStreamingAIResponse is the primary mock target for these tests;
// generateAIResponse covers the non-streaming path.
vi.mock('../../server/services/aiServiceFactory', () => ({
  generateAIResponse: vi.fn().mockResolvedValue({
    content: 'AI reply text',
    emotion: '중립',
    emotionReason: 'neutral',
  }),
  generateStreamingAIResponse: vi.fn(),
}));

vi.mock('../../server/services/simulation/simulationEngine', () => ({
  applySimulationPatch: vi.fn().mockReturnValue({
    version: 1,
    stage: 'intro',
    npcEmotions: { anger: 30, trust: 50, confusion: 20, interest: 50 },
    currentScore: 0,
    recentTurnScores: [],
    recentIncidents: [],
    simulationDirectives: [],
    summary: { totalTurns: 0, totalIncidents: 0, averageScore: 0, maxAnger: 30, minTrust: 50 },
  }),
  getOrCreateSessionContext: vi.fn().mockReturnValue({ simulationState: {} }),
  getSessionState: vi.fn().mockReturnValue(null),
}));

vi.mock('../../server/services/simulation/evaluateUserResponse', () => ({
  evaluateUserResponse: vi.fn().mockResolvedValue({
    turnScore: {
      turnId: 't-1', turnIndex: 0,
      clarity: 60, empathy: 60, logic: 60, ownership: 60, actionPlan: 60, total: 60,
      evaluationMethod: 'rule', evaluationConfidence: 40,
    },
    emotionDelta: {},
    skipped: false,
    method: 'rule',
  }),
}));

vi.mock('../../server/routes/routerHelpers', () => ({
  generateAndSaveFeedback: vi.fn().mockResolvedValue(null),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { generateAgentApiKey } from '../../server/utils/agentApiKey';
import agentApiRouter from '../../server/routes/agentApi';
import { fileManager } from '../../server/services/fileManager';
import { generateStreamingAIResponse } from '../../server/services/aiServiceFactory';
import { storage } from '../../server/storage';

// ─── Constants ────────────────────────────────────────────────────────────────
const SCENARIO_ID = 'scenario-sse-1';
const PERSONA_ID  = 'persona-sse-1';
const ORG_ID      = 'org-sse-test';
const KEY_ID      = 'agent-key-sse-1';
const SESSION_ID  = 'ags_ssetest000001234';

const MOCK_SCENARIO = {
  id: SCENARIO_ID,
  title: 'SSE Test Scenario',
  description: 'Streaming scenario for tests',
  category: 'communication',
  tags: [],
  difficulty: 3,
  targetTurns: 10,
  isDeleted: false,
  personas: [
    { id: PERSONA_ID, name: 'SSE Persona', role: 'Manager', mbti: 'INTJ', position: 'Manager', department: 'Sales' },
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

function makeActiveSession(overrides: Partial<any> = {}) {
  return {
    id: SESSION_ID,
    agentKeyId: KEY_ID,
    organizationId: ORG_ID,
    externalUserId: 'ext-user-sse',
    externalSessionId: null,
    personaRunId: 'prun-sse-1',
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
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/agent', agentApiRouter);
  return app;
}

/** Parse raw SSE text into an array of { event, data } objects. */
function parseSseEvents(text: string): Array<{ event: string; data: any }> {
  const blocks = text.split(/\n\n+/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    let event = 'message';
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length).trim();
      if (line.startsWith('data: '))  dataStr = line.slice('data: '.length).trim();
    }
    let data: any = dataStr;
    try { data = JSON.parse(dataStr); } catch { /* keep as string */ }
    return { event, data };
  });
}

/** Returns an async generator that yields the provided chunks. */
async function* makeChunkStream(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) yield chunk;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  dbQueue.clear();
  dbUpdateCalls.calls = [];
  vi.mocked(fileManager.getAllScenarios).mockResolvedValue([MOCK_SCENARIO] as any);
  vi.mocked(storage.createChatMessage).mockResolvedValue({} as any);
  vi.mocked(storage.getChatMessagesByPersonaRun).mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.AGENT_API_KEY_PEPPER;
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SSE streaming: POST /api/v1/agent/sessions/:id/messages', () => {

  // ── 1. Non-streaming backward compat ────────────────────────────────────────
  describe('non-streaming path (no Accept header)', () => {
    it('returns JSON with reply when Accept is not text/event-stream', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      dbQueue.push([record]);   // auth
      dbQueue.push([session]);  // getSessionForKey

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .send({ message: 'Hello' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toHaveProperty('reply');
      expect(res.body.reply.text).toBe('AI reply text');
      expect(res.body.reply).toHaveProperty('emotionLabel');
    });

    it('does not call generateStreamingAIResponse on the non-streaming path', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      dbQueue.push([record]);
      dbQueue.push([session]);

      await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .send({ message: 'Hello' });

      expect(vi.mocked(generateStreamingAIResponse)).not.toHaveBeenCalled();
    });
  });

  // ── 2. SSE response headers ──────────────────────────────────────────────────
  describe('SSE response headers', () => {
    it('sets Content-Type text/event-stream and Cache-Control no-cache', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Hello world'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Hi' });

      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      expect(res.headers['cache-control']).toBe('no-cache');
    });
  });

  // ── 3. delta events ──────────────────────────────────────────────────────────
  describe('event: delta', () => {
    it('emits delta events for each safe chunk', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      // Provide enough content to exceed the META_WINDOW (6 chars) so safeEnd > emittedUpTo
      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Hello, how are you doing today?'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Hello' });

      const events = parseSseEvents(res.body as string);
      const deltas = events.filter(e => e.event === 'delta');

      expect(deltas.length).toBeGreaterThan(0);
      deltas.forEach(d => expect(d.data).toHaveProperty('content'));
    });

    it('concatenated delta content equals full AI response text (excluding META marker)', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      const expectedText = 'This is the full AI response without any meta.';
      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream([expectedText])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Test' });

      const events = parseSseEvents(res.body as string);
      const assembled = events
        .filter(e => e.event === 'delta')
        .map(e => e.data.content as string)
        .join('');

      expect(assembled).toBe(expectedText);
    });

    it('strips [META:{...}] marker from delta content', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      const meta = JSON.stringify({ emotion: '기쁨', emotionReason: 'happy' });
      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream([`Nice to meet you![META:${meta}]`])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Hello' });

      const events = parseSseEvents(res.body as string);
      const assembled = events
        .filter(e => e.event === 'delta')
        .map(e => e.data.content as string)
        .join('');

      expect(assembled).not.toContain('[META:');
      expect(assembled).toContain('Nice to meet you!');
    });
  });

  // ── 4. done event fields ─────────────────────────────────────────────────────
  describe('event: done', () => {
    it('includes emotion, turnId, usage, and tokensEstimated: true', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      const meta = JSON.stringify({ emotion: '기쁨', emotionReason: 'test reason' });
      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream([`AI response content here.[META:${meta}]`])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'How are you?' });

      const events = parseSseEvents(res.body as string);
      const done = events.find(e => e.event === 'done');

      expect(done).toBeDefined();
      expect(done!.data.emotion).toBe('기쁨');
      expect(done!.data.turnId).toBeDefined();
      expect(done!.data.usage).toBeDefined();
      expect(done!.data.usage.tokensEstimated).toBe(true);
      expect(done!.data.usage.requestCount).toBe(1);
      expect(done!.data.usage.inputTokens).toBeGreaterThan(0);
      expect(done!.data.usage.outputTokens).toBeGreaterThan(0);
    });

    it('uses 중립 as default emotion when no META marker is present', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Plain response without any meta marker.'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Question?' });

      const events = parseSseEvents(res.body as string);
      const done = events.find(e => e.event === 'done');

      expect(done).toBeDefined();
      expect(done!.data.emotion).toBe('중립');
    });

    it('done event has exactly one occurrence', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Single chunk response.'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Hi' });

      const events = parseSseEvents(res.body as string);
      const doneEvents = events.filter(e => e.event === 'done');

      expect(doneEvents).toHaveLength(1);
    });
  });

  // ── 5. error event ───────────────────────────────────────────────────────────
  describe('event: error', () => {
    it('emits event: error and closes response when AI stream throws', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      vi.mocked(generateStreamingAIResponse).mockRejectedValue(
        new Error('Simulated AI provider failure')
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Trigger error' });

      const events = parseSseEvents(res.body as string);
      const errorEvent = events.find(e => e.event === 'error');

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data).toHaveProperty('message');
      expect(typeof errorEvent!.data.message).toBe('string');
    });

    it('does not emit a done event after an error', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      vi.mocked(generateStreamingAIResponse).mockRejectedValue(
        new Error('Fatal AI error')
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Trigger error' });

      const events = parseSseEvents(res.body as string);
      const doneEvents = events.filter(e => e.event === 'done');

      expect(doneEvents).toHaveLength(0);
    });
  });

  // ── 6. Chat history persistence ──────────────────────────────────────────────
  describe('chat history persistence', () => {
    it('persists user and AI messages to persona run after stream completes', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession({ personaRunId: 'prun-persist-1' });

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['AI response for persistence test.'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Persist this message' });

      const createChatCalls = vi.mocked(storage.createChatMessage).mock.calls;
      expect(createChatCalls.length).toBeGreaterThanOrEqual(2);

      const senders = createChatCalls.map(([arg]: any[]) => arg.sender);
      expect(senders).toContain('user');
      expect(senders).toContain('ai');

      const userCall = createChatCalls.find(([arg]: any[]) => arg.sender === 'user');
      expect(userCall![0].message).toBe('Persist this message');
      expect(userCall![0].personaRunId).toBe('prun-persist-1');
    });

    it('saves AI message with emotion from META marker', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession({ personaRunId: 'prun-emotion-1' });

      const meta = JSON.stringify({ emotion: '놀람', emotionReason: 'surprise' });
      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream([`Wow, interesting![META:${meta}]`])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Surprise me' });

      const aiCall = vi.mocked(storage.createChatMessage).mock.calls
        .find(([arg]: any[]) => arg.sender === 'ai');

      expect(aiCall).toBeDefined();
      expect(aiCall![0].emotion).toBe('놀람');
      expect(aiCall![0].message).toContain('Wow, interesting!');
      expect(aiCall![0].message).not.toContain('[META:');
    });

    it('does not persist messages when session has no personaRunId', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession({ personaRunId: null });

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['No run response.'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'No run' });

      expect(vi.mocked(storage.createChatMessage)).not.toHaveBeenCalled();
    });
  });

  // ── 7. sessionUsage accumulation ─────────────────────────────────────────────
  describe('sessionUsage accumulation', () => {
    it('accumulates requestCount and token counts on first message', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession({ metadata: null });

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Short reply.'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Usage test' });

      // The route writes sessionUsage via db.update().set(...)
      const updateCall = dbUpdateCalls.calls.find(
        (v: any) => v.metadata && v.metadata.sessionUsage
      );
      expect(updateCall).toBeDefined();

      const usage = updateCall.metadata.sessionUsage;
      expect(usage.requestCount).toBe(1);
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
    });

    it('increments requestCount when session already has existing usage', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const existingUsage = { requestCount: 3, inputTokens: 100, outputTokens: 200 };
      const session = makeActiveSession({
        metadata: { sessionUsage: existingUsage },
      });

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Another reply.'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Follow-up message' });

      const updateCall = dbUpdateCalls.calls.find(
        (v: any) => v.metadata && v.metadata.sessionUsage
      );
      expect(updateCall).toBeDefined();

      const usage = updateCall.metadata.sessionUsage;
      expect(usage.requestCount).toBe(4);
      expect(usage.inputTokens).toBeGreaterThan(100);
      expect(usage.outputTokens).toBeGreaterThan(200);
    });

    it('done event usage reflects updated sessionUsage', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const existingUsage = { requestCount: 2, inputTokens: 50, outputTokens: 80 };
      const session = makeActiveSession({
        metadata: { sessionUsage: existingUsage },
      });

      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Usage in done event.'])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Check done usage' });

      const events = parseSseEvents(res.body as string);
      const done = events.find(e => e.event === 'done');

      expect(done).toBeDefined();
      expect(done!.data.usage.requestCount).toBe(3);
      expect(done!.data.usage.inputTokens).toBeGreaterThan(50);
      expect(done!.data.usage.outputTokens).toBeGreaterThan(80);
      expect(done!.data.usage.tokensEstimated).toBe(true);
    });
  });

  // ── 8. Multi-chunk streaming ─────────────────────────────────────────────────
  describe('multi-chunk streaming', () => {
    it('correctly assembles text from multiple chunks with META in last chunk', async () => {
      const { fullKey, record } = makeAgentKeyRecord();
      const session = makeActiveSession();

      const meta = JSON.stringify({ emotion: '신뢰', emotionReason: 'trust' });
      vi.mocked(generateStreamingAIResponse).mockResolvedValue(
        makeChunkStream(['Hello ', 'there, ', `how can I help you?[META:${meta}]`])
      );

      dbQueue.push([record]);
      dbQueue.push([session]);

      const res = await request(buildApp())
        .post(`/api/v1/agent/sessions/${SESSION_ID}/messages`)
        .set('Authorization', `Bearer ${fullKey}`)
        .set('Accept', 'text/event-stream')
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => callback(null, data));
        })
        .send({ message: 'Hi!' });

      const events = parseSseEvents(res.body as string);
      const assembled = events
        .filter(e => e.event === 'delta')
        .map(e => e.data.content as string)
        .join('');

      expect(assembled).toBe('Hello there, how can I help you?');

      const done = events.find(e => e.event === 'done');
      expect(done!.data.emotion).toBe('신뢰');
    });
  });
});
