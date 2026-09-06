import { constants as bufferConstants } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { getRequestBodyLimitConfig } from '../src/request-body-limit.js';

// The ceiling is Node's max string length (~512 MiB), because express.json() has to
// materialize the whole body as one JS string before parsing (Codex review, PR #251, P2).
const CEILING = bufferConstants.MAX_STRING_LENGTH;
const ONE_HUNDRED_MB = 100 * 1024 * 1024;

describe('request-body-limit configuration', () => {
  it('defaults to 100 MB when unset', () => {
    expect(getRequestBodyLimitConfig({})).toEqual({ maxRequestBodyBytes: ONE_HUNDRED_MB, warnings: [] });
  });

  it('parses an explicit override', () => {
    expect(getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: '5242880' })).toEqual({
      maxRequestBodyBytes: 5242880,
      warnings: [],
    });
  });

  it('trims surrounding whitespace around an otherwise valid value', () => {
    expect(getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: '  5242880  ' })).toEqual({
      maxRequestBodyBytes: 5242880,
      warnings: [],
    });
  });

  // "Unset" cases: no value was ever provided, so there is nothing malformed to warn
  // about — these fall back silently, same as before.
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('falls back to the 100 MB default with NO warning for %s (equivalent to unset)', (_label, value) => {
    const result = getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: value });
    expect(result.maxRequestBodyBytes).toBe(ONE_HUNDRED_MB);
    expect(result.warnings).toEqual([]);
  });

  // Codex review (PR #251, P2): a value WAS provided but is malformed — these must
  // fall back explicitly, with a warning naming the rejected value, rather than
  // being silently accepted (the bug: `Number.parseInt('100abc', 10)` === 100, so
  // the previous implementation used a bogus 100-byte limit with no indication
  // anything was wrong).
  it.each([
    ['non-numeric', 'not-a-number'],
    ['partially-parsed integer with trailing garbage', '100abc'],
    ['decimal point', '100.5'],
    ['exponential notation', '1e10'],
    ['leading plus sign', '+100'],
    ['hex-looking value', '0x100'],
    ['zero', '0'],
    ['negative', '-1'],
    ['leading zero padded but otherwise fine — still accepted as a plain digit run', '00100'],
  ])('falls back to the 100 MB default WITH a warning for %s (%s)', (_label, value) => {
    const result = getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: value });
    if (value === '00100') {
      // Leading zeros are still a plain digit run (`^\d+$` matches) and parse to a
      // valid positive integer — this is the GEGENVERSUCH for the cases above: not
      // every string containing non-`[0-9]`-adjacent-looking characters is rejected,
      // only ones that are not a clean run of digits. `parseInt('00100', 10)` is 100.
      expect(result).toEqual({ maxRequestBodyBytes: 100, warnings: [] });
      return;
    }
    expect(result.maxRequestBodyBytes).toBe(ONE_HUNDRED_MB);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('MCP_MAX_REQUEST_BODY_BYTES');
    expect(result.warnings[0]).toContain(value);
  });

  it('GEGENVERSUCH: "100abc" is NOT silently accepted as a 100-byte limit', () => {
    // This is the exact case Codex flagged: Number.parseInt('100abc', 10) === 100,
    // and the pre-fix implementation returned maxRequestBodyBytes: 100 for it (a
    // limit so small every real MCP call would 413). The fix must reject the whole
    // malformed string and fall back to the 100 MB default instead.
    const result = getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: '100abc' });
    expect(result.maxRequestBodyBytes).not.toBe(100);
    expect(result.maxRequestBodyBytes).toBe(ONE_HUNDRED_MB);
  });

  it('caps a value above the string-length ceiling instead of leaving the parser effectively unbounded', () => {
    const result = getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: String(CEILING + 1) });
    expect(result.maxRequestBodyBytes).toBe(CEILING);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('MCP_MAX_REQUEST_BODY_BYTES');
    expect(result.warnings[0]).toContain('ceiling');
  });

  it('GEGENVERSUCH: a value exactly at the string-length ceiling is accepted unchanged, with no warning', () => {
    const result = getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: String(CEILING) });
    expect(result).toEqual({ maxRequestBodyBytes: CEILING, warnings: [] });
  });
});
