/**
 * The single pino instance for the whole server.
 *
 * Why stderr: the Streamable HTTP transport does not use stdout as a protocol
 * channel (unlike a stdio MCP server), so stdout is free — and this server uses it
 * for the nginx-formatted access log (see src/utils/access-log.ts). Under Docker's
 * default json-file driver the two streams end up in the same log anyway, so the
 * split is not what keeps CrowdSec from tripping over the structured lines: the grok
 * match is (a JSON line simply does not match the combined format). What the split
 * buys is a consumer outside Docker being able to take one channel without the other.
 *
 * Sync in test, async in production (Issue #210). fd 2 in a container is a pipe: if
 * the log consumer stalls and the 64 KB pipe buffer fills, a synchronous destination's
 * fs.writeSync blocks — and this is a single-threaded server, so it would stop
 * answering requests while waiting to write a log line. The straightforward fix is an
 * async destination, but ten test files intercept output by spying on fs.writeSync
 * (see tests/login-failure-visibility.test.ts): with an async destination SonicBoom
 * sends the first write through fs.write and only buffered ones through fs.writeSync,
 * so that spy becomes non-deterministic — and it fails by capturing nothing, which
 * reads as "the code logged nothing" rather than as a broken test.
 *
 * Rather than rebuild how those ten files capture output, the destination's
 * `sync` flag is chosen per environment: synchronous under vitest (`VITEST=true`,
 * verified set by vitest itself) or an explicit `NODE_ENV=test`, asynchronous
 * otherwise — which is production, where NODE_ENV=production is set in the
 * Dockerfile and neither of those variables is set. Every existing test keeps the
 * synchronous destination and is unaffected; production gets the non-blocking one.
 *
 * Because production is now async, src/index.ts's two fatal-exit paths cannot rely
 * on logger.error(...) + process.exit(1): a queued async write is not guaranteed to
 * land before the process dies. The first fix round tried flushing the destination
 * (SonicBoom's flushSync()) right before each exit — that turned out to be a
 * deterministic no-op for exactly this case. flushSync() only rescues its internal
 * `_writingBuf` back into the flushable queue `if (!this._writing && ...)`
 * (sonic-boom 4.2.1, index.js); but a write to a cold/idle destination dispatches
 * inline via write() -> _actualWrite(), which sets `_writing = true` and moves the
 * line into `_writingBuf` *before* flushSync() ever runs — both real call sites hit
 * exactly this cold case. So the fatal-exit paths instead use logFatalSync()
 * (below), which bypasses this destination entirely and writes directly to fd 2.
 *
 * Why no `silent`: the Issue #116 fix depends on the login-failure line always being
 * written. Supporting a level that suppresses everything would hand that guarantee
 * back to whoever sets an environment variable.
 */

import pino from 'pino';
// Default import, not `import * as fs`: consistent with
// tests/login-failure-visibility.test.ts — the namespace form is a frozen ES module
// object in Node/vitest and vi.spyOn cannot redefine a property on it. logFatalSync
// below calls fs.writeSync(...) as a property access on this shared, mutable object
// specifically so tests can intercept it the same way.
import fs from 'node:fs';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const SUPPORTED: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];
const DEFAULT_LEVEL: LogLevel = 'info';

export interface ResolvedLogLevel {
  level: LogLevel;
  /** Set when the configured value was not usable; caller logs it once at startup. */
  warning?: string;
}

export function resolveLogLevel(raw: string | undefined): ResolvedLogLevel {
  if (raw === undefined || raw.trim() === '') return { level: DEFAULT_LEVEL };

  const normalized = raw.trim().toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(normalized)) {
    return { level: normalized as LogLevel };
  }

  return {
    level: DEFAULT_LEVEL,
    warning:
      `LOG_LEVEL="${raw}" is not a supported level — falling back to ${DEFAULT_LEVEL}. ` +
      `Supported: ${SUPPORTED.join(', ')}.`,
  };
}

const resolved = resolveLogLevel(process.env['LOG_LEVEL']);

// Test files (this one included) run under vitest, which sets VITEST=true; an
// explicit NODE_ENV=test covers any other test runner. Anything else — in
// particular production, where the Dockerfile sets NODE_ENV=production and VITEST
// is unset — gets the non-blocking async destination.
const useSyncDestination = process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test';

const destination = pino.destination({ fd: 2, sync: useSyncDestination });

export const logger = pino(
  {
    level: resolved.level,
    // pino writes numeric levels by default (30, 50). Nobody reading `docker logs`
    // wants to translate those, so emit the word.
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Defence in depth only. The real guarantee is structural: nothing that could
    // carry a value is ever handed to the logger (see src/client/dockhand-client.ts).
    redact: {
      paths: ['password', 'token', 'secret', 'config', 'authorization', 'cookie'],
      censor: '[redacted]',
    },
  },
  destination,
);

if (resolved.warning) {
  logger.warn({ component: 'config' }, resolved.warning);
}

/**
 * Test seam: exposes whether the HELD DESTINATION ITSELF is currently synchronous —
 * deliberately reading the live SonicBoom instance rather than echoing
 * `useSyncDestination` back, so a bug that stops threading that flag through to
 * pino.destination(...) (e.g. an accidental hardcoded `sync: true`) still shows up
 * here instead of trivially passing.
 *
 * `.sync` is a real, load-bearing instance property (sonic-boom's own source
 * branches on `this.sync` throughout, e.g. node_modules/sonic-boom/index.js) but is
 * not part of SonicBoom's public TypeScript type, hence the cast.
 */
export function isDestinationSync(): boolean {
  return (destination as unknown as { sync: boolean }).sync;
}

/**
 * Writes ONE line synchronously and directly to fd 2, bypassing the destination
 * above entirely. Reserved for the two fatal-exit paths in src/index.ts (missing
 * required env var, failed server startup) plus the top-level uncaughtException /
 * unhandledRejection handlers — never for per-request logging, which is exactly the
 * hot path #210 moved off a blocking destination.
 *
 * See the module comment above for why flushing the destination (the first fix
 * round's approach) does not work here: for the cold-destination case every one of
 * these call sites hits, the write is already in flight and flushSync() finds
 * nothing queued to flush.
 *
 * Blocking (fs.writeSync) is fine and correct here: this runs once, at a fatal
 * exit, not per request, so it cannot reintroduce the event-loop stall #210 fixed.
 * The line is shaped like the rest of the logger's output — word-level `level`,
 * ISO `time` — so a fatal line reads the same as everything else under
 * `docker logs`.
 *
 * `bindings` should carry identifying fields only (component, variable name,
 * errType/errMessage — see src/utils/tool-helper.ts for that field-naming
 * convention) — never a raw Error object or anything that could carry a secret.
 * There is no pino redact() here to catch it: this bypasses pino entirely.
 */
export function logFatalSync(bindings: Record<string, unknown>, msg: string): void {
  const line = JSON.stringify({
    level: 'error',
    time: new Date().toISOString(),
    ...bindings,
    msg,
  });
  fs.writeSync(2, line + '\n');
}
