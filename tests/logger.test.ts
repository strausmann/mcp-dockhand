/**
 * The logger is the one place LOG_LEVEL becomes real. Issue #116 shipped a README
 * row for it while nothing in the code ever read the variable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// Default import, not `import * as fs`: matches src/utils/logger.ts and
// tests/login-failure-visibility.test.ts — the namespace form is a frozen ES
// module object in Node/vitest and vi.spyOn cannot redefine a property on it.
import fs from 'node:fs';
import { resolveLogLevel } from '../src/utils/logger.js';

describe('resolveLogLevel', () => {
  it('accepts the four supported levels', () => {
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      expect(resolveLogLevel(level)).toEqual({ level });
    }
  });

  it('defaults to info when unset', () => {
    expect(resolveLogLevel(undefined)).toEqual({ level: 'info' });
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(resolveLogLevel('  DEBUG ')).toEqual({ level: 'debug' });
  });

  it('falls back to info with a warning instead of exiting', () => {
    // A typo in a compose file must never stop the server from starting.
    const result = resolveLogLevel('lound');
    expect(result.level).toBe('info');
    expect(result.warning).toMatch(/lound/);
    expect(result.warning).toMatch(/error, warn, info, debug/);
  });

  it('rejects silent', () => {
    // Deliberate: the #116 fix depends on the login failure line ALWAYS being
    // emitted. A silent level would make that guarantee defeasible again.
    const result = resolveLogLevel('silent');
    expect(result.level).toBe('info');
    expect(result.warning).toMatch(/silent/);
  });
});

describe('logFatalSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a single, pino-shaped JSON line directly and synchronously to fd 2', async () => {
    const written: string[] = [];
    // The real fs.writeSync, not a mock of logFatalSync itself — Fix round 1's
    // flushLogsSync() looked correct through a mocked spy but was a deterministic
    // no-op against the REAL SonicBoom destination (see src/utils/logger.ts's
    // module comment). This test exists specifically so that class of regression
    // shows up here.
    vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
      if (fd === 2) {
        const text = String(buffer);
        written.push(text);
        return Buffer.byteLength(text);
      }
      return 0;
    });

    const { logFatalSync } = await import('../src/utils/logger.js');
    logFatalSync({ component: 'config' }, 'boom');

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('"level":"error"');
    expect(written[0]).toContain('boom');

    const parsed: unknown = JSON.parse(written[0]!);
    expect(parsed).toMatchObject({ level: 'error', component: 'config', msg: 'boom' });
    const record = parsed as Record<string, unknown>;
    expect(typeof record['time']).toBe('string');
    expect(() => new Date(record['time'] as string).toISOString()).not.toThrow();
    // logFatalSync deliberately bypasses pino entirely (see its doc comment). pino
    // always adds `pid`/`hostname` via its default base bindings, so their absence
    // is a shape-level differentiator that catches a regression routing this back
    // through the logger — one that a plain "did fd 2 receive a write" check would
    // NOT catch, because under vitest the destination happens to be synchronous
    // too (see the sync-in-test / async-in-production split below) and would
    // still reach fd 2 either way, just via a different, unreliable-in-production
    // path.
    expect(record).not.toHaveProperty('pid');
    expect(record).not.toHaveProperty('hostname');
    expect(Object.keys(record).sort()).toEqual(['component', 'level', 'msg', 'time']);
  });

  it('does not throw when a binding value is not JSON-serializable — still writes a line', async () => {
    const written: string[] = [];
    vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
      if (fd === 2) {
        const text = String(buffer);
        written.push(text);
        return Buffer.byteLength(text);
      }
      return 0;
    });

    const { logFatalSync } = await import('../src/utils/logger.js');
    // A BigInt binding makes JSON.stringify throw ("Do not know how to serialize a
    // BigInt"). The one line a fatal handler exists to write must still be written.
    expect(() => logFatalSync({ component: 'config', weird: 10n }, 'boom')).not.toThrow();

    expect(written).toHaveLength(1);
    const record = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({ level: 'error', msg: 'boom', note: 'fatal bindings were not serializable' });
    expect(typeof record['time']).toBe('string');
  });
});

describe('log destination sync-ness by environment', () => {
  const originalVitest = process.env['VITEST'];
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalVitest === undefined) delete process.env['VITEST'];
    else process.env['VITEST'] = originalVitest;
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    vi.resetModules();
  });

  it('uses a synchronous destination under the test default (VITEST=true)', async () => {
    vi.resetModules();
    // VITEST is already 'true' in this environment — exercise it explicitly anyway.
    process.env['VITEST'] = 'true';
    const { isDestinationSync } = await import('../src/utils/logger.js');
    expect(isDestinationSync()).toBe(true);
  });

  it('uses an asynchronous destination when neither VITEST nor NODE_ENV=test is set (production shape)', async () => {
    vi.resetModules();
    delete process.env['VITEST'];
    delete process.env['NODE_ENV'];
    const { isDestinationSync } = await import('../src/utils/logger.js');
    expect(isDestinationSync()).toBe(false);
  });

  it('caps the destination buffer to a finite maxLength (not SonicBoom default 0/unbounded)', async () => {
    vi.resetModules();
    // Read from the live instance. If someone drops the maxLength option, SonicBoom
    // falls back to its default of 0 (unbounded) and this fails — the whole point of
    // the Codex #216 P2: an async destination with an unbounded buffer OOM-kills the
    // process when the log consumer stalls.
    const { destinationMaxLength, ASYNC_LOG_MAX_BUFFER_BYTES } = await import('../src/utils/logger.js');
    expect(destinationMaxLength()).toBe(ASYNC_LOG_MAX_BUFFER_BYTES);
    expect(Number.isFinite(destinationMaxLength())).toBe(true);
    expect(destinationMaxLength()).toBeGreaterThan(0);
  });
});

describe('describeThrown', () => {
  it('reads name/message from an Error', async () => {
    const { describeThrown } = await import('../src/utils/logger.js');
    expect(describeThrown(new TypeError('boom'))).toEqual({ errType: 'TypeError', errMessage: 'boom' });
  });

  it('normalizes primitive non-Error throws by typeof + String()', async () => {
    const { describeThrown } = await import('../src/utils/logger.js');
    expect(describeThrown(null)).toEqual({ errType: 'object', errMessage: 'null' });
    expect(describeThrown(undefined)).toEqual({ errType: 'undefined', errMessage: 'undefined' });
    expect(describeThrown('plain')).toEqual({ errType: 'string', errMessage: 'plain' });
    expect(describeThrown(42)).toEqual({ errType: 'number', errMessage: '42' });
  });

  it('does not throw on values whose String() throws — the fatal-handler guarantee', async () => {
    const { describeThrown } = await import('../src/utils/logger.js');
    // Object.create(null) has no Object.prototype.toString: String() on it throws
    // "Cannot convert object to primitive value". This is the exact case that would
    // crash a fatal handler mid-formatting (Codex #216 P2). It must fall back, not throw.
    const nullProto = Object.create(null) as unknown;
    expect(() => describeThrown(nullProto)).not.toThrow();
    expect(describeThrown(nullProto)).toEqual({ errType: 'object', errMessage: '<unformattable value>' });

    // An object with a throwing Symbol.toPrimitive behaves the same way.
    const hostile = {
      [Symbol.toPrimitive]() {
        throw new Error('conversion hook exploded');
      },
    };
    expect(() => describeThrown(hostile)).not.toThrow();
    expect(describeThrown(hostile)).toEqual({ errType: 'object', errMessage: '<unformattable value>' });
  });

  it('coerces an Error with a non-string name/message to strings (a bigint would break JSON.stringify)', async () => {
    const { describeThrown } = await import('../src/utils/logger.js');
    // Error.name/.message are writable and can be replaced with a non-string. Left
    // uncoerced, the returned field flows into logFatalSync's JSON.stringify, which
    // throws on a bigint — reopening the fatal-handler crash from a different angle.
    const err = new Error('ok');
    (err as unknown as Record<string, unknown>)['name'] = 10n;
    (err as unknown as Record<string, unknown>)['message'] = 20n;
    const result = describeThrown(err);
    expect(typeof result.errType).toBe('string');
    expect(typeof result.errMessage).toBe('string');
    expect(result).toEqual({ errType: '10', errMessage: '20' });
  });
});
