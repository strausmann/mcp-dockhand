import { describe, it, expect, beforeEach } from 'vitest';
import { recordCall, recordError, getStatsSnapshot, __resetStats } from '../../src/utils/runtime-stats.js';

describe('runtime-stats', () => {
  beforeEach(() => {
    __resetStats();
  });

  it('recordCall increments the global and per-tool call counters', () => {
    recordCall('x');
    recordCall('x');
    const snap = getStatsSnapshot();
    expect(snap.requestCount).toBeGreaterThanOrEqual(2);
    expect(snap.perTool['x']?.calls).toBeGreaterThanOrEqual(2);
  });

  it('recordCall tracks separate tools independently', () => {
    recordCall('x');
    recordCall('y');
    recordCall('y');
    const snap = getStatsSnapshot();
    expect(snap.perTool['x']?.calls).toBe(1);
    expect(snap.perTool['y']?.calls).toBe(2);
  });

  it('recordError increments the global and per-tool error counters and sets lastError', () => {
    recordCall('x');
    recordError('x', 'boom');
    const snap = getStatsSnapshot();
    expect(snap.errorCount).toBeGreaterThanOrEqual(1);
    expect(snap.perTool['x']?.errors).toBeGreaterThanOrEqual(1);
    expect(snap.lastError).toMatchObject({ tool: 'x', message: 'boom' });
    expect(typeof snap.lastError?.at).toBe('string');
  });

  it('recordError overwrites lastError with the most recent failure', () => {
    recordError('a', 'first');
    recordError('b', 'second');
    const snap = getStatsSnapshot();
    expect(snap.lastError).toMatchObject({ tool: 'b', message: 'second' });
  });

  describe('recordError bounds an unbounded upstream error message (Self-Help Final Fix Wave, Finding 2)', () => {
    // DockhandClient.request() builds error.message as `Dockhand API error: ${method}
    // ${url} returned ${status}: ${errorBody}` — errorBody is an upstream HTTP response
    // body of arbitrary size. get_runtime_stats echoes lastError.message to any caller, so
    // recordError must never store it unbounded.

    it('leaves a short message unchanged', () => {
      recordError('x', 'short message');
      const snap = getStatsSnapshot();
      expect(snap.lastError?.message).toBe('short message');
    });

    it('truncates a message longer than 500 characters and appends an ellipsis marker', () => {
      const longMessage = 'a'.repeat(2000);
      recordError('x', longMessage);
      const snap = getStatsSnapshot();
      const stored = snap.lastError?.message ?? '';
      expect(stored.length).toBeLessThan(longMessage.length);
      expect(stored.length).toBeLessThanOrEqual(501); // 500 chars + 1-char ellipsis marker
      expect(stored.startsWith('a'.repeat(500))).toBe(true);
      expect(stored.endsWith('…')).toBe(true);
    });

    it('leaves a message exactly at the 500-character limit unchanged (no trailing ellipsis)', () => {
      const exactMessage = 'b'.repeat(500);
      recordError('x', exactMessage);
      const snap = getStatsSnapshot();
      expect(snap.lastError?.message).toBe(exactMessage);
      expect(snap.lastError?.message.endsWith('…')).toBe(false);
    });

    it('a realistic unbounded Dockhand upstream-body message is bounded in the stored snapshot', () => {
      const hugeUpstreamBody = '{"error":"' + 'x'.repeat(10_000) + '"}';
      const message = `Dockhand API error: PUT /api/stacks/foo/env returned 500: ${hugeUpstreamBody}`;
      recordError('update_stack_env', message);
      const snap = getStatsSnapshot();
      expect(snap.lastError?.message.length).toBeLessThanOrEqual(501);
      expect(snap.lastError?.message).toContain('Dockhand API error: PUT /api/stacks/foo/env returned 500:');
    });
  });

  it('getStatsSnapshot exposes startedAt as an ISO timestamp', () => {
    const snap = getStatsSnapshot();
    expect(typeof snap.startedAt).toBe('string');
    expect(() => new Date(snap.startedAt).toISOString()).not.toThrow();
  });

  it('getStatsSnapshot has the expected shape with zero counters after reset', () => {
    const snap = getStatsSnapshot();
    expect(snap).toMatchObject({
      requestCount: 0,
      errorCount: 0,
      perTool: {},
      lastError: null,
    });
  });

  it('snapshot never contains argument or response payloads — only counters and lastError.{tool,message,at}', () => {
    recordCall('x');
    recordError('x', 'boom');
    const snap = getStatsSnapshot();
    const serialized = JSON.stringify(snap);

    // Structural guarantee: lastError has exactly the three safe keys.
    expect(Object.keys(snap.lastError ?? {}).sort()).toEqual(['at', 'message', 'tool']);

    // No accidental extra top-level keys that could carry payload data.
    expect(Object.keys(snap).sort()).toEqual(
      ['errorCount', 'lastError', 'perTool', 'requestCount', 'startedAt'].sort()
    );

    // perTool entries only ever carry the two numeric counters.
    for (const entry of Object.values(snap.perTool)) {
      expect(Object.keys(entry).sort()).toEqual(['calls', 'errors']);
    }

    // Nothing resembling an args/response/payload key ever appears anywhere in the snapshot.
    expect(serialized).not.toMatch(/"(args|arguments|payload|response|result)"/);
  });

  it('__resetStats clears all counters and lastError', () => {
    recordCall('x');
    recordError('x', 'boom');
    __resetStats();
    const snap = getStatsSnapshot();
    expect(snap.requestCount).toBe(0);
    expect(snap.errorCount).toBe(0);
    expect(snap.perTool).toEqual({});
    expect(snap.lastError).toBeNull();
  });
});
