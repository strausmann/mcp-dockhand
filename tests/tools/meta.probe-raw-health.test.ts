/**
 * probeRawHealth() (src/tools/meta.ts) — the real wiring behind `self_check`'s
 * `probeHealth` (Fix round 2, Finding 2 / P2). Replaces the previous
 * `client.get('/api/health')` wiring, which ran through `SessionManager` and therefore
 * attempted a login first — an invalid credential made `probeHealth` fail on the LOGIN,
 * not on `/api/health` itself, so `self_check` reported `dockhandReachable: false,
 * overall: "down"` for what was really just a bad credential. `probeRawHealth` is a bare,
 * UNAUTHENTICATED `fetch()` against `/api/health` (documented `security: []`), so it must
 * succeed independently of whether any credential is valid.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeRawHealth } from '../../src/tools/meta.js';

function mockResponse(init: { ok: boolean; status: number }) {
  return { ok: init.ok, status: init.status };
}

describe('probeRawHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves without throwing when Dockhand /api/health answers 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeRawHealth('https://dockhand.example.com')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('https://dockhand.example.com/api/health');
  });

  it('sends a bare unauthenticated request — no Cookie/Authorization header, no request init at all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await probeRawHealth('https://dockhand.example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toHaveLength(1); // URL only — no second (headers/init) argument
  });

  it('reports Dockhand reachable even when the configured credentials are invalid — the core of the fix', async () => {
    // Simulates the exact scenario the previous client.get()-based wiring got wrong:
    // Dockhand itself is fully up and /api/health answers 200, independent of any
    // credential. probeRawHealth must resolve here regardless of auth state — it never
    // touches SessionManager/login at all.
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeRawHealth('https://dockhand.example.com')).resolves.toBeUndefined();
    // A single, unauthenticated GET — no login attempt bundled into this probe.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a diagnostic error when Dockhand responds with a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeRawHealth('https://dockhand.example.com')).rejects.toThrow(/503/);
  });

  it('propagates a network error (fetch rejects) instead of failing silently', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeRawHealth('https://dockhand.example.com')).rejects.toThrow('ECONNREFUSED');
  });

  it('appends /api/health to the given baseUrl as-is (mirrors attemptRawLogin: normalization is the caller\'s job, via client.getBaseUrl())', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await probeRawHealth('https://dockhand.example.com');

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toBe('https://dockhand.example.com/api/health');
  });
});
