/**
 * #210: the log destination is async in production (see src/utils/logger.ts), so a
 * process.exit(1) right after logger.error(...) can now race the write — the exit
 * path must call flushLogsSync() first, or the most important line the server ever
 * writes (why it refused to start) can be the one that never arrives.
 *
 * src/index.ts has two such exits: the missing-required-env-var path
 * (getEnvOrThrow) and the fatal-startup path (createServer(...).catch(...)). Both
 * are covered here by mocking the logger module (to spy on flushLogsSync without
 * touching the real destination) and process.exit (to halt execution at the exit
 * call, the same way the real process would stop).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('src/index.ts flushes logs before process.exit(1)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.doUnmock('../src/utils/logger.js');
    vi.doUnmock('../src/server.js');
  });

  it('calls flushLogsSync() before process.exit(1) on the missing-env-var path', async () => {
    const calls: string[] = [];
    const flushLogsSync = vi.fn(() => {
      calls.push('flush');
    });
    vi.doMock('../src/utils/logger.js', () => ({
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      flushLogsSync,
    }));

    delete process.env['DOCKHAND_URL'];
    delete process.env['DOCKHAND_USERNAME'];
    delete process.env['DOCKHAND_PASSWORD'];

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      calls.push(`exit:${code}`);
      throw new Error('process.exit called');
    }) as never);

    await expect(import('../src/index.js')).rejects.toThrow('process.exit called');

    expect(flushLogsSync).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(calls).toEqual(['flush', 'exit:1']);
  });

  it('calls flushLogsSync() before process.exit(1) on the fatal-startup path', async () => {
    const calls: string[] = [];
    const flushLogsSync = vi.fn(() => {
      calls.push('flush');
    });
    vi.doMock('../src/utils/logger.js', () => ({
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      flushLogsSync,
    }));
    vi.doMock('../src/server.js', () => ({
      createServer: vi.fn().mockRejectedValue(new Error('boom')),
    }));

    process.env['DOCKHAND_URL'] = 'https://dockhand.example';
    process.env['DOCKHAND_USERNAME'] = 'admin';
    process.env['DOCKHAND_PASSWORD'] = 'secret';

    // Unlike the missing-env-var path, this exit happens inside an unawaited
    // `.catch()` callback with nothing after it — so the mock does not need to
    // throw to halt execution (there is nothing left to halt), and throwing here
    // would only turn into an unhandled rejection on a promise nobody awaits.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      calls.push(`exit:${code}`);
      return undefined as never;
    }) as never);

    await import('../src/index.js');
    // createServer's rejection is handled asynchronously in a .catch() — give the
    // microtask queue a turn before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(flushLogsSync).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(calls).toEqual(['flush', 'exit:1']);
  });
});
