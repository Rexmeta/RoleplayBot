import { describe, it, expect } from 'vitest';
import { escapeHtml, assertSafePathSegment } from '../../server/utils/htmlEscape';

describe('escapeHtml', () => {
  it('replaces < with &lt;', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('replaces > with &gt;', () => {
    expect(escapeHtml('value > 0')).toBe('value &gt; 0');
  });

  it('replaces & with &amp;', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('replaces " with &quot;', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it("replaces ' with &#x27;", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it('escapes a full XSS payload', () => {
    const payload = '<script>alert("xss")</script>';
    const escaped = escapeHtml(payload);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('escapes an img onerror XSS pattern', () => {
    const payload = "<img src=x onerror='alert(1)'>";
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).not.toContain("'");
  });

  it('leaves safe plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  it('converts non-string values to string before escaping', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
  });

  it('escapes all special chars in a mixed payload', () => {
    const payload = '& < > " \'';
    expect(escapeHtml(payload)).toBe('&amp; &lt; &gt; &quot; &#x27;');
  });
});

describe('assertSafePathSegment', () => {
  it('accepts alphanumeric IDs', () => {
    expect(() => assertSafePathSegment('persona123')).not.toThrow();
  });

  it('accepts IDs with hyphens, underscores, and dots', () => {
    expect(() => assertSafePathSegment('persona-1_v2.0')).not.toThrow();
  });

  it('returns the value unchanged for valid input', () => {
    expect(assertSafePathSegment('valid-id')).toBe('valid-id');
  });

  it('throws for input containing <', () => {
    expect(() => assertSafePathSegment('<script>')).toThrow();
  });

  it('throws for input containing >', () => {
    expect(() => assertSafePathSegment('id>val')).toThrow();
  });

  it('throws for input containing "', () => {
    expect(() => assertSafePathSegment('id"value')).toThrow();
  });

  it("throws for input containing '", () => {
    expect(() => assertSafePathSegment("id'value")).toThrow();
  });

  it('throws for input containing spaces', () => {
    expect(() => assertSafePathSegment('id with space')).toThrow();
  });

  it('throws for input containing a slash (path traversal attempt)', () => {
    expect(() => assertSafePathSegment('../etc/passwd')).toThrow();
  });

  it('throws for input containing a null-byte', () => {
    expect(() => assertSafePathSegment('id\x00evil')).toThrow();
  });

  it('includes the label in the thrown error message', () => {
    expect(() => assertSafePathSegment('<bad>', 'persona ID')).toThrow('persona ID');
  });

  it('throws for a full XSS script tag as path segment', () => {
    expect(() => assertSafePathSegment('<script>alert(1)</script>', 'personaId')).toThrow();
  });
});
