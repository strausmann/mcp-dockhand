/**
 * MCP Dockhand Server - Entry Point
 *
 * Exposes 130+ Dockhand Docker Management API endpoints as MCP tools
 * via Streamable HTTP transport.
 */

import { createServer } from './server.js';
import { logger } from './utils/logger.js';

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error(
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
  logger.error({ component: 'server', err: error }, 'failed to start server');
  process.exit(1);
});
