/**
 * Self-help / meta tools — server identity and diagnostics for the MCP
 * server itself, distinct from the Dockhand tools it wraps.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { getServerVersion, getGitSha, getBuildDate, getUptimeSeconds } from '../version.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { TOOL_ENDPOINT_MAP, type ToolEndpointEntry } from '../openapi/tool-endpoint-map.js';
import { PINNED_DOCKHAND_OPENAPI_COMMIT } from '../openapi/pinned.js';
import { specInfoVersion } from '../openapi/spec-loader.js';
import { getStatsSnapshot } from '../utils/runtime-stats.js';
import { encodePath } from '../utils/encode-path.js';

export interface ServerInfo {
  version: string;
  gitSha: string;
  buildDate: string;
  uptimeSeconds: number;
  mcpProtocolVersion: string;
  dockhandUrl: string;
  dockhandServerVersion: string | null;
}

/**
 * Pure builder behind the `get_server_info` tool. Kept dependency-injected
 * (dockhandUrl + a version fetcher) so it is testable without a live MCP
 * server or Dockhand client. Fetching the Dockhand server version is
 * best-effort: any failure degrades to `null` rather than throwing, so a
 * self-help tool never breaks because Dockhand itself is unreachable.
 */
export async function buildServerInfo(deps: {
  dockhandUrl: string;
  mcpProtocolVersion?: string;
  getDockhandServerVersion: () => Promise<string>;
}): Promise<ServerInfo> {
  let dockhandServerVersion: string | null = null;
  try {
    dockhandServerVersion = await deps.getDockhandServerVersion();
  } catch {
    dockhandServerVersion = null;
  }
  return {
    version: getServerVersion(),
    gitSha: getGitSha(),
    buildDate: getBuildDate(),
    uptimeSeconds: getUptimeSeconds(),
    mcpProtocolVersion: deps.mcpProtocolVersion ?? 'unknown',
    dockhandUrl: deps.dockhandUrl,
    dockhandServerVersion,
  };
}

/**
 * Pure builder behind the `check_for_update` tool. Checks the latest GitHub
 * release for this server against a caller-supplied current version, with
 * an in-memory TTL cache so repeated tool calls do not hammer the GitHub
 * API. Injectable fetch + clock keep it testable without real network
 * access or timers. Any failure (network, non-2xx, malformed body)
 * degrades to `updateAvailable: null` rather than throwing, matching the
 * self-help-tools-never-break-the-server posture of `buildServerInfo`.
 */
const RELEASES_URL = 'https://api.github.com/repos/strausmann/mcp-dockhand/releases/latest';
const UPDATE_TTL_MS = 60 * 60 * 1000;
let updateCache: { at: number; latest: string; url?: string; publishedAt?: string } | null = null;

/** Test hook: clears the in-memory update cache between test cases. */
export function __resetUpdateCache() {
  updateCache = null;
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean | null;
  releaseUrl?: string;
  publishedAt?: string;
  error?: string;
}

export async function checkForUpdate(deps: {
  current: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<UpdateInfo> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    if (!updateCache || now() - updateCache.at > UPDATE_TTL_MS) {
      const res = await doFetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const json = (await res.json()) as { tag_name: string; html_url?: string; published_at?: string };
      updateCache = {
        at: now(),
        latest: json.tag_name.replace(/^v/, ''),
        url: json.html_url,
        publishedAt: json.published_at,
      };
    }
    const latest = updateCache.latest;
    return {
      current: deps.current,
      latest,
      updateAvailable: compareSemver(latest, deps.current) > 0,
      releaseUrl: updateCache.url,
      publishedAt: updateCache.publishedAt,
    };
  } catch (e) {
    return { current: deps.current, latest: null, updateAvailable: null, error: (e as Error).message };
  }
}

/**
 * The six self-help/meta tool names registered by `registerMetaTools()` below —
 * `get_tool_manifest` itself among them. This is the single source of truth for that
 * list: `tests/tool-endpoint.test.ts`'s endpoint-completeness check imports it to
 * exclude these six from its "every registered tool has a `TOOL_ENDPOINT_MAP` entry"
 * assertion (none of the six wrap a single Dockhand endpoint the way every other
 * registered tool does — see that test's own doc comment for why, tool by tool), and
 * `get_tool_manifest`'s own registration wiring below reuses it (Fix round 2,
 * Finding 4) so its inventory includes these six tools too, not just the
 * `TOOL_ENDPOINT_MAP` ones.
 */
export const META_TOOL_NAMES: readonly string[] = [
  'check_for_update',
  'get_runtime_stats',
  'get_server_info',
  'get_tool_manifest',
  'self_check',
  'validate_config',
];

