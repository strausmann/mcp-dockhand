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
 * Because production is now async, src/index.ts's two process.exit(1) calls (fatal
 * config error, fatal startup error) can no longer rely on the write completing
 * before the process dies — an async write queued right before exit can be lost,
 * which would make the most important message the server ever writes the one least
 * likely to arrive. The destination reference is held below and exposed via
 * flushLogsSync() so index.ts can drain it synchronously right before each exit.
 *
 * Why no `silent`: the Issue #116 fix depends on the login-failure line always being
 * written. Supporting a level that suppresses everything would hand that guarantee
 * back to whoever sets an environment variable.
 */

import pino from 'pino';

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
 * Drains the destination synchronously. Call this immediately before every
 * process.exit(...) in src/index.ts — see the module comment above for why: in
 * production the destination is async, so a queued write is not guaranteed to have
 * landed before the process dies unless it is flushed first.
 *
 * flushSync lives on the SonicBoom destination object, not on pino's Logger — that
 * is why the destination reference is held above instead of only being passed to
 * pino(...) inline.
 */
export function flushLogsSync(): void {
  destination.flushSync();
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
