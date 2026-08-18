/**
 * The login is the one Dockhand request that does not go through
 * DockhandClient.loggedFetch, so it was the one request that produced no
 * component:"client" line. At LOG_LEVEL=debug against an unreachable Dockhand an
 * operator saw the tool failure and nothing else — no method, no status, no duration —
 * for exactly the request Issue #116 is about.
 *
 * The interesting path is the one where fetch REJECTS: an unreachable host never
 * produces a response, so a line written only on the response side would still leave
 * that case silent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

describe('login request logging', () => {
  let written: string[];

  beforeEach(() => {
    vi.resetModules();
    process.env['LOG_LEVEL'] = 'debug';
    written = [];
    // pino.destination({ fd: 2 }) is SonicBoom: it calls fs.writeSync(fd, ...) and
    // never touches process.stderr.write, so the spy has to sit at the fd layer. The
    // byte count in the return value is load-bearing — SonicBoom retries whatever it
    // believes is still unwritten, so a hardcoded 0 spins forever.
    vi.spyOn(fs, 'writeSync').mockImplementation((_fd: unknown, chunk: unknown) => {
      const text = String(chunk);
      written.push(text);
      return Buffer.byteLength(text);
    });
  });

  afterEach(() => {
    delete process.env['LOG_LEVEL'];
    vi.restoreAllMocks();
  });

  function clientLines(): Record<string, unknown>[] {
    return written
      .join('')
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((entry) => entry.component === 'client');
  }

  async function login(fetchImpl: () => Promise<Response>) {
    const { SessionManager } = await import('../src/auth/session.js');
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl as never);
    const manager = new SessionManager({
      url: 'https://dockhand.example',
      username: 'svc',
      password: 'p@ssw0rd-do-not-log-me',
    });
    return manager.getCookie();
  }

  it('logs the login exchange the way every other Dockhand request is logged', async () => {
    await login(async () =>
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'dockhand_session=abc; Path=/' },
      }),
    );

    const [line, ...rest] = clientLines();
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      component: 'client',
      method: 'POST',
      route: '/api/auth',
      status: 200,
      msg: 'dockhand request',
    });
    expect(typeof line.ms).toBe('number');
  });

  it('logs an unreachable Dockhand, which is the case that produced nothing at all', async () => {
    await expect(
      login(() => Promise.reject(new TypeError('fetch failed'))),
    ).rejects.toThrow();

    const [line] = clientLines();
    expect(line).toMatchObject({
      component: 'client',
      method: 'POST',
      route: '/api/auth',
      // Same shape as the client's own failure line: the exception NAME, which is
      // bounded, never its free-text message.
      err: { type: 'TypeError' },
      msg: 'dockhand request failed',
    });
  });

  it('never puts the url, the body or the credentials on the line', async () => {
    await login(async () =>
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'dockhand_session=abc; Path=/' },
      }),
    );

    // Non-empty first: "contains no secret" is trivially true of a line that was never
    // written, which would make this test green against the very version it exists to
    // rule out.
    expect(clientLines()).toHaveLength(1);

    const line = JSON.stringify(clientLines());
    expect(line).not.toContain('p@ssw0rd-do-not-log-me');
    expect(line).not.toContain('svc');
    expect(line).not.toContain('dockhand.example');
    // The full path would be /api/auth/login; the logged route stops one segment short,
    // the same truncation the client applies.
    expect(line).not.toContain('/api/auth/login');
  });
});
