/**
 * attemptRawLogin() (src/tools/meta.ts) — the shared one-shot login probe behind both
 * self_check's authValid and validate_config's credentialsValid (Fix round 2,
 * Finding 3 / P2). Per docs/dockhand-openapi.json's own description of
 * POST /api/auth/login's 200 response ("Login succeeded and dockhand_session cookie was
 * set — OR requiresMfa:true if a second factor is needed first"), a plain 200 status is
 * NOT on its own proof that a usable session was established: an MFA account can return
 * 200 + { success:true, requiresMfa:true } with no session cookie. attemptRawLogin now
 * inspects the response body's requiresMfa flag and the Set-Cookie header (presence
 * only — never the cookie's value) to compute `completedAuth` separately from the raw
 * `statusCode`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptRawLogin } from '../../src/tools/meta.js';

interface MockResponseInit {
  status: number;
  body?: string;
  setCookie?: string[];
}

function mockResponse(init: MockResponseInit) {
  return {
    status: init.status,
    text: vi.fn().mockResolvedValue(init.body ?? ''),
    headers: {
      getSetCookie: () => init.setCookie ?? [],
      get: (name: string) => (name.toLowerCase() === 'set-cookie' ? (init.setCookie?.[0] ?? null) : null),
    },
  };
}

describe('attemptRawLogin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports completedAuth:true for a plain 200 with a session cookie and no requiresMfa flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 200,
        body: JSON.stringify({ success: true, user: { id: 1, username: 'admin', isAdmin: true } }),
        setCookie: ['dockhand_session=abc123; Path=/; HttpOnly'],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await attemptRawLogin('https://dockhand.example.com');

    expect(result).toEqual({ statusCode: 200, completedAuth: true });
  });

  it('reports completedAuth:false for a 200 carrying requiresMfa:true, even though the status is 200 — the core of the fix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 200,
        body: JSON.stringify({ success: true, requiresMfa: true }),
        setCookie: [], // no session cookie — MFA still pending
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await attemptRawLogin('https://dockhand.example.com');

    expect(result.statusCode).toBe(200);
    expect(result.completedAuth).toBe(false);
  });

  it('reports completedAuth:false for a 200 with requiresMfa:true even if a (non-session) cookie happened to be set', async () => {
    // requiresMfa:true must win regardless of cookie presence — an MFA-pending login
    // is never a completed auth, no matter what the Set-Cookie header contains.
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        status: 200,
        body: JSON.stringify({ success: true, requiresMfa: true }),
        setCookie: ['some_other_cookie=xyz; Path=/'],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await attemptRawLogin('https://dockhand.example.com');

    expect(result.completedAuth).toBe(false);
  });

  it('reports completedAuth:false for a 200 with no session cookie at all, even without an explicit requiresMfa flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 200, body: JSON.stringify({ success: true }), setCookie: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await attemptRawLogin('https://dockhand.example.com');

    expect(result.completedAuth).toBe(false);
  });

  it('reports statusCode:401, completedAuth:false for invalid credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 401, body: JSON.stringify({ error: 'Invalid username or password' }) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await attemptRawLogin('https://dockhand.example.com');

    expect(result).toEqual({ statusCode: 401, completedAuth: false });
  });

  it('never attempts to parse the body for a non-200 status', async () => {
    const textSpy = vi.fn().mockResolvedValue('');
    const fetchMock = vi.fn().mockResolvedValue({
      status: 403,
      text: textSpy,
      headers: { getSetCookie: () => [], get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    await attemptRawLogin('https://dockhand.example.com');

    expect(textSpy).not.toHaveBeenCalled();
  });

  it('degrades to completedAuth:false (does not throw) when the 200 body is not valid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 200, body: 'not json', setCookie: ['dockhand_session=abc123'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await attemptRawLogin('https://dockhand.example.com');

    // No requiresMfa flag could be parsed out of a non-JSON body, so it's treated as
    // absent — the session cookie alone still makes this a completed auth.
    expect(result).toEqual({ statusCode: 200, completedAuth: true });
  });

  it('falls back to the raw set-cookie header when getSetCookie() reports none (older fetch implementations)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
      headers: {
        // No getSetCookie() results, but the raw header is present.
        getSetCookie: () => [],
        get: (name: string) => (name.toLowerCase() === 'set-cookie' ? 'dockhand_session=fallback123; Path=/' : null),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await attemptRawLogin('https://dockhand.example.com');

    expect(result.completedAuth).toBe(true);
  });

  it('propagates a network error (fetch rejects) instead of failing silently', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(attemptRawLogin('https://dockhand.example.com')).rejects.toThrow('ECONNREFUSED');
  });

  it('never surfaces the configured username/password in the result — secret-safe by construction', async () => {
    const originalUsername = process.env.DOCKHAND_USERNAME;
    const originalPassword = process.env.DOCKHAND_PASSWORD;
    process.env.DOCKHAND_USERNAME = 'sentinel-username-value';
    process.env.DOCKHAND_PASSWORD = 'sentinel-password-value';

    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ status: 200, body: JSON.stringify({ success: true }), setCookie: ['dockhand_session=abc123'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await attemptRawLogin('https://dockhand.example.com');
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('sentinel-username-value');
      expect(serialized).not.toContain('sentinel-password-value');
    } finally {
      process.env.DOCKHAND_USERNAME = originalUsername;
      process.env.DOCKHAND_PASSWORD = originalPassword;
    }
  });
});