/**
 * `get_prometheus_metrics`'s real endpoint (`GET /api/metrics`, see
 * `registerSystemTools()` in src/tools/system.ts) — deliberately excluded from the
 * generated `TOOL_ENDPOINT_MAP` itself (see `scripts/generate-tool-endpoint-map.mjs`'s
 * own header: `/api/metrics` is not a SvelteKit route and therefore cannot carry an
 * `@openapi` annotation for the generator to pick up).
 *
 * `get_tool_manifest`'s registration wiring below merges this single entry back in
 * (Fix round 2, Finding 4) — without it, `META_TOOL_NAMES` alone would still leave the
 * manifest one tool short of the true registered count: 291 `TOOL_ENDPOINT_MAP` entries
 * + 6 meta tools = 297, not the actual 298 `registerAllTools()` exposes.
 * `get_prometheus_metrics` is NOT a meta/self-help tool (it is a real, single-endpoint
 * Dockhand-backed tool, same as every `TOOL_ENDPOINT_MAP` entry), so it gets its real
 * `method`/`path` here rather than `META_TOOL_NAMES`' `null`/`null` treatment.
 */
const GET_PROMETHEUS_METRICS_ENDPOINT: ToolEndpointEntry = { method: 'GET', path: '/api/metrics' };

/**
 * Pure builder behind the `get_tool_manifest` tool. Maps the tool→endpoint map
 * (`src/openapi/tool-endpoint-map.ts`) plus the pinned Dockhand OpenAPI identity
 * (commit + `info.version`, see `src/openapi/pinned.ts` / `src/openapi/spec-loader.ts`)
 * into a single manifest, so a client can detect drift between what this server
 * exposes and the Dockhand version it targets. Kept dependency-injected — no direct
 * import of the real endpoint map or spec — so it is testable without touching the
 * filesystem. The registered tool wires the real `TOOL_ENDPOINT_MAP`, `META_TOOL_NAMES`,
 * and the pinned identity in.
 *
 * Fix round 2, Finding 4 (P2): previously this manifest was built SOLELY from
 * `endpointMap`, so `get_tool_manifest` reported `toolCount: 292` while
 * `registerAllTools()` actually exposes 298 tools — the six self-help/meta tools
 * (including `get_tool_manifest` itself) were missing, contradicting the tool's own
 * description ("the tools this build exposes"). `deps.metaToolNames` is now a required,
 * separate list (the real wiring passes `META_TOOL_NAMES` above) whose entries are
 * appended to the manifest with `method: null, path: null` — accurately reflecting that
 * these six tools are not backed by a single Dockhand endpoint the way every
 * `endpointMap` entry is.
 */
export interface ToolManifestEntry {
  name: string;
  method: string | null;
  path: string | null;
}

export interface ToolManifest {
  toolCount: number;
  tools: ToolManifestEntry[];
  dockhandOpenApiCommit: string;
  dockhandOpenApiVersion: string;
  generatedAt: string;
}

export function buildToolManifest(deps: {
  endpointMap: Readonly<Record<string, ToolEndpointEntry>>;
  metaToolNames: readonly string[];
  openApiCommit: string;
  openApiVersion: string;
  generatedAt: string;
}): ToolManifest {
  const endpointTools: ToolManifestEntry[] = Object.entries(deps.endpointMap).map(([name, entry]) => ({
    name,
    method: entry.method,
    path: entry.path,
  }));
  const metaTools: ToolManifestEntry[] = deps.metaToolNames.map((name) => ({
    name,
    method: null,
    path: null,
  }));
  const tools = [...endpointTools, ...metaTools];
  return {
    toolCount: tools.length,
    tools,
    dockhandOpenApiCommit: deps.openApiCommit,
    dockhandOpenApiVersion: deps.openApiVersion,
    generatedAt: deps.generatedAt,
  };
}

/**
 * A single environment's outcome inside a `runSelfCheck()` result — Dockhand's own
 * identity (`id`, `name`) plus two OUTCOME booleans (reachable, Hawser-connected).
 * Never a token or credential value (`.claude/rules/service-verifikation.md` /
 * `secret-safe-config-inspection.md`): whether the agent is connected is itself the
 * signal, not what it is connected with.
 */
export interface SelfCheckEnvironment {
  id: number;
  name: string;
  reachable: boolean;
  hawserConnected: boolean;
}

export interface SelfCheck {
  dockhandReachable: boolean;
  authValid: boolean;
  latencyMs: number;
  environments: SelfCheckEnvironment[];
  overall: 'ok' | 'degraded' | 'down';
}

