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

function postToMcp(
  port: number,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close', ...extraHeaders },
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

// Regression test for a SECOND, more serious finding in the same review round
// (Codex, PR #251, P1, SECURITY): express.json({ limit: <large> }) used to be
// registered globally, ahead of both the Host/Origin guard and the bearer-auth
// guard (which are mounted on '/mcp' further down in server.ts). Because
// express.json() fully buffers the request body before calling next() — and
// next() is what invokes the next middleware, i.e. the guard — an
// UNAUTHENTICATED caller with no valid bearer token could still make this
// process buffer up to the full configured limit (100 MB by default) of
// request body before the bearer guard ever got a chance to reject the
// request. A caller with no credentials at all could repeat that against
// every reachable connection and exhaust memory: a DoS available to anyone
// who can reach the port, entirely defeating the point of MCP_AUTH_TOKEN.
//
// Fix: express.json() is now mounted on '/mcp' AFTER both guards (server.ts).
// Both guards read only headers (Host, Origin, Authorization) — never the
// body — so an unauthenticated request is rejected by the bearer guard
// before a single byte of the body is parsed/buffered.
describe('unauthenticated large body is rejected before it is ever buffered (P1 regression)', () => {
  it('an unauthenticated oversized POST gets 401, never 413 — proof the bearer guard ran BEFORE the body was parsed', async () => {
    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    // Deliberately tiny — if express.json() ran before the guard (the pre-fix
    // ordering), a body this large would be rejected by the body parser itself
    // with 413, and the guard's 401 would never be reached/observed at all.
    vi.stubEnv('MCP_MAX_REQUEST_BODY_BYTES', '1024');
    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    // 5 KB, well over the configured 1 KB limit, sent with NO Authorization header.
    const res = await postToMcp(TEST_PORT, jsonBodyOfSize(5 * 1024));

    // 401 (unauthorized), NOT 413 (payload too large): the bearer guard rejected
    // this purely on the missing/invalid Authorization header, before express.json
    // ever ran — so the oversized body was never buffered in the first place.
    expect(res.statusCode).toBe(401);
  });

  it('GEGENVERSUCH: the SAME oversized body with the correct bearer token still hits the 413 body-size limit', async () => {
    // This is the control for the test above: it proves the 1 KB limit still
    // applies once a request actually gets past the guard (i.e. the fix did not
    // simply stop enforcing the body limit at all) — the ONLY thing that
    // changed is the ORDER guard-vs-parser runs in for an unauthenticated caller.
    vi.stubEnv('MCP_AUTH_TOKEN', 'top-secret-token');
    vi.stubEnv('MCP_MAX_REQUEST_BODY_BYTES', '1024');
    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    const res = await postToMcp(TEST_PORT, jsonBodyOfSize(5 * 1024), {
      Authorization: 'Bearer top-secret-token',
    });

    expect(res.statusCode).toBe(413);
  });

  it('with no MCP_AUTH_TOKEN configured (opt-in auth off): an oversized POST still hits 413 — unchanged default behavior', async () => {
    // With auth left off (the compatible default), the bearer guard is a no-op
    // and every request reaches express.json() same as before this fix — this
    // guards against the reorder accidentally changing the unauthenticated-by-
    // design default configuration's behavior.
    vi.stubEnv('MCP_MAX_REQUEST_BODY_BYTES', '1024');
    httpServer = await createServer({ dockhand: DUMMY_DOCKHAND, port: TEST_PORT, host: '127.0.0.1' });

    const res = await postToMcp(TEST_PORT, jsonBodyOfSize(5 * 1024));

    expect(res.statusCode).toBe(413);
  });
});
