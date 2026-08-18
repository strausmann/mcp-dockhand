/**
 * The request that CREATES a session is the one request that cannot carry an
 * mcp-session-id header — the id does not exist yet when the header would have been
 * sent. Its access line therefore read `sid=-`, and it is the single most interesting
 * line in the session's life: everything the client does afterwards is joinable by
 * sid, except the handshake that started it.
 *
 * The id is known by the time the line is written (the access line goes out on
 * 'finish', long after onsessioninitialized has run), so the fix is to backfill the
 * request context there. This exercises the real Express app end to end with a real
 * MCP initialize, the same pattern as tests/access-log-ordering-e2e.test.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { createServer } from '../src/server.js';
import type { ServerConfig } from '../src/server.js';

const TEST_PORT = 48301;

const DUMMY_DOCKHAND: ServerConfig['dockhand'] = {
  url: 'http://dockhand.invalid',
  username: 'dummy',
  password: 'dummy',
};

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'access-log-correlation-test', version: '1.0.0' },
  },
});

let httpServer: HttpServer | undefined;

function initializeSession(port: number): Promise<{ statusCode: number; sessionId?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Both types: the transport refuses a POST that cannot accept an SSE reply.
          Accept: 'application/json, text/event-stream',
          Connection: 'close',
        },
        agent: false,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            sessionId: res.headers['mcp-session-id'] as string | undefined,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(INITIALIZE);
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = undefined;
  }
});

describe('founding request correlation', () => {
  it('writes the created session id on the access line of the request that created it', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });
    const res = await initializeSession(TEST_PORT);
    spy.mockRestore();

    expect(res.statusCode).toBe(200);
    expect(res.sessionId).toBeTruthy();

    const accessLine = written.find((line) => line.includes('"POST /mcp HTTP/1.1" 200'));
    expect(accessLine).toBeDefined();
    // Against the id the server actually handed back, not merely "something that is
    // not a dash": a wrong id would be worse than none.
    expect(accessLine).toContain(`sid=${res.sessionId}`);
  });
});
