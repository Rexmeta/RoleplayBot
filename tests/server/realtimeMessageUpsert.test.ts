/**
 * Tests for the realtime-messages upsert endpoint.
 *
 * Three layers:
 * 1. Pure algorithm tests — verify the turnIndex formula is correct
 * 2. Route-level integration tests — exercise POST /:id/realtime-messages with
 *    a mocked DB and verify the actual DB upsert values include a unique
 *    turnIndex equal to each message's array index.
 * 3. Idempotency / no-duplicate tests — simulate ON CONFLICT DO UPDATE with a
 *    Map keyed by (personaRunId, turnIndex, sender) and assert that replaying
 *    the same payload never grows the row count beyond the unique tuple count.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { storage } from '../../server/storage';
import { enqueueFeedbackJob, resetFeedbackJob } from '../../server/services/feedbackGenerationService';

// ─── Captured upsert calls + simulated DB state ───────────────────────────────
// db.insert().values() pushes the values object here for inspection AND writes
// to dbState which models the ON CONFLICT DO UPDATE unique-key deduplication.
const capturedInserts = vi.hoisted(() => {
  const calls: any[] = [];
  // Simulates the DB table: key = "personaRunId|turnIndex|sender", value = row
  const state = new Map<string, any>();
  return {
    push(v: any) {
      calls.push(v);
      const positionalKey = `${v.personaRunId}|${v.turnIndex}|${v.sender}`;
      const voiceEntry = v.voiceTurnId
        ? [...state.entries()].find(([, row]) =>
            row.personaRunId === v.personaRunId && row.voiceTurnId === v.voiceTurnId)
        : undefined;
      const existingEntry = voiceEntry ?? (
        state.has(positionalKey)
          ? [positionalKey, state.get(positionalKey)] as [string, any]
          : undefined
      );
      if (existingEntry) {
        const [existingKey, existing] = existingEntry;
        if (existing.voiceTranscriptFinal) return;
        state.delete(existingKey);
      }
      const key = positionalKey;
      state.set(key, v);
    },
    clear() {
      calls.length = 0;
      state.clear();
    },
    all() { return [...calls]; },
    /** Returns a snapshot of surviving rows (unique by upsert key). */
    rows() { return [...state.values()]; },
  };
});

// ─── Mock the storage layer ───────────────────────────────────────────────────
vi.mock('../../server/storage', () => ({
  db: {
    insert: () => ({
      values: (vals: any) => {
        capturedInserts.push(vals);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    }),
  },
  storage: {
    getPersonaRun: vi.fn().mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
      personaId: 'persona-1',
    }),
    getScenarioRun: vi.fn().mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      scenarioId: 'scenario-1',
      scenarioSnapshot: {
        id: 'scenario-1',
        personas: [{ id: 'persona-1', name: 'Test Persona' }],
      },
      status: 'completed',   // 'completed' so checkAndCompleteScenario returns early
    }),
    updatePersonaRun: vi.fn().mockResolvedValue({}),
    getOrCreateSubscription: vi.fn().mockResolvedValue({
      subscription: { tokensUsedThisCycle: 0 },
      plan: { tokenQuotaMonthly: -1 },
    }),
    deleteChatMessagesByPersonaRun: vi.fn().mockResolvedValue(undefined),
    getChatMessagesByPersonaRun: vi.fn().mockResolvedValue([]),
    getSimulationState: vi.fn().mockResolvedValue(null),
    saveSimulationState: vi.fn().mockResolvedValue(undefined),
    createSimulationEvent: vi.fn().mockResolvedValue({}),
    upsertVoiceTranscript: vi.fn().mockImplementation(async (values: any) => {
      capturedInserts.push(values);
      return capturedInserts.rows().find(row => row.voiceTurnId === values.voiceTurnId);
    }),
    getFeedbackByConversationId: vi.fn().mockResolvedValue(null),
    addStrategyChoice: vi.fn().mockResolvedValue({}),
    getUser: vi.fn().mockResolvedValue({ preferredLanguage: 'ko' }),
  },
}));

