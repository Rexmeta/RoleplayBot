import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateAgentApiKey,
  hashApiKey,
  verifyApiKeyHash,
  extractKeyPrefix,
  computeExpiryDate,
  getPepper,
} from '../../server/utils/agentApiKey';

const TEST_PEPPER = 'test-pepper-secret-32-chars-long!';

describe('getPepper', () => {
  afterEach(() => {
    delete process.env.AGENT_API_KEY_PEPPER;
  });

  it('returns the pepper when set', () => {
    process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
    expect(getPepper()).toBe(TEST_PEPPER);
  });

  it('throws when AGENT_API_KEY_PEPPER is not set', () => {
    delete process.env.AGENT_API_KEY_PEPPER;
    expect(() => getPepper()).toThrow('AGENT_API_KEY_PEPPER');
  });
});

describe('generateAgentApiKey', () => {
  beforeEach(() => {
    process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  });
  afterEach(() => {
    delete process.env.AGENT_API_KEY_PEPPER;
  });

  it('generates full key with rpb_live_ prefix for live environment', () => {
    const { fullKey } = generateAgentApiKey('live');
    expect(fullKey).toMatch(/^rpb_live_[0-9a-f]{8}_[0-9a-f]{32}$/);
  });

  it('generates full key with rpb_test_ prefix for test environment', () => {
    const { fullKey } = generateAgentApiKey('test');
    expect(fullKey).toMatch(/^rpb_test_[0-9a-f]{8}_[0-9a-f]{32}$/);
  });

  it('generates keyPrefix in format rpb_{env}_{8-hex}', () => {
    const { keyPrefix } = generateAgentApiKey('live');
    expect(keyPrefix).toMatch(/^rpb_live_[0-9a-f]{8}$/);
  });

  it('keyPrefix is the first segment of fullKey', () => {
    const { fullKey, keyPrefix } = generateAgentApiKey('live');
    expect(fullKey.startsWith(keyPrefix + '_')).toBe(true);
  });

  it('keyHash is consistent with hashApiKey applied to fullKey', () => {
    const { fullKey, keyHash } = generateAgentApiKey('live');
    expect(keyHash).toBe(hashApiKey(fullKey, TEST_PEPPER));
  });

  it('generates unique keys across multiple calls', () => {
    const keys = Array.from({ length: 10 }, () => generateAgentApiKey('live').fullKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(10);
  });

  it('throws when AGENT_API_KEY_PEPPER is not set', () => {
    delete process.env.AGENT_API_KEY_PEPPER;
    expect(() => generateAgentApiKey('live')).toThrow('AGENT_API_KEY_PEPPER');
  });
});

describe('hashApiKey', () => {
  it('produces a 64-character hex string (SHA-256)', () => {
    const hash = hashApiKey('any-key', 'any-pepper');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: same inputs always produce the same hash', () => {
    const h1 = hashApiKey('my-key', 'my-pepper');
    const h2 = hashApiKey('my-key', 'my-pepper');
    expect(h1).toBe(h2);
  });

  it('different pepper produces a different hash', () => {
    const h1 = hashApiKey('same-key', 'pepper-a');
    const h2 = hashApiKey('same-key', 'pepper-b');
    expect(h1).not.toBe(h2);
  });

  it('different key produces a different hash', () => {
    const h1 = hashApiKey('key-a', 'same-pepper');
    const h2 = hashApiKey('key-b', 'same-pepper');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyApiKeyHash', () => {
  beforeEach(() => {
    process.env.AGENT_API_KEY_PEPPER = TEST_PEPPER;
  });
  afterEach(() => {
    delete process.env.AGENT_API_KEY_PEPPER;
  });

  it('returns true when the full key matches the stored hash', () => {
    const { fullKey, keyHash } = generateAgentApiKey('live');
    expect(verifyApiKeyHash(fullKey, keyHash)).toBe(true);
  });

  it('returns false when an incorrect key is provided', () => {
    const { keyHash } = generateAgentApiKey('live');
    const wrongKey = 'rpb_live_00000000_' + '0'.repeat(32);
    expect(verifyApiKeyHash(wrongKey, keyHash)).toBe(false);
  });

  it('returns false when an incorrect hash is provided', () => {
    const { fullKey } = generateAgentApiKey('live');
    const wrongHash = '0'.repeat(64);
    expect(verifyApiKeyHash(fullKey, wrongHash)).toBe(false);
  });

  it('returns false (does not throw) when AGENT_API_KEY_PEPPER is missing', () => {
    delete process.env.AGENT_API_KEY_PEPPER;
    const hash = '0'.repeat(64);
    expect(verifyApiKeyHash('any-key', hash)).toBe(false);
  });

  it('is timing-safe: length mismatch returns false without throwing', () => {
    const hash = 'short';
    expect(verifyApiKeyHash('any-key', hash)).toBe(false);
  });
});

describe('extractKeyPrefix', () => {
  it('extracts prefix from a valid live key', () => {
    const key = 'rpb_live_abcd1234_' + 'e'.repeat(32);
    expect(extractKeyPrefix(key)).toBe('rpb_live_abcd1234');
  });

  it('extracts prefix from a valid test key', () => {
    const key = 'rpb_test_12345678_' + 'f'.repeat(32);
    expect(extractKeyPrefix(key)).toBe('rpb_test_12345678');
  });

  it('returns null for an empty string', () => {
    expect(extractKeyPrefix('')).toBeNull();
  });

  it('returns null for a key with unknown environment segment', () => {
    const key = 'rpb_prod_abcd1234_' + 'e'.repeat(32);
    expect(extractKeyPrefix(key)).toBeNull();
  });

  it('returns null for a key with wrong prefix segment length', () => {
    const key = 'rpb_live_abc_' + 'e'.repeat(32);
    expect(extractKeyPrefix(key)).toBeNull();
  });

  it('returns null for a key with wrong secret segment length', () => {
    const key = 'rpb_live_abcd1234_' + 'e'.repeat(16);
    expect(extractKeyPrefix(key)).toBeNull();
  });

  it('returns null for completely invalid strings', () => {
    expect(extractKeyPrefix('not-a-key')).toBeNull();
    expect(extractKeyPrefix('Bearer rpb_live_abcd1234_' + 'e'.repeat(32))).toBeNull();
  });
});

describe('computeExpiryDate', () => {
  it('defaults to approximately 90 days from now', () => {
    const before = Date.now();
    const expiry = computeExpiryDate();
    const after = Date.now();
    const diffDaysMin = (expiry.getTime() - after) / (86400 * 1000);
    const diffDaysMax = (expiry.getTime() - before) / (86400 * 1000);
    expect(diffDaysMin).toBeGreaterThan(89);
    expect(diffDaysMax).toBeLessThan(91);
  });

  it('respects a custom day count', () => {
    const expiry = computeExpiryDate(30);
    const diff = expiry.getTime() - Date.now();
    const days = diff / (86400 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('caps at 365 days regardless of requested value', () => {
    const expiry = computeExpiryDate(500);
    const diff = expiry.getTime() - Date.now();
    const days = diff / (86400 * 1000);
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);
  });

  it('returns a Date object', () => {
    expect(computeExpiryDate()).toBeInstanceOf(Date);
  });
});
