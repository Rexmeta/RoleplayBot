/**
 * Auto-detect stale API calls in client code.
 *
 * How it works
 * ------------
 * 1. Statically parses every server route file to build a canonical route
 *    registry (the set of paths that actually exist on the server).
 * 2. Scans every client .ts/.tsx file for /api/... string and template literals.
 * 3. Fails with the file + line reference if any literal cannot be matched
 *    against the registry.
 *
 * This complements the hand-crafted FORBIDDEN_PATTERNS in
 * forbiddenApiEndpoints.test.ts: those guards catch known-bad forms; this
 * guard catches calls to routes that were renamed or removed without needing a
 * per-case rule.
 *
 * Adding server-side route files
 * --------------------------------
 * A test automatically detects any .ts file added to server/routes/ that is
 * not yet registered here, so you will get a clear failure message rather than
 * silent missing coverage.  When you add a new route file, do ONE of:
 * • If the router uses ABSOLUTE paths (already begins with /api/), add its
 *   file path to SERVER_FILES_ABSOLUTE.
 * • If the router uses RELATIVE paths and is mounted at a prefix, add an
 *   entry to SERVER_FILES_RELATIVE with the correct mount prefix.
 * • If the file is a shared helper (no router.get/post/…), add its filename
 *   to ROUTE_DIR_NON_ROUTE_FILES.
 *
 * Allowlisting legitimate false-positives
 * -----------------------------------------
 * If a valid path can't be auto-matched (e.g. a dynamically constructed path
 * prefix used only as a React Query cache key), add it to PATH_ALLOWLIST below.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";

// ---------------------------------------------------------------------------
// Route source configuration
// ---------------------------------------------------------------------------

const CWD = process.cwd();

/**
 * Server files that declare routes with ABSOLUTE paths (already include /api/).
 * Paths like `router.get("/api/scenarios/:id", ...)` are extracted directly.
 */
const SERVER_FILES_ABSOLUTE: string[] = [
  "server/auth.ts",
  "server/routes.ts",
  "server/routes/adminScenarios.ts",
  "server/routes/user.ts",
  "server/routes/freeChat.ts",
  "server/routes/scenarioRuns.ts",
  "server/routes/analytics.ts",
  "server/routes/adminPersonas.ts",
  "server/routes/adminOrganizations.ts",
  "server/routes/adminScenarioOverrides.ts",
  "server/routes/evaluationCriteria.ts",
  "server/routes/translations.ts",
  "server/routes/personaScenes.ts",
  "server/routes/personaUserScenes.ts",
  "server/routes/hrAnalytics.ts",
  "server/replit_integrations/object_storage/routes.ts",
];

/**
 * Server files that declare routes with RELATIVE paths (no /api/ prefix).
 * Each entry pairs the file with the Express mount prefix used in routes.ts.
 *
 * Example: `router.get("/plans", ...)` in subscriptions.ts, mounted at
 * /api/subscriptions, becomes the canonical path /api/subscriptions/plans.
 */
const SERVER_FILES_RELATIVE: Array<{ file: string; prefix: string }> = [
  { file: "server/routes/bookmarks.ts",       prefix: "/api/bookmarks" },
  { file: "server/routes/scenarios.ts",        prefix: "/api/scenarios" },
  { file: "server/routes/conversations.ts",    prefix: "/api/conversations" },
  { file: "server/routes/simulation.ts",       prefix: "/api/simulation" },
  { file: "server/routes/systemAdmin.ts",      prefix: "/api/system-admin" },
  { file: "server/routes/subscriptions.ts",    prefix: "/api/subscriptions" },
  { file: "server/routes/store.ts",            prefix: "/api/store" },
  { file: "server/routes/agentApi.ts",         prefix: "/api/v1/agent" },
  { file: "server/routes/adminAgentKeys.ts",   prefix: "/api/admin/agent-keys" },
  { file: "server/routes/imageGeneration.ts",  prefix: "/api/image" },
  { file: "server/routes/userPersonaImage.ts", prefix: "/api/user-personas" },
  { file: "server/routes/media.ts",            prefix: "/api/media" },
];