vi.mock('../../server/services/feedbackGenerationService', () => ({
  enqueueFeedbackJob: vi.fn().mockResolvedValue({ status: 'queued' }),
  getFeedbackJobStatus: vi.fn().mockResolvedValue({ status: 'queued' }),
  resetFeedbackJob: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: { getAllScenarios: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../server/services/aiServiceFactory', () => ({
  generateAIResponse: vi.fn(),
  generateStreamingAIResponse: vi.fn(),
  generateFeedback: vi.fn(),
  generateStrategyReflectionFeedback: vi.fn(),
}));
vi.mock('../../server/services/aiUsageTracker', () => ({
  trackUsage: vi.fn(),
}));
vi.mock('../../server/services/simulation/simulationEngine', () => ({
  setSessionState: vi.fn(),
  getSessionState: vi.fn().mockReturnValue(null),
  applySimulationPatch: vi.fn(),
  checkIncidentCooldown: vi.fn().mockReturnValue(false),
  recordIncidentCooldown: vi.fn(),
  getSessionHarnessConfig: vi.fn().mockReturnValue(null),
  getSessionEvaluationHarness: vi.fn().mockReturnValue(null),
  getSessionFlowGraph: vi.fn().mockReturnValue(null),
}));

// ─── Build a minimal test app (created once per suite) ────────────────────────
// The conversations router is a factory that takes isAuthenticated as a param.
// We pass a no-op middleware to bypass JWT validation in tests.
function noopAuth(req: any, _res: any, next: any) {
  req.user = { id: 'user-1', role: 'user' };
  next();
}

let app: express.Express;

beforeAll(async () => {
  const { default: createConversationsRouter } = await import('../../server/routes/conversations');
  app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter(noopAuth));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message });
  });
}, 30000);

// ─── Route-level tests ────────────────────────────────────────────────────────

describe('GET /api/conversations/:id', () => {
  it('returns voice turn identity and finality for reload hydration', async () => {
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: 'user-1',
      scenarioId: '__free_chat__',
      status: 'completed',
    } as any);
    vi.mocked(storage.getChatMessagesByPersonaRun).mockResolvedValueOnce([{
      id: 'message-1',
      personaRunId: 'prun-1',
      sender: 'user',
      message: '제공자 최종 원문',
      turnIndex: 0,
      voiceTurnId: 'voice-user:hydrated:1',
      voiceTranscriptFinal: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as any]);

    const res = await request(app).get('/api/conversations/prun-1');

    expect(res.status).toBe(200);
    expect(res.body.messages[0]).toMatchObject({
      message: '제공자 최종 원문',
      voiceTurnId: 'voice-user:hydrated:1',
      voiceTranscriptFinal: true,
    });
  });
});

