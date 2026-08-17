import { logger } from './utils/logger.js';

export interface SessionLifecycleConfig {
  inactivityTimeoutMs: number;
  cleanupIntervalMs: number;
  maxSessions: number;
}

export interface SessionActivity {
  lastActivity: number;
  activeRequests: number;
}

/** Minimal shape a session's McpServer must expose for lifecycle bookkeeping. */
export interface CloseableServer {
  close(): Promise<void>;
}

/** Minimal shape a session's transport must expose for lifecycle bookkeeping. */
export interface CloseableTransport {
  close?: () => Promise<void>;
}

/** A session record as tracked by server.ts, generic enough to unit-test
 * without any Express/HTTP/MCP-SDK involvement. */
export interface ManagedSessionEntry extends SessionActivity {
  server: CloseableServer;
  transport: CloseableTransport;
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

/**
 * Registers a session record the moment the Streamable HTTP transport mints
 * its session ID (the SDK's `onsessioninitialized` callback) -- while the
 * *founding* `transport.handleRequest(...)` call that is processing the
 * initialize handshake for that very session is still in flight.
 *
 * The entry starts busy (`activeRequests: 1`) rather than idle. Without this,
 * a brand-new session sat in the map with `activeRequests: 0` for the entire
 * duration of its own initialize handshake, making it eligible for capacity
 * eviction via {@link selectOldestIdleSession} -- a concurrent session
 * creation under `MCP_MAX_SESSIONS` could then evict a session that was still
 * being initialized, aborting its handshake and leaving the client holding an
 * already-invalidated session ID.
 */
export function beginFoundingSession<T extends ManagedSessionEntry>(
  sessions: Map<string, T>,
  id: string,
  base: Omit<T, 'lastActivity' | 'activeRequests'>,
  now: number = Date.now(),
): void {
  sessions.set(id, { ...base, lastActivity: now, activeRequests: 1 } as T);
}

/**
 * Releases the busy marker set by {@link beginFoundingSession} once the
 * founding `transport.handleRequest(...)` call has resolved (the initialize
 * response/SSE stream has been fully handed off to the client). From this
 * point on, normal idle-eviction and inactivity-timeout accounting applies.
 *
 * A no-op if the session is no longer present (e.g. it was already removed
 * because initialization failed).
 */
export function completeFoundingSession<T extends SessionActivity>(
  sessions: Map<string, T>,
  id: string,
  now: number = Date.now(),
): void {
  const entry = sessions.get(id);
  if (!entry) return;
  entry.activeRequests = Math.max(0, entry.activeRequests - 1);
  entry.lastActivity = now;
}

/**
 * Removes and closes a session using an already-known entry reference,
 * independent of whether the session is still present in `sessions`.
 *
 * This matters specifically for the DELETE `/mcp` path: the MCP SDK's own
 * DELETE handling calls `transport.close()` internally, which fires the
 * transport's `onclose` handler and can already have deleted the map entry
 * *before* the route handler gets a chance to run its own cleanup. A
 * lookup-based removal (`sessions.get(id)` then bail if missing) silently
 * no-ops in that case, so `server.close()` and the removal log never run.
 * Passing the entry captured *before* the request was served sidesteps that
 * race entirely.
 *
 * Safe to call even if `server.close()` throws because the session (and
 * therefore its transport) was already closed by a racing `onclose` --
 * the error is swallowed after a best-effort `transport.close()` fallback.
 */
export async function removeSessionEntry<T extends ManagedSessionEntry>(
  sessions: Map<string, T>,
  id: string,
  entry: T,
  reason: string,
): Promise<void> {
  sessions.delete(id);
  try {
    await entry.server.close();
  } catch (error) {
    logger.error({ component: 'session', sid: id, err: error }, 'error closing server');
    try {
      await entry.transport.close?.();
    } catch {
      // Best-effort fallback only.
    }
  }
  logger.info({ component: 'session', sid: id, reason, active: sessions.size }, 'session removed');
}
