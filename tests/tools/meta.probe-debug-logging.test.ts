/**
 * self_check and validate_config make direct Dockhand requests (probeRawHealth,
 * attemptRawLogin) that bypass DockhandClient, so before this they produced no debug
 * line — LOG_LEVEL=debug missed the health and credential probes, the exact exchanges
 * that matter when a diagnostic reports a failure. loggedProbe() now emits the same
 * one-line-per-request shape every other Dockhand call does. Codex #209.
 *
 * The load-bearing assertion is the credential-safety one: the login probe carries the
 * DOCKHAND_USERNAME and DOCKHAND_PASSWORD in its request body, and none of that, nor the
 * URL, may reach the line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(fs, 'writeSync').mockImplementation((_fd: unknown, chunk: unknown) => {
    const text = String(chunk);
    lines.push(text);
    return Buffer.byteLength(text);
  });
  return lines;
}

function clientLines(written: string[]) {
  return written
    .join('')
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e.component === 'client');
}

describe('diagnostic probes emit a debug line', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['LOG_LEVEL'] = 'debug';
  });
  afterEach(() => {
    delete process.env['LOG_LEVEL'];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('probeRawHealth logs method, route /api/health, status and duration', async () => {
    const written = captureStderr();
    const { probeRawHealth } = await import('../../src/tools/meta.js');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await probeRawHealth('https://dockhand.example');

    const [line] = clientLines(written);
    expect(line).toMatchObject({ component: 'client', method: 'GET', route: '/api/health', status: 200 });
    expect(typeof line.ms).toBe('number');
    // Never the concrete URL.
    expect(JSON.stringify(line)).not.toContain('dockhand.example');
  });

  it('attemptRawLogin logs route /api/auth and never the credentials or URL', async () => {
    process.env['DOCKHAND_USERNAME'] = 'svc';
    process.env['DOCKHAND_PASSWORD'] = 'p@ssw0rd-do-not-log-me';
    const written = captureStderr();
    const { attemptRawLogin } = await import('../../src/tools/meta.js');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        text: vi.fn().mockResolvedValue('{}'),
        headers: { getSetCookie: () => ['dockhand_session=x; Path=/'], get: () => null },
      }),
    );

    await attemptRawLogin('https://dockhand.example');

    const [line] = clientLines(written);
    expect(line).toMatchObject({ component: 'client', method: 'POST', route: '/api/auth', status: 200 });
    const serialised = JSON.stringify(line);
    expect(serialised).not.toContain('svc');
    expect(serialised).not.toContain('p@ssw0rd-do-not-log-me');
    expect(serialised).not.toContain('dockhand.example');
    expect(serialised).not.toContain('/api/auth/login');
    delete process.env['DOCKHAND_USERNAME'];
    delete process.env['DOCKHAND_PASSWORD'];
  });

  it('logs the health-probe TIMEOUT as a failure, and never a late success line', async () => {
    // withTimeout must reject inside loggedProbe, not around it. Codex #209: wrapping it
    // outside let a timeout escape unlogged, and a fetch resolving after the timeout
    // emitted a success line once self_check had already reported Dockhand down.
    vi.useFakeTimers();
    try {
      const written = captureStderr();
      const { probeRawHealth } = await import('../../src/tools/meta.js');
      // A fetch that resolves only long after the 5s health timeout.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, status: 200 }), 60_000)),
        ),
      );

      const probe = probeRawHealth('https://dockhand.example');
      const settled = probe.then(() => 'resolved', () => 'rejected');
      await vi.advanceTimersByTimeAsync(5_001); // past the health timeout
      expect(await settled).toBe('rejected');

      const lines = clientLines(written);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ component: 'client', method: 'GET', route: '/api/health' });
      expect((lines[0] as { err?: unknown }).err).toBeDefined(); // logged as a failure, not a success
      expect(lines[0].msg).toBe('dockhand request failed');

      // Advance past when the fetch would resolve: still no late success line.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(clientLines(written).filter((l) => l.msg === 'dockhand request')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a warn with only the error name when the probe throws', async () => {
    const written = captureStderr();
    const { probeRawHealth } = await import('../../src/tools/meta.js');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED 10.0.0.9')));

    await expect(probeRawHealth('https://dockhand.example')).rejects.toThrow();

    const [line] = clientLines(written);
    expect(line).toMatchObject({ component: 'client', method: 'GET', route: '/api/health' });
    expect(line.err).toEqual({ type: 'TypeError' });
    // The exception message carries an address; only the name may be logged.
    expect(JSON.stringify(line)).not.toContain('10.0.0.9');
  });
});
