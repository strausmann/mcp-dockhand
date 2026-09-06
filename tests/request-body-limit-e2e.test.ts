import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { createServer } from '../src/server.js';
import type { ServerConfig } from '../src/server.js';

// Regression test for the `limit` option server.ts now passes to express.json():
// without it, Express's own 100 KB default silently rejected `load_image`'s
// base64-encoded tar body with HTTP 413 (Codex, PR #251, P1). This exercises the
// REAL Express app end-to-end (no mocked req/res, same pattern as
// tests/access-log-ordering-e2e.test.ts) to prove the configured `MCP_MAX_REQUEST_
// BODY_BYTES` value is actually wired into express.json()'s `limit` option — a unit
// test of request-body-limit.ts's config parsing alone cannot show that the value
// ever reaches express.json() at all.

const TEST_PORT = 48311;

const DUMMY_DOCKHAND: ServerConfig['dockhand'] = {
  url: 'http://dockhand.invalid',
  username: 'dummy',
  password: 'dummy',
};

let httpServer: HttpServer | undefined;

/** A syntactically valid JSON object body of roughly the given size in bytes. */
function jsonBodyOfSize(bytes: number): string {
  const prefix = '{"padding":"';
  const suffix = '"}';
  const padLength = Math.max(0, bytes - prefix.length - suffix.length);
  return prefix + 'x'.repeat(padLength) + suffix;
}

function postToMcp(port: number, body: string): Promise<{ statusCode: number }> {
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
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = undefined;
  }
});

describe('request body size limit (regression)', () => {
  it('accepts a body larger than Express\'s 100 KB default when no override is set (100 MB default applies)', async () => {
    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    // 150 KB — bigger than Express's own 100 KB default, comfortably under our 100 MB
    // default. A valid-but-unrelated MCP body like this fails MCP-protocol validation
    // (not a 200), but the point here is specifically that it must NOT be a 413 — that
    // would mean express.json() is still using the 100 KB default, i.e. the limit
    // option was never wired through.
    const res = await postToMcp(TEST_PORT, jsonBodyOfSize(150 * 1024));

    expect(res.statusCode).not.toBe(413);
  });

  it('applies a configured MCP_MAX_REQUEST_BODY_BYTES override — a body just over it is rejected with 413', async () => {
    vi.stubEnv('MCP_MAX_REQUEST_BODY_BYTES', '1024');
    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    // 5 KB body, well over the configured 1 KB limit and well under both Express's own
    // 100 KB default and our 100 MB default — only rejected if the configured value
    // actually reached express.json()'s `limit` option.
    const res = await postToMcp(TEST_PORT, jsonBodyOfSize(5 * 1024));

    expect(res.statusCode).toBe(413);
  });

  it('accepts a body under a configured MCP_MAX_REQUEST_BODY_BYTES override', async () => {
    vi.stubEnv('MCP_MAX_REQUEST_BODY_BYTES', '1048576'); // 1 MB
    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    const res = await postToMcp(TEST_PORT, jsonBodyOfSize(5 * 1024));

    expect(res.statusCode).not.toBe(413);
  });
});
