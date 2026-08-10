/**
 * `DockhandClient.delete()` gained an optional `body` parameter as part of #169
 * (`remove_user_role` needs it: the real `DELETE /api/users/{id}/roles` endpoint
 * reads its target from `request.json()`, not from query params — see
 * `Finsys/dockhand` v1.0.41 `src/routes/api/users/[id]/roles/+server.ts:108`).
 *
 * This test proves the client actually puts that body on the wire (as JSON,
 * with a Content-Type header) rather than silently dropping it — the tool-level
 * tests in body-contract-real-bugs-169.test.ts only prove the tool *calls*
 * `client.delete(path, params, body)` with the right arguments against a mock,
 * they don't prove the client itself forwards `body` to `fetch`.
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
    json: vi.fn().mockResolvedValue(init.body ? JSON.parse(init.body) : {}),
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

describe('DockhandClient.delete — optional body support (#169)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the body as JSON with a Content-Type header when provided', async () => {
    const fetchMock = vi.fn()
      // Login call
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      // DELETE call
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', body: '{"success":true}' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    const result = await client.delete('/api/users/7/roles', undefined, { roleId: 3, environmentId: 1 });

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1];
    expect(String(deleteUrl)).toBe('https://dockhand.example.com/api/users/7/roles');
    expect(deleteInit.method).toBe('DELETE');
    expect(deleteInit.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(deleteInit.body as string)).toEqual({ roleId: 3, environmentId: 1 });
  });

  it('sends no body and no Content-Type header when body is omitted (existing behavior preserved)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', setCookie: ['session=abc123'] }))
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, statusText: 'OK', body: '{"success":true}' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new DockhandClient(config());
    await client.delete('/api/license');

    const [, deleteInit] = fetchMock.mock.calls[1];
    expect(deleteInit.body).toBeUndefined();
    expect(deleteInit.headers['Content-Type']).toBeUndefined();
  });
});
