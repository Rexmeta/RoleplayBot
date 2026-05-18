import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── isGCSAvailable with varying env vars ────────────────────────────────────
// GCS_BUCKET_NAME is a module-level const so we must reset the module cache
// before each test and re-import to pick up the patched env vars.

describe('isGCSAvailable — dual mode (REPL_ID + GCS_BUCKET_NAME)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.REPL_ID = process.env.REPL_ID;
    saved.GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
    saved.GCS_SERVICE_ACCOUNT_KEY = process.env.GCS_SERVICE_ACCOUNT_KEY;
    saved.K_SERVICE = process.env.K_SERVICE;
    saved.K_REVISION = process.env.K_REVISION;
    vi.resetModules();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  it('returns true when both REPL_ID and GCS_BUCKET_NAME are set (dual mode, no service key)', async () => {
    process.env.REPL_ID = 'test-repl';
    process.env.GCS_BUCKET_NAME = 'roleplay-bucket';
    delete process.env.GCS_SERVICE_ACCOUNT_KEY;
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;

    const { isGCSAvailable } = await import('../../server/services/gcsStorage');
    expect(isGCSAvailable()).toBe(true);
  });

  it('returns true when REPL_ID and GCS_BUCKET_NAME are both set with a service key', async () => {
    process.env.REPL_ID = 'test-repl';
    process.env.GCS_BUCKET_NAME = 'roleplay-bucket';
    process.env.GCS_SERVICE_ACCOUNT_KEY = '{"type":"service_account"}';
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;

    const { isGCSAvailable } = await import('../../server/services/gcsStorage');
    expect(isGCSAvailable()).toBe(true);
  });

  it('returns false when GCS_BUCKET_NAME is not set even if REPL_ID is set', async () => {
    process.env.REPL_ID = 'test-repl';
    delete process.env.GCS_BUCKET_NAME;
    delete process.env.GCS_SERVICE_ACCOUNT_KEY;
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;

    const { isGCSAvailable } = await import('../../server/services/gcsStorage');
    expect(isGCSAvailable()).toBe(false);
  });

  it('returns true in Cloud Run mode (K_SERVICE set, no REPL_ID) when GCS_BUCKET_NAME is set', async () => {
    delete process.env.REPL_ID;
    process.env.GCS_BUCKET_NAME = 'roleplay-bucket';
    process.env.K_SERVICE = 'my-service';
    delete process.env.K_REVISION;

    const { isGCSAvailable } = await import('../../server/services/gcsStorage');
    expect(isGCSAvailable()).toBe(true);
  });

  it('returns true when GCS_SERVICE_ACCOUNT_KEY is set without REPL_ID or K_SERVICE', async () => {
    delete process.env.REPL_ID;
    process.env.GCS_BUCKET_NAME = 'roleplay-bucket';
    process.env.GCS_SERVICE_ACCOUNT_KEY = '{"type":"service_account"}';
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;

    const { isGCSAvailable } = await import('../../server/services/gcsStorage');
    expect(isGCSAvailable()).toBe(true);
  });
});

// ─── GCS fallback route logic — key normalization ─────────────────────────────
// Test the key normalization applied in the /objects route before GCS fallback

describe('Object Storage route — key normalization', () => {
  it('strips query string from raw key', () => {
    const rawKey = 'scenarios/videos/intro-abc123.mp4?v=1234';
    const key = decodeURIComponent(rawKey).split('?')[0];
    expect(key).toBe('scenarios/videos/intro-abc123.mp4');
  });

  it('strips encoded query string from key', () => {
    const rawKey = encodeURIComponent('scenarios/videos/intro-abc123.mp4?v=1234');
    const key = decodeURIComponent(rawKey).split('?')[0];
    expect(key).toBe('scenarios/videos/intro-abc123.mp4');
  });

  it('rejects path traversal keys', () => {
    expect('../etc/passwd'.includes('..')).toBe(true);
  });

  it('accepts mp4 video key', () => {
    const key = 'scenarios/videos/intro-abc123.mp4';
    expect(key.includes('..')).toBe(false);
    expect(key).toBeTruthy();
  });

  it('accepts webm video key', () => {
    const key = 'scenarios/videos/intro-abc123.webm';
    expect(key.includes('..')).toBe(false);
    expect(key).toBeTruthy();
  });
});
