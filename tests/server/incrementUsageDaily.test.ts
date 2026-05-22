/**
 * Unit tests for incrementUsageDaily and cascade/FK contract on agentUsageDaily.
 *
 * incrementUsageDaily is best-effort (non-fatal): it must never throw.
 * The agentUsageDaily FK to agent_api_keys intentionally has NO onDelete cascade
 * so that historical billing rows survive key deletion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

// ─── Hoist mocks so they are available inside vi.mock() factories ─────────────

const {
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
} = vi.hoisted(() => {
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  return { mockOnConflictDoUpdate, mockValues, mockInsert };
});

// ─── Mock all heavy server dependencies before importing the module ───────────

vi.mock('../../server/storage', () => ({
  db: { insert: mockInsert },
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

// ─── Import after mocks ───────────────────────────────────────────────────────
import { incrementUsageDaily } from '../../server/routes/agentApi';
import { agentUsageDaily, agentKeyScenarios, agentIdempotencyKeys } from '../../shared/schema/agentApi';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('incrementUsageDaily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockInsert.mockReturnValue({ values: mockValues });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('first insert (no existing row)', () => {
    it('calls db.insert with the agentUsageDaily table', async () => {
      await incrementUsageDaily('org-1', 'key-1', { inputTokens: 50, outputTokens: 100 });

      expect(mockInsert).toHaveBeenCalledOnce();
      const tableArg = mockInsert.mock.calls[0][0];
      expect(tableArg).toBe(agentUsageDaily);
    });

    it('inserts requestCount=1 and correct token values on first call', async () => {
      await incrementUsageDaily('org-1', 'key-1', { inputTokens: 50, outputTokens: 100 });

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.organizationId).toBe('org-1');
      expect(insertedValues.agentKeyId).toBe('key-1');
      expect(insertedValues.requestCount).toBe(1);
      expect(insertedValues.sessionCount).toBe(0);
      expect(insertedValues.inputTokens).toBe(50);
      expect(insertedValues.outputTokens).toBe(100);
      expect(insertedValues.totalTokens).toBe(150);
    });

    it('inserts the current date in YYYY-MM-DD format', async () => {
      await incrementUsageDaily('org-1', 'key-1', {});

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(insertedValues.date).toBe(new Date().toISOString().slice(0, 10));
    });

    it('defaults missing token params to 0', async () => {
      await incrementUsageDaily('org-2', 'key-2', {});

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.inputTokens).toBe(0);
      expect(insertedValues.outputTokens).toBe(0);
      expect(insertedValues.totalTokens).toBe(0);
      expect(insertedValues.errorCount).toBe(0);
    });

    it('stores latencyMs as avgLatencyMs when provided', async () => {
      await incrementUsageDaily('org-1', 'key-1', { latencyMs: 420 });

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.avgLatencyMs).toBe(420);
    });

    it('stores null avgLatencyMs when latency is omitted', async () => {
      await incrementUsageDaily('org-1', 'key-1', {});

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.avgLatencyMs).toBeNull();
    });
  });

  describe('upsert accumulation (existing row)', () => {
    it('calls onConflictDoUpdate to accumulate into an existing row', async () => {
      await incrementUsageDaily('org-1', 'key-1', { inputTokens: 10, outputTokens: 20 });

      expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
    });

    it('targets the composite unique index (organizationId, agentKeyId, date)', async () => {
      await incrementUsageDaily('org-1', 'key-1', { inputTokens: 10, outputTokens: 20 });

      const conflictArg = mockOnConflictDoUpdate.mock.calls[0][0];
      const targetCols: string[] = conflictArg.target.map((c: any) => c.name);
      expect(targetCols).toContain('organization_id');
      expect(targetCols).toContain('agent_key_id');
      expect(targetCols).toContain('date');
    });

    it('includes requestCount, inputTokens, outputTokens, totalTokens, errorCount in the SET clause', async () => {
      await incrementUsageDaily('org-1', 'key-1', { inputTokens: 10, outputTokens: 20 });

      const conflictArg = mockOnConflictDoUpdate.mock.calls[0][0];
      const setKeys = Object.keys(conflictArg.set);
      expect(setKeys).toContain('requestCount');
      expect(setKeys).toContain('inputTokens');
      expect(setKeys).toContain('outputTokens');
      expect(setKeys).toContain('totalTokens');
      expect(setKeys).toContain('errorCount');
    });

    it('accumulates error counts when errorCount param is provided', async () => {
      await incrementUsageDaily('org-1', 'key-1', { errorCount: 1 });

      const insertedValues = mockValues.mock.calls[0][0];
      expect(insertedValues.errorCount).toBe(1);
    });
  });

  describe('non-fatal DB error path', () => {
    it('does not throw when onConflictDoUpdate rejects', async () => {
      mockOnConflictDoUpdate.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        incrementUsageDaily('org-1', 'key-1', { inputTokens: 5 })
      ).resolves.toBeUndefined();
    });

    it('does not throw when db.insert itself throws synchronously', async () => {
      mockInsert.mockImplementation(() => { throw new Error('Unexpected sync error'); });

      await expect(
        incrementUsageDaily('org-1', 'key-1', {})
      ).resolves.toBeUndefined();
    });

    it('does not throw when values() rejects', async () => {
      mockValues.mockRejectedValue(new Error('values error'));

      await expect(
        incrementUsageDaily('org-1', 'key-1', {})
      ).resolves.toBeUndefined();
    });

    it('resolves even when all token params are missing', async () => {
      mockOnConflictDoUpdate.mockRejectedValue(new Error('network timeout'));

      await expect(
        incrementUsageDaily('org-x', 'key-x', {})
      ).resolves.toBeUndefined();
    });
  });
});

// ─── Schema FK cascade contract ───────────────────────────────────────────────

describe('agentUsageDaily FK cascade contract (billing data preservation)', () => {
  it('agentUsageDaily.agentKeyId has NO onDelete cascade — rows survive key deletion', () => {
    const config = getTableConfig(agentUsageDaily);
    const fk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'agent_key_id')
    );
    expect(fk).toBeDefined();
    // Drizzle normalises the absence of an explicit cascade to 'no action',
    // meaning PostgreSQL will reject key deletion if usage rows exist —
    // historical billing data is preserved and cannot be silently dropped.
    expect(fk!.onDelete).toBe('no action');
  });

  it('agentKeyScenarios.agentKeyId HAS onDelete cascade — access-control rows are cleaned up', () => {
    const config = getTableConfig(agentKeyScenarios);
    const fk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'agent_key_id')
    );
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('cascade');
  });

  it('agentIdempotencyKeys.agentKeyId HAS onDelete cascade — idempotency records are cleaned up', () => {
    const config = getTableConfig(agentIdempotencyKeys);
    const fk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'agent_key_id')
    );
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('cascade');
  });

  it('agentUsageDaily composite unique index covers organizationId + agentKeyId + date', () => {
    const config = getTableConfig(agentUsageDaily);
    // uniqueIndex() entries appear in config.indexes (not config.uniqueConstraints)
    const uniqueIdx = config.indexes.find((idx) => {
      if (!idx.config.unique) return false;
      const cols = idx.config.columns.map((c: any) => c.name);
      return (
        cols.includes('organization_id') &&
        cols.includes('agent_key_id') &&
        cols.includes('date')
      );
    });
    expect(uniqueIdx).toBeDefined();
  });
});
