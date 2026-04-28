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
