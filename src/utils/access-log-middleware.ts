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
import { runWithLogContext } from './log-context.js';

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function createAccessLogMiddleware(
  trusted: TrustedProxies,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): RequestHandler {
  return (req: Request, res: Response, next) => {
    const requestId = randomUUID();
    const sessionId = header(req, 'mcp-session-id');
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
      write(
        formatAccessLine({
          ip,
          time: startedAt,
          method: req.method,
          path: req.originalUrl ?? req.url,
          httpVersion: req.httpVersion,
          status: res.statusCode,
          bytes: Number(res.getHeader('content-length') ?? 0),
          referer: header(req, 'referer'),
          userAgent: header(req, 'user-agent'),
          req: requestId,
          sid: sessionId,
        }),
      );
    };

    // 'finish' covers a completed response; 'close' catches a client that hung up
    // mid-stream (SSE deploys do that routinely). The guard keeps it at one line.
    res.on('finish', emit);
    res.on('close', emit);

    runWithLogContext({ req: requestId, sid: sessionId }, () => next());
  };
}
