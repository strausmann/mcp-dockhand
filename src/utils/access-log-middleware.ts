/**
 * Opens the request context and closes it with an access line.
 *
 * Registered ahead of the Host/Origin and bearer guards on purpose: a rejected
 * request is the one worth seeing. 401 on /mcp means someone is guessing the token,
 * 403 means a DNS-rebinding attempt. A middleware sitting after the guards would
 * observe neither.
 */

import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { formatAccessLine } from './access-log.js';
import { resolveClientIp, type TrustedProxies } from './client-ip.js';
import { runWithLogContext, type LogContext } from './log-context.js';

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function createAccessLogMiddleware(
  trusted: TrustedProxies,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): RequestHandler {
  return (req: Request, res: Response, next) => {
    // This object is the log context for the whole request (see runWithLogContext:
    // it is stored, not copied). The founding request of a session arrives without
    // an mcp-session-id header — the id does not exist yet — and server.ts backfills
    // it here via extendLogContext once the handshake produces one. Reading `context`
    // at emit time rather than a captured local is what puts that id on the access
    // line of the request that created the session.
    const context: LogContext = { req: randomUUID(), sid: header(req, 'mcp-session-id') };
    const startedAt = new Date();

    const ip = resolveClientIp({
      peer: req.socket?.remoteAddress,
      forwardedFor: header(req, 'x-forwarded-for'),
      realIp: header(req, 'x-real-ip'),
      trusted,
    });

    let written = false;
    const emit = (): void => {
      if (written) return;
      written = true;
      // res.writableFinished is the authoritative "the response completed" signal: true
      // only after 'finish'. A 'close' that fires without it is a client that hung up
      // mid-stream (routine for SSE), where res.statusCode is still its default 200 —
      // logging that as success would let a disconnect flood look like normal traffic to
      // CrowdSec. Report nginx's 499 (client closed connection) instead, which the nginx
      // parser understands.
      const status = res.writableFinished ? res.statusCode : 499;
      write(
        formatAccessLine({
          ip,
          time: startedAt,
          method: req.method,
          path: req.originalUrl ?? req.url,
          httpVersion: req.httpVersion,
          status,
          bytes: Number(res.getHeader('content-length') ?? 0),
          referer: header(req, 'referer'),
          userAgent: header(req, 'user-agent'),
          req: context.req,
          sid: context.sid,
        }),
      );
    };

    // 'finish' covers a completed response; 'close' catches a client that hung up
    // mid-stream (SSE deploys do that routinely). The guard keeps it at one line.
    res.on('finish', emit);
    res.on('close', emit);

    runWithLogContext(context, () => next());
  };
}
