/**
 * Issue #116: a failing Dockhand login produced no output at all, so an operator saw
 * a server that started fine and tools that failed for no stated reason.
 *
 * The fix logged it unconditionally, with a comment saying there was no LOG_LEVEL to
 * gate it on. Now there is one — so the guarantee needs a test rather than a comment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Default import, not `import * as fs`: the namespace form is a frozen ES module
// object in Node/vitest and vi.spyOn cannot redefine a property on it. The default
// import resolves to Node's actual (mutable) CJS module.exports for 'fs'.
import fs from 'node:fs';

function captureStderr(): string[] {
  const written: string[] = [];
  // The logger (src/utils/logger.ts) writes via pino.destination({ fd: 2 }) — SonicBoom,
  // which calls fs.writeSync(fd, ...) directly rather than going through
  // process.stderr.write. Mocking process.stderr.write here would leave `written` empty
  // no matter what the logger does, so the interception has to sit at the fd-write layer
  // pino actually uses. The byte count in the return value matters: SonicBoom treats it
  // as the number of bytes released and retries whatever it believes is still unwritten,
  // so a hardcoded 0 spins forever.
  vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
    if (fd === 2) {
      const text = String(buffer);
      written.push(text);
      return Buffer.byteLength(text);
    }
    return 0;
  });
  return written;
}

describe('login failure visibility at the most restrictive level', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['LOG_LEVEL'] = 'error';
  });

  afterEach(() => {
    delete process.env['LOG_LEVEL'];
    vi.restoreAllMocks();
  });

  it('writes the login failure even when only errors are enabled', async () => {
    const written: string[] = [];
    // The logger (src/utils/logger.ts) writes via pino.destination({ fd: 2, sync: true })
    // — SonicBoom, which calls fs.writeSync(fd, ...) directly rather than going through
    // process.stderr.write. Mocking process.stderr.write here would leave `written` empty
    // no matter what the logger does, so the interception has to sit at the fd-write layer
    // pino actually uses.
    vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
      if (fd === 2) {
        const text = String(buffer);
        written.push(text);
        return Buffer.byteLength(text);
      }
      return 0;
    });

    const { SessionManager } = await import('../src/auth/session.js');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Invalid credentials', { status: 401, statusText: 'Unauthorized' }),
    );

    const manager = new SessionManager({
      url: 'https://dockhand.example',
      username: 'svc',
      password: 'wrong',
    });

    await expect(manager.getCookie()).rejects.toThrow();

    const line = written.join('');
    expect(line).toMatch(/"level":"error"/);
    expect(line).toMatch(/svc/);
    expect(line).toMatch(/401/);
    // The password must never be part of the diagnosis.
    expect(line).not.toMatch(/wrong/);
  });

  // Visible is not the same as usable. This line is the one Issue #116 exists for, and
  // it was written through the bare logger while a request context existed — so an
  // operator got 'tool failed' with req/sid/call/tool and 'login failed' with none of
  // them, and had to join the two by timestamp. At LOG_LEVEL=error, where those are the
  // only two lines that survive, that is the whole diagnosis.
  it('carries the request correlation ids, so the failure can be joined to the call', async () => {
    const written = captureStderr();

    const { SessionManager } = await import('../src/auth/session.js');
    const { runWithLogContext } = await import('../src/utils/log-context.js');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Invalid credentials', { status: 401, statusText: 'Unauthorized' }),
    );

    const manager = new SessionManager({
      url: 'https://dockhand.example',
      username: 'svc',
      password: 'wrong',
    });

    await runWithLogContext(
      { req: 'req-1', sid: 'sid-1', call: 'call-1', tool: 'list_stacks' },
      async () => {
        await expect(manager.getCookie()).rejects.toThrow();
      },
    );

    const entry = JSON.parse(
      written
        .join('')
        .trim()
        .split('\n')
        .find((l) => l.includes('login failed'))!,
    ) as Record<string, unknown>;

    expect(entry).toMatchObject({
      level: 'error',
      req: 'req-1',
      sid: 'sid-1',
      call: 'call-1',
      tool: 'list_stacks',
    });
  });
});
