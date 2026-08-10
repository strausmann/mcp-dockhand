import { describe, expect, it } from 'vitest';
import { describeLoginFailure, normalizeBaseUrl } from '../src/utils/url.js';

describe('normalizeBaseUrl', () => {
  it('leaves a URL without a trailing slash untouched', () => {
    expect(normalizeBaseUrl('https://dockhand.example.com')).toBe('https://dockhand.example.com');
  });

  it('strips a single trailing slash', () => {
    expect(normalizeBaseUrl('https://dockhand.example.com/')).toBe('https://dockhand.example.com');
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeBaseUrl('https://dockhand.example.com///')).toBe('https://dockhand.example.com');
  });

  it('does not touch slashes that are part of the path', () => {
    expect(normalizeBaseUrl('https://dockhand.example.com/dockhand/')).toBe(
      'https://dockhand.example.com/dockhand',
    );
  });
});

describe('describeLoginFailure', () => {
  it('builds an actionable hint for a redirect with a Location header', () => {
    const message = describeLoginFailure(307, '/login?redirect=%2Fapi%2Fauth%2Flogin', '', 'Temporary Redirect');
    expect(message).toContain('/login?redirect=%2Fapi%2Fauth%2Flogin');
    expect(message).toContain('trailing slash');
    expect(message).toContain('reverse-proxy');
  });

  it('builds a hint for a redirect without a Location header', () => {
    const message = describeLoginFailure(307, null, '', 'Temporary Redirect');
    expect(message).toContain('no Location header');
    expect(message).toContain('trailing slash');
  });

  it('falls back to the response body for a non-redirect failure', () => {
    const message = describeLoginFailure(401, null, '{"error":"Invalid username or password"}', 'Unauthorized');
    expect(message).toBe('{"error":"Invalid username or password"}');
  });

  it('falls back to the status text when the body is empty', () => {
    const message = describeLoginFailure(500, null, '', 'Internal Server Error');
    expect(message).toBe('Internal Server Error');
  });
});
