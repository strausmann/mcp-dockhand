/**
 * MCP Dockhand Server - Entry Point
 *
 * Exposes 130+ Dockhand Docker Management API endpoints as MCP tools
 * via Streamable HTTP transport.
 */

import { createServer } from './server.js';
import { parseApiToken } from './auth/api-token.js';
import { logger, logFatalSync, describeThrown } from './utils/logger.js';
import { buildToolPolicy, configureToolPolicy, ToolPolicyError } from './utils/tool-policy.js';
import { TOOL_ENDPOINT_MAP } from './openapi/tool-endpoint-map.js';
import { META_TOOL_NAMES } from './utils/meta-tool-names.js';

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

// DOCKHAND_API_TOKEN selects token auth and makes the username/password pair
// unnecessary. Only one mode is read: a set token wins, and the session
// variables are then not even required to be present.
//
// The value is validated before use (see src/auth/api-token.ts): a malformed token
// would otherwise fail every request with 401, and one with an embedded line break
// makes fetch() throw an error that quotes the whole header, token included.
const parsedToken = parseApiToken(process.env['DOCKHAND_API_TOKEN']);
if (parsedToken.error) {
  logFatalSync({ component: 'config', variable: 'DOCKHAND_API_TOKEN' }, parsedToken.error);
  process.exit(1);
}
const apiToken = parsedToken.token;
if (apiToken && (process.env['DOCKHAND_USERNAME'] || process.env['DOCKHAND_PASSWORD'])) {
  logger.warn(
    { component: 'config' },
    'DOCKHAND_API_TOKEN is set, so DOCKHAND_USERNAME/DOCKHAND_PASSWORD are ignored',
  );
}

const config = {
  dockhand: apiToken
    ? {
        url: getEnvOrThrow('DOCKHAND_URL'),
        apiToken,
      }
    : {
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
    // The mode, not the credential: username is absent in token mode, and the
    // token value itself must never reach the log.
    auth: apiToken ? 'api-token' : 'session',
    dockhandUser: config.dockhand.username,
    port: config.port,
  },
  'starting MCP Dockhand server',
);

// MCP_READ_ONLY / MCP_TOOLS_ALLOW / MCP_TOOLS_DENY (issue #254). Built and configured
// right before createServer() so every registerTool() call sees the final policy. A bad value
// or a pattern matching no tool is fatal: failing open would expose write tools the
// operator meant to hide.
try {
  const policy = buildToolPolicy(process.env, {
    endpointMap: TOOL_ENDPOINT_MAP,
    metaToolNames: META_TOOL_NAMES,
  });
  configureToolPolicy(policy);
  const { readOnly, registered, total, readmittedWriteTools } = policy.summary;
  logger.info({ component: 'tools', readOnly, registered, total }, 'tool policy');
  if (readmittedWriteTools.length > 0) {
    logger.warn(
      { component: 'tools', tools: readmittedWriteTools },
      'write tools re-admitted under MCP_READ_ONLY via exact MCP_TOOLS_ALLOW names',
    );
  }
} catch (error) {
  if (error instanceof ToolPolicyError) {
    logFatalSync({ component: 'config' }, error.message);
    process.exit(1);
  }
  throw error;
}

createServer(config).catch((error: unknown) => {
  logFatalSync(
    { component: 'server', ...describeThrown(error) },
    'failed to start server',
  );
  process.exit(1);
});
