export interface SessionLifecycleConfig {
  inactivityTimeoutMs: number;
  cleanupIntervalMs: number;
  maxSessions: number;
}

export interface SessionActivity {
  lastActivity: number;
  activeRequests: number;
}

const DEFAULT_INACTIVITY_TIMEOUT_SECONDS = 30 * 60;
const DEFAULT_CLEANUP_INTERVAL_SECONDS = 5 * 60;
const DEFAULT_MAX_SESSIONS = 0;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getSessionLifecycleConfig(env: NodeJS.ProcessEnv = process.env): SessionLifecycleConfig {
  const inactivitySeconds = parsePositiveInteger(
    env.MCP_SESSION_TTL_SECONDS,
    DEFAULT_INACTIVITY_TIMEOUT_SECONDS,
  );
  const requestedCleanupSeconds = parsePositiveInteger(
    env.MCP_SESSION_CLEANUP_INTERVAL_SECONDS,
    DEFAULT_CLEANUP_INTERVAL_SECONDS,
  );
  const cleanupSeconds = Math.min(requestedCleanupSeconds, inactivitySeconds);
  const maxSessions = parseNonNegativeInteger(env.MCP_MAX_SESSIONS, DEFAULT_MAX_SESSIONS);

  return {
    inactivityTimeoutMs: inactivitySeconds * 1000,
    cleanupIntervalMs: cleanupSeconds * 1000,
    maxSessions,
  };
}

export function selectOldestIdleSession<T extends SessionActivity>(
  sessions: Map<string, T>,
): string | undefined {
  let selectedId: string | undefined;
  let oldestActivity = Number.POSITIVE_INFINITY;

  for (const [sessionId, entry] of sessions) {
    if (entry.activeRequests !== 0) continue;
    if (entry.lastActivity < oldestActivity) {
      oldestActivity = entry.lastActivity;
      selectedId = sessionId;
    }
  }

  return selectedId;
}
