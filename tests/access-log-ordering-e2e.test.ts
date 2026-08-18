import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { createServer } from '../src/server.js';
import type { ServerConfig } from '../src/server.js';

// Regression test for the registration order in src/server.ts: the access-log
// middleware MUST run before the Host/Origin and bearer guards. That ordering is
// the whole point of the task that introduced it (see the comment at its
// registration) and fails SILENTLY if it regresses -- a middleware registered
// after the guards would still return the correct 401, but no access line would
// ever be written for it, and nothing here would go red without this test. The
// middleware's own unit tests (access-log-middleware.test.ts) never touch
// server.ts's registration order at all.
//
// This exercises the real Express app end-to-end (no mocked req/res), on a fixed
// loopback port, the same pattern as tests/transport-security-e2e.test.ts.

const TEST_PORT = 48299;

const DUMMY_DOCKHAND: ServerConfig['dockhand'] = {
  url: 'http://dockhand.invalid',
  username: 'dummy',
  password: 'dummy',
};

let httpServer: HttpServer | undefined;

function postToMcp(port: number, body = '{}'): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        agent: false,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end(body);
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

describe('access-log middleware ordering (regression)', () => {
  it('writes an access line for a bearer-guard 401 rejection', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    const res = await postToMcp(TEST_PORT);
    spy.mockRestore();

    expect(res.statusCode).toBe(401);
    const accessLines = written.filter((line) => line.includes('"POST /mcp HTTP/1.1" 401'));
    expect(accessLines.length).toBeGreaterThan(0);
  });

  // The bearer-guard case above only pins the access log against the two guards. It
  // says nothing about express.json(), which sits earlier in the chain and rejects a
  // malformed body by calling next(err) -- that skips every non-error middleware, so
  // an access-log middleware registered after the body parser never even gets to
  // attach its res.on('finish') handler and writes NOTHING for the request. The 400
  // still goes out, so this fails silently in exactly the way the test above was
  // written to prevent, and the suite is green with the body parser on either side
  // of the access log until this test exists.
  it('writes an access line for a body-parser 400 rejection', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    const res = await postToMcp(TEST_PORT, '{bad:1}');
    spy.mockRestore();

    expect(res.statusCode).toBe(400);
    const accessLines = written.filter((line) => line.includes('"POST /mcp HTTP/1.1" 400'));
    expect(accessLines.length).toBeGreaterThan(0);
  });
});
