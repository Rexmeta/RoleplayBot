import { describe, it, expect, afterEach } from 'vitest';
import { MemStorage } from '../../server/storage/index';

describe('MemStorage proxy – missing method guard', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws a descriptive error in development when no delegate implements the method', () => {
    process.env.NODE_ENV = 'development';
    const storage = new MemStorage();
    expect(() => {
      (storage as unknown as Record<string, unknown>)['nonExistentMethod'];
    }).toThrow("MemStorage: no delegate implements method 'nonExistentMethod'");
  });

  it('returns undefined in production when no delegate implements the method', () => {
    process.env.NODE_ENV = 'production';
    const storage = new MemStorage();
    const result = (storage as unknown as Record<string, unknown>)['nonExistentMethod'];
    expect(result).toBeUndefined();
  });
});
