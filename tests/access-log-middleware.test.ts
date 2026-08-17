/**
 * The middleware has to sit BEFORE the Host/Origin and bearer guards. A rejected
 * request is the one an operator most wants to see — 401 means someone is guessing
 * the token, 403 means a DNS-rebinding attempt — and a middleware registered after
 * the guards would never run for either.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createAccessLogMiddleware } from '../src/utils/access-log-middleware.js';
import { parseTrustedProxies } from '../src/utils/client-ip.js';
import { currentLogContext } from '../src/utils/log-context.js';

function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    originalUrl: '/mcp',
    httpVersion: '1.1',
    headers: {},
    socket: { remoteAddress: '203.0.113.9' },
    ...overrides,
  } as never;
}

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    getHeader: (name: string) => unknown;
  };
  res.statusCode = 200;
  res.getHeader = () => undefined;
  return res;
}

describe('access log middleware', () => {
  it('writes one line when the response finishes', () => {
    const lines: string[] = [];
    const middleware = createAccessLogMiddleware(parseTrustedProxies(undefined), (l) => lines.push(l));
    const res = fakeRes();

    middleware(fakeReq(), res as never, () => {});
    expect(lines).toHaveLength(0); // nothing yet — the status is not known until the end

    res.statusCode = 401;
    res.emit('finish');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('203.0.113.9');
    expect(lines[0]).toContain('"POST /mcp HTTP/1.1" 401');
  });

  it('establishes a request context the rest of the call can see', () => {
    const middleware = createAccessLogMiddleware(parseTrustedProxies(undefined), () => {});
    let seen: ReturnType<typeof currentLogContext> | undefined;

    middleware(fakeReq({ headers: { 'mcp-session-id': 'sess-1' } }), fakeRes() as never, () => {
      seen = currentLogContext();
    });

    expect(seen?.sid).toBe('sess-1');
    expect(seen?.req).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('puts the same request id on the access line and in the context', () => {
    const lines: string[] = [];
    const middleware = createAccessLogMiddleware(parseTrustedProxies(undefined), (l) => lines.push(l));
    const res = fakeRes();
    let contextReq = '';

    middleware(fakeReq(), res as never, () => {
      contextReq = currentLogContext().req ?? '';
    });
    res.emit('finish');

    expect(contextReq).not.toBe('');
    expect(lines[0]).toContain(`req=${contextReq}`);
  });

  it('honours a forwarding header from a trusted peer', () => {
    const lines: string[] = [];
    const middleware = createAccessLogMiddleware(parseTrustedProxies('10.0.0.0/8'), (l) => lines.push(l));
    const res = fakeRes();

    middleware(
      fakeReq({
        socket: { remoteAddress: '10.0.0.5' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      }),
      res as never,
      () => {},
    );
    res.emit('finish');

    expect(lines[0].startsWith('203.0.113.9 ')).toBe(true);
  });

  it('writes exactly one line even if the socket also closes', () => {
    const lines: string[] = [];
    const middleware = createAccessLogMiddleware(parseTrustedProxies(undefined), (l) => lines.push(l));
    const res = fakeRes();

    middleware(fakeReq(), res as never, () => {});
    res.emit('finish');
    res.emit('close');

    expect(lines).toHaveLength(1);
  });
});