/**
 * Files inside `server/routes/` that are NOT route-registration files (e.g.
 * shared helpers/utilities).  They are excluded from the coverage check below.
 * Add a file here — with a short comment — if it lives in server/routes/ but
 * does not call router.get/post/… directly.
 */
const ROUTE_DIR_NON_ROUTE_FILES = new Set<string>([
  "routerHelpers.ts", // shared middleware helpers, not a router mount
]);

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * Paths (or path prefixes) that are legitimate but cannot be automatically
 * matched by the static route extractor.  Add an entry here only when the
 * path is genuinely valid — and include a comment explaining why.
 *
 * Rules:
 *  • Exact entry:  the normalized client literal must equal the allowlisted
 *    string exactly (after query-string stripping).
 *  • Prefix entry: any normalized literal that STARTS WITH the allowlisted
 *    string is accepted (used for React Query cache-key prefixes).
 *    Mark prefix entries with a trailing "/".
 */
const PATH_ALLOWLIST: string[] = [
  // /objects is not an /api/ path — served by Replit object storage middleware.
  // Mentioned in client code only as a fallback serving URL, not a fetch call.
  // (Already excluded by the /api/ scan, listed here for documentation.)

  // /api/personas is used exclusively as a React Query invalidation key prefix
  // for /api/personas/:id/translations routes registered in translations.ts.
  "/api/personas/",

  // /api/admin/analytics is used as a query-key prefix; actual routes live at
  // /api/admin/analytics/overview, /trends, /participants, etc.
  "/api/admin/analytics/",

  // /api/admin/categories is used as a query-key prefix; actual routes include
  // /api/admin/categories/:id and /api/admin/categories/:categoryId/translations/:locale.
  "/api/admin/categories/",

];

// ---------------------------------------------------------------------------
// Helpers — server-side route extraction
// ---------------------------------------------------------------------------

/**
 * Extract all route paths from one server source file.
 *
 * Handles:
 *   (app|router).METHOD("path")   — string literal argument
 *   (app|router).METHOD('path')
 *   (app|router).METHOD(`path`)   — template literal (static part only)
 *   (app|router).use("path", ...) — middleware mount points (path only, no METHOD)
 *
 * @param content      Raw file text.
 * @param mountPrefix  When the file uses relative paths, the Express mount
 *                     prefix prepended to every extracted path.
 */
function extractServerRoutes(content: string, mountPrefix = ""): string[] {
  const paths: string[] = [];

  const addPath = (rawPath: string) => {
    const fullPath = mountPrefix
      ? mountPrefix + (rawPath === "/" ? "" : rawPath.startsWith("/") ? rawPath : `/${rawPath}`)
      : rawPath;
    if (fullPath.startsWith("/api/")) {
      paths.push(fullPath);
    }
  };

  // Match HTTP-verb calls and the first string argument.
  const routeRe =
    /(?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`\r\n]+)\1/g;

  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content)) !== null) {
    addPath(m[2].trim());
  }

  // Match app.use('/path', ...) mount points — captures the first string
  // argument only when it looks like a path (starts with '/').
  const useRe =
    /(?:app|router)\s*\.\s*use\s*\(\s*(['"`])(\/[^'"`\r\n]*)\1/g;

  while ((m = useRe.exec(content)) !== null) {
    addPath(m[2].trim());
  }

  return paths;
}

/** Build the complete canonical route set by parsing all server files. */
function buildCanonicalRoutes(): Set<string> {
  const all: string[] = [];

  for (const file of SERVER_FILES_ABSOLUTE) {
    try {
      all.push(...extractServerRoutes(readFileSync(join(CWD, file), "utf8")));
    } catch {
      // File absent — tolerate so the test still runs on partial checkouts.
    }
  }

  for (const { file, prefix } of SERVER_FILES_RELATIVE) {
    try {
      all.push(
        ...extractServerRoutes(readFileSync(join(CWD, file), "utf8"), prefix)
      );
    } catch {
      // File absent — tolerate.
    }
  }

  return new Set(all);
}

// ---------------------------------------------------------------------------
// Helpers — client-side literal extraction
// ---------------------------------------------------------------------------

/** Recursively collect all .ts and .tsx files under a directory. */
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

// ---------------------------------------------------------------------------
// Helpers — matching
// ---------------------------------------------------------------------------

/**
 * Normalise a raw client /api/... literal so it can be compared to server
 * route patterns:
 *   1. Strip query string (everything from ? onwards).
 *   2. Strip trailing slash(es).
 *   3. Replace ${...} template interpolations with the placeholder __SEG__.
 *   4. Strip a trailing __SEG__ that is NOT preceded by "/" — this covers the
 *      pattern `` `/api/scenarios${queryParam}` `` where `queryParam` is a
 *      query-string variable like `?foo=bar` or `""`. After stripping the
 *      literal "?" (step 1 operates on the raw string, not the expanded one)
 *      is not visible, but we can infer intent: a __SEG__ that directly
 *      follows a path character (not a slash) is almost certainly a query-
 *      string variable appended without a "/" separator, not a real path
 *      segment.
 */
function normalizeClientPath(raw: string): string {
  let p = raw;
  const q = p.indexOf("?");
  if (q !== -1) p = p.slice(0, q);
  p = p.replace(/\/+$/, "");
  p = p.replace(/\$\{[^}]+\}/g, "__SEG__");
  // Drop a trailing __SEG__ that follows a non-slash character.
  p = p.replace(/([^/])__SEG__$/, "$1");
  return p;
}