/**
 * Pure, injectable builder behind the future `self_check` tool — an end-to-end
 * diagnostic that answers "is this server actually usable right now?" in one call.
 * Takes three probes so it is fully testable without a live Dockhand:
 *   - `probeHealth`: resolves when Dockhand answers at all; rejects/throws on network
 *     failure or timeout. This alone decides `dockhandReachable`.
 *   - `probeAuth`: resolves `true`/`false` for a valid/invalid credential (the real
 *     wiring in the registration task makes one authed call and turns its status code —
 *     200 vs 401/403 — into this boolean; a genuine transport error while doing so is
 *     caught here and also treated as `false`). Per `service-verifikation.md`, this is
 *     an OUTCOME check (does the call succeed?) — the credential's value is never read
 *     or compared.
 *   - `listEnvironments`: lists each configured environment with its own reachability
 *     and Hawser-agent-connected outcome.
 *
 * If `probeHealth` fails, the function short-circuits: Dockhand being unreachable makes
 * any auth/environments probe meaningless (and likely to fail the same way), so neither
 * is called and the result is `overall: "down"` with an empty `environments` list.
 * Otherwise `overall` is `"ok"` only when auth is valid AND every environment reports
 * reachable; any other combination (invalid auth, an unreachable environment, or the
 * environments probe itself throwing) degrades to `"degraded"` rather than throwing —
 * a diagnostic tool must never itself become the outage.
 *
 * `latencyMs` is measured with `Date.now()` (or the injected `now` for deterministic
 * tests) around the whole probe sequence, so it reflects what a caller actually waited.
 */
export async function runSelfCheck(deps: {
  probeHealth: () => Promise<void>;
  probeAuth: () => Promise<boolean>;
  listEnvironments: () => Promise<SelfCheckEnvironment[]>;
  now?: () => number;
}): Promise<SelfCheck> {
  const now = deps.now ?? Date.now;
  const start = now();

  try {
    await deps.probeHealth();
  } catch {
    return {
      dockhandReachable: false,
      authValid: false,
      latencyMs: now() - start,
      environments: [],
      overall: 'down',
    };
  }

  let authValid: boolean;
  try {
    authValid = await deps.probeAuth();
  } catch {
    authValid = false;
  }

  let environments: SelfCheckEnvironment[];
  let environmentsOk: boolean;
  try {
    environments = await deps.listEnvironments();
    environmentsOk = environments.every((env) => env.reachable);
  } catch {
    environments = [];
    environmentsOk = false;
  }

  return {
    dockhandReachable: true,
    authValid,
    latencyMs: now() - start,
    environments,
    overall: authValid && environmentsOk ? 'ok' : 'degraded',
  };
}

/**
 * Required environment variables this server needs to talk to Dockhand.
 * Presence-only — the values themselves are never read into any output.
 */
const REQUIRED_ENV_KEYS = ['DOCKHAND_URL', 'DOCKHAND_USERNAME', 'DOCKHAND_PASSWORD'] as const;

export interface ConfigValidation {
  requiredEnvPresent: {
    DOCKHAND_URL: boolean;
    DOCKHAND_USERNAME: boolean;
    DOCKHAND_PASSWORD: boolean;
  };
  credentialsValid: boolean;
  statusCode: number | null;
}

/**
 * Pure, injectable builder behind the future `validate_config` tool — answers
 * "is this server's configuration usable?" without ever reading a secret value.
 *
 * Env-var checks are Boolean-only (`!!process.env.X`): presence, never content. If any
 * required var is missing, the login probe is skipped entirely (`credentialsValid: false`,
 * `statusCode: null`) — there is nothing meaningful to attempt without a URL, username, and
 * password all present, and calling out anyway would risk a confusing error unrelated to the
 * real problem (a missing var).
 *
 * `attemptLogin` is injected (returns a `LoginProbeResult`, see that interface's own doc
 * comment below) so this is testable without a live Dockhand instance and without ever
 * touching the credential's value in a test — only the resulting status code and
 * completed-auth boolean cross the boundary. `credentialsValid` is exactly
 * `completedAuth` (Fix round 2, Finding 3: NOT `statusCode === 200` — a `200` can still
 * mean an incomplete, MFA-pending login with no session established, which
 * `LoginProbeResult.completedAuth` already accounts for; see `attemptRawLogin()`'s doc
 * comment for the full rationale). Any other status (401, 403, ...), an incomplete `200`,
 * or a thrown error (network failure, timeout) all degrade to `credentialsValid: false` —
 * a probe that throws never propagates out of `validateConfig`, matching the
 * self-help-tools-never-break posture of `buildServerInfo()` / `runSelfCheck()` above. On
 * a thrown probe, `statusCode` stays `null` (there was no response to report a code
 * from); on a completed probe, `statusCode` always reports the real HTTP status,
 * independent of `credentialsValid` — so a `200`-but-MFA-pending outcome is still
 * visible as `statusCode: 200, credentialsValid: false`, not conflated with a `401`.
 *
 * Per `secret-safe-config-inspection.md` / `service-verifikation.md`: this function reads
 * env values only to compute a boolean and to pass them (via the injected `attemptLogin`)
 * to a live auth check — it never places a value itself into the returned object.
 */
