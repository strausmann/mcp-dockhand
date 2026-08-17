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
});