describe('POST /api/conversations/:id/realtime-messages', () => {
  beforeEach(() => {
    capturedInserts.clear();
    vi.mocked(enqueueFeedbackJob).mockClear();
    vi.mocked(storage.getPersonaRun).mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
      personaId: 'persona-1',
    } as any);
    vi.mocked(storage.getScenarioRun).mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      scenarioId: 'scenario-1',
      scenarioSnapshot: {
        id: 'scenario-1',
        personas: [{ id: 'persona-1', name: 'Test Persona' }],
      },
      status: 'completed',
    } as any);
  });

  it('queues final feedback for a free-chat run from its persona snapshot', async () => {
    vi.mocked(storage.getPersonaRun).mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
      personaId: 'mbti-1',
      personaSnapshot: { id: 'mbti-1', mbti: 'ENTJ', communicationStyle: 'direct' },
      difficulty: 4,
    } as any);
    vi.mocked(storage.getScenarioRun).mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      scenarioId: '__free_chat__',
      status: 'active',
      difficulty: 4,
    } as any);

    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{ sender: 'user', message: 'hello' }], isFinal: true });

    expect(res.status).toBe(200);
    expect(enqueueFeedbackJob).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'prun-1',
      scenario: expect.objectContaining({ id: '__free_chat__' }),
      persona: expect.objectContaining({ id: 'mbti-1' }),
    }));
  });

  it('queues final feedback for a user-persona run from its persisted snapshot', async () => {
    vi.mocked(storage.getPersonaRun).mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
      personaId: 'custom-1',
      personaName: 'Custom Persona',
      personaSnapshot: {
        id: 'custom-1',
        name: 'Custom Persona',
        personality: { traits: ['calm'] },
      },
      difficulty: 3,
    } as any);
    vi.mocked(storage.getScenarioRun).mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      scenarioId: '__user_persona__:custom-1',
      status: 'active',
      difficulty: 3,
    } as any);

    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{ sender: 'user', message: 'hello' }], isFinal: true });

    expect(res.status).toBe(200);
    expect(enqueueFeedbackJob).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'prun-1',
      scenario: expect.objectContaining({
        id: '__user_persona__:custom-1',
        personas: [expect.objectContaining({ id: 'custom-1', name: 'Custom Persona' })],
      }),
      persona: expect.objectContaining({ id: 'custom-1', name: 'Custom Persona' }),
    }));
  });

  it('queues final feedback for an MBTI synthetic run from its persona snapshot', async () => {
    vi.mocked(storage.getPersonaRun).mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
      personaId: 'mbti-2',
      personaSnapshot: { id: 'mbti-2', mbti: 'INFP', communicationStyle: 'empathetic' },
      difficulty: 2,
    } as any);
    vi.mocked(storage.getScenarioRun).mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      scenarioId: '__mbti_persona__:mbti-2',
      status: 'active',
      difficulty: 2,
    } as any);

    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{ sender: 'user', message: 'hello' }], isFinal: true });

    expect(res.status).toBe(200);
    expect(enqueueFeedbackJob).toHaveBeenCalledWith(expect.objectContaining({
      scenario: expect.objectContaining({ id: '__mbti_persona__:mbti-2' }),
      persona: expect.objectContaining({ id: 'mbti-2' }),
    }));
  });

  it('assigns turnIndex = array index for each message (normal alternating conversation)', async () => {
    const messages = [
      { sender: 'ai',   message: 'Hello!' },
      { sender: 'user', message: 'Hi' },
      { sender: 'ai',   message: 'How can I help?' },
      { sender: 'user', message: 'I need help' },
    ];

    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages, isFinal: false });

    expect(res.status).toBe(200);
    const inserts = capturedInserts.all();
    expect(inserts).toHaveLength(4);
    inserts.forEach((row: any, i: number) => {
      expect(row.turnIndex).toBe(i);
      expect(row.sender).toBe(messages[i].sender);
      expect(row.message).toBe(messages[i].message);
    });
  });

  it('assigns unique turnIndex for consecutive same-sender messages — no collisions', async () => {
    // The critical regression case: two AI messages before the user responds.
    // Math.floor(i/2) gave [0,0,1,1] → collision at ai:0.
    // Fixed: uses i → [0,1,2,3] → all unique.
    const messages = [
      { sender: 'ai',   message: 'Greeting' },
      { sender: 'ai',   message: 'Follow-up' },
      { sender: 'user', message: 'User response' },
      { sender: 'ai',   message: 'Final reply' },
    ];

    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages, isFinal: false });

    expect(res.status).toBe(200);
    const inserts = capturedInserts.all();
    expect(inserts).toHaveLength(4);

    expect(inserts[0]).toMatchObject({ sender: 'ai',   message: 'Greeting',      turnIndex: 0 });
    expect(inserts[1]).toMatchObject({ sender: 'ai',   message: 'Follow-up',     turnIndex: 1 });
    expect(inserts[2]).toMatchObject({ sender: 'user', message: 'User response', turnIndex: 2 });
    expect(inserts[3]).toMatchObject({ sender: 'ai',   message: 'Final reply',   turnIndex: 3 });

    // All (turnIndex, sender) pairs are distinct — no upsert key collisions
    const keys = inserts.map((r: any) => `${r.sender}:${r.turnIndex}`);
    expect(new Set(keys).size).toBe(4);
  });

  it('multiple incremental flushes preserve all messages — later flushes are idempotent', async () => {
    // Simulates the typical voice session pattern: each flush sends the full
    // accumulated list. Re-sending earlier messages with the same (i, sender)
    // key is an idempotent upsert that never overwrites a different message.
    const flush1 = [{ sender: 'ai',   message: 'AI turn 0' }];
    const flush2 = [...flush1, { sender: 'user', message: 'User turn 1' }];
    const flush3 = [...flush2, { sender: 'ai',   message: 'AI turn 2' }];
    const flush4 = [...flush3, { sender: 'user', message: 'User turn 3' }];

    for (const msgs of [flush1, flush2, flush3]) {
      await request(app)
        .post('/api/conversations/prun-1/realtime-messages')
        .send({ messages: msgs, isFinal: false });
    }

    capturedInserts.clear();
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: flush4, isFinal: true });

    // Final flush upserted all 4 messages with correct sequential indices
    const finalInserts = capturedInserts.all();
    expect(finalInserts).toHaveLength(4);
    expect(finalInserts[0]).toMatchObject({ sender: 'ai',   message: 'AI turn 0',   turnIndex: 0 });
    expect(finalInserts[1]).toMatchObject({ sender: 'user', message: 'User turn 1', turnIndex: 1 });
    expect(finalInserts[2]).toMatchObject({ sender: 'ai',   message: 'AI turn 2',   turnIndex: 2 });
    expect(finalInserts[3]).toMatchObject({ sender: 'user', message: 'User turn 3', turnIndex: 3 });
  });

  it('consecutive same-sender incremental flushes all preserve distinct slots', async () => {
    const flush1 = [{ sender: 'ai', message: 'Greeting' }];
    const flush2 = [...flush1, { sender: 'ai', message: 'Follow-up' }];
    const flush3 = [...flush2, { sender: 'user', message: 'User response' }];
    const flush4 = [...flush3, { sender: 'ai', message: 'Final reply' }];

    for (const msgs of [flush1, flush2, flush3]) {
      await request(app)
        .post('/api/conversations/prun-1/realtime-messages')
        .send({ messages: msgs, isFinal: false });
    }

    capturedInserts.clear();
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: flush4, isFinal: true });

    const finalInserts = capturedInserts.all();
    expect(finalInserts).toHaveLength(4);
    const keys = finalInserts.map((r: any) => `${r.sender}:${r.turnIndex}`);
    expect(new Set(keys).size).toBe(4); // all 4 distinct keys
    expect(finalInserts[0]).toMatchObject({ sender: 'ai',   message: 'Greeting',      turnIndex: 0 });
    expect(finalInserts[1]).toMatchObject({ sender: 'ai',   message: 'Follow-up',     turnIndex: 1 });
    expect(finalInserts[2]).toMatchObject({ sender: 'user', message: 'User response', turnIndex: 2 });
    expect(finalInserts[3]).toMatchObject({ sender: 'ai',   message: 'Final reply',   turnIndex: 3 });
  });

  it('returns 400 when messages is not an array', async () => {
    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('stores provider-final user text byte-for-byte with its voice turn ID', async () => {
    const transcript = '  네, PO-42 Jane입니다.  ';
    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({
        messages: [{
          sender: 'user',
          message: transcript,
          voiceTurnId: 'voice-user:session:1',
          voiceTranscriptFinal: true,
        }],
        isFinal: false,
      });

    expect(res.status).toBe(200);
    expect(capturedInserts.rows()).toContainEqual(expect.objectContaining({
      sender: 'user',
      message: transcript,
      voiceTurnId: 'voice-user:session:1',
      voiceTranscriptFinal: true,
    }));
  });

  it('replaces a provisional page-exit transcript with the provider-final text', async () => {
    const voiceTurnId = 'voice-user:session:2';
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{
        sender: 'user',
        message: '정상 한국어',
        voiceTurnId,
        voiceTranscriptFinal: false,
      }] });
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{
        sender: 'user',
        message: '정상 한국어 원문',
        voiceTurnId,
        voiceTranscriptFinal: true,
      }] });

    expect(capturedInserts.rows()).toHaveLength(1);
    expect(capturedInserts.rows()[0].message).toBe('정상 한국어 원문');
    expect(capturedInserts.rows()[0].voiceTranscriptFinal).toBe(true);
  });

  it('keeps provider-final text when a stale save reuses the same voice turn ID', async () => {
    const voiceTurnId = 'voice-user:session:3';
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{
        sender: 'user',
        message: '정상 한국어 원문',
        voiceTurnId,
        voiceTranscriptFinal: true,
      }] });
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{
        sender: 'user',
        message: '后来的错误字符串',
        voiceTurnId,
        voiceTranscriptFinal: false,
      }] });

    expect(capturedInserts.rows()).toHaveLength(1);
    expect(capturedInserts.rows()[0].message).toBe('정상 한국어 원문');
  });

  it('resolves a reordered replay by voice turn identity instead of array position', async () => {
    const voiceTurnId = 'voice-user:session:reordered';
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{
        sender: 'user',
        message: '제공자 최종 원문',
        voiceTurnId,
        voiceTranscriptFinal: true,
      }] });

    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [
        { sender: 'ai', message: '앞에 추가된 메시지' },
        {
          sender: 'user',
          message: 'stale replay',
          voiceTurnId,
          voiceTranscriptFinal: false,
        },
      ] });

    expect(res.status).toBe(200);
    const voiceRows = capturedInserts.rows().filter(row => row.voiceTurnId === voiceTurnId);
    expect(voiceRows).toHaveLength(1);
    expect(voiceRows[0].message).toBe('제공자 최종 원문');
  });

  it('rejects a voice turn ID on an AI message', async () => {
    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{ sender: 'ai', message: 'not a user transcript', voiceTurnId: 'voice-user:x:1' }] });
    expect(res.status).toBe(400);
  });
});

