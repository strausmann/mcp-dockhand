import { describe, expect, it } from 'vitest';
import { getSessionLifecycleConfig, selectOldestIdleSession } from '../src/session-lifecycle.js';

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
