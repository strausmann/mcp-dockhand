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