export async function validateConfig(deps: {
  attemptLogin: () => Promise<LoginProbeResult>;
}): Promise<ConfigValidation> {
  const requiredEnvPresent = {
    DOCKHAND_URL: !!process.env.DOCKHAND_URL,
    DOCKHAND_USERNAME: !!process.env.DOCKHAND_USERNAME,
    DOCKHAND_PASSWORD: !!process.env.DOCKHAND_PASSWORD,
  };

  const allPresent = REQUIRED_ENV_KEYS.every((key) => requiredEnvPresent[key]);
  if (!allPresent) {
    return { requiredEnvPresent, credentialsValid: false, statusCode: null };
  }

  let statusCode: number | null;
  let completedAuth: boolean;
  try {
    const probe = await deps.attemptLogin();
    statusCode = probe.statusCode;
    completedAuth = probe.completedAuth;
  } catch {
    statusCode = null;
    completedAuth = false;
  }

  return {
    requiredEnvPresent,
    credentialsValid: completedAuth,
    statusCode,
  };
}

/**
 * A single environment as returned by `GET /api/environments` — only the fields this
 * module actually reads (see `listEnvironments` wiring below). Exported so
 * `deriveEnvironmentStatuses()` below has a named parameter type its own tests can
 * construct against.
 */
export interface EnvironmentListEntry {
  id: number;
  name: string;
  connectionType?: string;
}

/**
 * A single currently-connected Hawser agent, as returned by `GET /api/hawser/connect`
 * (`src/tools/meta.ts` is the only caller in this repo — no existing tool wraps this
 * endpoint, see `list_hawser_tokens`/`create_hawser_token`/`revoke_hawser_token` in
 * `src/tools/hawser.ts` for the token-management side of the same feature). Only
 * `environmentId` is read; the rest of the documented shape (`agentId`, `hostname`,
 * `connectedAt`, ...) is irrelevant to a boolean "is this environment's agent up"
 * outcome check.
 */
interface HawserConnection {
  environmentId: number;
}

/**
 * Pure, exported builder behind `self_check`'s per-environment status derivation
 * (Fix round 1, Finding 2: this logic previously lived untested inline inside the
 * `registerTool('self_check', ...)` closure — every other piece of this module is a
 * pure, injectable, separately-tested builder, and this one now is too).
 *
 * Takes already-resolved, already-degraded inputs so it never itself does I/O or
 * throws:
 *   - `environments`: the raw `GET /api/environments` list (`id`, `name`,
 *     `connectionType`).
 *   - `connectedAgentIds`: the set of environment ids with a currently-connected
 *     Hawser agent, per `GET /api/hawser/connect` (empty set if that call failed —
 *     see the registration wiring below for how that degrade happens).
 *   - `perEnvReachable`: a **live, per-environment** reachability result — Fix round 1,
 *     Finding 1: `reachable` must be a real outcome check for every environment
 *     (`POST /api/environments/{id}/test`'s `success` field), not a hardcoded
 *     assumption for any connection type. Missing an entry for a given id (e.g. its
 *     `/test` probe threw or timed out) degrades to `reachable: false` via the `??
 *     false` fallback — this function never throws on an incomplete map.
 *
 * `hawserConnected` is true only for a `"hawser-edge"` environment whose id is in
 * `connectedAgentIds` — non-edge (`"socket"`, etc.) environments are trivially
 * `false`, since they have no Hawser agent to be connected. `reachable` is always
 * `perEnvReachable`'s live result, uniformly across connection types — the whole
 * point of Finding 1's fix is that this is no longer type-dependent.
 */
export function deriveEnvironmentStatuses(
  environments: readonly EnvironmentListEntry[],
  connectedAgentIds: ReadonlySet<number>,
  perEnvReachable: ReadonlyMap<number, boolean>,
): SelfCheckEnvironment[] {
  return environments.map((env) => ({
    id: env.id,
    name: env.name,
    reachable: perEnvReachable.get(env.id) ?? false,
    hawserConnected: env.connectionType === 'hawser-edge' && connectedAgentIds.has(env.id),
  }));
}

