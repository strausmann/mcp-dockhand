/**
 * MCP Dockhand Server - Entry Point
 *
 * Exposes 130+ Dockhand Docker Management API endpoints as MCP tools
 * via Streamable HTTP transport.
 */

import { createServer } from './server.js';
import { logger, logFatalSync, describeThrown } from './utils/logger.js';

/**
 * Issue #210, fix round 2: moving normal logging off a blocking destination (see
 * src/utils/logger.ts) means a line written shortly before an *uncaught*
 * termination — as opposed to one of the two deliberate process.exit(1) calls
 * below, which already go through logFatalSync() — is no longer guaranteed to have
 * landed the way it always did under the old fully-synchronous logger. These two
 * handlers close that gap with the same synchronous, destination-bypassing write.
 *
 * Deliberately narrow: no SIGTERM/SIGINT graceful-shutdown handling here — that is
 * a separate concern, out of scope for #210, and belongs in its own issue.
 */
process.on('uncaughtException', (error: unknown) => {
  // Node passes the raw thrown value, and `throw null` / `throw undefined` /
  // `throw Object.create(null)` are all legal — the `Error` type Node's own typings
  // claim here is a lie. describeThrown() formats any value without throwing (reading
  // `.name` on null, or String() on a null-prototype object, would otherwise crash
  // this handler and Node would exit code 7 with nothing logged, burying the failure).
  logFatalSync({ component: 'process', ...describeThrown(error) }, 'uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logFatalSync({ component: 'process', ...describeThrown(reason) }, 'unhandled rejection');
  process.exit(1);
});

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    logFatalSync(
      { component: 'config', variable: name },
      'required environment variable is not set — copy .env.example to .env and fill in your Dockhand credentials',
    );
    process.exit(1);
  }
  return value;
}

const config = {
  dockhand: {
    url: getEnvOrThrow('DOCKHAND_URL'),
    username: getEnvOrThrow('DOCKHAND_USERNAME'),
    password: getEnvOrThrow('DOCKHAND_PASSWORD'),
  },
  port: parseInt(process.env['MCP_PORT'] ?? '8080', 10),
  host: process.env['MCP_HOST'] || '0.0.0.0',
};

logger.info(
  {
    component: 'config',
    dockhandUrl: config.dockhand.url,
    dockhandUser: config.dockhand.username,
    port: config.port,
  },
  'starting MCP Dockhand server',
);

createServer(config).catch((error: unknown) => {
  logFatalSync(
    { component: 'server', ...describeThrown(error) },
    'failed to start server',
  );
  process.exit(1);
});
