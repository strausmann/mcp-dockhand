/**
 * Configurable size limit for the JSON body `express.json()` parses on every
 * request to `/mcp`.
 *
 * Codex review (PR #251, P1): `express.json()` was registered in server.ts with no
 * `limit` option at all, so Express's own default of 100 KB applied. The Streamable
 * HTTP transport routes every MCP tool call through that same body parser, and
 * `load_image`'s `tarContent` argument is a base64-encoded Docker image tar (any real
 * `docker save` output, inflated ~33% by base64) embedded inside that JSON body — so
 * the tool was rejected with HTTP 413 before it ever ran, for any image beyond a few
 * tens of KB. The tool was effectively unusable for its stated purpose.
 *
 * Fix: make the limit explicit, configurable, and bounded — not unlimited. The
 * `security-audit` skill already flagged unbounded base64 input as a risk; an
 * operator-tunable but explicit ceiling is the point, not "no limit at all".
 *
 * Follows the same config-loading pattern as `session-lifecycle.ts`
 * (`getSessionLifecycleConfig`) and `transport-guard.ts`
 * (`getTransportSecurityConfig`): a small, independently testable `get*Config(env)`
 * function that defaults safely on anything missing or invalid.
 */

const DEFAULT_MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024; // 100 MB

// A generous but sane upper bound. Nothing this server does needs a body anywhere
// close to this — even a very large `docker save` tar, base64-inflated ~33% for
// load_image, stays well under it — so an operator raising
// MCP_MAX_REQUEST_BODY_BYTES still hits a wall rather than being able to configure
// an effectively unbounded body parser (Codex review, PR #251, P2).
const MAX_REQUEST_BODY_BYTES_CEILING = 1024 * 1024 * 1024; // 1 GiB

export interface RequestBodyLimitConfig {
  /** Maximum size, in bytes, `express.json()` accepts for a single `/mcp` request body. */
  maxRequestBodyBytes: number;
}

/**
 * Parses `value` as a plain positive integer (in bytes), falling back to `fallback`
 * — with a logged warning naming exactly why — for anything that is not one.
 *
 * Codex review (PR #251, P2): the previous version of this function used
 * `Number.parseInt(value, 10)` directly, which silently accepts a PARTIALLY parsed
 * value — `Number.parseInt('100abc', 10)` returns `100`, not `NaN` — and the
 * previous `Number.isFinite(parsed) && parsed > 0` check happily let that `100`
 * through as a legitimate 100-byte limit, no different from a deliberately
 * configured `"100"`. A malformed value (trailing garbage, a decimal point, an
 * exponent, a leading `+`) was never rejected as malformed; it just got silently
 * misinterpreted as the leading digit run. This requires the WHOLE trimmed string
 * to be a plain run of decimal digits before ever calling `parseInt`, so a
 * malformed value is caught explicitly instead of being partially parsed into
 * something that looks like a legitimate number.
 *
 * Falls back rather than throwing (matching `getSessionLifecycleConfig` and
 * `getTransportSecurityConfig`'s existing "default safely on anything missing or
 * invalid" contract) — an operator's typo in an env var should not crash server
 * startup; it should be visible in the logs and otherwise harmless.
 */
function parseRequestBodyByteLimit(
  value: string | undefined,
  fallback: number,
  warnings: string[],
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    warnings.push(
      `MCP_MAX_REQUEST_BODY_BYTES=${JSON.stringify(value)} is not a plain positive integer (bytes) — ` +
        `ignoring it and using the ${fallback}-byte default instead.`,
    );
    return fallback;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    warnings.push(
      `MCP_MAX_REQUEST_BODY_BYTES=${JSON.stringify(value)} must be a positive integer — ` +
        `ignoring it and using the ${fallback}-byte default instead.`,
    );
    return fallback;
  }

  if (parsed > MAX_REQUEST_BODY_BYTES_CEILING) {
    warnings.push(
      `MCP_MAX_REQUEST_BODY_BYTES=${JSON.stringify(value)} exceeds the ${MAX_REQUEST_BODY_BYTES_CEILING}-byte ` +
        `ceiling — capping it there instead of leaving the body parser effectively unbounded.`,
    );
    return MAX_REQUEST_BODY_BYTES_CEILING;
  }

  return parsed;
}

/**
 * Resolves the `/mcp` JSON body size limit from the environment.
 *
 * `MCP_MAX_REQUEST_BODY_BYTES` is optional; unset falls back to a 100 MB default —
 * comfortably above Express's 100 KB default and above any realistic `docker save`
 * tar's base64-inflated size, while still being an explicit, bounded ceiling rather
 * than no limit at all. A malformed, non-positive, or excessive value is rejected
 * explicitly (see `parseRequestBodyByteLimit`) and reported via `warnings`, the
 * same pattern `parseTrustedProxies` (client-ip.ts) uses — the caller (server.ts)
 * logs them at startup so a mistyped env var is never silently invisible.
 */
export function getRequestBodyLimitConfig(env: NodeJS.ProcessEnv = process.env): RequestBodyLimitConfig & { warnings: string[] } {
  const warnings: string[] = [];
  const maxRequestBodyBytes = parseRequestBodyByteLimit(
    env['MCP_MAX_REQUEST_BODY_BYTES'],
    DEFAULT_MAX_REQUEST_BODY_BYTES,
    warnings,
  );
  return { maxRequestBodyBytes, warnings };
}
