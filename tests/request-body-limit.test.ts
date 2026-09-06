import { describe, expect, it } from 'vitest';
import { getRequestBodyLimitConfig } from '../src/request-body-limit.js';

describe('request-body-limit configuration', () => {
  it('defaults to 100 MB when unset', () => {
    expect(getRequestBodyLimitConfig({})).toEqual({ maxRequestBodyBytes: 100 * 1024 * 1024 });
  });

  it('parses an explicit override', () => {
    expect(getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: '5242880' })).toEqual({
      maxRequestBodyBytes: 5242880,
    });
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['non-numeric', 'not-a-number'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('falls back to the 100 MB default for %s', (_label, value) => {
    expect(getRequestBodyLimitConfig({ MCP_MAX_REQUEST_BODY_BYTES: value })).toEqual({
      maxRequestBodyBytes: 100 * 1024 * 1024,
    });
  });
});
