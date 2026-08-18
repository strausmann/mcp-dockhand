/**
 * MCP Dockhand Server - Entry Point
 *
 * Exposes 130+ Dockhand Docker Management API endpoints as MCP tools
 * via Streamable HTTP transport.
 */

import { createServer } from './server.js';
import { logger, logFatalSync } from './utils/logger.js';

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
  // `throw 'oops'` are all legal — the `Error` type Node's own typings claim here
  // is a lie. Reading `.name` on a non-Error would throw a second TypeError inside
  // this very handler and Node would exit with code 7 before anything is logged,
  // burying the original failure. Normalize exactly as the rejection handler below.
  logFatalSync(
    {
      component: 'process',
      errType: error instanceof Error ? error.name : typeof error,
      errMessage: error instanceof Error ? error.message : String(error),
    },
    'uncaught exception',
  );
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logFatalSync(
    {
      component: 'process',
      errType: reason instanceof Error ? reason.name : typeof reason,
      errMessage: reason instanceof Error ? reason.message : String(reason),
    },
    'unhandled rejection',
  );
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
    {
      component: 'server',
      errType: error instanceof Error ? error.name : typeof error,
      errMessage: error instanceof Error ? error.message : String(error),
    },
    'failed to start server',
  );
  process.exit(1);
});
