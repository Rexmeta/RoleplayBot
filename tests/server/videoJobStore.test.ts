import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoJobStore } from '../../server/utils/videoJobStore';

// Each describe block creates a fresh VideoJobStore instance so tests are
// fully isolated from one another and from the module-level singleton.

// ─── create() ────────────────────────────────────────────────────────────────

describe('VideoJobStore – create()', () => {
  it('creates a job with status pending', () => {
    const store = new VideoJobStore();
    const record = store.create('job-1');
    expect(record.jobId).toBe('job-1');
    expect(record.status).toBe('pending');
    expect(record.result).toBeUndefined();
    expect(record.error).toBeUndefined();
    expect(record.createdAt).toBeGreaterThan(0);
  });

  it('makes the job retrievable via get()', () => {
    const store = new VideoJobStore();
    store.create('job-2');
    const fetched = store.get('job-2');
    expect(fetched).toBeDefined();
    expect(fetched!.jobId).toBe('job-2');
    expect(fetched!.status).toBe('pending');
  });

  it('returns undefined for an unknown jobId', () => {
    const store = new VideoJobStore();
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('stores multiple independent jobs', () => {
    const store = new VideoJobStore();
    store.create('a');
    store.create('b');
    expect(store.get('a')?.status).toBe('pending');
    expect(store.get('b')?.status).toBe('pending');
  });

  it('returned record createdAt is close to Date.now()', () => {
    const store = new VideoJobStore();
    const before = Date.now();
    const record = store.create('ts-job');
    const after = Date.now();
    expect(record.createdAt).toBeGreaterThanOrEqual(before);
    expect(record.createdAt).toBeLessThanOrEqual(after);
  });
});

// ─── setRunning() ─────────────────────────────────────────────────────────────

describe('VideoJobStore – setRunning()', () => {
  it('transitions status from pending to running', () => {
    const store = new VideoJobStore();
    store.create('job-r');
    store.setRunning('job-r');
    expect(store.get('job-r')!.status).toBe('running');
  });

  it('does nothing for an unknown jobId (no throw)', () => {
    const store = new VideoJobStore();
    expect(() => store.setRunning('ghost')).not.toThrow();
  });

  it('does not affect sibling jobs', () => {
    const store = new VideoJobStore();
    store.create('a');
    store.create('b');
    store.setRunning('a');
    expect(store.get('b')!.status).toBe('pending');
  });
});

// ─── setDone() ────────────────────────────────────────────────────────────────

describe('VideoJobStore – setDone()', () => {
  it('transitions status to done and stores result', () => {
    const store = new VideoJobStore();
    store.create('job-d');
    store.setDone('job-d', 'https://example.com/clip.mp4', 'idle');
    const record = store.get('job-d')!;
    expect(record.status).toBe('done');
    expect(record.result).toEqual({ videoUrl: 'https://example.com/clip.mp4', state: 'idle' });
    expect(record.error).toBeUndefined();
  });

  it('stores the exact videoUrl and state provided', () => {
    const store = new VideoJobStore();
    store.create('job-url');
    store.setDone('job-url', 'https://cdn.test/video.mp4', 'speaking');
    expect(store.get('job-url')!.result!.videoUrl).toBe('https://cdn.test/video.mp4');
    expect(store.get('job-url')!.result!.state).toBe('speaking');
  });

  it('does nothing for an unknown jobId (no throw)', () => {
    const store = new VideoJobStore();
    expect(() => store.setDone('ghost', 'url', 'idle')).not.toThrow();
  });

  it('overwrites a prior result if called twice', () => {
    const store = new VideoJobStore();
    store.create('job-ow');
    store.setDone('job-ow', 'https://first.mp4', 'idle');
    store.setDone('job-ow', 'https://second.mp4', 'speaking');
    expect(store.get('job-ow')!.result!.videoUrl).toBe('https://second.mp4');
    expect(store.get('job-ow')!.result!.state).toBe('speaking');
  });
});

// ─── setError() ───────────────────────────────────────────────────────────────

describe('VideoJobStore – setError()', () => {
  it('transitions status to error and stores error message', () => {
    const store = new VideoJobStore();
    store.create('job-e');
    store.setError('job-e', '생성 실패');
    const record = store.get('job-e')!;
    expect(record.status).toBe('error');
    expect(record.error).toBe('생성 실패');
    expect(record.result).toBeUndefined();
  });

  it('does nothing for an unknown jobId (no throw)', () => {
    const store = new VideoJobStore();
    expect(() => store.setError('ghost', 'some error')).not.toThrow();
  });

  it('preserves the error message verbatim', () => {
    const store = new VideoJobStore();
    store.create('job-msg');
    const msg = 'Network timeout after 30s';
    store.setError('job-msg', msg);
    expect(store.get('job-msg')!.error).toBe(msg);
  });

  it('does not set a result field when erroring', () => {
    const store = new VideoJobStore();
    store.create('job-nourl');
    store.setError('job-nourl', 'fail');
    expect(store.get('job-nourl')!.result).toBeUndefined();
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

  it('evicts jobs older than 30 minutes when a new job is created', () => {
    const store = new VideoJobStore();

    vi.setSystemTime(Date.now());
    store.create('old-job');

    // Advance time past the 30-minute TTL
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);

    // Creating a new job triggers the eviction sweep
    store.create('new-job');

    expect(store.get('old-job')).toBeUndefined();
    expect(store.get('new-job')).toBeDefined();
  });

  it('keeps jobs that are still within the 30-minute window', () => {
    const store = new VideoJobStore();

    vi.setSystemTime(Date.now());
    store.create('young-job');

    vi.advanceTimersByTime(15 * 60 * 1000); // only 15 min

    store.create('trigger-job'); // triggers eviction scan

    expect(store.get('young-job')).toBeDefined();
  });

  it('evicts only expired jobs and keeps recent ones', () => {
    const store = new VideoJobStore();

    vi.setSystemTime(Date.now());
    store.create('old');                              // t=0

    vi.advanceTimersByTime(20 * 60 * 1000);
    store.create('middle');                           // t=20min

    vi.advanceTimersByTime(11 * 60 * 1000);           // t=31min total
    store.create('new');                              // triggers eviction

    expect(store.get('old')).toBeUndefined();         // 31 min > TTL
    expect(store.get('middle')).toBeDefined();        // 11 min < TTL
    expect(store.get('new')).toBeDefined();
  });

  it('job at exactly the TTL boundary is NOT evicted (strict > check)', () => {
    const store = new VideoJobStore();

    vi.setSystemTime(Date.now());
    store.create('boundary-job');

    vi.advanceTimersByTime(30 * 60 * 1000); // exactly 30 min

    store.create('trigger');

    // now - createdAt === TTL_MS, but eviction uses strict >, so the job survives
    expect(store.get('boundary-job')).toBeDefined();
  });

  it('job one millisecond past the TTL boundary is evicted', () => {
    const store = new VideoJobStore();

    vi.setSystemTime(Date.now());
    store.create('just-expired-job');

    vi.advanceTimersByTime(30 * 60 * 1000 + 1); // 30 min + 1 ms

    store.create('trigger');

    expect(store.get('just-expired-job')).toBeUndefined();
  });
});