// ─── Idempotency / no-duplicate-row tests ────────────────────────────────────
//
// These tests use capturedInserts.rows() which models the DB's ON CONFLICT DO
// UPDATE behaviour: the Map is keyed by (personaRunId, turnIndex, sender) so
// replaying the same message yields an overwrite, never a new row.
//
// The core invariant: after any sequence of flushes, the surviving row count
// must equal the number of *unique* (personaRunId, turnIndex, sender) tuples
// sent — never more (no duplicates) and never fewer (no silent drops).

describe('voice session replay — no duplicate conversation rows', () => {
  beforeEach(() => {
    capturedInserts.clear();
    vi.mocked(storage.deleteChatMessagesByPersonaRun).mockClear();
  });

  it('sending the same payload twice leaves exactly N rows, not 2N', async () => {
    const messages = [
      { sender: 'ai',   message: 'Hello!' },
      { sender: 'user', message: 'Hi' },
      { sender: 'ai',   message: 'How can I help?' },
      { sender: 'user', message: 'I need help' },
    ];

    // First flush — initial voice session write
    const r1 = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages, isFinal: false });
    expect(r1.status).toBe(200);

    // Second flush — same payload re-sent (simulates a replay / retry)
    const r2 = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages, isFinal: false });
    expect(r2.status).toBe(200);

    // The DB state must have exactly 4 rows — not 8
    const rows = capturedInserts.rows();
    expect(rows).toHaveLength(4);
    // Every unique (turnIndex, sender) key appears exactly once
    const keys = rows.map((r: any) => `${r.sender}:${r.turnIndex}`);
    expect(new Set(keys).size).toBe(4);
  });

  it('reconnect scenario: initial flush + re-flush of full accumulated list = same row count', async () => {
    // Voice session sends 2 messages, disconnects, reconnects and re-sends the
    // same 2 messages (accumulated list) plus 2 new ones in the final flush.
    const initialMessages = [
      { sender: 'ai',   message: 'Greeting' },
      { sender: 'user', message: 'Response' },
    ];
    const accumulatedMessages = [
      ...initialMessages,
      { sender: 'ai',   message: 'Follow-up after reconnect' },
      { sender: 'user', message: 'Acknowledged' },
    ];

    // Initial flush (before disconnect)
    const r1 = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: initialMessages, isFinal: false });
    expect(r1.status).toBe(200);

    // Re-flush after reconnect: same first 2 messages re-sent plus 2 new ones
    const r2 = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: accumulatedMessages, isFinal: true });
    expect(r2.status).toBe(200);

    // The DB must hold exactly 4 unique rows — the repeated first 2 messages
    // must not create extra rows beyond the 4 total unique tuples
    const rows = capturedInserts.rows();
    expect(rows).toHaveLength(4);

    // Original messages are in the correct slots (overwritten by re-flush, same values)
    expect(rows.find((r: any) => r.turnIndex === 0)).toMatchObject({ sender: 'ai',   message: 'Greeting' });
    expect(rows.find((r: any) => r.turnIndex === 1)).toMatchObject({ sender: 'user', message: 'Response' });
    expect(rows.find((r: any) => r.turnIndex === 2)).toMatchObject({ sender: 'ai',   message: 'Follow-up after reconnect' });
    expect(rows.find((r: any) => r.turnIndex === 3)).toMatchObject({ sender: 'user', message: 'Acknowledged' });
  });

  it('repeated full-list flushes (3 replays) never exceed unique tuple count', async () => {
    const messages = [
      { sender: 'ai',   message: 'Turn 0' },
      { sender: 'user', message: 'Turn 1' },
      { sender: 'ai',   message: 'Turn 2' },
    ];

    // Send same payload three times
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/conversations/prun-1/realtime-messages')
        .send({ messages, isFinal: i === 2 });
      expect(res.status).toBe(200);
    }

    const rows = capturedInserts.rows();
    // 3 unique tuples regardless of how many times the payload was replayed
    expect(rows).toHaveLength(3);
    rows.forEach((row: any, i: number) => {
      expect(row.turnIndex).toBe(i);
    });
  });

  it('consecutive same-sender replay leaves all N distinct slots', async () => {
    // Edge case: two AI messages before the user — each has a distinct sender:turnIndex key
    const messages = [
      { sender: 'ai',   message: 'AI greeting' },
      { sender: 'ai',   message: 'AI follow-up' },
      { sender: 'user', message: 'User reply' },
    ];

    // Send twice — simulates a replay
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages, isFinal: false });
    await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages, isFinal: false });

    const rows = capturedInserts.rows();
    expect(rows).toHaveLength(3);
    expect(rows.find((r: any) => r.turnIndex === 0)).toMatchObject({ sender: 'ai',   message: 'AI greeting' });
    expect(rows.find((r: any) => r.turnIndex === 1)).toMatchObject({ sender: 'ai',   message: 'AI follow-up' });
    expect(rows.find((r: any) => r.turnIndex === 2)).toMatchObject({ sender: 'user', message: 'User reply' });
  });
});

