import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../src/auth/session.js';
import type { DockhandConfig } from '../src/types/dockhand.js';

interface MockResponseInit {
  ok: boolean;
  status: number;
  statusText: string;
  body?: string;
  setCookie?: string[];
  location?: string | null;
}

function mockResponse(init: MockResponseInit) {
  const headerMap = new Map<string, string>();
  if (init.location !== undefined && init.location !== null) {
    headerMap.set('location', init.location);
  }
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText,
    text: vi.fn().mockResolvedValue(init.body ?? ''),
    headers: {
      getSetCookie: () => init.setCookie ?? [],
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
  };
}

function config(overrides: Partial<DockhandConfig> = {}): DockhandConfig {
  return {
    url: 'https://dockhand.example.com',
    username: 'admin',
    password: 'p@ss!w0rd#$%',
    ...overrides,
  };
}

describe('SessionManager login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs in successfully and stores the session cookie (happy path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123; Path=/; HttpOnly'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());
    const cookie = await manager.getCookie();

    expect(cookie).toBe('session=abc123');
    expect(manager.isAuthenticated()).toBe(true);
  });

  it('sends a password containing special characters unmodified in the JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const complexPassword = 'a"b\\c$d!e&f#g%h\'i`j<k>l{m}n unicode-äöü-中文';
    const manager = new SessionManager(config({ username: 'Mixed.Case_User', password: complexPassword }));
    await manager.getCookie();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string) as { username: string; password: string };
    expect(sentBody.password).toBe(complexPassword);
    expect(sentBody.username).toBe('Mixed.Case_User');
  });

  it('builds the login URL without a double slash when DOCKHAND_URL has a trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config({ url: 'https://dockhand.example.com/' }));
    await manager.getCookie();

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://dockhand.example.com/api/auth/login');
  });

  it('throws a diagnostic error and logs it when login is redirected (HTTP 307)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 307,
        statusText: 'Temporary Redirect',
        body: '',
        location: '/login?redirect=%2Fapi%2Fauth%2Flogin',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const manager = new SessionManager(config());

    await expect(manager.getCookie()).rejects.toThrow(/HTTP 307/);
    await expect(manager.getCookie()).rejects.toThrow(/trailing slash/);

    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('/login?redirect=%2Fapi%2Fauth%2Flogin');
  });

  it('throws with the response body on a rejected login (HTTP 401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: '{"error":"Invalid username or password"}',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());

    await expect(manager.getCookie()).rejects.toThrow(/Invalid username or password/);
  });

  it('propagates a network error (fetch rejects) instead of failing silently', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());

    await expect(manager.getCookie()).rejects.toThrow('ECONNREFUSED');
  });

  it('throws when no Set-Cookie header is present in an otherwise-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', body: '{"success":true}', setCookie: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());

    await expect(manager.getCookie()).rejects.toThrow(/No session cookie received/);
  });

  it('reuses the cached cookie on a second call instead of logging in again', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());
    await manager.getCookie();
    await manager.getCookie();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent login attempts into a single in-flight request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());
    const [cookieA, cookieB] = await Promise.all([manager.getCookie(), manager.getCookie()]);

    expect(cookieA).toBe('session=abc123');
    expect(cookieB).toBe('session=abc123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('joins multiple Set-Cookie headers with a semicolon', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        ok: true,
        status: 200,
        statusText: 'OK',
        setCookie: ['session=abc123; Path=/; HttpOnly', 'csrf=xyz789; Path=/'],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());
    const cookie = await manager.getCookie();

    expect(cookie).toBe('session=abc123; csrf=xyz789');
  });

  it('falls back to the raw set-cookie header when getSetCookie() is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(''),
      headers: {
        // No getSetCookie() at all — older/alternate fetch implementations.
        get: (name: string) => (name.toLowerCase() === 'set-cookie' ? 'session=fallback123; Path=/' : null),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());
    const cookie = await manager.getCookie();

    expect(cookie).toBe('session=fallback123');
  });

  it('logs in again after invalidate()', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(config());
    await manager.getCookie();
    manager.invalidate();
    expect(manager.isAuthenticated()).toBe(false);
    await manager.getCookie();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
