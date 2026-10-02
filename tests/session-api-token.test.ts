import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../src/auth/session.js';
import { DockhandClient } from '../src/client/dockhand-client.js';
import type { DockhandConfig } from '../src/types/dockhand.js';

interface MockResponseInit {
  ok: boolean;
  status: number;
  statusText: string;
  body?: string;
  setCookie?: string[];
}

function mockResponse(init: MockResponseInit) {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText,
    text: vi.fn().mockResolvedValue(init.body ?? ''),
    json: vi.fn().mockResolvedValue(init.body ? JSON.parse(init.body) : {}),
    headers: {
      getSetCookie: () => init.setCookie ?? [],
      get: (name: string) => (name.toLowerCase() === 'content-type' && init.body ? 'application/json' : null),
    },
  };
}

const TOKEN = 'dh_abcdefghijklmnopqrstuvwxyz0123456789';

function sessionConfig(overrides: Partial<DockhandConfig> = {}): DockhandConfig {
  return {
    url: 'https://dockhand.example.com',
    username: 'admin',
    password: 'secret',
    ...overrides,
  };
}

function tokenConfig(overrides: Partial<DockhandConfig> = {}): DockhandConfig {
  return {
    url: 'https://dockhand.example.com',
    apiToken: TOKEN,
    ...overrides,
  };
}

describe('SessionManager — API token mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is accepted without a username or password', () => {
    expect(() => new SessionManager(tokenConfig())).not.toThrow();
  });

  it('presents the token as a Bearer header', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(tokenConfig());

    await expect(manager.getAuthHeaders()).resolves.toEqual({ Authorization: `Bearer ${TOKEN}` });
    // The point of token mode: no login round-trip at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes login() a no-op — no request, no error', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(tokenConfig());

    await expect(manager.login()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports authenticated without ever having logged in', () => {
    const manager = new SessionManager(tokenConfig());
    expect(manager.isAuthenticated()).toBe(true);
  });

  it('rejects getCookie() rather than returning a meaningless value', async () => {
    const manager = new SessionManager(tokenConfig());
    await expect(manager.getCookie()).rejects.toThrow(/API-token mode/);
  });

  it('makes invalidate() a no-op, so the 401 retry path is safe', async () => {
    const manager = new SessionManager(tokenConfig());

    expect(() => manager.invalidate()).not.toThrow();
    // Still authenticated, and still presenting the same token.
    expect(manager.isAuthenticated()).toBe(true);
    await expect(manager.getAuthHeaders()).resolves.toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('treats an empty-string token as absent, falling back to session mode', () => {
    const manager = new SessionManager(sessionConfig({ apiToken: '' }));
    expect(manager.isAuthenticated()).toBe(false);
  });
});

describe('SessionManager — configuration guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws at construction when neither a token nor a full credential pair is given', () => {
    expect(() => new SessionManager({ url: 'https://dockhand.example.com' })).toThrow(
      /DOCKHAND_API_TOKEN or both DOCKHAND_USERNAME \+ DOCKHAND_PASSWORD/,
    );
  });

  it('throws at construction when the password is missing', () => {
    expect(
      () => new SessionManager({ url: 'https://dockhand.example.com', username: 'admin' }),
    ).toThrow(/DOCKHAND_API_TOKEN/);
  });
});

describe('SessionManager — session mode is unchanged', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getAuthHeaders() logs in and returns a Cookie header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123; Path=/; HttpOnly'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const manager = new SessionManager(sessionConfig());

    await expect(manager.getAuthHeaders()).resolves.toEqual({ Cookie: 'session=abc123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('DockhandClient — Bearer auth end to end', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends Authorization: Bearer and never logs in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', body: '{"ok":true}' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(tokenConfig());
    await client.get('/api/health');

    // One call, not two: no login preceded the request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://dockhand.example.com/api/health');
    expect(init.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Cookie']).toBeUndefined();
  });

  it('re-sends the same Bearer header on a 401 retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }))
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', body: '{"ok":true}' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(tokenConfig());
    await client.get('/api/health');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1];
    expect(retryInit.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(retryInit.headers['Cookie']).toBeUndefined();
  });
});
