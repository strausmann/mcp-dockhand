import { describe, expect, it, vi } from 'vitest';
import {
  beginFoundingSession,
  completeFoundingSession,
  getSessionLifecycleConfig,
  removeSessionEntry,
  selectOldestIdleSession,
  type ManagedSessionEntry,
} from '../src/session-lifecycle.js';

describe('session lifecycle configuration', () => {
  it('keeps the existing timeout defaults when no overrides are set', () => {
    expect(getSessionLifecycleConfig({})).toEqual({
      inactivityTimeoutMs: 30 * 60 * 1000,
      cleanupIntervalMs: 5 * 60 * 1000,
      maxSessions: 0,
    });
  });

  it('parses explicit TTL, cleanup interval, and maximum session count', () => {
    expect(getSessionLifecycleConfig({
      MCP_SESSION_TTL_SECONDS: '600',
      MCP_SESSION_CLEANUP_INTERVAL_SECONDS: '60',
      MCP_MAX_SESSIONS: '32',
    })).toEqual({ inactivityTimeoutMs: 600_000, cleanupIntervalMs: 60_000, maxSessions: 32 });
  });

  it('clamps cleanup interval to the inactivity TTL', () => {
    expect(getSessionLifecycleConfig({
      MCP_SESSION_TTL_SECONDS: '30',
      MCP_SESSION_CLEANUP_INTERVAL_SECONDS: '120',
    }).cleanupIntervalMs).toBe(30_000);
  });

  it('falls back safely for invalid values while allowing zero to mean unlimited sessions', () => {
    expect(getSessionLifecycleConfig({
      MCP_SESSION_TTL_SECONDS: 'invalid',
      MCP_SESSION_CLEANUP_INTERVAL_SECONDS: '-1',
      MCP_MAX_SESSIONS: '0',
    })).toEqual({
      inactivityTimeoutMs: 30 * 60 * 1000,
      cleanupIntervalMs: 5 * 60 * 1000,
      maxSessions: 0,
    });
  });
});

describe('session capacity eviction', () => {
  it('selects the oldest idle session and never selects active sessions', () => {
    const sessions = new Map([
      ['active-oldest', { lastActivity: 1, activeRequests: 1 }],
      ['idle-newer', { lastActivity: 30, activeRequests: 0 }],
      ['idle-oldest', { lastActivity: 10, activeRequests: 0 }],
    ]);
    expect(selectOldestIdleSession(sessions)).toBe('idle-oldest');
    expect(selectOldestIdleSession(new Map([['active', { lastActivity: 1, activeRequests: 2 }]]))).toBeUndefined();
  });
});

function fakeEntry(overrides: Partial<ManagedSessionEntry> = {}): ManagedSessionEntry {
  return {
    server: { close: vi.fn().mockResolvedValue(undefined) },
    transport: {},
    lastActivity: Date.now(),
    activeRequests: 0,
    ...overrides,
  };
}

describe('beginFoundingSession / completeFoundingSession (bug: founding session evictable mid-initialize)', () => {
  it('registers a brand-new session as busy (activeRequests: 1), not idle', () => {
    const sessions = new Map<string, ManagedSessionEntry>();
    beginFoundingSession(sessions, 'founding', { server: { close: vi.fn() }, transport: {} });

    expect(sessions.get('founding')?.activeRequests).toBe(1);
  });

  it('never lets selectOldestIdleSession pick a session whose founding request is still in flight, even if it is the only (and therefore oldest) session', () => {
    const sessions = new Map<string, ManagedSessionEntry>();
    beginFoundingSession(sessions, 'founding', { server: { close: vi.fn() }, transport: {} }, 1 /* very old lastActivity */);

    // Without the fix, onsessioninitialized stored activeRequests: 0 for the
    // founding entry, so this session -- the only candidate -- would have
    // been evicted by selectOldestIdleSession() while its own initialize
    // handshake was still being served by transport.handleRequest(...).
    expect(selectOldestIdleSession(sessions)).toBeUndefined();
  });

  it('releases the busy marker once the founding request has resolved, making the session evictable again under normal idle rules', () => {
    const sessions = new Map<string, ManagedSessionEntry>();
    beginFoundingSession(sessions, 'founding', { server: { close: vi.fn() }, transport: {} }, 1);

    completeFoundingSession(sessions, 'founding');

    expect(sessions.get('founding')?.activeRequests).toBe(0);
    expect(selectOldestIdleSession(sessions)).toBe('founding');
  });

  it('completeFoundingSession is a no-op when the session no longer exists (e.g. removed by an initialization failure)', () => {
    const sessions = new Map<string, ManagedSessionEntry>();
    expect(() => completeFoundingSession(sessions, 'missing')).not.toThrow();
  });
});

describe('removeSessionEntry (bug: DELETE-triggered cleanup never running)', () => {
  it('closes the server and logs the removal using an already-captured entry, even when the session was already deleted from the map', async () => {
    const sessions = new Map<string, ManagedSessionEntry>();
    const closeServer = vi.fn().mockResolvedValue(undefined);
    const entry = fakeEntry({ server: { close: closeServer } });
    sessions.set('deleted-by-client', entry);

    // Simulate the MCP SDK's own DELETE handling: transport.handleRequest()
    // calls transport.close() internally, which fires the transport's
    // onclose handler and deletes the map entry -- BEFORE the DELETE route
    // handler gets a chance to call removeSession(sessionId, 'client
    // delete'). Without the fix, a subsequent sessions.get(sessionId) here
    // returns undefined and the whole cleanup silently no-ops.
    sessions.delete('deleted-by-client');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await removeSessionEntry(sessions, 'deleted-by-client', entry, 'client delete');

    // Assert before mockRestore(): restoring also clears the recorded call
    // history (mockRestore implies mockReset/mockClear), so checking after
    // restoring would always see zero calls regardless of behaviour.
    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[session] Removed session deleted-by-client (client delete'),
    );

    errorSpy.mockRestore();
  });

  it('still removes/closes correctly on the normal path where the entry is still present in the map', async () => {
    const sessions = new Map<string, ManagedSessionEntry>();
    const closeServer = vi.fn().mockResolvedValue(undefined);
    const entry = fakeEntry({ server: { close: closeServer } });
    sessions.set('still-present', entry);

    await removeSessionEntry(sessions, 'still-present', entry, 'inactivity timeout');

    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(sessions.has('still-present')).toBe(false);
  });

  it('falls back to transport.close() and stays idempotent-safe if server.close() throws (double-close from a racing onclose)', async () => {
    const sessions = new Map<string, ManagedSessionEntry>();
    const closeServer = vi.fn().mockRejectedValue(new Error('already closed'));
    const closeTransport = vi.fn().mockResolvedValue(undefined);
    const entry = fakeEntry({ server: { close: closeServer }, transport: { close: closeTransport } });
    sessions.set('racing-close', entry);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(removeSessionEntry(sessions, 'racing-close', entry, 'client delete')).resolves.toBeUndefined();
    errorSpy.mockRestore();

    expect(closeTransport).toHaveBeenCalledTimes(1);
  });
});
