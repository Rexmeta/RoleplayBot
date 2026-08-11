import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for MediaStorageService.saveVideo filename sanitisation.
 *
 * Background: the safeTitle regex previously stripped ALL non-alphanumeric
 * characters including hyphens, so passing "ac-idle" produced "acidle" in the
 * filename — making clips unrecognisable and hiding gender from the path.
 * The fix updates the regex to preserve hyphens.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Replicate the safeTitle logic from saveVideo so we can unit-test it without
 *  touching the storage backend. */
function computeSafeTitle(scenarioTitle: string): string {
  return scenarioTitle
    .replace(/[^a-zA-Z0-9가-힣\s\-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('saveVideo — safeTitle filename sanitisation', () => {
  it('preserves a hyphen in a state string like "ac-idle"', () => {
    const result = computeSafeTitle('ac-idle');
    expect(result).toBe('ac-idle');
    expect(result).not.toContain('acidle');
  });

  it('does NOT produce "acidle" when title is "ac-idle"', () => {
    const result = computeSafeTitle('ac-idle');
    expect(result).not.toBe('acidle');
  });

  it('preserves hyphens in a compound persona-state title', () => {
    const result = computeSafeTitle('avatar-ac-idle');
    expect(result).toBe('avatar-ac-idle');
  });

  it('still strips characters that are not alphanumeric, Korean, space, or hyphen', () => {
    const result = computeSafeTitle('hello!@#world');
    expect(result).toBe('helloworld');
  });

  it('converts spaces to hyphens', () => {
    const result = computeSafeTitle('hello world');
    expect(result).toBe('hello-world');
  });

  it('truncates to 50 characters', () => {
    const long = 'a-'.repeat(30); // 60 chars
    expect(computeSafeTitle(long).length).toBeLessThanOrEqual(50);
  });

  it('preserves Korean characters', () => {
    const result = computeSafeTitle('시나리오-테스트');
    expect(result).toBe('시나리오-테스트');
  });
});

// ── integration-style test: saveVideo path contains the hyphen ────────────────

describe('saveVideo — end-to-end filename via mocked storage', () => {
  let uploadPaths: string[] = [];

  beforeEach(async () => {
    uploadPaths = [];

    // Stub the storage backend so no real network calls happen.
    vi.doMock('../../server/services/gcsStorage', () => ({
      isGCSAvailable: () => true,
      isCloudRun: () => false,
      uploadToGCS: async (_buf: Buffer, objectPath: string) => {
        uploadPaths.push(objectPath);
        return objectPath;
      },
      deleteFromGCS: async () => true,
      normalizeObjectPath: (p: string) => p,
      downloadBufferFromGCS: async () => null,
    }));

    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('saveVideo with title "ac-idle" does not produce a path containing "acidle"', async () => {
    const { MediaStorageService } = await import('../../server/services/mediaStorage');
    const svc = new MediaStorageService();

    await svc.saveVideo(new Uint8Array([0, 1, 2]), 'avatar-ac', 'ac-idle');

    expect(uploadPaths.length).toBeGreaterThan(0);
    const savedPath = uploadPaths[0];
    expect(savedPath).not.toContain('acidle');
    expect(savedPath).toContain('ac-idle');
  });
});
