/**
 * Guard against wrong API endpoint strings in client code.
 *
 * Background
 * ----------
 * A bug in admin-management.tsx fetched `/api/user` (which does not exist)
 * instead of the correct `/api/auth/user`. The silent 404 was only caught
 * during manual QA. This test catches the same class of mistake automatically.
 *
 * What this test detects
 * ----------------------
 * Any string literal in client source files that is exactly `/api/user` with
 * nothing after it — i.e. the URL terminates immediately (quote, backtick,
 * question-mark, hash, or whitespace follows). Sub-paths such as
 * `/api/user/profile`, `/api/user/profile-image`, `/api/user-personas/*`, and
 * `/api/users/me` are all legitimate and are NOT flagged.
 *
 * Correct endpoints for authentication data
 * ------------------------------------------
 *   GET /api/auth/user   — current user session (from useAuth.ts)
 *   GET /api/user/profile — user profile details
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

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
    } else if (stat.isFile() && (extname(entry) === ".ts" || extname(entry) === ".tsx")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Regex that matches the bare `/api/user` endpoint.
 *
 * Positive lookahead ensures the match is NOT followed by characters that
 * would make it a valid sub-path:
 *   /  — e.g. /api/user/profile
 *   -  — e.g. /api/user-personas
 *   s  — e.g. /api/users/me
 *   word chars in general (letters, digits, _)
 *
 * Captures the surrounding context (up to 60 chars) for the error message.
 */
const FORBIDDEN_PATTERN = /\/api\/user(?![\/\-\w])/g;

describe("Forbidden API endpoint guard", () => {
  const clientDir = join(process.cwd(), "client", "src");
  const sourceFiles = collectSourceFiles(clientDir);

  it("should have found client source files to scan", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it("no client file references the bare /api/user endpoint", () => {
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      lines.forEach((line, idx) => {
        FORBIDDEN_PATTERN.lastIndex = 0;
        if (FORBIDDEN_PATTERN.test(line)) {
          const relativePath = filePath.replace(process.cwd() + "/", "");
          violations.push(`${relativePath}:${idx + 1}  →  ${line.trim()}`);
        }
      });
    }

    if (violations.length > 0) {
      const message = [
        "",
        "Found bare '/api/user' endpoint(s) — this route does not exist.",
        "Did you mean '/api/auth/user' (current session) or '/api/user/profile'?",
        "",
        ...violations.map((v) => `  ${v}`),
        "",
      ].join("\n");
      expect.fail(message);
    }
  });
});
