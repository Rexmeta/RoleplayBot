/**
 * Focused tests for getEmotionStatsByPersona:
 * - User-persona (PersonaX) rows with NULL personaName resolve the display name
 *   via the LEFT JOIN on user_personas.
 * - User-persona rows where personaName was saved as the raw sentinel also resolve.
 * - MBTI persona rows (no sentinel prefix) are returned unchanged.
 * - Rows where both personaName and the joined user_personas.name are null are
 *   filtered out at the JS layer (COALESCE → null → skipped).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock handles for the Drizzle ORM chain ───────────────────────────

const { mockOrderBy, mockGroupBy, mockWhere, mockLeftJoin, mockInnerJoin2, mockInnerJoin1, mockFrom, mockSelect } =
  vi.hoisted(() => {
    const mockOrderBy = vi.fn();
    const mockGroupBy = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockWhere = vi.fn().mockReturnValue({ groupBy: mockGroupBy });
    const mockLeftJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockInnerJoin2 = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin });
    const mockInnerJoin1 = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin2 });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin1 });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    return { mockOrderBy, mockGroupBy, mockWhere, mockLeftJoin, mockInnerJoin2, mockInnerJoin1, mockFrom, mockSelect };
  });

// ── Mock heavy server dependencies before any module import ───────────────────

vi.mock('../../server/storage/db', () => ({
  db: { select: mockSelect },
}));

vi.mock('../../server/storage', () => ({
  db: { select: mockSelect },
  storage: {},
}));

vi.mock('../../server/middleware/agentApiKeyMiddleware', () => ({
  attachAgentRequestId: (_req: any, _res: any, next: any) => next(),
  isAgentApiKey: (_req: any, _res: any, next: any) => next(),
  requireScope: () => (_req: any, _res: any, next: any) => next(),
  agentError: () => {},
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

// ── Import after mocks ────────────────────────────────────────────────────────

import { PostgreSQLStorage } from '../../server/storage/index';

// ── Helpers ───────────────────────────────────────────────────────────────────

function setQueryRows(rows: object[]) {
  mockOrderBy.mockResolvedValue(rows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getEmotionStatsByPersona', () => {
  let storage: PostgreSQLStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupBy.mockReturnValue({ orderBy: mockOrderBy });
    mockWhere.mockReturnValue({ groupBy: mockGroupBy });
    mockLeftJoin.mockReturnValue({ where: mockWhere });
    mockInnerJoin2.mockReturnValue({ leftJoin: mockLeftJoin });
    mockInnerJoin1.mockReturnValue({ innerJoin: mockInnerJoin2 });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin1 });
    mockSelect.mockReturnValue({ from: mockFrom });
    storage = new PostgreSQLStorage();
  });

  it('returns the display name from user_personas when personaName is the raw sentinel', async () => {
    const PERSONA_ID = '__user_persona__:abc-123';
    setQueryRows([
      {
        personaId: PERSONA_ID,
        // COALESCE resolved to the real display name (simulating user_personas.name winning)
        personaName: 'Alice Test',
        mbtiType: null,
        emotion: 'happy',
        count: 5,
      },
    ]);

    const result = await storage.getEmotionStatsByPersona(undefined, 'user');

    expect(result).toHaveLength(1);
    expect(result[0].personaId).toBe(PERSONA_ID);
    expect(result[0].personaName).toBe('Alice Test');
    expect(result[0].emotions).toEqual([{ emotion: 'happy', count: 5 }]);
    expect(result[0].totalCount).toBe(5);
  });

  it('returns the display name from user_personas when personaName was NULL (never set)', async () => {
    const PERSONA_ID = '__user_persona__:def-456';
    setQueryRows([
      {
        personaId: PERSONA_ID,
        // COALESCE resolved to the real display name because personaName was NULL
        personaName: 'Bob Test',
        mbtiType: null,
        emotion: 'sad',
        count: 3,
      },
    ]);

    const result = await storage.getEmotionStatsByPersona(undefined, 'user');

    expect(result).toHaveLength(1);
    expect(result[0].personaName).toBe('Bob Test');
  });

  it('filters out rows where both personaName and user_personas.name are null', async () => {
    setQueryRows([
      {
        personaId: '__user_persona__:ghost-001',
        personaName: null, // COALESCE returned null — neither source has a name
        mbtiType: null,
        emotion: 'happy',
        count: 2,
      },
    ]);

    const result = await storage.getEmotionStatsByPersona(undefined, 'user');

    expect(result).toHaveLength(0);
  });

  it('aggregates multiple emotions for the same user persona', async () => {
    const PERSONA_ID = '__user_persona__:multi-789';
    setQueryRows([
      { personaId: PERSONA_ID, personaName: 'Carol', mbtiType: null, emotion: 'happy', count: 4 },
      { personaId: PERSONA_ID, personaName: 'Carol', mbtiType: null, emotion: 'angry', count: 2 },
    ]);

    const result = await storage.getEmotionStatsByPersona(undefined, 'user');

    expect(result).toHaveLength(1);
    expect(result[0].personaName).toBe('Carol');
    expect(result[0].totalCount).toBe(6);
    expect(result[0].emotions).toHaveLength(2);
  });

  it('returns MBTI persona rows with their stored personaName unchanged', async () => {
    setQueryRows([
      {
        personaId: 'mbti-persona-001',
        personaName: 'INTJ Manager',
        mbtiType: 'INTJ',
        emotion: 'curious',
        count: 7,
      },
    ]);

    const result = await storage.getEmotionStatsByPersona(undefined, 'mbti');

    expect(result).toHaveLength(1);
    expect(result[0].personaId).toBe('mbti-persona-001');
    expect(result[0].personaName).toBe('INTJ Manager');
    expect(result[0].mbtiType).toBe('INTJ');
  });
});
