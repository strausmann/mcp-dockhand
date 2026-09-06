/**
 * Transport-level access control for the /mcp Streamable HTTP endpoint.
 *
 * Two independent, **both opt-in** layers:
 *  - Host/Origin allowlisting (DNS-rebinding protection). Implemented as our
 *    own Express middleware rather than the MCP SDK's transport-level
 *    `enableDnsRebindingProtection`/`allowedHosts`/`allowedOrigins` options,
 *    which the SDK itself marks `@deprecated` in favor of exactly this
 *    pattern (see `@modelcontextprotocol/sdk` server/webStandardStreamableHttp.d.ts).
 *    `server.ts` still passes the same allowlists to the transport too, as
 *    cheap defense-in-depth, but this middleware is the primary, tested
 *    enforcement point and runs first.
 *  - A shared-secret bearer token, checked in constant time.
 *
 * Both are opt-in and OFF by default: with neither `MCP_ALLOWED_HOSTS` nor
 * `MCP_ALLOWED_ORIGINS` set, no Host/Origin check runs at all (and the guard
 * middleware isn't even registered — see server.ts); with `MCP_AUTH_TOKEN`
 * unset, no bearer check runs. This is a deliberate compatibility decision:
 * enabling either by default would reject every existing remote/reverse-
 * proxied deployment whose client doesn't send a `localhost`/`127.0.0.1`
 * Host header, breaking them on update. Operators opt in explicitly once the
 * endpoint is reachable beyond their own loopback — see the README section
 * "Securing the transport".
 *
 * Security note: the DNS-rebinding scenario the Host/Origin layer guards
 * against is a browser page that gets its own hostname rebound (low-TTL DNS)
 * to the server's loopback/LAN address. Because the browser still considers
 * the request same-origin as the page (the URL string is unchanged), it
 * sends the request with the *rebound* Host header (e.g.
 * `attacker.example:8080`) but often without any Origin header for a
 * same-origin request. Host validation therefore has to be the primary
 * check; Origin validation is complementary and only enforced when the
 * caller actually sends an Origin header.
 */

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface TransportSecurityConfig {
  /** Allowed `Host` header values. Empty array disables the Host check entirely. */
  allowedHosts: string[];
  /** Allowed `Origin` header values. Empty array disables the Origin check entirely. */
  allowedOrigins: string[];
  /** Shared-secret bearer token required on every /mcp request, or undefined to leave /mcp unauthenticated. */
  authToken: string | undefined;
}

function parseCommaList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Resolves the Host/Origin allowlists and the optional bearer token from the
 * environment. `port` is accepted for API symmetry with the rest of the
 * config-loading pattern in this codebase (see `getSessionLifecycleConfig`)
 * but is not used to synthesize a default allowlist — see below.
 *
 * Host/Origin enforcement is **opt-in, off by default**: with
 * `MCP_ALLOWED_HOSTS` unset (or set to an empty value), `allowedHosts` is an
 * empty array, which `createHostOriginGuard`/the SDK transport treat as "no
 * check" — i.e. exactly the pre-existing behavior, so already-deployed
 * clients (including ones reaching the server via a LAN IP or a reverse
 * proxy, not `localhost`) are not broken by an update. The same applies to
 * `MCP_ALLOWED_ORIGINS`. Operators enable Host/Origin protection by setting
 * `MCP_ALLOWED_HOSTS` (and optionally `MCP_ALLOWED_ORIGINS`) explicitly —
 * see `isHostOriginEnforcementActive()` and the README "Securing the
 * transport" section, which also covers the `host:port` form needed when
 * connecting directly rather than via `localhost` (e.g.
 * `100.100.50.40:8222`).
 *
 * `MCP_AUTH_TOKEN` is likewise opt-in: unset means `/mcp` stays
 * unauthenticated (pre-existing behavior).
 */
export function getTransportSecurityConfig(
  _port: number,
  env: NodeJS.ProcessEnv = process.env,
): TransportSecurityConfig {
  const allowedHosts = parseCommaList(env['MCP_ALLOWED_HOSTS']);
  const allowedOrigins = parseCommaList(env['MCP_ALLOWED_ORIGINS']);
  const rawToken = env['MCP_AUTH_TOKEN']?.trim();
  const authToken = rawToken && rawToken.length > 0 ? rawToken : undefined;

  return { allowedHosts, allowedOrigins, authToken };
}

/**
 * True once the operator has opted into Host/Origin (DNS-rebinding)
 * enforcement by setting either allowlist to a non-empty value.
 */
export function isHostOriginEnforcementActive(config: Pick<TransportSecurityConfig, 'allowedHosts' | 'allowedOrigins'>): boolean {
  return config.allowedHosts.length > 0 || config.allowedOrigins.length > 0;
}

/**
 * Rejects requests whose `Host` header is not in `allowedHosts` (when
 * non-empty), and requests that send an `Origin` header not in
 * `allowedOrigins` (when non-empty). A missing `Origin` header always passes
 * — see module docs.
 */
export function createHostOriginGuard(allowedHosts: string[], allowedOrigins: string[]): RequestHandler {
  const hostAllowlist = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const originAllowlist = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (hostAllowlist.size > 0) {
      const hostHeader = req.headers.host;
      if (!hostHeader || !hostAllowlist.has(hostHeader.toLowerCase())) {
        res.status(403).json({ error: `Invalid Host header: ${hostHeader ?? '(missing)'}` });
        return;
      }
    }

    if (originAllowlist.size > 0) {
      const originHeader = req.headers.origin;
      if (originHeader && !originAllowlist.has(originHeader)) {
        res.status(403).json({ error: `Invalid Origin header: ${originHeader}` });
        return;
      }
    }

    next();
  };
}

const BEARER_PREFIX = 'Bearer ';

function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Requires `Authorization: Bearer <token>` on every request when `token` is
 * set. When `token` is undefined the guard is a no-op (opt-in
 * authentication) — callers MUST emit a startup warning in that case (see
 * server.ts) so silently-unauthenticated operation is never invisible to the
 * operator.
 */
export function createBearerAuthGuard(token: string | undefined): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!token) {
      next();
      return;
    }

    const header = req.headers.authorization;
    const provided = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;

    if (!provided || !timingSafeTokenMatch(provided, token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    next();
  };
}