/** Per-environment `POST /api/environments/{id}/test` timeout (Fix round 1, Finding 1):
 * keeps `self_check` responsive even when one environment's agent/socket hangs instead
 * of answering. All environments are probed in parallel (`Promise.allSettled`, see the
 * `self_check` wiring below), so this bounds the *slowest* environment's contribution
 * to `self_check`'s total latency, not the sum across environments. */
const ENVIRONMENT_TEST_TIMEOUT_MS = 5_000;

/**
 * Races `promise` against a timeout, rejecting with a plain `Error` if `promise` has
 * not settled within `timeoutMs`. Generic, not Dockhand-specific — used only to bound
 * the per-environment `POST /api/environments/{id}/test` calls in `self_check`'s
 * `listEnvironments` wiring below.
 *
 * Note: this only makes the *caller* stop waiting — it does not abort the underlying
 * `fetch()` inside `promise` (`DockhandClient`'s request methods take no
 * `AbortSignal`). A timed-out environment probe may still complete in the background;
 * its result is simply discarded once `withTimeout` has already rejected. That is a
 * deliberate, acceptable trade-off for a lightweight diagnostic tool — `self_check`'s
 * job is to stay responsive, not to strictly bound background resource usage.
 *
 * Exported so it can be unit-tested directly — it is small, generic,
 * timing-sensitive logic in its own right, not just wiring.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The outcome of a one-shot login probe (`attemptRawLogin()` below) — the shared shape
 * behind both `self_check`'s `authValid` and `validate_config`'s `credentialsValid`.
 *
 * `statusCode` is always the real HTTP status Dockhand returned (or `null` upstream, in
 * `validateConfig()`, when the probe itself threw) — kept separate from `completedAuth`
 * so a caller can still report *what actually happened* (e.g. `401`) even though a
 * bare status code is not, on its own, a reliable "auth is valid" signal (see
 * `completedAuth`'s own doc below, Fix round 2 / Finding 3).
 *
 * `completedAuth` is the actual "is this credential usable non-interactively right
 * now" answer: `true` only for a `200` response that also established a real session
 * (a session cookie was set) AND did not carry `requiresMfa:true`. `false` for every
 * other outcome — including a `200` that did neither.
 */
export interface LoginProbeResult {
  statusCode: number;
  completedAuth: boolean;
}

/**
 * A dedicated, minimal raw login attempt against Dockhand's own `/api/auth/login` —
 * the shared wiring behind both `self_check`'s `authValid` and `validate_config`'s
 * `credentialsValid`.
 *
 * Deliberately NOT `SessionManager.login()` (src/auth/session.ts): that method
 * `console.error`s the configured username on failure and throws rather than
 * resolving to a result value — useful for its own job (diagnosable auto-relogin
 * failures in `docker logs`, Issue #116), wrong for this one. Two self-help tools
 * need the outcome as a plain value, not a side effect or an exception, and neither
 * needs the extra log line. This function does neither: no logging, always resolves to
 * a `LoginProbeResult` — a genuine transport failure (DNS, connection refused, timeout)
 * is left to the caller's own try/catch, matching `runSelfCheck()`'s `probeAuth` and
 * `validateConfig()`'s `attemptLogin` contracts (both already documented above as
 * "throws → treated as invalid/false").
 *
 * Also why this can't just be `client.get(...)`: `DockhandClient`'s request methods
 * auto-relogin on a 401 (see `dockhand-client.ts`'s `request()`), which is exactly the
 * right behavior for every *other* tool in this server (a stale/expired session
 * cookie shouldn't surface as a tool failure) but would mask a genuinely bad
 * credential here — the auto-relogin would itself fail, but silently, several layers
 * away from this function. An explicit, one-shot login attempt is the only way to
 * observe the credential's own validity.
 *
 * Secret-safe (`secret-safe-config-inspection.md`): reads `DOCKHAND_USERNAME`/
 * `DOCKHAND_PASSWORD` only to place them in the POST body sent directly to Dockhand's
 * own login endpoint — the same two values `SessionManager` itself sends on every
 * real login — and never logs, returns, or otherwise surfaces either value. Only the
 * `LoginProbeResult` (a status code plus a boolean) crosses back out of this function —
 * the response body itself is inspected here for exactly one boolean flag
 * (`requiresMfa`) and never returned.
 *
 * Fix round 2, Finding 3 (P2): a `200` response from `/api/auth/login` does not always
 * mean a usable session was established. Per `docs/dockhand-openapi.json`'s own
 * description of this endpoint's `200` response ("Login succeeded and dockhand_session
 * cookie was set — OR requiresMfa:true if a second factor is needed first"), a `200`
 * can also carry `{ success: true, requiresMfa: true }` with NO session cookie — an MFA
 * account whose credentials this one-shot, non-interactive probe can never fully
 * authenticate (there is no second factor to supply). The previous version of this
 * function treated any `200` as valid, so `validate_config.credentialsValid` and
 * `self_check`'s `authValid` both reported `true` for such an account even though it
 * could not actually establish a session through this path. This function now reads
 * the response body's `requiresMfa` flag and checks for a `Set-Cookie` session cookie
 * (mirroring `SessionManager.performLogin()`'s own cookie-extraction fallback chain —
 * `getSetCookie()` then the raw `set-cookie` header — without needing the cookie's
 * *value*, only its presence): `completedAuth` is `true` only when the status is `200`,
 * a session cookie was set, AND `requiresMfa` is not `true`.
 */
