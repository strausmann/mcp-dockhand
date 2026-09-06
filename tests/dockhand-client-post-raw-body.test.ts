/**
 * `DockhandClient.postRawBody()` — added for `load_image` (POST /api/images/load,
 * Finsys/dockhand `src/routes/api/images/load/+server.ts`), whose request BODY is the
 * raw Docker image tar itself (`Content-Type: application/x-tar`), not JSON and not
 * multipart/form-data. It reuses `requestRaw()` (the same low-level helper getRaw() and
 * postMultipart() already share) rather than adding new auth/retry plumbing.
 *
 * This test proves the client actually puts the raw Buffer body + content-type header
 * on the wire and parses the JSON response back — the tool-level test
 * (load-image.test.ts) only proves the tool *calls* client.postRawBody(...) with the
 * right arguments against a mock, it doesn't prove the client forwards them to fetch()
 * correctly. Same split as dockhand-client-delete-body.test.ts for client.delete().
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockhandClient } from '../src/client/dockhand-client.js';
import type { DockhandConfig } from '../src/types/dockhand.js';

function mockResponse(init: { ok: boolean; status: number; statusText: string; body?: string; contentType?: string; setCookie?: string[] }) {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText,
    text: vi.fn().mockResolvedValue(init.body ?? ''),
    json: vi.fn().mockImplementation(async () => {
      if (!init.body) return {};
      try {
        return JSON.parse(init.body);
      } catch {
        throw new SyntaxError('Unexpected token in JSON');
      }
    }),
    headers: {
      getSetCookie: () => init.setCookie ?? [],
      get: (name: string) => (name.toLowerCase() === 'content-type' ? (init.contentType ?? null) : null),
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

describe('DockhandClient.postRawBody', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the Buffer body verbatim with the given Content-Type header, and parses a JSON response', async () => {
    const fetchMock = vi.fn()
      // Login call
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      // POST call
      .mockResolvedValueOnce(mockResponse({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: '{"success":true,"loaded":"alpine:3.20"}',
        contentType: 'application/json',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    const tar = Buffer.from('fake-tar-bytes');
    const result = await client.postRawBody('/api/images/load', tar, 'application/x-tar', { env: 3 });

    expect(result).toEqual({ success: true, loaded: 'alpine:3.20' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe('https://dockhand.example.com/api/images/load?env=3');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-tar');
    expect(init.headers['Accept']).toBe('application/json');
    expect(init.body).toBe(tar);
  });

  it('omits the env query param when environmentId is not given', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', body: '{"success":true}', contentType: 'application/json' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    await client.postRawBody('/api/images/load', Buffer.from('x'), 'application/x-tar');

    const [url] = fetchMock.mock.calls[1];
    expect(String(url)).toBe('https://dockhand.example.com/api/images/load');
  });

  it('falls back to text when the response is not JSON (defensive, mirrors postMultipart)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', body: 'plain text', contentType: 'text/plain' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    const result = await client.postRawBody('/api/images/load', Buffer.from('x'), 'application/x-tar');

    expect(result).toBe('plain text');
  });

  it('throws a redacted error on a non-ok response (e.g. 400 missing body)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 400, statusText: 'Bad Request', body: 'Request body (an image tar) is required' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    await expect(client.postRawBody('/api/images/load', Buffer.from('x'), 'application/x-tar'))
      .rejects.toThrow(/400.*Request body \(an image tar\) is required/);
  });

  it('network error propagates unchanged', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    await expect(client.postRawBody('/api/images/load', Buffer.from('x'), 'application/x-tar'))
      .rejects.toThrow('ECONNREFUSED');
  });
});