// ─── Cross-user ownership enforcement tests ───────────────────────────────────
//
// The route must reject requests where the authenticated user does not own the
// persona run.  `verifyPersonaRunOwnership` checks `scenarioRun.userId !== userId`
// and throws 403.  These tests confirm that the route surfaces that rejection
// and that no DB insert is attempted in the cross-user case.

describe('POST /api/conversations/:id/realtime-messages — cross-user ownership enforcement', () => {
  const OWNER_ID = 'user-2';       // who owns the run in the DB
  const REQUESTER_ID = 'user-1';  // who is making the request

  beforeEach(() => {
    capturedInserts.clear();
    // Restore default mock values after each test
    vi.mocked(storage.getPersonaRun).mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
    } as any);
    vi.mocked(storage.getScenarioRun).mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      status: 'completed',
    } as any);
  });

  it('returns 403 when the requester does not own the persona run', async () => {
    // Make the run belong to OWNER_ID (user-2), but the request comes from REQUESTER_ID (user-1)
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const crossUserApp = express();
    crossUserApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    crossUserApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: REQUESTER_ID, role: 'user' };
      next();
    }));
    crossUserApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(crossUserApp)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [{ sender: 'user', message: 'hi', timestamp: Date.now() }], isFinal: false });

    expect(res.status).toBe(403);
  });

  it('does not attempt any DB insert when ownership check fails', async () => {
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const crossUserApp = express();
    crossUserApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    crossUserApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: REQUESTER_ID, role: 'user' };
      next();
    }));
    crossUserApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    await request(crossUserApp)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({
        messages: [
          { sender: 'user', message: 'hello', timestamp: Date.now() },
          { sender: 'ai',   message: 'world',  timestamp: Date.now() },
        ],
        isFinal: false,
      });

    // The route must exit before any db.insert call
    expect(capturedInserts.all()).toHaveLength(0);
  });

  it('returns 404 when the persona run does not exist', async () => {
    vi.mocked(storage.getPersonaRun).mockResolvedValueOnce(null as any);

    const res = await request(app)
      .post('/api/conversations/nonexistent-run/realtime-messages')
      .send({ messages: [], isFinal: false });

    expect(res.status).toBe(404);
    expect(capturedInserts.all()).toHaveLength(0);
  });

  it('returns 404 when the scenario run does not exist', async () => {
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce(null as any);

    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({ messages: [], isFinal: false });

    expect(res.status).toBe(404);
    expect(capturedInserts.all()).toHaveLength(0);
  });

  it('allows the legitimate owner to upsert messages (200)', async () => {
    // Default mocks already set userId to 'user-1', matching noopAuth user — should succeed
    const res = await request(app)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({
        messages: [
          { sender: 'user', message: 'owner message', timestamp: Date.now() },
        ],
        isFinal: false,
      });

    expect(res.status).toBe(200);
    expect(capturedInserts.all()).toHaveLength(1);
  });

  it('enforces ownership even for admin role — this route does not pass role to verifyPersonaRunOwnership', async () => {
    // NOTE: Unlike some other routes (e.g. simulation), the realtime-messages
    // route calls verifyPersonaRunOwnership(personaRunId, userId) WITHOUT the
    // third `userRole` argument.  That means the admin bypass inside
    // verifyPersonaRunOwnership is never reached, and admins are subject to
    // the same ownership check as regular users.  This test documents that
    // behaviour; if the route is intentionally updated to pass the role, this
    // test should be updated accordingly.
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const adminApp = express();
    adminApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    adminApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: 'admin-user', role: 'admin' };
      next();
    }));
    adminApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(adminApp)
      .post('/api/conversations/prun-1/realtime-messages')
      .send({
        messages: [{ sender: 'user', message: 'audit check', timestamp: Date.now() }],
        isFinal: false,
      });

    expect(res.status).toBe(403);
    expect(capturedInserts.all()).toHaveLength(0);
  });
});

