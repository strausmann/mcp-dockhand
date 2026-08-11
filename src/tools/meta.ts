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
 * Registers the three M1 self-help tools, wiring the pure builders above to their real
 * dependencies:
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
 * All three take no input arguments.
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
}
