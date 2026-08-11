import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoJobStore } from '../../server/utils/videoJobStore';

// Stub out the pg pool so the store's fire-and-forget DB calls are silent no-ops in tests.
vi.mock('../../server/storage/db', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// Convenience helpers so every test doesn't repeat the three extra args.
const PERSONA = 'persona-1';
const SLOT    = 'listening_neutral';
const GENDER  = 'male';
function mkStore() { return new VideoJobStore(); }
function create(store: VideoJobStore, jobId: string) {
  return store.create(jobId, PERSONA, SLOT, GENDER);
}

// ─── create() ────────────────────────────────────────────────────────────────

describe('VideoJobStore – create()', () => {
  it('creates a job with status pending', () => {
    const store = mkStore();
    const record = create(store, 'job-1');
    expect(record.jobId).toBe('job-1');
    expect(record.status).toBe('pending');
    expect(record.result).toBeUndefined();
    expect(record.error).toBeUndefined();
    expect(record.createdAt).toBeGreaterThan(0);
  });

  it('makes the job retrievable via get()', async () => {
    const store = mkStore();
    create(store, 'job-2');
    const fetched = await store.get('job-2');
    expect(fetched).toBeDefined();
    expect(fetched!.jobId).toBe('job-2');
    expect(fetched!.status).toBe('pending');
  });

  it('returns undefined for an unknown jobId', async () => {
    const store = mkStore();
    expect(await store.get('does-not-exist')).toBeUndefined();
  });

  it('stores multiple independent jobs', async () => {
    const store = mkStore();
    create(store, 'a');
    create(store, 'b');
    expect((await store.get('a'))?.status).toBe('pending');
    expect((await store.get('b'))?.status).toBe('pending');
  });

  it('returned record createdAt is close to Date.now()', () => {
    const store = mkStore();
    const before = Date.now();
    const record = create(store, 'ts-job');
    const after = Date.now();
    expect(record.createdAt).toBeGreaterThanOrEqual(before);
    expect(record.createdAt).toBeLessThanOrEqual(after);
  });
});

// ─── setRunning() ─────────────────────────────────────────────────────────────

describe('VideoJobStore – setRunning()', () => {
  it('transitions status from pending to running', async () => {
    const store = mkStore();
    create(store, 'job-r');
    store.setRunning('job-r');
    expect((await store.get('job-r'))!.status).toBe('running');
  });

  it('does nothing for an unknown jobId (no throw)', () => {
    const store = mkStore();
    expect(() => store.setRunning('ghost')).not.toThrow();
  });

  it('does not affect sibling jobs', async () => {
    const store = mkStore();
    create(store, 'a');
    create(store, 'b');
    store.setRunning('a');
    expect((await store.get('b'))!.status).toBe('pending');
  });
});

// ─── setDone() ────────────────────────────────────────────────────────────────

describe('VideoJobStore – setDone()', () => {
  it('transitions status to done and stores result', async () => {
    const store = mkStore();
    create(store, 'job-d');
    store.setDone('job-d', 'https://example.com/clip.mp4', 'listening_neutral', 'male');
    const record = (await store.get('job-d'))!;
    expect(record.status).toBe('done');
    expect(record.result).toEqual({ videoUrl: 'https://example.com/clip.mp4', slot: 'listening_neutral', gender: 'male' });
    expect(record.error).toBeUndefined();
  });

  it('stores the exact videoUrl and slot provided', async () => {
    const store = mkStore();
    create(store, 'job-url');
    store.setDone('job-url', 'https://cdn.test/video.mp4', 'speaking_positive', 'female');
    expect((await store.get('job-url'))!.result!.videoUrl).toBe('https://cdn.test/video.mp4');
    expect((await store.get('job-url'))!.result!.slot).toBe('speaking_positive');
  });

  it('does nothing for an unknown jobId (no throw)', () => {
    const store = mkStore();
    expect(() => store.setDone('ghost', 'url', 'listening_neutral', 'male')).not.toThrow();
  });

  it('overwrites a prior result if called twice', async () => {
    const store = mkStore();
    create(store, 'job-ow');
    store.setDone('job-ow', 'https://first.mp4', 'listening_neutral', 'male');
    store.setDone('job-ow', 'https://second.mp4', 'speaking_negative', 'male');
    expect((await store.get('job-ow'))!.result!.videoUrl).toBe('https://second.mp4');
    expect((await store.get('job-ow'))!.result!.slot).toBe('speaking_negative');
  });
});

// ─── setError() ───────────────────────────────────────────────────────────────

describe('VideoJobStore – setError()', () => {
  it('transitions status to error and stores error message', async () => {
    const store = mkStore();
    create(store, 'job-e');
    store.setError('job-e', '생성 실패');
    const record = (await store.get('job-e'))!;
    expect(record.status).toBe('error');
    expect(record.error).toBe('생성 실패');
    expect(record.result).toBeUndefined();
  });

  it('does nothing for an unknown jobId (no throw)', () => {
    const store = mkStore();
    expect(() => store.setError('ghost', 'some error')).not.toThrow();
  });

  it('preserves the error message verbatim', async () => {
    const store = mkStore();
    create(store, 'job-msg');
    const msg = 'Network timeout after 30s';
    store.setError('job-msg', msg);
    expect((await store.get('job-msg'))!.error).toBe(msg);
  });

  it('does not set a result field when erroring', async () => {
    const store = mkStore();
    create(store, 'job-nourl');
    store.setError('job-nourl', 'fail');
    expect((await store.get('job-nourl'))!.result).toBeUndefined();
  });
});

// ─── expiry eviction ──────────────────────────────────────────────────────────

describe('VideoJobStore – expiry eviction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts jobs older than 30 minutes when a new job is created', async () => {
    const store = mkStore();

    vi.setSystemTime(Date.now());
    create(store, 'old-job');

    // Advance time past the 30-minute TTL
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);

    // Creating a new job triggers the eviction sweep
    create(store, 'new-job');

    expect(await store.get('old-job')).toBeUndefined();
    expect(await store.get('new-job')).toBeDefined();
  });

  it('keeps jobs that are still within the 30-minute window', async () => {
    const store = mkStore();

    vi.setSystemTime(Date.now());
    create(store, 'young-job');

    vi.advanceTimersByTime(15 * 60 * 1000); // only 15 min

    create(store, 'trigger-job'); // triggers eviction scan

    expect(await store.get('young-job')).toBeDefined();
  });

  it('evicts only expired jobs and keeps recent ones', async () => {
    const store = mkStore();

    vi.setSystemTime(Date.now());
    create(store, 'old');                              // t=0

    vi.advanceTimersByTime(20 * 60 * 1000);
    create(store, 'middle');                           // t=20min

    vi.advanceTimersByTime(11 * 60 * 1000);           // t=31min total
    create(store, 'new');                              // triggers eviction

    expect(await store.get('old')).toBeUndefined();   // 31 min > TTL
    expect(await store.get('middle')).toBeDefined();  // 11 min < TTL
    expect(await store.get('new')).toBeDefined();
  });

  it('job at exactly the TTL boundary is NOT evicted (strict > check)', async () => {
    const store = mkStore();

    vi.setSystemTime(Date.now());
    create(store, 'boundary-job');

    vi.advanceTimersByTime(30 * 60 * 1000); // exactly 30 min

    create(store, 'trigger');

    // now - createdAt === TTL_MS, but eviction uses strict >, so the job survives
    expect(await store.get('boundary-job')).toBeDefined();
  });

  it('job one millisecond past the TTL boundary is evicted', async () => {
    const store = mkStore();

    vi.setSystemTime(Date.now());
    create(store, 'just-expired-job');

    vi.advanceTimersByTime(30 * 60 * 1000 + 1); // 30 min + 1 ms

    create(store, 'trigger');

    expect(await store.get('just-expired-job')).toBeUndefined();
  });
});