// ─── Cross-user ownership tests: DELETE /:id/messages ─────────────────────────
//
// The conversation-reset route (DELETE /:id/messages) is a destructive write
// operation.  `userRole` is intentionally NOT forwarded to
// verifyPersonaRunOwnership, so admins and operators are also blocked from
// resetting another user's conversation.

describe('DELETE /api/conversations/:id/messages — cross-user ownership enforcement', () => {
  const OWNER_ID = 'user-2';
  const REQUESTER_ID = 'user-1';

  beforeEach(() => {
    capturedInserts.clear();
    vi.mocked(storage.deleteChatMessagesByPersonaRun).mockClear();
    vi.mocked(storage.getPersonaRun).mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
    } as any);
    vi.mocked(storage.getScenarioRun).mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      status: 'active',
    } as any);
  });

  it('invalidates the feedback generation before deleting reset messages', async () => {
    vi.mocked(storage.getPersonaRun).mockResolvedValueOnce({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
      feedbackStatus: 'generating',
      feedbackJobToken: 'generation-to-cancel',
    } as any);
    vi.mocked(resetFeedbackJob).mockResolvedValueOnce(true);

    const res = await request(app).delete('/api/conversations/prun-1/messages');

    expect(res.status).toBe(200);
    expect(resetFeedbackJob).toHaveBeenCalledWith('prun-1', {
      status: 'generating',
      token: 'generation-to-cancel',
    });
    expect(vi.mocked(resetFeedbackJob).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(storage.deleteChatMessagesByPersonaRun).mock.invocationCallOrder.at(-1)!);
  });

  it('returns 403 when a regular user tries to reset another user\'s conversation', async () => {
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const crossUserApp = express();
    crossUserApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    crossUserApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: REQUESTER_ID, role: 'user' };
      next();
    }));
    crossUserApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(crossUserApp)
      .delete('/api/conversations/prun-1/messages');

    expect(res.status).toBe(403);
  });

  it('returns 403 even for an admin trying to reset another user\'s conversation', async () => {
    // NOTE: This route intentionally does NOT pass userRole to
    // verifyPersonaRunOwnership.  Resetting another user's conversation history
    // is a destructive write; admin bypass is not granted here by design.
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const adminApp = express();
    adminApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    adminApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: 'admin-user', role: 'admin' };
      next();
    }));
    adminApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(adminApp)
      .delete('/api/conversations/prun-1/messages');

    expect(res.status).toBe(403);
  });

  it('does not call deleteChatMessagesByPersonaRun when ownership check fails', async () => {
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const crossUserApp = express();
    crossUserApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    crossUserApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: REQUESTER_ID, role: 'user' };
      next();
    }));
    crossUserApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    await request(crossUserApp).delete('/api/conversations/prun-1/messages');

    expect(vi.mocked(storage.deleteChatMessagesByPersonaRun)).not.toHaveBeenCalled();
  });
});

