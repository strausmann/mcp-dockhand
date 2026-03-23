/**
 * MCP Dockhand Server - Entry Point
 *
 * Exposes 130+ Dockhand Docker Management API endpoints as MCP tools
 * via Streamable HTTP transport.
 */

import { createServer } from './server.js';

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] ERROR: Environment variable ${name} is required but not set.`);
    console.error('[config] Copy .env.example to .env and fill in your Dockhand credentials.');
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

console.error('[config] Starting MCP Dockhand server...');
console.error(`[config] Dockhand URL: ${config.dockhand.url}`);
console.error(`[config] Dockhand User: ${config.dockhand.username}`);
console.error(`[config] MCP Port: ${config.port}`);

createServer(config).catch((error) => {
  console.error('[fatal] Failed to start server:', error);
  process.exit(1);
});
