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
 * Why sync: src/index.ts calls process.exit(1) immediately after logging a fatal
 * configuration error. With an async destination that line can be lost in the exit,
 * which would make the most important message the server ever writes the one least
 * likely to arrive.
 *
 * KNOWN TRADE-OFF, deliberately left as it is for now: fd 2 in a container is a pipe,
 * so if the log consumer stalls and the 64 KB pipe buffer fills, fs.writeSync blocks —
 * and this is a single-threaded server, so it would stop answering requests while
 * waiting to write a log line. The narrower fix (async destination + an explicit
 * flush before each process.exit) is correct in production but cannot be adopted
 * without first rebuilding how the tests capture log output: with an async
 * destination SonicBoom sends the first write through fs.write and only buffered ones
 * through fs.writeSync, so the fs.writeSync spy that ten test files rely on becomes
 * non-deterministic — and it fails by capturing nothing, which reads as "the code
 * logged nothing" rather than as a broken test. Flushing before asserting does NOT
 * repair that, which is what makes it a rebuild rather than a tweak.
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
  pino.destination({ fd: 2, sync: true }),
);

if (resolved.warning) {
  logger.warn({ component: 'config' }, resolved.warning);
}