// ─── Cross-user ownership tests: POST /:id/strategy-choices ───────────────────
//
// The strategy-choices write route enforces owner-only access.  As with
// realtime-messages and the message-reset route, `userRole` is not forwarded,
// so admin/operator users cannot write strategy choices into another user's run.

describe('POST /api/conversations/:id/strategy-choices — cross-user ownership enforcement', () => {
  const OWNER_ID = 'user-2';
  const REQUESTER_ID = 'user-1';

  const validBody = {
    phase: 1,
    choice: 'Empathy-first approach',
    reasoning: 'Building rapport before addressing the conflict',
  };

  beforeEach(() => {
    capturedInserts.clear();
    vi.mocked(storage.getPersonaRun).mockResolvedValue({
      id: 'prun-1',
      scenarioRunId: 'srun-1',
    } as any);
    vi.mocked(storage.getScenarioRun).mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      status: 'active',
    } as any);
  });

  it('returns 403 when a regular user tries to write strategy choices into another user\'s run', async () => {
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const crossUserApp = express();
    crossUserApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    crossUserApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: REQUESTER_ID, role: 'user' };
      next();
    }));
    crossUserApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(crossUserApp)
      .post('/api/conversations/prun-1/strategy-choices')
      .send(validBody);

    expect(res.status).toBe(403);
  });

  it('returns 403 even for an admin trying to write strategy choices into another user\'s run', async () => {
    // NOTE: This route intentionally does NOT pass userRole to
    // verifyPersonaRunOwnership.  Writing strategy choices into another user's
    // conversation is a write operation; admin bypass is not granted here by design.
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const adminApp = express();
    adminApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    adminApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: 'admin-user', role: 'admin' };
      next();
    }));
    adminApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(adminApp)
      .post('/api/conversations/prun-1/strategy-choices')
      .send(validBody);

    expect(res.status).toBe(403);
  });

  it('does not call addStrategyChoice when ownership check fails', async () => {
    vi.mocked(storage.getScenarioRun).mockResolvedValueOnce({
      id: 'srun-1',
      userId: OWNER_ID,
      status: 'active',
    } as any);

    const crossUserApp = express();
    crossUserApp.use(express.json());
    const { default: createConversationsRouter } = await import('../../server/routes/conversations');
    crossUserApp.use('/api/conversations', createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: REQUESTER_ID, role: 'user' };
      next();
    }));
    crossUserApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    await request(crossUserApp)
      .post('/api/conversations/prun-1/strategy-choices')
      .send(validBody);

    expect(vi.mocked(storage.addStrategyChoice)).not.toHaveBeenCalled();
  });
});

