import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { createServer } from '../src/server.js';
import type { ServerConfig } from '../src/server.js';

// End-to-end regression tests for the HIGH finding: the /mcp Streamable-HTTP
// endpoint had no authentication and no DNS-rebinding/Origin protection, and
// bound 0.0.0.0 by default -- an unauthenticated POST /mcp with a spoofed
// Host/Origin returned 200 + a session id and the full ~298-tool surface.
//
// Design decision (operator, post-fix review): Host/Origin enforcement and
// the bearer token are BOTH opt-in, off by default. Enforcing either by
// default would reject every already-deployed remote/reverse-proxied client
// whose Host header isn't `localhost`/`127.0.0.1` -- a breaking change on a
// routine update. So the default-config tests below assert the OLD
// (unprotected) behavior is preserved byte-for-byte, and the opt-in tests
// assert protection actually engages once MCP_ALLOWED_HOSTS/
// MCP_ALLOWED_ORIGINS/MCP_AUTH_TOKEN are set.
//
// These tests exercise the real Express app end-to-end (no mocked req/res),
// on a fixed loopback port, so they fail exactly the way the audit's dynamic
// reproduction did if the guards regress. Dummy Dockhand credentials are
// enough: the MCP `initialize` handshake never calls the Dockhand backend.

const TEST_PORT = 48213;

const DUMMY_DOCKHAND: ServerConfig['dockhand'] = {
  url: 'http://dockhand.invalid',
  username: 'dummy',
  password: 'dummy',
};

interface RawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function rawRequest(
  port: number,
  options: { method: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: options.path ?? '/mcp',
        method: options.method,
        // Force a fresh connection per request and have the server close
        // it once the response is sent — avoids keep-alive sockets from one
        // test leaking into the next test's server instance on the same
        // fixed test port (both are on 127.0.0.1:TEST_PORT sequentially).
        headers: { Connection: 'close', ...options.headers },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function initializeBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0' },
    },
  });
}

function initializeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Host: `127.0.0.1:${TEST_PORT}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...extra,
  };
}

let httpServer: HttpServer | undefined;

async function startServer(config: Partial<ServerConfig> = {}): Promise<void> {
  httpServer = await createServer({
    dockhand: DUMMY_DOCKHAND,
    port: TEST_PORT,
    host: '127.0.0.1',
    ...config,
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = undefined;
  }
});

describe('/mcp Host/Origin allowlist (opt-in DNS-rebinding protection, default OFF)', () => {
  it('(a) default, no MCP_ALLOWED_HOSTS/MCP_ALLOWED_ORIGINS: a spoofed Host+Origin is NOT rejected -- preserves the old behavior', async () => {
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Host: 'evil.attacker.example', Origin: 'https://evil.attacker.example' }),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['mcp-session-id']).toBeDefined();
  });

  it('(a) default: GET and DELETE /mcp with an arbitrary Host header are also not rejected by a Host guard', async () => {
    await startServer();

    const getRes = await rawRequest(TEST_PORT, {
      method: 'GET',
      headers: { Host: 'evil.attacker.example' },
    });
    // No session id -> SDK itself returns 400 "Missing session ID", not a
    // guard-level 403. That 400 (not 403) is the proof no Host guard ran.
    expect(getRes.statusCode).not.toBe(403);

    const deleteRes = await rawRequest(TEST_PORT, {
      method: 'DELETE',
      headers: { Host: 'evil.attacker.example', 'mcp-session-id': 'nonexistent' },
    });
    expect(deleteRes.statusCode).not.toBe(403);
  });

  it('(b) MCP_ALLOWED_HOSTS set: rejects a disallowed/spoofed Host header (403) -- the audit repro, once opted in', async () => {
    vi.stubEnv('MCP_ALLOWED_HOSTS', `127.0.0.1:${TEST_PORT}`);
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Host: 'evil.attacker.example', Origin: 'https://evil.attacker.example' }),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers['mcp-session-id']).toBeUndefined();
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('Invalid Host header') });
  });

  it('(b) MCP_ALLOWED_HOSTS set: allows the request and issues a session id for an allowlisted host:port', async () => {
    vi.stubEnv('MCP_ALLOWED_HOSTS', `127.0.0.1:${TEST_PORT}`);
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders(),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['mcp-session-id']).toBeDefined();
  });

  it('MCP_ALLOWED_HOSTS set: applies the Host guard to GET and DELETE too, not just POST', async () => {
    vi.stubEnv('MCP_ALLOWED_HOSTS', `127.0.0.1:${TEST_PORT}`);
    await startServer();

    const getRes = await rawRequest(TEST_PORT, { method: 'GET', headers: { Host: 'evil.attacker.example' } });
    expect(getRes.statusCode).toBe(403);

    const deleteRes = await rawRequest(TEST_PORT, {
      method: 'DELETE',
      headers: { Host: 'evil.attacker.example', 'mcp-session-id': 'nonexistent' },
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it('MCP_ALLOWED_ORIGINS set (MCP_ALLOWED_HOSTS unset): rejects a disallowed Origin header even though Host is unchecked', async () => {
    vi.stubEnv('MCP_ALLOWED_ORIGINS', 'https://good.example');
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Host: 'anything-goes.example', Origin: 'https://evil.example' }),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.stringContaining('Invalid Origin header') });
  });

  it('honors an explicit MCP_ALLOWED_HOSTS allowlist for a non-default hostname (e.g. behind a proxy)', async () => {
    vi.stubEnv('MCP_ALLOWED_HOSTS', 'dock-mcp.example.internal');
    await startServer();

    const rejected = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Host: `127.0.0.1:${TEST_PORT}` }),
      body: initializeBody(),
    });
    expect(rejected.statusCode).toBe(403);

    const allowed = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Host: 'dock-mcp.example.internal' }),
      body: initializeBody(),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['mcp-session-id']).toBeDefined();
  });
});

describe('/mcp opt-in bearer authentication', () => {
  it('(c) with no MCP_AUTH_TOKEN configured: requests still work (backward-compatible)', async () => {
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders(),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['mcp-session-id']).toBeDefined();
  });

  it('with neither MCP_ALLOWED_HOSTS nor MCP_AUTH_TOKEN configured: emits a startup warning that /mcp is unauthenticated and host-unchecked', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startServer();

    const allOutput = errorSpy.mock.calls.map((call) => String(call.join(' '))).join('\n');
    expect(allOutput).toContain('WARNING');
    expect(allOutput).toContain('MCP_ALLOWED_HOSTS');
    expect(allOutput).toContain('MCP_AUTH_TOKEN');
  });

  it('with MCP_ALLOWED_HOSTS configured (but no token): does NOT emit the "no protection at all" warning', async () => {
    vi.stubEnv('MCP_ALLOWED_HOSTS', `127.0.0.1:${TEST_PORT}`);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startServer();

    const messages = errorSpy.mock.calls.map((call) => String(call.join(' ')));
    expect(messages.some((msg) => msg.includes('WARNING'))).toBe(false);
  });

  it('(c) with MCP_AUTH_TOKEN configured: a request with no Authorization header is rejected (401)', async () => {
    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders(),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'unauthorized' });
  });

  it('(c) with MCP_AUTH_TOKEN configured: a request with the wrong bearer token is rejected (401)', async () => {
    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Authorization: 'Bearer wrong-token' }),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(401);
  });

  it('(c) with MCP_AUTH_TOKEN configured: a bearer token of a different length is rejected (401, no throw / no crash)', async () => {
    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Authorization: 'Bearer short' }),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(401);
  });

  it('(c) with MCP_AUTH_TOKEN configured: a request with the correct bearer token succeeds', async () => {
    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    await startServer();

    const res = await rawRequest(TEST_PORT, {
      method: 'POST',
      headers: initializeHeaders({ Authorization: 'Bearer top-secret-token' }),
      body: initializeBody(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['mcp-session-id']).toBeDefined();
  });

  it('does not gate /health behind the bearer token (unchanged behavior)', async () => {
    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    await startServer();

    const res = await rawRequest(TEST_PORT, { method: 'GET', path: '/health', headers: {} });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok' });
  });
});
