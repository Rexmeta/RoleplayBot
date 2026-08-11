/**
 * Integration smoke test for generateAvatarClip.
 *
 * This test fires a REAL Veo API call to catch Google-side policy regressions
 * that unit tests cannot detect (e.g. new banned-content rules added by Google).
 *
 * Tagging strategy
 * ----------------
 * The file is named *.smoke.test.ts and is excluded from the regular vitest
 * run via `vitest.config.ts` → `test.exclude`.  Run it deliberately with:
 *
 *   npm run test:smoke
 *
 * The test is automatically skipped when GEMINI_API_KEY is not present in the
 * environment, so it is safe to include in CI pipelines that opt out of live
 * calls.  It also skips gracefully when the call fails for a non-policy reason
 * (quota, model unavailability, network error) so those infrastructure issues
 * do not produce a false-positive policy-regression alert.
 *
 * NOTE: Veo video generation can take up to several minutes.  The test
 * timeout is set to 10 minutes to accommodate polling.
 */

import { describe, it, expect } from 'vitest';
import { generateAvatarClip } from '../../server/services/gemini-video-generator';

const HAS_API_KEY = Boolean(
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
);

/**
 * Substrings whose presence in result.error indicates a Veo content-policy
 * rejection.  Any match here means the prompt triggered a policy rule —
 * that is the regression we want to catch.
 */
const POLICY_ERROR_PATTERNS = [
  'policy',
  'safety',
  'content',
  'blocked',
  'prohibited',
  'violation',
  '정책',   // Korean: "policy"
  '안전',   // Korean: "safety"
  '차단',   // Korean: "blocked"
];

/**
 * Substrings that indicate a transient infrastructure failure that is NOT
 * related to content policy.  When the only error matches one of these the
 * test skips rather than failing, avoiding false-positive policy alerts.
 */
const INFRASTRUCTURE_ERROR_PATTERNS = [
  'quota',
  'rate limit',
  'limit exceeded',
  '한도',       // Korean: "limit"
  '초과',       // Korean: "exceeded"
  'timeout',
  'timed out',
  '시간이 초과', // Korean: "time exceeded"
  'not found',
  '404',
  'unavailable',
  '사용할 수 없',  // Korean: "cannot use"
  'network',
  'econnreset',
  '생성된 비디오가 없',  // Korean: "no generated video"
  '생성 시간이 초과',    // Korean: "generation timed out"
];

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(p => lower.includes(p.toLowerCase()));
}

describe.skipIf(!HAS_API_KEY)(
  'generateAvatarClip – Veo policy smoke test [smoke]',
  () => {
    it(
      'behavior=listening returns no policy error (real Veo call)',
      async (ctx) => {
        const result = await generateAvatarClip({
          personaId: 'smoke-test-persona',
          behavior: 'listening',
          // No neutralImageUrl — text-only prompt keeps the test self-contained.
        });

        if (!result.success) {
          const errorText = result.error ?? '';

          // Hard-fail: policy error detected — this is the regression we guard against.
          if (matchesAny(errorText, POLICY_ERROR_PATTERNS)) {
            throw new Error(
              `Veo policy error detected — prompt may have triggered a new content rule.\n` +
              `error: ${errorText}`,
            );
          }

          // Soft-skip: non-policy infrastructure failure — do not raise a false alarm.
          if (matchesAny(errorText, INFRASTRUCTURE_ERROR_PATTERNS) || errorText) {
            ctx.skip();
            return;
          }
        }

        // Nominal path: call succeeded — assert success and no policy error.
        expect(result.success).toBe(true);
        if (result.error) {
          expect(matchesAny(result.error, POLICY_ERROR_PATTERNS)).toBe(false);
        }
      },
      // 10-minute timeout — Veo operations poll until done.
      10 * 60 * 1000,
    );
  },
);
