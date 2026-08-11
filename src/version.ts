/**
 * Build-identity module — build-time-injected version/sha/date, plus
 * process uptime. See Dockerfile for how MCP_SERVER_VERSION, MCP_GIT_SHA
 * and MCP_BUILD_DATE are injected at image build time via --build-arg.
 */

export function getServerVersion(): string {
  return process.env['MCP_SERVER_VERSION'] ?? '0.0.0-dev';
}

export function getGitSha(): string {
  return process.env['MCP_GIT_SHA'] ?? 'unknown';
}

export function getBuildDate(): string {
  return process.env['MCP_BUILD_DATE'] ?? 'unknown';
}

export function getUptimeSeconds(): number {
  return Math.floor(process.uptime());
}
