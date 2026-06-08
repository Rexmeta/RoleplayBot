/**
 * Guard against wrong API endpoint strings in client code.
 *
 * Background
 * ----------
 * A bug in admin-management.tsx fetched `/api/user` (which does not exist)
 * instead of the correct `/api/auth/user`. The silent 404 was only caught
 * during manual QA. This test catches the same class of mistake automatically.
 *
 * How it works
 * ------------
 * Each entry in FORBIDDEN_PATTERNS describes one known-bad URL pattern. For
 * every entry the scanner checks every line of every client .ts/.tsx file. A
 * match causes the test to fail with a human-readable message pointing at the
 * offending file and line, and explaining the correct alternative.
 *
 * Adding new patterns
 * -------------------
 * 1. Add an object to FORBIDDEN_PATTERNS below.
 * 2. Set `pattern` to a regex that fires ONLY on the bad form (use negative
 *    lookaheads to avoid flagging valid sub-paths).
 * 3. Set `description` to a short label shown in the test name.
 * 4. Set `hint` to the actionable "did you mean …?" message shown on failure.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

// ---------------------------------------------------------------------------
// Forbidden pattern registry
// ---------------------------------------------------------------------------

interface ForbiddenPattern {
  /** Short label used in the `it(...)` test name. */
  description: string;
  /**
   * Regex that matches the bad form of the endpoint.
   * Use negative lookaheads so legitimate sub-paths are NOT flagged.
   * The regex is reset (lastIndex = 0) before each line test.
   */
  pattern: RegExp;
  /**
   * Human-readable hint shown when a violation is found.
   * Should name the correct endpoint(s) the developer should use instead.
   */
  hint: string;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  {
    description: "bare /api/user endpoint",
    /**
     * Matches `/api/user` NOT followed by `/`, `-`, or any word character.
     * Allowed: /api/user/profile, /api/user-personas, /api/users/me
     * Blocked: /api/user (the route does not exist)
     *
     * Correct endpoints:
     *   GET /api/auth/user          — current authenticated session (useAuth.ts)
     *   GET /api/user/profile       — full user profile details
     */
    pattern: /\/api\/user(?![\/\-\w])/g,
    hint:
      "'/api/user' does not exist. Use '/api/auth/user' for the current session or '/api/user/profile' for profile details.",
  },
  {
    description: "bare /api/auth endpoint (missing sub-path)",
    /**
     * Matches `/api/auth` NOT followed by `/` or any word character.
     * Allowed: /api/auth/login, /api/auth/user, /api/auth/logout, etc.
     * Blocked: /api/auth (no handler exists at this bare path)
     *
     * Correct endpoints:
     *   POST /api/auth/login        — sign in with email + password
     *   POST /api/auth/register     — create a new account
     *   POST /api/auth/logout       — end the current session
     *   GET  /api/auth/user         — fetch current authenticated user
     *   POST /api/auth/verify       — verify JWT token validity
     *   POST /api/auth/realtime-token — obtain a Gemini Live token
     *   POST /api/auth/guest-login  — start a guest session
     */
    pattern: /\/api\/auth(?![\/\w])/g,
    hint:
      "'/api/auth' has no handler. Use a sub-path such as '/api/auth/login', '/api/auth/user', or '/api/auth/logout'.",
  },
  {
    description: "singular /api/conversation endpoint (should be plural)",
    /**
     * Matches `/api/conversation` NOT followed by `s` or `/`.
     * Allowed: /api/conversations, /api/conversations/123
     * Blocked: /api/conversation (the router is mounted at /api/conversations)
     *
     * Correct endpoint:
     *   /api/conversations          — all conversation routes live here
     */
    pattern: /\/api\/conversation(?![s\/\w])/g,
    hint:
      "'/api/conversation' does not exist. The router is mounted at '/api/conversations' (plural).",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .ts and .tsx files under a directory.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (
      stat.isFile() &&
      (extname(entry) === ".ts" || extname(entry) === ".tsx")
    ) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Forbidden API endpoint guard", () => {
  const clientDir = join(process.cwd(), "client", "src");
  const sourceFiles = collectSourceFiles(clientDir);

  it("should have found client source files to scan", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const { description, pattern, hint } of FORBIDDEN_PATTERNS) {
    it(`no client file references the ${description}`, () => {
      const violations: string[] = [];

      for (const filePath of sourceFiles) {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        lines.forEach((line, idx) => {
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            const relativePath = filePath.replace(process.cwd() + "/", "");
            violations.push(`${relativePath}:${idx + 1}  →  ${line.trim()}`);
          }
        });
      }

      if (violations.length > 0) {
        const message = [
          "",
          `Found forbidden endpoint pattern — ${hint}`,
          "",
          ...violations.map((v) => `  ${v}`),
          "",
        ].join("\n");
        expect.fail(message);
      }
    });
  }
});
