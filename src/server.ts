/**
 * MCP Server setup with Streamable HTTP transport.
 */

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import type { Request, Response } from 'express';
import { DockhandClient } from './client/dockhand-client.js';
import { registerAllTools } from './tools/index.js';
import type { DockhandConfig } from './types/dockhand.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export interface ServerConfig {
  dockhand: DockhandConfig;
  port: number;
  host?: string;
}

export async function createServer(config: ServerConfig): Promise<void> {
  const client = new DockhandClient(config.dockhand);

  const server = new McpServer({
    name: 'mcp-dockhand',
    version: pkg.version,
  });

  registerAllTools(server, client);

  const app = express();

  // Parse JSON request bodies (required for MCP Streamable HTTP)
  app.use(express.json());

  // Health endpoint (no auth required)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', server: 'mcp-dockhand', version: pkg.version });
  });

  // Store transports by session ID for session management
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // MCP Streamable HTTP endpoint
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });

        transport.onclose = () => {
          const sid = [...transports.entries()].find(([, t]) => t === transport)?.[0];
          if (sid) transports.delete(sid);
        };

        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[server] Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // Handle GET for SSE streams (session-based)
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // Handle DELETE for session cleanup
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
  });

  const host = config.host || '0.0.0.0';
  app.listen(config.port, host, () => {
    console.error(`[server] MCP Dockhand server v${pkg.version} listening on ${host}:${config.port}`);
    console.error(`[server] Dockhand URL: ${config.dockhand.url}`);
    console.error(`[server] Health: http://localhost:${config.port}/health`);
    console.error(`[server] MCP endpoint: http://localhost:${config.port}/mcp`);
  });
}
