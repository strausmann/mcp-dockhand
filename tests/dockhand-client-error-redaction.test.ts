/**
 * DockhandClient's thrown `Dockhand API error: ${method} ${url} returned …` message —
 * Fix round 3, Item B. `trigger_git_webhook` (src/tools/git-stacks.ts) calls
 * `client.get('/api/git/stacks/{id}/webhook', { secret })`, which `buildUrl()` turns
 * into a `?secret=<value>` query param on the request URL. On failure, that URL used to
 * land verbatim inside the thrown error message — reaching THREE surfaces unredacted:
 * `console.error` (docker logs), the MCP caller's own error response, and (before the
 * Fix 1 sink-side redaction) `get_runtime_stats`. This is the source-side fix: redact
 * once at construction, in `request()`/`requestRaw()` themselves, via the shared
 * `redactQueryStrings()` (src/utils/redact.ts) — so every consumer of the thrown error
 * gets the already-redacted message, not just `get_runtime_stats`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockhandClient } from '../src/client/dockhand-client.js';
import type { DockhandConfig } from '../src/types/dockhand.js';

function mockResponse(init: { ok: boolean; status: number; statusText: string; body?: string; setCookie?: string[] }) {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText,
    text: vi.fn().mockResolvedValue(init.body ?? ''),
    // Lazily parsed (only on actual .json() call) — the error paths under test here
    // only ever call .text(), and several of these mocked bodies (e.g. plain-text
    // 'boom'/'nope') are deliberately NOT valid JSON, matching a real non-JSON error
    // response body.
    json: vi.fn().mockImplementation(async () => (init.body ? JSON.parse(init.body) : {})),
    headers: {
      getSetCookie: () => init.setCookie ?? [],
      get: (name: string) => (name.toLowerCase() === 'content-type' && init.body ? 'application/json' : null),
    },
  };
}

function config(overrides: Partial<DockhandConfig> = {}): DockhandConfig {
  return {
    url: 'https://dockhand.example.com',
    username: 'admin',
    password: 'secret',
    ...overrides,
  };
}

describe('DockhandClient error message redaction (request())', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redacts a secret carried in a query string in the thrown error message', async () => {
    const fetchMock = vi.fn()
      // Login call
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      // GET /api/git/stacks/7/webhook?secret=abc123def — the real trigger_git_webhook shape
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error', body: 'boom' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    let thrown: Error | undefined;
    try {
      await client.get('/api/git/stacks/7/webhook', { secret: 'abc123def' });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/Dockhand API error: GET .*\?<redacted> returned 500: boom/);
    // The raw secret value must be nowhere in the thrown message.
    expect(thrown!.message).not.toContain('abc123def');
    expect(thrown!.message).toContain('?<redacted>');
  });

  it('leaves an error message from a query-less URL unchanged', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found', body: 'stack not found' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());

    await expect(client.get('/api/stacks/does-not-exist')).rejects.toThrow(
      'Dockhand API error: GET https://dockhand.example.com/api/stacks/does-not-exist returned 404: stack not found',
    );
  });
});

describe('DockhandClient error message redaction (requestRaw(), via postMultipart())', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redacts a secret carried in a query string in requestRaw()\'s thrown error message too', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 403, statusText: 'Forbidden', body: 'nope' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    const formData = new FormData();
    formData.append('file', 'content');

    let thrown: Error | undefined;
    try {
      await client.postMultipart('/api/containers/abc/upload', formData, { token: 'super-secret-upload-token' });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/Dockhand API error: POST .*\?<redacted> returned 403: nope/);
    expect(thrown!.message).not.toContain('super-secret-upload-token');
  });
});
