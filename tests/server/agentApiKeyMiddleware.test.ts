import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';

const TEST_PEPPER = 'test-middleware-pepper-32-chars!!';

// ─── hoisted mutable state so vi.mock factory can reference it ───────────────
const mockState = vi.hoisted(() => ({
  candidates: [] as any[],
  updateCatch: vi.fn(),
}));

vi.mock('../../server/storage', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockState.candidates),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          catch: mockState.updateCatch,
        }),
      }),
    }),
  },
}));

// ─── import after mocks are set up ──────────────────────────────────────────
import {
  isAgentApiKey,
  requireScope,
  attachAgentRequestId,
} from '../../server/middleware/agentApiKeyMiddleware';
import { generateAgentApiKey, hashApiKey } from '../../server/utils/agentApiKey';

// ─── helpers ────────────────────────────────────────────────────────────────
function buildApp(extraMiddleware?: (req: any, res: Response, next: any) => void) {
  const app = express();
  app.use(express.json());
  app.use(attachAgentRequestId);
  app.use(isAgentApiKey);
  if (extraMiddleware) app.use(extraMiddleware);
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

function makeValidKey() {
  process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  const { fullKey, keyHash, keyPrefix } = generateAgentApiKey('live');
  return { fullKey, keyHash, keyPrefix };
}

function makeRecord(overrides: Partial<any> = {}): any {
  const { fullKey, keyHash, keyPrefix } = makeValidKey();
  return {
    id: 'key-id-1',
    keyHash,
    keyPrefix,
    isActive: true,
    revokedAt: null,
    expiresAt: null,
    allowedIps: [],
    scopes: ['sessions:read', 'sessions:create', 'sessions:message'],
    organizationId: 'org-1',
    ...overrides,
    fullKey,
  };
}

beforeEach(() => {
  process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  mockState.candidates = [];
  mockState.updateCatch.mockReset();
});

afterEach(() => {
  delete process.env.AGENT_API_KEY_PEPPER;
});

// ─── isAgentApiKey ───────────────────────────────────────────────────────────
describe('isAgentApiKey middleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = buildApp();
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when key format is invalid', async () => {
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', 'Bearer bad-format-key');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when no candidates found in DB', async () => {
    mockState.candidates = [];
    const { fullKey } = makeRecord();
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when HMAC comparison fails (wrong hash stored)', async () => {
    const { fullKey, keyPrefix } = makeRecord();
    mockState.candidates = [{
      id: 'key-id-1',
      keyHash: '0'.repeat(64),
      keyPrefix,
      isActive: true,
      revokedAt: null,
      expiresAt: null,
      allowedIps: [],
      scopes: [],
      organizationId: 'org-1',
    }];
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when key is inactive (isActive = false)', async () => {
    const rec = makeRecord({ isActive: false });
    mockState.candidates = [rec];
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('revoked_api_key');
  });

  it('returns 401 when key has been revoked (revokedAt is set)', async () => {
    const rec = makeRecord({ revokedAt: new Date(Date.now() - 1000) });
    mockState.candidates = [rec];
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('revoked_api_key');
  });

  it('returns 401 when key has expired', async () => {
    const rec = makeRecord({ expiresAt: new Date(Date.now() - 1000) });
    mockState.candidates = [rec];
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('expired_api_key');
  });

  it('returns 403 when client IP is not in the whitelist', async () => {
    const rec = makeRecord({ allowedIps: ['10.0.0.1'] });
    mockState.candidates = [rec];
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ip_not_allowed');
  });

  it('allows request when client IP is in the whitelist', async () => {
    // supertest's loopback address normalizes to 127.0.0.1
    const rec = makeRecord({ allowedIps: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] });
    mockState.candidates = [rec];
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(200);
  });

  it('calls next() and attaches agentKey for a valid key with no restrictions', async () => {
    const rec = makeRecord();
    mockState.candidates = [rec];
    let capturedKey: any;
    const app = buildApp((req: any, _res, next) => {
      capturedKey = req.agentKey;
      next();
    });
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(200);
    expect(capturedKey).toBeDefined();
    expect(capturedKey.id).toBe('key-id-1');
  });

  it('sets X-Request-Id and X-API-Version headers on every response', async () => {
    const app = buildApp();
    const res = await request(app).get('/test');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-api-version']).toBe('2026-05-13');
  });

  it('keys that have not expired yet are allowed through', async () => {
    const rec = makeRecord({ expiresAt: new Date(Date.now() + 86400 * 1000) });
    mockState.candidates = [rec];
    const app = buildApp();
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(200);
  });
});

// ─── requireScope ────────────────────────────────────────────────────────────
describe('requireScope middleware', () => {
  function buildScopedApp(requiredScope: string) {
    const app = express();
    app.use(express.json());
    app.use(attachAgentRequestId);
    app.use(isAgentApiKey);
    app.use(requireScope(requiredScope as any));
    app.get('/test', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('returns 403 when key lacks the required scope', async () => {
    const rec = makeRecord({ scopes: ['scenarios:read'] });
    mockState.candidates = [rec];
    const app = buildScopedApp('sessions:create');
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('passes when key has the required scope', async () => {
    const rec = makeRecord({ scopes: ['scenarios:read', 'sessions:create'] });
    mockState.candidates = [rec];
    const app = buildScopedApp('sessions:create');
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(200);
  });

  it('returns 403 when scopes array is empty', async () => {
    const rec = makeRecord({ scopes: [] });
    mockState.candidates = [rec];
    const app = buildScopedApp('sessions:read');
    const res = await request(app).get('/test').set('Authorization', `Bearer ${rec.fullKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });

  it('constant-time comparison: slightly modified key is still rejected at HMAC level', async () => {
    const rec = makeRecord({ scopes: ['sessions:read'] });
    mockState.candidates = [rec];
    const app = buildScopedApp('sessions:read');

    // Flip the last character of the secret segment
    const parts = rec.fullKey.split('_');
    const lastPart = parts[parts.length - 1];
    const flipped = lastPart.slice(0, -1) + (lastPart.endsWith('a') ? 'b' : 'a');
    parts[parts.length - 1] = flipped;
    const tamperedKey = parts.join('_');

    const res = await request(app).get('/test').set('Authorization', `Bearer ${tamperedKey}`);
    expect(res.status).toBe(401);
  });
});
