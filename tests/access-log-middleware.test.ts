/**
 * The middleware has to sit BEFORE the Host/Origin and bearer guards. A rejected
 * request is the one an operator most wants to see — 401 means someone is guessing
 * the token, 403 means a DNS-rebinding attempt — and a middleware registered after
 * the guards would never run for either.
 */
import { describe, it, expect, vi } from 'vitest';
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
    writableFinished: boolean;
    getHeader: (name: string) => unknown;
  };
  res.statusCode = 200;
  // Node sets writableFinished true before it emits 'finish'; mirror that so a plain
  // res.emit('finish') in a test reflects a completed response, while a 'close' without
  // a prior 'finish' leaves it false — the aborted case.
  res.writableFinished = false;
  const rawEmit = res.emit.bind(res);
  res.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (event === 'finish') res.writableFinished = true;
    return rawEmit(event, ...args);
  }) as typeof res.emit;
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

  it('stamps the line with the emit time, not the request start time', () => {
    // A long-lived SSE stream is written on close, minutes after it began. CrowdSec
    // reads this timestamp for its time-windowed scenarios, so it must be the emit
    // time. Codex #209.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-18T05:00:00Z'));
      const lines: string[] = [];
      const middleware = createAccessLogMiddleware(parseTrustedProxies(undefined), (l) => lines.push(l));
      const res = fakeRes();

      middleware(fakeReq(), res as never, () => {});
      vi.setSystemTime(new Date('2026-08-18T05:07:00Z')); // seven minutes later
      res.emit('finish');

      expect(lines[0]).toContain('[18/Aug/2026:05:07:00 +0000]');
      expect(lines[0]).not.toContain('05:00:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs an aborted mid-stream close as 499, not as the default 200', () => {
    // A client hanging up before the response finishes fires 'close' without 'finish',
    // and res.statusCode is still 200. Logging that as success would let a disconnect
    // flood look like normal traffic to CrowdSec. Codex #209.
    const lines: string[] = [];
    const middleware = createAccessLogMiddleware(parseTrustedProxies(undefined), (l) => lines.push(l));
    const res = fakeRes();

    middleware(fakeReq(), res as never, () => {});
    res.emit('close'); // no prior 'finish' -> aborted

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"POST /mcp HTTP/1.1" 499');
  });

  it('keeps the real status when the response finished, even if close follows', () => {
    const lines: string[] = [];
    const middleware = createAccessLogMiddleware(parseTrustedProxies(undefined), (l) => lines.push(l));
    const res = fakeRes();

    middleware(fakeReq(), res as never, () => {});
    res.statusCode = 200;
    res.emit('finish');
    res.emit('close');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"POST /mcp HTTP/1.1" 200');
    expect(lines[0]).not.toContain(' 499');
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
