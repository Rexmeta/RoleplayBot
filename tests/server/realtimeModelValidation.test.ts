/**
 * Regression tests: supported Gemini realtime model names
 *
 * These tests keep the runtime model list (realtimeVoiceService + shared/realtimeModels)
 * and the migration allowlist (REALTIME_MODEL_MIGRATION_ALLOWLIST in migrate.ts) in sync.
 * If a deprecated name is re-introduced, or the current model name changes, at least one
 * test here will fail — pointing directly at the file that drifted.
 */
import { describe, it, expect } from 'vitest';
import {
  REALTIME_MODELS,
  VALID_REALTIME_MODEL_VALUES,
} from '../../shared/realtimeModels';
// Import the real constant that the migration SQL is built from — not a local copy.
import { REALTIME_MODEL_MIGRATION_ALLOWLIST } from '../../server/migrate';

// ─── canonical current Gemini model ─────────────────────────────────────────
const CURRENT_GEMINI_MODEL = 'gemini-3.1-flash-live-preview';

// ─── exact expected Gemini Live entries in the shared model list ─────────────
const EXPECTED_GEMINI_MODELS = new Set(['gemini-3.1-flash-live-preview']);

// ─── deprecated Gemini Live names that must never appear in any valid-model list
const DEPRECATED_GEMINI_NAMES = [
  'gemini-live-2.5-flash-preview',
  'gemini-live-2.5-flash-native-audio',
  'gemini-2.5-flash-live',
  'gemini-2.0-flash-live-preview',
  'gemini-live-preview',
];

// ────────────────────────────────────────────────────────────────────────────
describe('shared/realtimeModels — supported model list', () => {
  it('includes the current Gemini realtime model', () => {
    expect(VALID_REALTIME_MODEL_VALUES.has(CURRENT_GEMINI_MODEL)).toBe(true);
  });

  it('has exactly one recommended model and it is the current Gemini model', () => {
    const recommended = REALTIME_MODELS.filter(m => m.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].value).toBe(CURRENT_GEMINI_MODEL);
  });

  it('lists the current Gemini model under the Google Live provider', () => {
    const geminiEntry = REALTIME_MODELS.find(m => m.value === CURRENT_GEMINI_MODEL);
    expect(geminiEntry).toBeDefined();
    expect(geminiEntry!.provider).toBe('Google Live');
  });

  it.each(DEPRECATED_GEMINI_NAMES)(
    'does NOT include deprecated name "%s"',
    (deprecated) => {
      expect(VALID_REALTIME_MODEL_VALUES.has(deprecated)).toBe(false);
    }
  );

  it('VALID_REALTIME_MODEL_VALUES is derived from REALTIME_MODELS with no extra entries', () => {
    const fromArray = new Set(REALTIME_MODELS.map(m => m.value));
    expect(VALID_REALTIME_MODEL_VALUES).toEqual(fromArray);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('realtimeVoiceService — Gemini model validation constants', () => {
  // Dynamic import so the minimal env is set before module evaluation.
  async function importService() {
    process.env.GOOGLE_API_KEY = 'test-key-for-import';
    try {
      const mod = await import('../../server/services/realtimeVoiceService');
      return mod;
    } finally {
      delete process.env.GOOGLE_API_KEY;
    }
  }

  it('exports VALID_GEMINI_REALTIME_MODELS as a non-empty array', async () => {
    const { VALID_GEMINI_REALTIME_MODELS } = await importService();
    expect(Array.isArray(VALID_GEMINI_REALTIME_MODELS)).toBe(true);
    expect(VALID_GEMINI_REALTIME_MODELS.length).toBeGreaterThan(0);
  });

  it('VALID_GEMINI_REALTIME_MODELS contains exactly the expected Gemini model set', async () => {
    const { VALID_GEMINI_REALTIME_MODELS } = await importService();
    // Exact-equality check: no extra models, no missing models.
    expect(new Set(VALID_GEMINI_REALTIME_MODELS)).toEqual(EXPECTED_GEMINI_MODELS);
  });

  it('VALID_GEMINI_REALTIME_MODELS contains no deprecated names', async () => {
    const { VALID_GEMINI_REALTIME_MODELS } = await importService();
    for (const deprecated of DEPRECATED_GEMINI_NAMES) {
      expect(VALID_GEMINI_REALTIME_MODELS).not.toContain(deprecated);
    }
  });

  it('every VALID_GEMINI_REALTIME_MODEL is also in shared VALID_REALTIME_MODEL_VALUES', async () => {
    const { VALID_GEMINI_REALTIME_MODELS } = await importService();
    for (const model of VALID_GEMINI_REALTIME_MODELS) {
      expect(VALID_REALTIME_MODEL_VALUES.has(model)).toBe(
        true,
        `"${model}" is in VALID_GEMINI_REALTIME_MODELS but missing from shared VALID_REALTIME_MODEL_VALUES`
      );
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('migrate.ts — REALTIME_MODEL_MIGRATION_ALLOWLIST alignment', () => {
  // These tests import the real exported constant that is used to build the SQL,
  // so any drift in migrate.ts will cause failures here.

  it('migration allowlist contains the current Gemini model', () => {
    expect(REALTIME_MODEL_MIGRATION_ALLOWLIST.has(CURRENT_GEMINI_MODEL)).toBe(true);
  });

  it('migration allowlist contains no deprecated Gemini names', () => {
    for (const deprecated of DEPRECATED_GEMINI_NAMES) {
      expect(REALTIME_MODEL_MIGRATION_ALLOWLIST.has(deprecated)).toBe(false);
    }
  });

  it('migration allowlist and shared VALID_REALTIME_MODEL_VALUES are exactly equal', () => {
    // Both sides must match exactly — if migrate.ts adds or removes a value,
    // or if shared/realtimeModels.ts changes, this test catches the drift.
    expect(REALTIME_MODEL_MIGRATION_ALLOWLIST).toEqual(VALID_REALTIME_MODEL_VALUES);
  });
});
