/**
 * #210, fix round 2: fix round 1 flushed the async production destination right
 * before both fatal process.exit(1) calls in src/index.ts — verified, by mocking
 * flushLogsSync(), to call flushLogsSync() before exit. That test passed, but the
 * mechanism it verified was a no-op against the REAL SonicBoom destination for a
 * cold write (see src/utils/logger.ts's module comment for why). Both fatal-exit
 * paths, plus the top-level uncaughtException/unhandledRejection handlers, now use
 * logFatalSync() instead, which bypasses the pino destination entirely and writes
 * directly to fd 2.
 *
 * These tests spy on the REAL fs.writeSync (not a mock of logFatalSync itself) so
 * they exercise the same code path production does. To make sure a regression that
 * routes any of these call sites back through logger.error(...) is still caught —
 * even though vitest's own destination happens to be synchronous too (see
 * src/utils/logger.ts's sync-in-test / async-in-production split), which would
 * otherwise still land a line on fd 2 and mask exactly this regression — every
 * assertion here also checks for pino's default `pid`/`hostname` base bindings,
 * which logFatalSync's hand-built JSON never has, and a direct spy on `logger.error`
 * asserting it was never called for the fatal line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

interface FatalLineCapture {
  /** In call order: `write:<json>` for every fd-2 write, or `exit:<code>`. */
  calls: string[];
}

function captureFatalWritesAndExit(): FatalLineCapture {
  const calls: string[] = [];
  vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
    if (fd === 2) {
      const text = String(buffer);
      calls.push(`write:${text}`);
      return Buffer.byteLength(text);
    }
    return 0;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    calls.push(`exit:${code}`);
    return undefined as never;
  }) as never);
  return { calls };
}

function assertBypassesLogger(line: string): void {
  const parsed: unknown = JSON.parse(line);
  const record = parsed as Record<string, unknown>;
  expect(record['level']).toBe('error');
  // pino always adds these via its default base bindings — their absence is what
  // proves this line came from logFatalSync, not logger.error(...).
  expect(record).not.toHaveProperty('pid');
  expect(record).not.toHaveProperty('hostname');
}

describe('src/index.ts fatal-exit paths write to fd 2 before process.exit(1)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.doUnmock('../src/server.js');
    // process.on(...) listeners installed by a freshly re-imported src/index.ts
    // are NOT scoped to vi.resetModules() — without this they accumulate across
    // tests in this file (and beyond, since these are real process-level
    // listeners) and later tests would see writes/exits from earlier ones' handlers.
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  it('missing-env-var path: writes the fatal line to fd 2, THEN exits(1)', async () => {
    const { calls } = captureFatalWritesAndExit();
    // Exit throws here (unlike the fatal-startup test below) specifically so a
    // regression that reordered process.exit(1) before the write would leave
    // `calls` empty instead of merely reordered — getEnvOrThrow has nothing after
    // process.exit(1) in the real source either, so this changes nothing observable
    // about correct behaviour.
    vi.mocked(process.exit).mockImplementation(((code?: number) => {
      calls.push(`exit:${code}`);
      throw new Error('process.exit called');
    }) as never);

    delete process.env['DOCKHAND_URL'];
    delete process.env['DOCKHAND_USERNAME'];
    delete process.env['DOCKHAND_PASSWORD'];

    await expect(import('../src/index.js')).rejects.toThrow('process.exit called');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^write:/);
    expect(calls[1]).toBe('exit:1');
    const line = calls[0]!.slice('write:'.length);
    assertBypassesLogger(line);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ component: 'config', variable: 'DOCKHAND_URL' });
    expect(parsed.msg).toMatch(/required environment variable is not set/);
  });

  it('fatal-startup path: writes the fatal line to fd 2, THEN exits(1)', async () => {
    vi.doMock('../src/server.js', () => ({
      createServer: vi.fn().mockRejectedValue(new Error('boom')),
    }));

    const { calls } = captureFatalWritesAndExit();

    process.env['DOCKHAND_URL'] = 'https://dockhand.example';
    process.env['DOCKHAND_USERNAME'] = 'admin';
    process.env['DOCKHAND_PASSWORD'] = 'secret';

    await import('../src/index.js');
    // createServer's rejection is handled asynchronously in a .catch() — give the
    // microtask queue a turn before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Under valid env vars the startup info line also writes to fd 2 (synchronously
    // — vitest uses the sync destination), so the fatal line is not necessarily the
    // only entry. It must be the LAST one, i.e. it happened right before exit.
    expect(calls.at(-1)).toBe('exit:1');
    const fatalCall = calls.at(-2);
    expect(fatalCall).toMatch(/^write:/);
    const line = fatalCall!.slice('write:'.length);
    assertBypassesLogger(line);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      component: 'server',
      errType: 'Error',
      errMessage: 'boom',
      msg: 'failed to start server',
    });
  });
});