/**
 * Convert a canonical server route path to a RegExp that matches concrete
 * URLs:
 *   :param   → [^/]+   (one path segment)
 *   *        → .*      (glob wildcard)
 */
function routeToRegex(route: string): RegExp {
  const pat = route
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials
    .replace(/:\w+/g, "[^/]+")             // :param → any segment
    .replace(/\\\*/g, ".*");               // \* → wildcard
  return new RegExp(`^${pat}$`);
}

/**
 * Return true when a normalized client path is covered by the route registry.
 *
 * A path is covered when ANY of the following is true:
 *   1. It exactly matches a canonical route (fast path).
 *   2. It matches a canonical route whose :params are treated as wildcards.
 *   3. A canonical route matches the client path when the client's __SEG__
 *      placeholders are treated as single-segment wildcards.
 *   4. It starts with a PATH_ALLOWLIST prefix entry (trailing "/").
 *   5. It equals a PATH_ALLOWLIST exact entry.
 *   6. It is a strict prefix of a canonical route — meaning the path is used
 *      only as a React Query cache-key prefix, not a standalone endpoint.
 *      (e.g. "/api/personas" covers "/api/personas/:id/translations")
 */
function isCovered(normalizedPath: string, canonical: Set<string>): boolean {
  // ── Allowlist checks ──────────────────────────────────────────────────────
  for (const entry of PATH_ALLOWLIST) {
    if (entry.endsWith("/")) {
      if (normalizedPath.startsWith(entry) || normalizedPath + "/" === entry) return true;
    } else {
      if (normalizedPath === entry) return true;
    }
  }

  // ── Build the client-side regex (handling __SEG__ wildcards) ─────────────
  const clientRegexSource = normalizedPath
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/__SEG__/g, "[^/]+");
  const clientRegex = new RegExp(`^${clientRegexSource}$`);

  for (const route of canonical) {
    const serverRegex = routeToRegex(route);

    // Rule 1 & 2: server pattern covers the (concrete) client path.
    if (serverRegex.test(normalizedPath)) return true;

    // Rule 3: client pattern (with __SEG__ wildcards) covers the server route.
    if (clientRegex.test(route)) return true;

    // Rule 6: client path is a prefix of a canonical route.
    // Guard against trivial prefixes like "/api" matching everything.
    if (
      normalizedPath.length > "/api/".length - 1 &&
      route.startsWith(normalizedPath + "/")
    ) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stale API route detector", () => {
  const canonicalRoutes = buildCanonicalRoutes();
  const clientFiles = collectSourceFiles(join(CWD, "client", "src"));

  // ── Route-file coverage guard ─────────────────────────────────────────────

  it("all server/routes/*.ts files are registered in SERVER_FILES_ABSOLUTE or SERVER_FILES_RELATIVE", () => {
    const routeDir = join(CWD, "server", "routes");

    // Build a set of filenames (basename only) that are already registered.
    const registeredFiles = new Set<string>([
      ...SERVER_FILES_ABSOLUTE
        .filter((f) => f.startsWith("server/routes/"))
        .map((f) => basename(f)),
      ...SERVER_FILES_RELATIVE
        .map(({ file }) => basename(file)),
    ]);

    // Discover every .ts file directly inside server/routes/ (non-recursive —
    // sub-directories are intentionally out of scope for this guard).
    const discovered = readdirSync(routeDir).filter(
      (name) =>
        extname(name) === ".ts" && !ROUTE_DIR_NON_ROUTE_FILES.has(name)
    );

    const unregistered = discovered.filter((name) => !registeredFiles.has(name));

    if (unregistered.length > 0) {
      const message = [
        "",
        `${unregistered.length} file(s) in server/routes/ are not registered in staleApiRoutes.test.ts:`,
        ...unregistered.map((f) => `  server/routes/${f}`),
        "",
        "How to fix — choose ONE of the following for each unregistered file:",
        "  • If the router uses ABSOLUTE paths (already includes /api/), add the",
        "    file path to SERVER_FILES_ABSOLUTE in tests/server/staleApiRoutes.test.ts.",
        "  • If the router uses RELATIVE paths and is mounted at a prefix, add an",
        "    entry to SERVER_FILES_RELATIVE with the correct mount prefix.",
        "  • If the file is a shared helper (not a router mount), add its filename",
        "    to ROUTE_DIR_NON_ROUTE_FILES in tests/server/staleApiRoutes.test.ts.",
      ].join("\n");
      expect.fail(message);
    }
  });

  // ── Sanity checks ──────────────────────────────────────────────────────────

  it("extracts at least 50 server routes", () => {
    expect(canonicalRoutes.size).toBeGreaterThan(50);
  });

  it("finds client source files to scan", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  // ── Main guard ────────────────────────────────────────────────────────────

  it("every /api/ literal in client code matches a registered server route", () => {
    const violations: string[] = [];

    /**
     * Matches the /api/... portion inside a string or template literal.
     * Stops at the closing quote/backtick or at whitespace.
     * Intentionally does NOT capture query strings here — they are stripped
     * by normalizeClientPath() later.
     */
    const literalRe = /['"`](\/api\/[^'"`\s\\]+)/g;

    for (const filePath of clientFiles) {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        // Skip comment-only lines.
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

        literalRe.lastIndex = 0;
        let m: RegExpExecArray | null;

        while ((m = literalRe.exec(line)) !== null) {
          const raw = m[1];
          const normalized = normalizeClientPath(raw);

          if (!isCovered(normalized, canonicalRoutes)) {
            const rel = filePath.replace(CWD + "/", "");
            violations.push(`${rel}:${idx + 1}  →  ${raw}`);
          }
        }
      });
    }

    if (violations.length > 0) {
      const sortedRoutes = [...canonicalRoutes].sort();
      const message = [
        "",
        `Found ${violations.length} client-side /api/ path(s) that do not match any registered server route.`,
        "The route may have been renamed or removed, or the client call may have a typo.",
        "",
        "Violations:",
        ...violations.map((v) => `  ${v}`),
        "",
        `Registered server routes (${sortedRoutes.length}):`,
        ...sortedRoutes.map((r) => `  ${r}`),
        "",
        "How to fix:",
        "  • If the server route was renamed, update the client call to match.",
        "  • If the path is intentional and valid (e.g. a cache-key prefix),",
        "    add it to PATH_ALLOWLIST in tests/server/staleApiRoutes.test.ts.",
      ].join("\n");
      expect.fail(message);
    }
  });
});