export async function attemptRawLogin(baseUrl: string): Promise<LoginProbeResult> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env['DOCKHAND_USERNAME'],
      password: process.env['DOCKHAND_PASSWORD'],
      provider: 'local',
    }),
    redirect: 'manual',
  });

  const statusCode = response.status;
  if (statusCode !== 200) {
    return { statusCode, completedAuth: false };
  }

  // Read the body once (mirrors SessionManager.performLogin()'s own "read once, cache"
  // pattern for the same reason: a Response body can only be consumed once).
  const bodyText = await response.text().catch(() => '');
  let requiresMfa = false;
  try {
    const body = bodyText ? (JSON.parse(bodyText) as { requiresMfa?: unknown }) : {};
    requiresMfa = body?.requiresMfa === true;
  } catch {
    // Non-JSON or unparsable body — no requiresMfa flag to find, treat as absent.
    requiresMfa = false;
  }

  const setCookie = response.headers.getSetCookie?.() ?? [];
  const hasSessionCookie = setCookie.length > 0 || !!response.headers.get('set-cookie');

  return { statusCode, completedAuth: hasSessionCookie && !requiresMfa };
}

/** Timeout for the unauthenticated `/api/health` liveness probe below (Fix round 2,
 * Finding 2 / P2 security-adjacent). Same bound as `ENVIRONMENT_TEST_TIMEOUT_MS` — the
 * top-level liveness probe has no reason to be allowed to wait longer than a single
 * environment's own `/test` probe before `self_check` gives up on it. */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * A dedicated, minimal, UNAUTHENTICATED liveness probe against Dockhand's own
 * `/api/health` — the real wiring behind `self_check`'s `probeHealth`.
 *
 * Fix round 2, Finding 2 (P2): previously wired directly as `client.get('/api/health')`
 * in `registerMetaTools()` below. `client.get()` runs every request through
 * `SessionManager`, which attempts a login first if it has no cached session cookie —
 * so with an invalid/misconfigured credential, the *login* failed before `/api/health`
 * was ever reached, `probeHealth` threw, and `self_check` reported
 * `dockhandReachable: false, overall: "down"`. That is indistinguishable from Dockhand
 * itself being down, even though Dockhand was up the whole time — only the credentials
 * were bad. `GET /api/health` is documented `security: []` in the Dockhand OpenAPI spec
 * (public, no auth required by design), so probing it with a bare `fetch()` instead
 * fixes the conflation: a bad-credential deployment now reports
 * `dockhandReachable: true` (this probe succeeds on its own) alongside
 * `authValid: false` (the separate `attemptRawLogin()`-backed probe fails) →
 * `runSelfCheck()` resolves `overall: "degraded"`, not `"down"` — an accurate signal
 * that Dockhand is up but the configured credentials are not.
 *
 * Bounded by `withTimeout()`/`HEALTH_CHECK_TIMEOUT_MS` (mirrors the per-environment
 * `/test` probes' own timeout below) so an unresponsive Dockhand cannot make
 * `self_check` itself hang. Throws on any failure — network error, non-2xx status, or
 * timeout — matching `runSelfCheck()`'s `probeHealth` contract, where any throw means
 * `dockhandReachable: false`.
 */
export async function probeRawHealth(baseUrl: string): Promise<void> {
  const response = await withTimeout(fetch(`${baseUrl}/api/health`), HEALTH_CHECK_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Dockhand health check failed: GET ${baseUrl}/api/health returned ${response.status}`);
  }
}

/**
 * Registers all six self-help tools, wiring the pure builders above to their real
 * dependencies.
 *
 * M1 (server identity, all three take no input arguments):
 *   - `get_server_info`: `dockhandUrl` from `client.getBaseUrl()` — the client's own
 *     normalized base URL (trailing slash(es) stripped, see Issue #116 /
 *     src/utils/url.ts's `normalizeBaseUrl()`), not the raw `DOCKHAND_URL` env var
 *     directly: those two can diverge (e.g. `DOCKHAND_URL=https://x/` normalizes to
 *     `https://x`), and this is a diagnostic tool whose job is to report what the client
 *     actually does, not what was typed into the config. A URL, never a secret. The
 *     Dockhand server version is read from `GET /api/changelog` (`src/tools/system.ts`'s
 *     `get_changelog` tool hits the same endpoint): the changelog is generated newest-first,
 *     so its first entry's `version` is the running server's version. That call is
 *     best-effort — `buildServerInfo()` already degrades any throw (network error, empty
 *     changelog, auth failure) to `dockhandServerVersion: null` rather than failing the
 *     tool. `mcpProtocolVersion` is the SDK's own `LATEST_PROTOCOL_VERSION` constant.
 *   - `check_for_update`: compares this server's own build-injected version
 *     (`getServerVersion()`, src/version.js) against the latest GitHub release.
 *   - `get_tool_manifest`: the real generated `TOOL_ENDPOINT_MAP` plus
 *     `GET_PROMETHEUS_METRICS_ENDPOINT` above merged in, `META_TOOL_NAMES` above
 *     (**Fix round 2, Finding 4**: without these two additions, the manifest omitted
 *     all six self-help/meta tools — including `get_tool_manifest` itself — AND
 *     `get_prometheus_metrics`, from its own `toolCount`/`tools`), the pinned Dockhand
 *     OpenAPI source commit (`PINNED_DOCKHAND_OPENAPI_COMMIT`, src/openapi/pinned.ts),
 *     and that same pinned spec's own `info.version` (`specInfoVersion()`,
 *     src/openapi/spec-loader.ts) — so a client can tell which Dockhand API version
 *     this server's tools were generated against.
 *
 * M2 (diagnostics, all three also take no input arguments):
 *   - `self_check`: wires `runSelfCheck()`'s three probes to real calls —
 *       - `probeHealth`: `probeRawHealth()` above — a bare, UNAUTHENTICATED `fetch()`
 *         against `/api/health` (`security: []`, always 200 when the process is up per
 *         the spec's own summary), deliberately NOT `client.get()` (**Fix round 2,
 *         Finding 2**: `client.get()` would attempt a login first, so an invalid
 *         credential made this probe indistinguishable from Dockhand being down — see
 *         `probeRawHealth()`'s own doc comment for the full rationale). A throw here
 *         (network error, non-2xx status, or timeout) means Dockhand is unreachable;
 *         `runSelfCheck` short-circuits to `overall: "down"` without calling the other
 *         two probes.
 *       - `probeAuth`: `attemptRawLogin()` above, `.completedAuth` (**Fix round 2,
 *         Finding 3**: NOT a bare `status === 200` check — see `attemptRawLogin()`'s own
 *         doc comment for why a `200` alone is not sufficient, e.g. an MFA-pending
 *         login).
 *       - `listEnvironments`: three calls, then `deriveEnvironmentStatuses()` above turns
 *         their results into `SelfCheckEnvironment[]` — see that function's own doc comment
 *         for exactly how `reachable`/`hawserConnected` are derived (**Fix round 1, Finding
 *         1**: `reachable` is now a genuine live outcome check for every environment, never
 *         a hardcoded assumption for any connection type):
 *           1. `GET /api/environments` — each environment's `id`, `name`, `connectionType`
 *              (`"socket"` or `"hawser-edge"`).
 *           2. `GET /api/hawser/connect` (used nowhere else in this server — see
 *              `HawserConnection` above) — the ground truth of which environments' agents
 *              are *currently* connected, by `environmentId`. Best-effort: on failure,
 *              `connectedAgentIds` degrades to an empty set (every `"hawser-edge"`
 *              environment then reads as not-connected) rather than throwing out of
 *              `listEnvironments`.
 *           3. `POST /api/environments/{id}/test` for **every** environment, **in
 *              parallel** (`Promise.allSettled`, not sequential — one hung environment must
 *              not block the others) and each individually bounded by
 *              `withTimeout()`/`ENVIRONMENT_TEST_TIMEOUT_MS` above (5s) so a single
 *              unresponsive environment cannot make `self_check` itself hang. This is the
 *              same endpoint `POST /api/environments/{id}/test` — its `success` field is
 *              the real, uniform reachability signal for socket AND edge environments
 *              alike. A rejected/timed-out probe degrades that one environment to
 *              `reachable: false` (via the missing `perEnvReachable` entry) rather than
 *              failing `listEnvironments` for every other environment.
 *   - `validate_config`: `validateConfig()`'s `attemptLogin` is `attemptRawLogin()` above
 *     against `client.getBaseUrl()` — the same helper `self_check` uses, so the two tools
 *     agree on what "the configured credentials are valid" means (both key off
 *     `LoginProbeResult.completedAuth`, not a bare status code — Fix round 2, Finding 3).
 *     `requiredEnvPresent` reads `process.env` directly inside `validateConfig()` itself
 *     (see its own doc comment); this registration only supplies the login probe.
 *   - `get_runtime_stats`: `getStatsSnapshot()` (`src/utils/runtime-stats.js`) — no
 *     dependencies to wire, the counters live at module scope and are updated by
 *     `registerTool()` itself on every call (`recordCall`/`recordError`, see
 *     `src/utils/tool-helper.ts`), including calls to the five other meta tools.
 */
export function registerMetaTools(server: McpServer, client: DockhandClient): void {
  registerTool(server, 'get_server_info',
    {},
    async () => {
      const info = await buildServerInfo({
        dockhandUrl: client.getBaseUrl(),
        mcpProtocolVersion: LATEST_PROTOCOL_VERSION,
        getDockhandServerVersion: async () => {
          const changelog = await client.get<{ version: string }[]>('/api/changelog');
          const latest = changelog[0]?.version;
          if (!latest) throw new Error('Dockhand changelog is empty');
          return latest;
        },
      });
      return jsonResponse(info);
    }
  );

  registerTool(server, 'check_for_update',
    {},
    async () => {
      return jsonResponse(await checkForUpdate({ current: getServerVersion() }));
    }
  );

  registerTool(server, 'get_tool_manifest',
    {},
    async () => {
      const manifest = buildToolManifest({
        endpointMap: {
          ...TOOL_ENDPOINT_MAP,
          get_prometheus_metrics: GET_PROMETHEUS_METRICS_ENDPOINT,
        },
        metaToolNames: META_TOOL_NAMES,
        openApiCommit: PINNED_DOCKHAND_OPENAPI_COMMIT,
        openApiVersion: specInfoVersion() ?? 'unknown',
        generatedAt: new Date().toISOString(),
      });
      return jsonResponse(manifest);
    }
  );

  registerTool(server, 'self_check',
    {},
    async () => {
      const result = await runSelfCheck({
        probeHealth: () => probeRawHealth(client.getBaseUrl()),
        probeAuth: async () => (await attemptRawLogin(client.getBaseUrl())).completedAuth,
        listEnvironments: async () => {
          const envs = await client.get<EnvironmentListEntry[]>('/api/environments');

          let connectedAgentIds = new Set<number>();
          try {
            const hawser = await client.get<{ connections?: HawserConnection[] }>('/api/hawser/connect');
            connectedAgentIds = new Set((hawser.connections ?? []).map((c) => c.environmentId));
          } catch {
            // Best-effort: an unreachable Hawser status endpoint degrades every
            // hawser-edge environment to not-connected below rather than failing
            // listEnvironments() outright — see the doc comment above
            // registerMetaTools() for the full rationale.
          }

          // Fix round 1, Finding 1: a genuine, per-environment, in-parallel reachability
          // check for EVERY environment (not just hawser-edge ones) — no connection type
          // is ever assumed reachable. Each probe is individually timeout-bounded so one
          // hung environment cannot make self_check itself hang.
          const testResults = await Promise.allSettled(
            envs.map((env) =>
              withTimeout(
                client.post<{ success?: boolean }>(`/api/environments/${encodePath(env.id)}/test`),
                ENVIRONMENT_TEST_TIMEOUT_MS,
              ),
            ),
          );

          const perEnvReachable = new Map<number, boolean>();
          envs.forEach((env, i) => {
            const result = testResults[i];
            perEnvReachable.set(env.id, result.status === 'fulfilled' && !!result.value.success);
          });

          return deriveEnvironmentStatuses(envs, connectedAgentIds, perEnvReachable);
        },
      });
      return jsonResponse(result);
    }
  );

  registerTool(server, 'validate_config',
    {},
    async () => {
      const result = await validateConfig({
        attemptLogin: () => attemptRawLogin(client.getBaseUrl()),
      });
      return jsonResponse(result);
    }
  );

  registerTool(server, 'get_runtime_stats',
    {},
    async () => {
      return jsonResponse(getStatsSnapshot());
    }
  );
}