describe('src/index.ts top-level uncaughtException/unhandledRejection handlers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env['DOCKHAND_URL'] = 'https://dockhand.example';
    process.env['DOCKHAND_USERNAME'] = 'admin';
    process.env['DOCKHAND_PASSWORD'] = 'secret';
    vi.doMock('../src/server.js', () => ({
      // Resolves (never settles a real server) so this describe block never
      // exercises the fatal-startup .catch() path above — only the two handlers
      // under test here.
      createServer: vi.fn().mockReturnValue(new Promise(() => {})),
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.doUnmock('../src/server.js');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  it('uncaughtException: writes name/message only to fd 2, calls logFatalSync (not logger.error), then exits(1)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    const { calls } = captureFatalWritesAndExit();

    await import('../src/index.js');

    const secretValue = 'super-secret-password-should-never-appear';
    const err = new Error('boom: irrelevant detail');
    // A real thrown error sometimes carries extra enumerable properties (e.g. a
    // config object attached for debugging). Attaching one here proves the handler
    // reads only .name/.message and never serializes the whole error.
    (err as unknown as Record<string, unknown>)['context'] = { password: secretValue };

    process.emit('uncaughtException', err);

    expect(calls.at(-1)).toBe('exit:1');
    const fatalCall = calls.at(-2);
    expect(fatalCall).toMatch(/^write:/);
    const line = fatalCall!.slice('write:'.length);
    assertBypassesLogger(line);
    expect(line).not.toContain(secretValue);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      component: 'process',
      errType: 'Error',
      errMessage: 'boom: irrelevant detail',
      msg: 'uncaught exception',
    });
    expect(JSON.stringify(parsed)).not.toContain(secretValue);
    // Direct proof this path never went through the async logger, independent of
    // vitest's sync-in-test destination masking the output-shape check above.
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('unhandledRejection: writes name/message only to fd 2, calls logFatalSync (not logger.error), then exits(1)', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const loggerErrorSpy = vi.spyOn(logger, 'error');
    const { calls } = captureFatalWritesAndExit();

    await import('../src/index.js');

    const secretValue = 'super-secret-token-should-never-appear';
    const reason = new Error('rejected: irrelevant detail');
    (reason as unknown as Record<string, unknown>)['context'] = { token: secretValue };

    process.emit('unhandledRejection', reason, Promise.resolve());

    expect(calls.at(-1)).toBe('exit:1');
    const fatalCall = calls.at(-2);
    expect(fatalCall).toMatch(/^write:/);
    const line = fatalCall!.slice('write:'.length);
    assertBypassesLogger(line);
    expect(line).not.toContain(secretValue);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      component: 'process',
      errType: 'Error',
      errMessage: 'rejected: irrelevant detail',
      msg: 'unhandled rejection',
    });
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('unhandledRejection: a non-Error reason is stringified, not thrown or dropped', async () => {
    const { calls } = captureFatalWritesAndExit();

    await import('../src/index.js');

    process.emit('unhandledRejection', 'plain string rejection', Promise.resolve());

    expect(calls.at(-1)).toBe('exit:1');
    const fatalCall = calls.at(-2);
    const line = fatalCall!.slice('write:'.length);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      component: 'process',
      errType: 'string',
      errMessage: 'plain string rejection',
      msg: 'unhandled rejection',
    });
  });
});