// ─── Pure algorithm tests (fast, no HTTP overhead) ────────────────────────────

describe('turnIndex formula regression (pure algorithm)', () => {
  interface Msg { sender: string; message: string; }

  function computeFixed(msgs: Msg[]) {
    return msgs.map((m, i) => ({ ...m, turnIndex: i }));
  }
  function computeOld(msgs: Msg[]) {
    return msgs.map((m, i) => ({ ...m, turnIndex: Math.floor(i / 2) }));
  }
  // Models the NEW unique key: (personaRunId, turnIndex) — sender is NOT part of the key.
  // turnIndex alone must be unique per run for the upsert to be collision-free.
  function upsert(rows: ReturnType<typeof computeFixed>) {
    const store = new Map<number, { sender: string; message: string }>();
    rows.forEach(r => store.set(r.turnIndex, { sender: r.sender, message: r.message }));
    return store;
  }

  it('Math.floor(i/2) loses consecutive same-sender messages (documents the bug)', () => {
    // With Math.floor(i/2): indices [0,0,1,1] → positions 0 and 1 collide,
    // positions 2 and 3 collide → only 2 DB rows survive out of 4.
    const msgs = [
      { sender: 'ai',   message: 'Greeting' },
      { sender: 'ai',   message: 'Follow-up' },
      { sender: 'user', message: 'User response' },
      { sender: 'ai',   message: 'Final reply' },
    ];
    const store = upsert(computeOld(msgs));
    expect(store.size).toBe(2);                               // only 2 rows — 2 messages lost
    expect(store.get(0)?.message).toBe('Follow-up');          // Greeting overwritten
    expect(store.get(1)?.message).toBe('Final reply');        // User response overwritten
  });

  it('fixed algorithm (i as turnIndex) preserves all messages', () => {
    const msgs = [
      { sender: 'ai',   message: 'Greeting' },
      { sender: 'ai',   message: 'Follow-up' },
      { sender: 'user', message: 'User response' },
      { sender: 'ai',   message: 'Final reply' },
    ];
    const store = upsert(computeFixed(msgs));
    expect(store.size).toBe(4);
    expect(store.get(0)?.message).toBe('Greeting');
    expect(store.get(1)?.message).toBe('Follow-up');
    expect(store.get(2)?.message).toBe('User response');
    expect(store.get(3)?.message).toBe('Final reply');
  });
});
