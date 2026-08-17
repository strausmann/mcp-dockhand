/**
 * MCP Server setup with Streamable HTTP transport.
 *
 * Each stateful MCP session gets its own McpServer instance while all sessions
 * share a single DockhandClient (and its auth cookie). Session resource usage is
 * bounded through configurable inactivity cleanup and an optional LRU cap.
 */

import type { Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import type { Request, Response } from 'express';
import { DockhandClient } from './client/dockhand-client.js';
import { registerAllTools } from './tools/index.js';
import {
  createBearerAuthGuard,
  createHostOriginGuard,
  getTransportSecurityConfig,
  isHostOriginEnforcementActive,
} from './auth/transport-guard.js';
import {
  beginFoundingSession,
  completeFoundingSession,
  getSessionLifecycleConfig,
  removeSessionEntry,
  selectOldestIdleSession,
} from './session-lifecycle.js';
import type { DockhandConfig } from './types/dockhand.js';
import { logger } from './utils/logger.js';
import { createAccessLogMiddleware } from './utils/access-log-middleware.js';
import { parseTrustedProxies } from './utils/client-ip.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export interface ServerConfig {
  dockhand: DockhandConfig;
  port: number;
  host?: string;
}

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
  activeRequests: number;
}

function createMcpServer(client: DockhandClient): McpServer {
  const server = new McpServer({
    name: 'mcp-dockhand',
    version: pkg.version,
  });
  registerAllTools(server, client);
  return server;
}

