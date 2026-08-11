/**
 * Self-help / meta tools — server identity and diagnostics for the MCP
 * server itself, distinct from the Dockhand tools it wraps.
 */

import { getServerVersion, getGitSha, getBuildDate, getUptimeSeconds } from '../version.js';

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
