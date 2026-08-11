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
 * Pure builder behind the `get_tool_manifest` tool. Maps the tool→endpoint map
 * (`src/openapi/tool-endpoint-map.ts`) plus the pinned Dockhand OpenAPI identity
 * (commit + `info.version`, see `src/openapi/pinned.ts` / `src/openapi/spec-loader.ts`)
 * into a single manifest, so a client can detect drift between what this server
 * exposes and the Dockhand version it targets. Kept dependency-injected — no direct
 * import of the real endpoint map or spec — so it is testable without touching the
 * filesystem. The registered tool wires the real `TOOL_ENDPOINT_MAP` and the pinned
 * identity in.
 */
export interface ToolManifestEntry {
  name: string;
  method: string;
  path: string;
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
  openApiCommit: string;
  openApiVersion: string;
  generatedAt: string;
}): ToolManifest {
  const tools = Object.entries(deps.endpointMap).map(([name, entry]) => ({
    name,
    method: entry.method,
    path: entry.path,
  }));
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
 * `attemptLogin` is injected (returns an HTTP status code) so this is testable without a
 * live Dockhand instance and without ever touching the credential's value in a test —
 * only the resulting status code crosses the boundary. `credentialsValid` is exactly
 * `statusCode === 200`; any other status (401, 403, ...) or a thrown error (network
 * failure, timeout) degrades to `credentialsValid: false` — a probe that throws never
 * propagates out of `validateConfig`, matching the self-help-tools-never-break posture
 * of `buildServerInfo()` / `runSelfCheck()` above. On a thrown probe, `statusCode` stays
 * `null` (there was no response to report a code from).
 *
 * Per `secret-safe-config-inspection.md` / `service-verifikation.md`: this function reads
 * env values only to compute a boolean and to pass them (via the injected `attemptLogin`)
 * to a live auth check — it never places a value itself into the returned object.
 */
export async function validateConfig(deps: {
  attemptLogin: () => Promise<number>;
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
  try {
    statusCode = await deps.attemptLogin();
  } catch {
    statusCode = null;
  }

  return {
    requiredEnvPresent,
    credentialsValid: statusCode === 200,
    statusCode,
  };
}

/**
 * A single environment as returned by `GET /api/environments` — only the fields this
 * module actually reads (see `listEnvironments` wiring below). Not exported: a
 * registration-time implementation detail, not part of this module's public contract.
 */
interface EnvironmentListEntry {
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
 * A dedicated, minimal raw login attempt against Dockhand's own `/api/auth/login` —
 * the shared wiring behind both `self_check`'s `authValid` and `validate_config`'s
 * `credentialsValid`.
 *
 * Deliberately NOT `SessionManager.login()` (src/auth/session.ts): that method
 * `console.error`s the configured username on failure and throws rather than
 * resolving to a status code — useful for its own job (diagnosable auto-relogin
 * failures in `docker logs`, Issue #116), wrong for this one. Two self-help tools
 * need the plain HTTP status (200 valid / 401 invalid) as a value, not a side effect
 * or an exception, and neither needs the extra log line. This function does neither:
 * no logging, always resolves to `response.status` — a genuine transport failure
 * (DNS, connection refused, timeout) is left to the caller's own try/catch, matching
 * `runSelfCheck()`'s `probeAuth` and `validateConfig()`'s `attemptLogin` contracts
 * (both already documented above as "throws → treated as invalid/false").
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
 * numeric status code crosses back out of this function.
 */
async function attemptRawLogin(baseUrl: string): Promise<number> {
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
  return response.status;
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
 *   - `get_tool_manifest`: the real generated `TOOL_ENDPOINT_MAP`, the pinned Dockhand
 *     OpenAPI source commit (`PINNED_DOCKHAND_OPENAPI_COMMIT`, src/openapi/pinned.ts),
 *     and that same pinned spec's own `info.version` (`specInfoVersion()`,
 *     src/openapi/spec-loader.ts) — so a client can tell which Dockhand API version this
 *     server's tools were generated against.
 *
 * M2 (diagnostics, all three also take no input arguments):
 *   - `self_check`: wires `runSelfCheck()`'s three probes to real calls —
 *       - `probeHealth`: `client.get('/api/health')` (`security: []`, always 200 when the
 *         process is up per the spec's own summary). A throw here (network error, or the
 *         client's non-2xx-throws convention) means Dockhand is unreachable; `runSelfCheck`
 *         short-circuits to `overall: "down"` without calling the other two probes.
 *       - `probeAuth`: `attemptRawLogin()` above, `status === 200`.
 *       - `listEnvironments`: `GET /api/environments` gives each environment's `id`, `name`,
 *         and `connectionType` (`"socket"` or `"hawser-edge"` — the list endpoint documents
 *         no separate liveness/connection field, see `docs/dockhand-openapi.json`); `GET
 *         /api/hawser/connect` (used nowhere else in this server — see
 *         `HawserConnection` above) gives the ground truth of which environments' agents
 *         are *currently* connected, by `environmentId`, matching that endpoint's own
 *         summary ("list currently connected agents") — an OUTCOME check
 *         (`service-verifikation.md`), not a static config field. From these two calls:
 *         `hawserConnected` is true only for a `"hawser-edge"` environment whose id appears
 *         in the connected set; `reachable` is that same `hawserConnected` value for
 *         `"hawser-edge"` environments (an edge environment's reachability *is* whether its
 *         agent is connected — there is no other transport), and `true` for `"socket"`/other
 *         directly-configured environments (Dockhand talks to those without a Hawser agent
 *         in between, so their presence in the list already implies they are configured and
 *         addressable; a deeper per-environment Docker-level probe would mean issuing one
 *         `POST /api/environments/{id}/test` per environment on every `self_check` call,
 *         which this diagnostic deliberately keeps out of its cheap, fixed-cost O(2) call
 *         budget). If the Hawser status call itself fails, every `"hawser-edge"` environment
 *         degrades to `reachable: false, hawserConnected: false` rather than throwing out of
 *         `listEnvironments` — consistent with `runSelfCheck()`'s own "never let a diagnostic
 *         become the outage" posture documented above it.
 *   - `validate_config`: `validateConfig()`'s `attemptLogin` is `attemptRawLogin()` above
 *     against `client.getBaseUrl()` — the same helper `self_check` uses, so the two tools
 *     agree on what "the configured credentials are valid" means. `requiredEnvPresent` reads
 *     `process.env` directly inside `validateConfig()` itself (see its own doc comment); this
 *     registration only supplies the login probe.
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
        endpointMap: TOOL_ENDPOINT_MAP,
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
        probeHealth: async () => {
          await client.get('/api/health');
        },
        probeAuth: async () => (await attemptRawLogin(client.getBaseUrl())) === 200,
        listEnvironments: async () => {
          const envs = await client.get<EnvironmentListEntry[]>('/api/environments');

          let connectedIds = new Set<number>();
          try {
            const hawser = await client.get<{ connections?: HawserConnection[] }>('/api/hawser/connect');
            connectedIds = new Set((hawser.connections ?? []).map((c) => c.environmentId));
          } catch {
            // Best-effort: an unreachable Hawser status endpoint degrades every
            // hawser-edge environment below to not-connected/not-reachable rather
            // than failing listEnvironments() outright — see the doc comment above
            // registerMetaTools() for the full rationale.
          }

          return envs.map((env) => {
            const isHawserEdge = env.connectionType === 'hawser-edge';
            const hawserConnected = isHawserEdge && connectedIds.has(env.id);
            return {
              id: env.id,
              name: env.name,
              reachable: isHawserEdge ? hawserConnected : true,
              hawserConnected,
            };
          });
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
