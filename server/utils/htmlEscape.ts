import path from 'path';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_\-\.]+$/;

/**
 * Validates that a string used as a URL path segment contains only safe characters
 * (alphanumeric, hyphens, underscores, dots). Throws if the value contains anything
 * else, preventing HTML injection and unexpected path characters.
 */
export function assertSafePathSegment(value: string, label = 'value'): string {
  if (!SAFE_SEGMENT_RE.test(value)) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
  return value;
}

/**
 * Defense-in-depth boundary check after path.join().
 * Resolves both paths to absolute form and asserts that `joined` is contained
 * within `baseDir`, preventing path-traversal even if a segment slipped through
 * earlier validation.
 *
 * @param joined   The result of path.join() that must stay inside baseDir.
 * @param baseDir  The expected root directory.
 * @param label    Human-readable name used in the error message.
 */
export function assertSafeJoinedPath(joined: string, baseDir: string, label = 'path'): void {
  const resolvedBase = path.resolve(baseDir);
  const resolvedJoined = path.resolve(joined);
  const safePrefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (resolvedJoined !== resolvedBase && !resolvedJoined.startsWith(safePrefix)) {
    throw new Error(`Path traversal detected: ${label} is outside the allowed directory`);
  }
}
