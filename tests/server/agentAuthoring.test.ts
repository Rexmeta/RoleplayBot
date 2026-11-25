import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const state = vi.hoisted(() => ({
  owner: { id: 'op-1', role: 'operator', isActive: true } as any,
  categories: ['cat-1'] as string[],
  auditInserts: [] as any[],
  idem: new Map<string, any>(),
  key: null as any,
}));

vi.mock('../../server/storage', () => ({
  db: {
    insert: () => ({
      values: (v: any) => {
        if (v.action) { state.auditInserts.push(v); return Promise.resolve(); }
        const row = state.idem;
        row.set(v.key, v);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([...(state.idem.size ? [state.idem.values().next().value] : [])]),
        }),
      }),
    }),
  },
  storage: { getUser: async () => state.owner },
}));
vi.mock('../../server/routes/routerHelpers', () => ({
  getOperatorAccessibleCategoryIds: async () => state.categories,
}));

import {
  requireAuthoring,
  authoringIdempotency,
  findPublishAttempts,
  rejectPublishAttempts,
  scenarioDraftFields,
  rubricDraftFields,
  recordAuthoringAudit,
  getAuthoringContext,
  canAccessCategory,
  AGENT_WRITE_RATE_LIMIT_PER_MINUTE,
} from '../../server/services/agentAuthoring';
import { attachAgentRequestId } from '../../server/middleware/agentApiKeyMiddleware';
import { hasAuthoringScope } from '@shared/schema';

function makeKey(overrides: any = {}) {
  return {
    id: 'key-1', name: 'Bot', ownerUserId: 'op-1', organizationId: 'org-1',
    scopes: ['scenarios:write'], expiresAt: new Date(Date.now() + 86400000), ...overrides,
  };
}

function buildApp(scope?: any) {
  const app = express();
  app.use(express.json());
  app.use(attachAgentRequestId);
  app.use((req: any, _res, next) => { req.agentKey = state.key; next(); });
  app.use('/w', authoringIdempotency);
  app.post('/w/scenarios', ...requireAuthoring(scope), async (req: any, res) => {
    if (rejectPublishAttempts(res, req.body)) return;
    const ctx = getAuthoringContext(req);
    await recordAuthoringAudit(req, 'scenario.created', 'scenario', 's-1', { title: req.body.title });
    res.status(201).json({ ...scenarioDraftFields(ctx), inScope: canAccessCategory(ctx, req.body.categoryId) });
  });
  return app;
}

beforeEach(() => {
  state.owner = { id: 'op-1', role: 'operator', isActive: true };
  state.categories = ['cat-1'];
  state.auditInserts = [];
  state.idem = new Map();
  state.key = makeKey();
});

