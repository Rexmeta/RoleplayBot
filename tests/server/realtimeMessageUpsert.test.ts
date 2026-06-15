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
      // Replicate ON CONFLICT DO UPDATE — same key → overwrites, never appends
      const key = `${v.personaRunId}|${v.turnIndex}|${v.sender}`;
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
    }),
    getScenarioRun: vi.fn().mockResolvedValue({
      id: 'srun-1',
      userId: 'user-1',
      status: 'completed',   // 'completed' so checkAndCompleteScenario returns early
    }),
    updatePersonaRun: vi.fn().mockResolvedValue({}),
    getOrCreateSubscription: vi.fn().mockResolvedValue({
      subscription: { tokensUsedThisCycle: 0 },
      plan: { tokenQuotaMonthly: -1 },
    }),
  },
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

describe('POST /api/conversations/:id/realtime-messages', () => {
  beforeEach(() => {
    capturedInserts.clear();
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
