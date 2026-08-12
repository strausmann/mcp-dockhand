/**
 * redactQueryStrings() (src/utils/redact.ts) — the single, shared implementation used by
 * both `DockhandClient` (source: error-message construction, Fix round 3, Item B) and
 * `src/utils/runtime-stats.ts` (defense-in-depth). Extracted so the regex is never
 * duplicated and cannot drift between the two call sites.
 */
import { describe, it, expect } from 'vitest';
import { redactQueryStrings, QUERY_STRING_REDACTION_MARKER } from '../../src/utils/redact.js';

describe('redactQueryStrings', () => {
  it('replaces a query string carrying a secret with the redaction marker', () => {
    const message = 'Dockhand API error: GET https://dockhand.example/api/git/stacks/7/webhook?secret=abc123def returned 500: boom';
    const result = redactQueryStrings(message);

    expect(result).not.toContain('abc123def');
    expect(result).toContain(`?${QUERY_STRING_REDACTION_MARKER}`);
  });

  it('leaves a message with no query string unchanged', () => {
    const message = 'Dockhand API error: PUT /api/stacks/foo/env returned 500: boom';
    expect(redactQueryStrings(message)).toBe(message);
  });

  it('redacts multiple query params on the same URL as a single marker (key and value both gone)', () => {
    const message = 'Dockhand API error: GET /api/git/stacks/7/webhook?secret=abc123def&x=1 returned 500: boom';
    const result = redactQueryStrings(message);

    expect(result).not.toContain('abc123def');
    expect(result).not.toContain('x=1');
    expect(result).toContain(`?${QUERY_STRING_REDACTION_MARKER}`);
  });

  it('redacts each query string independently when a message embeds more than one URL', () => {
    const message = 'first https://a.example/x?secret=aaa then https://b.example/y?token=bbb';
    const result = redactQueryStrings(message);

    expect(result).not.toContain('aaa');
    expect(result).not.toContain('bbb');
    expect((result.match(/\?<redacted>/g) ?? []).length).toBe(2);
  });

  it('is idempotent — redacting an already-redacted message changes nothing further', () => {
    const once = redactQueryStrings('GET /x?secret=abc123 returned 500');
    const twice = redactQueryStrings(once);
    expect(twice).toBe(once);
  });

  it('returns an empty string unchanged', () => {
    expect(redactQueryStrings('')).toBe('');
  });
});
