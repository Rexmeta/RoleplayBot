/**
 * Vitest config for the smoke-test suite.
 *
 * Run with:  npm run test:smoke
 *
 * This config deliberately includes ONLY *.smoke.test.ts files and has a
 * generous per-test timeout (10 min) to accommodate real Veo API polling.
 * The GEMINI_API_KEY check inside each smoke test skips the suite when the
 * key is absent, making it safe to run in any environment.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.smoke.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 10 * 60 * 1000, // 10 minutes – Veo polling can take a while
  },
  resolve: {
    alias: {
      '@': path.resolve('./client/src'),
      '@shared': path.resolve('./shared'),
    },
  },
});