describe('authoring guard', () => {
  it('rejects keys without the required authoring scope', async () => {
    state.key = makeKey({ scopes: ['scenarios:read'] });
    const res = await request(buildApp('scenarios:write')).post('/w/scenarios').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('rejects the personas:write scope on a scenarios endpoint', async () => {
    state.key = makeKey({ scopes: ['personas:write'] });
    const res = await request(buildApp('scenarios:write')).post('/w/scenarios').send({});
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('rejects keys without an expiry date', async () => {
    state.key = makeKey({ expiresAt: null });
    const res = await request(buildApp('scenarios:write')).post('/w/scenarios').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('authoring_out_of_scope');
  });

  it('rejects when the owner is deactivated or not an operator/admin', async () => {
    state.owner = { id: 'op-1', role: 'user', isActive: true };
    let res = await request(buildApp('scenarios:write')).post('/w/scenarios').send({});
    expect(res.body.error.code).toBe('authoring_out_of_scope');
    state.owner = { id: 'op-1', role: 'operator', isActive: false };
    res = await request(buildApp('scenarios:write')).post('/w/scenarios').send({});
    expect(res.body.error.code).toBe('authoring_out_of_scope');
  });

  it('accepts any authoring scope when none is specified', async () => {
    state.key = makeKey({ scopes: ['rubrics:write'] });
    const res = await request(buildApp()).post('/w/scenarios').send({ categoryId: 'cat-1' });
    expect(res.status).toBe(201);
  });
});

describe('owner scope and drafts', () => {
  it('limits categories to the owner scope', async () => {
    const app = buildApp('scenarios:write');
    expect((await request(app).post('/w/scenarios').send({ categoryId: 'cat-1' })).body.inScope).toBe(true);
    expect((await request(app).post('/w/scenarios').send({ categoryId: 'cat-2' })).body.inScope).toBe(false);
  });

  it('forces drafts and records authorship', async () => {
    const res = await request(buildApp('scenarios:write')).post('/w/scenarios').send({ categoryId: 'cat-1' });
    expect(res.body).toMatchObject({
      isPublic: false, isDemo: false, storeListed: false,
      authoredByAgent: { agentKeyId: 'key-1', agentKeyName: 'Bot', ownerUserId: 'op-1' },
    });
  });

  it('refuses publish, approval and default attempts', async () => {
    const res = await request(buildApp('scenarios:write')).post('/w/scenarios').send({ isPublic: true, status: 'approved', isDefault: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('authoring_draft_only');
    expect(res.body.error.details.fields).toEqual(expect.arrayContaining(['isPublic', 'status', 'isDefault']));
  });

  it('allows explicit draft values', () => {
    expect(findPublishAttempts({ isPublic: false, status: 'draft', isDefault: false })).toEqual([]);
  });

  it('builds unapproved, non-default rubric drafts', () => {
    const ctx: any = { owner: { id: 'op-1' }, authorship: { agentKeyId: 'key-1', agentKeyName: 'Bot', ownerUserId: 'op-1' } };
    expect(rubricDraftFields(ctx)).toMatchObject({ status: 'draft', isDefault: false, approvedBy: null, ownerOperatorId: 'op-1' });
  });
});

describe('audit and idempotency', () => {
  it('writes an audit log with the agent key and owner', async () => {
    await request(buildApp('scenarios:write')).post('/w/scenarios').send({ title: 'T' });
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]).toMatchObject({
      actorUserId: 'op-1', action: 'agent_authoring.scenario.created', targetType: 'scenario',
      metadata: { agentKeyId: 'key-1', agentKeyName: 'Bot', ownerUserId: 'op-1', title: 'T' },
    });
  });

  it('replays the stored response for a repeated Idempotency-Key', async () => {
    const app = buildApp('scenarios:write');
    const first = await request(app).post('/w/scenarios').set('Idempotency-Key', 'k1').send({ title: 'T' });
    expect(first.status).toBe(201);
    await new Promise((r) => setTimeout(r, 10));
    const second = await request(app).post('/w/scenarios').set('Idempotency-Key', 'k1').send({ title: 'T' });
    expect(second.status).toBe(201);
    expect(state.auditInserts).toHaveLength(1);
  });

  it('returns 409 when the key is reused with a different body', async () => {
    const app = buildApp('scenarios:write');
    await request(app).post('/w/scenarios').set('Idempotency-Key', 'k2').send({ title: 'A' });
    await new Promise((r) => setTimeout(r, 10));
    const res = await request(app).post('/w/scenarios').set('Idempotency-Key', 'k2').send({ title: 'B' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('idempotency_key_conflict');
  });
});

describe('write rate limit', () => {
  it('returns a dedicated error after the per-minute write limit', async () => {
    state.key = makeKey({ id: 'key-rate' });
    const app = buildApp('scenarios:write');
    let last: any;
    for (let i = 0; i <= AGENT_WRITE_RATE_LIMIT_PER_MINUTE; i++) {
      last = await request(app).post('/w/scenarios').send({ categoryId: 'cat-1' });
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('authoring_rate_limit_exceeded');
  });
});

describe('scope helpers', () => {
  it('detects authoring scopes', () => {
    expect(hasAuthoringScope(['scenarios:read'])).toBe(false);
    expect(hasAuthoringScope(['scenarios:read', 'rubrics:write'])).toBe(true);
    expect(hasAuthoringScope(undefined)).toBe(false);
  });
});
