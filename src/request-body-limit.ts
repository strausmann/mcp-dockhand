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

export interface RequestBodyLimitConfig {
  /** Maximum size, in bytes, `express.json()` accepts for a single `/mcp` request body. */
  maxRequestBodyBytes: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolves the `/mcp` JSON body size limit from the environment.
 *
 * `MCP_MAX_REQUEST_BODY_BYTES` is optional; unset (or an invalid/non-positive value)
 * falls back to a 100 MB default — comfortably above Express's 100 KB default and
 * above any realistic `docker save` tar's base64-inflated size, while still being an
 * explicit, bounded ceiling rather than no limit at all.
 */
export function getRequestBodyLimitConfig(env: NodeJS.ProcessEnv = process.env): RequestBodyLimitConfig {
  return {
    maxRequestBodyBytes: parsePositiveInteger(env['MCP_MAX_REQUEST_BODY_BYTES'], DEFAULT_MAX_REQUEST_BODY_BYTES),
  };
}