export async function createServer(config: ServerConfig): Promise<HttpServer> {
  const client = new DockhandClient(config.dockhand);
  const lifecycle = getSessionLifecycleConfig();
  const security = getTransportSecurityConfig(config.port);
  const hostOriginEnforced = isHostOriginEnforcementActive(security);
  if (!hostOriginEnforced && !security.authToken) {
    logger.warn(
      { component: 'security' },
      '/mcp has no Host/Origin allowlist (MCP_ALLOWED_HOSTS) and no bearer token (MCP_AUTH_TOKEN) ' +
        'configured — it accepts requests from any reachable client with no checks at all. This is the ' +
        'compatible default; set MCP_ALLOWED_HOSTS (DNS-rebinding protection) and MCP_AUTH_TOKEN ' +
        '("Authorization: Bearer <token>") once this endpoint is reachable beyond loopback.',
    );
  }
  const app = express();
  app.use(express.json());

  const trustedProxies = parseTrustedProxies(process.env['TRUSTED_PROXIES']);
  for (const warning of trustedProxies.warnings) {
    logger.warn({ component: 'config' }, warning);
  }
  // Registered ahead of the Host/Origin and bearer guards below (deliberately —
  // see the comment at their registration) so a rejected request still produces
  // an access line: a 401 on /mcp means someone is guessing the token, a 403
  // means a DNS-rebinding attempt, and both are the lines an operator most wants.
  app.use(createAccessLogMiddleware(trustedProxies));

  const sessions = new Map<string, SessionEntry>();
  let pendingSessions = 0;
  let capacityGate: Promise<void> = Promise.resolve();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      server: 'mcp-dockhand',
      version: pkg.version,
      sessions: {
        active: sessions.size,
        pending: pendingSessions,
        max: lifecycle.maxSessions === 0 ? null : lifecycle.maxSessions,
        ttlSeconds: lifecycle.inactivityTimeoutMs / 1000,
        cleanupIntervalSeconds: lifecycle.cleanupIntervalMs / 1000,
      },
    });
  });

  async function removeSession(sessionId: string, reason: string): Promise<void> {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    await removeSessionEntry(sessions, sessionId, entry, reason);
  }

  async function handleExistingSession(
    entry: SessionEntry,
    req: Request,
    res: Response,
    body?: unknown,
  ): Promise<void> {
    entry.activeRequests += 1;
    entry.lastActivity = Date.now();
    try {
      await entry.transport.handleRequest(req, res, body);
    } finally {
      entry.activeRequests = Math.max(0, entry.activeRequests - 1);
      entry.lastActivity = Date.now();
    }
  }

  async function reserveSessionSlot(): Promise<boolean> {
    let releaseGate!: () => void;
    const previousGate = capacityGate;
    capacityGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    await previousGate;
    try {
      if (lifecycle.maxSessions !== 0 && sessions.size + pendingSessions >= lifecycle.maxSessions) {
        const candidate = selectOldestIdleSession(sessions);
        if (!candidate) return false;
        logger.warn(
          { component: 'session', sid: candidate, maxSessions: lifecycle.maxSessions },
          'capacity reached; evicting idle session',
        );
        await removeSession(candidate, 'capacity eviction');
      }

      if (lifecycle.maxSessions !== 0 && sessions.size + pendingSessions >= lifecycle.maxSessions) {
        return false;
      }

      pendingSessions += 1;
      return true;
    } finally {
      releaseGate();
    }
  }

  function releasePendingSessionSlot(): void {
    pendingSessions = Math.max(0, pendingSessions - 1);
  }

  const cleanupInterval = setInterval(() => {
    void (async () => {
      const now = Date.now();
      for (const [sessionId, entry] of sessions) {
        if (entry.activeRequests !== 0) continue;
        if (now - entry.lastActivity > lifecycle.inactivityTimeoutMs) {
          logger.info({ component: 'session', sid: sessionId }, 'session timed out after inactivity');
          await removeSession(sessionId, 'inactivity timeout');
        }
      }
    })();
  }, lifecycle.cleanupIntervalMs);
  cleanupInterval.unref();

  // DNS-rebinding protection (Host/Origin allowlist) and the opt-in bearer
  // token guard the whole /mcp surface (POST/GET/DELETE) — registered ahead
  // of the route handlers below so a rejected request never reaches session
  // lookup or the MCP SDK transport. See src/auth/transport-guard.ts.
  //
  // The Host/Origin guard is only *registered* when the operator opted in
  // (MCP_ALLOWED_HOSTS and/or MCP_ALLOWED_ORIGINS set): with neither set,
  // omitting the middleware entirely reproduces the pre-existing behavior
  // exactly, rather than relying on an always-registered guard that happens
  // to no-op on empty allowlists. createBearerAuthGuard is always
  // registered — it is already a no-op when no token is configured.
  if (hostOriginEnforced) {
    app.use('/mcp', createHostOriginGuard(security.allowedHosts, security.allowedOrigins));
  }
  app.use('/mcp', createBearerAuthGuard(security.authToken));

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId) {
        const entry = sessions.get(sessionId);
        if (!entry) {
          res.status(404).json({ error: 'Session not found or expired' });
          return;
        }
        await handleExistingSession(entry, req, res, req.body);
        return;
      }

      if (!(await reserveSessionSlot())) {
        res.setHeader('Retry-After', '1');
        res.status(503).json({ error: 'MCP session capacity reached; retry shortly' });
        return;
      }

      let initializedSessionId: string | undefined;
      let server: McpServer | undefined;
      let transport: StreamableHTTPServerTransport | undefined;
      try {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          // Defense-in-depth, mirroring the opt-in Express guard above: only
          // enabled when the operator actually configured an allowlist, so
          // an unconfigured deployment sees the SDK's own compatible
          // default (false) unchanged. The SDK marks these transport-level
          // options @deprecated in favor of external middleware, but
          // passing them costs nothing and covers any future call path that
          // bypasses the Express middleware chain.
          enableDnsRebindingProtection: hostOriginEnforced,
          allowedHosts: security.allowedHosts,
          allowedOrigins: security.allowedOrigins,
          onsessioninitialized: (id) => {
            initializedSessionId = id;
            // Mark the session busy (activeRequests: 1) immediately: the
            // founding transport.handleRequest(...) call below is still in
            // flight for this very session, and until it resolves the
            // session must not be a candidate for capacity eviction (see
            // selectOldestIdleSession / reserveSessionSlot).
            beginFoundingSession(sessions, id, { server: server!, transport: transport! });
            logger.info({ component: 'session', sid: id, active: sessions.size }, 'session created');
          },
        });

        transport.onclose = () => {
          const sid = [...sessions.entries()].find(([, entry]) => entry.transport === transport)?.[0];
          if (sid) {
            sessions.delete(sid);
            logger.info({ component: 'session', sid, active: sessions.size }, 'session transport closed');
          }
        };

        server = createMcpServer(client);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        // The founding request has now been fully served; release the busy
        // marker so normal idle-eviction/inactivity-timeout accounting takes
        // back over for this session.
        if (initializedSessionId) {
          completeFoundingSession(sessions, initializedSessionId);
        }
      } catch (error) {
        if (initializedSessionId) {
          await removeSession(initializedSessionId, 'initialization failure');
        } else if (server) {
          try {
            await server.close();
          } catch {
            // Best-effort cleanup for a failed initialization.
          }
        }
        throw error;
      } finally {
        releasePendingSessionSlot();
      }
    } catch (error) {
      logger.error({ component: 'server', err: error }, 'error handling MCP request');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }
    const entry = sessions.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }
    await handleExistingSession(entry, req, res);
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session ID' });
      return;
    }
    const entry = sessions.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    await handleExistingSession(entry, req, res);
    // Use the entry captured above rather than removeSession(sessionId, ...)
    // (which would re-look-up via sessions.get(sessionId)): the SDK's own
    // DELETE handling inside handleExistingSession() calls
    // transport.close() internally, firing transport.onclose, which already
    // deletes the map entry before we get here. A lookup-based removal would
    // then silently no-op and skip server.close() + the removal log.
    await removeSessionEntry(sessions, sessionId, entry, 'client delete');
  });

  const host = config.host || '0.0.0.0';
  return await new Promise<HttpServer>((resolve) => {
    const httpServer = app.listen(config.port, host, () => {
      logger.info(
        {
          component: 'server',
          version: pkg.version,
          host,
          port: config.port,
          dockhandUrl: config.dockhand.url,
          health: `http://localhost:${config.port}/health`,
          mcp: `http://localhost:${config.port}/mcp`,
          logLevel: logger.level,
          trustedProxies: trustedProxies.isEmpty ? 'none' : 'configured',
        },
        'MCP Dockhand server listening',
      );
      logger.info(
        {
          component: 'session',
          ttlSeconds: lifecycle.inactivityTimeoutMs / 1000,
          cleanupIntervalSeconds: lifecycle.cleanupIntervalMs / 1000,
          maxSessions: lifecycle.maxSessions === 0 ? 'unlimited' : lifecycle.maxSessions,
        },
        'session lifecycle configured',
      );
      resolve(httpServer);
    });
  });
}
