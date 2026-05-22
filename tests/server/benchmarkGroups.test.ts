/**
 * Integration tests for GET /api/admin/analytics/benchmark-groups
 *
 * The endpoint aggregates feedback scores across scenarios that share the same
 * analyticsSpec.benchmarkGroup value. These tests verify correct group averages,
 * session counts, and edge-cases like null scores or missing linkage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Storage mock ──────────────────────────────────────────────────────────────
const {
  mockGetScenarios,
  mockGetAllFeedbacks,
  mockGetAllPersonaRuns,
  mockGetAllScenarioRuns,
} = vi.hoisted(() => ({
  mockGetScenarios: vi.fn(),
  mockGetAllFeedbacks: vi.fn(),
  mockGetAllPersonaRuns: vi.fn(),
  mockGetAllScenarioRuns: vi.fn(),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getScenarios: mockGetScenarios,
    getAllFeedbacks: mockGetAllFeedbacks,
    getAllPersonaRuns: mockGetAllPersonaRuns,
    getAllScenarioRuns: mockGetAllScenarioRuns,
  },
  db: { select: vi.fn() },
  pool: undefined,
  checkDatabaseConnection: vi.fn(),
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getAllScenarios: vi.fn().mockResolvedValue([]),
    getPersonaByMBTI: vi.fn().mockResolvedValue(null),
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import createAnalyticsRouter from '../../server/routes/analytics';

// ─── App factory ──────────────────────────────────────────────────────────────
function buildApp(userRole: 'admin' | 'operator' | 'user' = 'admin') {
  const app = express();
  app.use(express.json());

  const isAuthenticated = (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', role: userRole };
    next();
  };

  app.use(createAnalyticsRouter(isAuthenticated));
  return app;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────
function makeScenario(id: number, benchmarkGroup: string | null, title?: string) {
  return {
    id,
    title: title ?? `Scenario ${id}`,
    analyticsSpec: benchmarkGroup ? { benchmarkGroup } : null,
  };
}

function makeScenarioRun(id: string, scenarioId: number) {
  return { id, scenarioId };
}

function makePersonaRun(id: string, scenarioRunId: string) {
  return { id, scenarioRunId };
}

function makeFeedback(personaRunId: string, overallScore: number | null) {
  return { personaRunId, overallScore };
}

// ─── Seed default mocks shared by most tests ─────────────────────────────────
function seedMocks({
  scenarios = [] as any[],
  scenarioRuns = [] as any[],
  personaRuns = [] as any[],
  feedbacks = [] as any[],
} = {}) {
  mockGetScenarios.mockResolvedValue(scenarios);
  mockGetAllScenarioRuns.mockResolvedValue(scenarioRuns);
  mockGetAllPersonaRuns.mockResolvedValue(personaRuns);
  mockGetAllFeedbacks.mockResolvedValue(feedbacks);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/analytics/benchmark-groups', () => {
  it('returns 403 for non-admin, non-operator users', async () => {
    seedMocks();
    const res = await request(buildApp('user')).get('/api/admin/analytics/benchmark-groups');
    expect(res.status).toBe(403);
  });

  it('returns 200 for admin users', async () => {
    seedMocks();
    const res = await request(buildApp('admin')).get('/api/admin/analytics/benchmark-groups');
    expect(res.status).toBe(200);
  });

  it('returns 200 for operator users', async () => {
    seedMocks();
    const res = await request(buildApp('operator')).get('/api/admin/analytics/benchmark-groups');
    expect(res.status).toBe(200);
  });

  it('returns an empty array when no scenarios have a benchmarkGroup', async () => {
    seedMocks({
      scenarios: [makeScenario(1, null), makeScenario(2, null)],
    });
    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns correct average score and session count for a single group', async () => {
    seedMocks({
      scenarios: [makeScenario(10, 'sales', 'Sales Intro')],
      scenarioRuns: [makeScenarioRun('sr-1', 10), makeScenarioRun('sr-2', 10)],
      personaRuns: [makePersonaRun('pr-1', 'sr-1'), makePersonaRun('pr-2', 'sr-2')],
      feedbacks: [makeFeedback('pr-1', 60), makeFeedback('pr-2', 80)],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const group = res.body[0];
    expect(group.benchmarkGroup).toBe('sales');
    expect(group.scenarioCount).toBe(1);
    expect(group.scenarioTitles).toEqual(['Sales Intro']);
    expect(group.averageScore).toBe(70);
    expect(group.sessionCount).toBe(2);
  });

  it('rounds the average score to the nearest integer', async () => {
    seedMocks({
      scenarios: [makeScenario(1, 'groupA')],
      scenarioRuns: [makeScenarioRun('sr-1', 1), makeScenarioRun('sr-2', 1), makeScenarioRun('sr-3', 1)],
      personaRuns: [
        makePersonaRun('pr-1', 'sr-1'),
        makePersonaRun('pr-2', 'sr-2'),
        makePersonaRun('pr-3', 'sr-3'),
      ],
      feedbacks: [makeFeedback('pr-1', 70), makeFeedback('pr-2', 71), makeFeedback('pr-3', 72)],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.body[0].averageScore).toBe(71);
  });

  it('returns null averageScore when all feedback scores are null', async () => {
    seedMocks({
      scenarios: [makeScenario(5, 'support')],
      scenarioRuns: [makeScenarioRun('sr-1', 5)],
      personaRuns: [makePersonaRun('pr-1', 'sr-1')],
      feedbacks: [makeFeedback('pr-1', null)],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.body[0].averageScore).toBeNull();
    expect(res.body[0].sessionCount).toBe(1);
  });

  it('excludes null scores from average but counts those sessions', async () => {
    seedMocks({
      scenarios: [makeScenario(7, 'onboarding')],
      scenarioRuns: [makeScenarioRun('sr-1', 7), makeScenarioRun('sr-2', 7)],
      personaRuns: [makePersonaRun('pr-1', 'sr-1'), makePersonaRun('pr-2', 'sr-2')],
      feedbacks: [makeFeedback('pr-1', null), makeFeedback('pr-2', 90)],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    const group = res.body[0];
    expect(group.averageScore).toBe(90);
    expect(group.sessionCount).toBe(2);
  });

  it('aggregates multiple scenarios within the same benchmark group', async () => {
    seedMocks({
      scenarios: [
        makeScenario(1, 'leadership', 'Leadership A'),
        makeScenario(2, 'leadership', 'Leadership B'),
      ],
      scenarioRuns: [makeScenarioRun('sr-1', 1), makeScenarioRun('sr-2', 2)],
      personaRuns: [makePersonaRun('pr-1', 'sr-1'), makePersonaRun('pr-2', 'sr-2')],
      feedbacks: [makeFeedback('pr-1', 60), makeFeedback('pr-2', 100)],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.body).toHaveLength(1);

    const group = res.body[0];
    expect(group.benchmarkGroup).toBe('leadership');
    expect(group.scenarioCount).toBe(2);
    expect(group.scenarioTitles).toEqual(expect.arrayContaining(['Leadership A', 'Leadership B']));
    expect(group.averageScore).toBe(80);
    expect(group.sessionCount).toBe(2);
  });

  it('separates results into distinct benchmark groups', async () => {
    seedMocks({
      scenarios: [
        makeScenario(1, 'alpha'),
        makeScenario(2, 'beta'),
      ],
      scenarioRuns: [makeScenarioRun('sr-1', 1), makeScenarioRun('sr-2', 2)],
      personaRuns: [makePersonaRun('pr-1', 'sr-1'), makePersonaRun('pr-2', 'sr-2')],
      feedbacks: [makeFeedback('pr-1', 50), makeFeedback('pr-2', 90)],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.body).toHaveLength(2);

    const byGroup = Object.fromEntries(res.body.map((g: any) => [g.benchmarkGroup, g]));
    expect(byGroup['alpha'].averageScore).toBe(50);
    expect(byGroup['beta'].averageScore).toBe(90);
  });

  it('returns groups sorted alphabetically by benchmarkGroup name', async () => {
    seedMocks({
      scenarios: [makeScenario(1, 'zebra'), makeScenario(2, 'apple'), makeScenario(3, 'mango')],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    const names = res.body.map((g: any) => g.benchmarkGroup);
    expect(names).toEqual([...names].sort());
  });

  it('returns sessionCount of 0 and null averageScore for a group with no feedbacks', async () => {
    seedMocks({
      scenarios: [makeScenario(99, 'empty-group', 'No Sessions Scenario')],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].averageScore).toBeNull();
    expect(res.body[0].sessionCount).toBe(0);
  });

  it('ignores feedbacks whose personaRun is not linked to a known scenario', async () => {
    seedMocks({
      scenarios: [makeScenario(1, 'known')],
      scenarioRuns: [makeScenarioRun('sr-1', 1)],
      personaRuns: [makePersonaRun('pr-1', 'sr-1')],
      feedbacks: [
        makeFeedback('pr-1', 80),
        makeFeedback('pr-orphan', 50),
      ],
    });

    const res = await request(buildApp()).get('/api/admin/analytics/benchmark-groups');
    expect(res.body[0].sessionCount).toBe(1);
    expect(res.body[0].averageScore).toBe(80);
  });
});
