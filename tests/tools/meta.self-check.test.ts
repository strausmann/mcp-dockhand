import { describe, it, expect } from 'vitest';
import { runSelfCheck } from '../../src/tools/meta.js';
import type { SelfCheckEnvironment } from '../../src/tools/meta.js';

describe('runSelfCheck', () => {
  it('reports ok when Dockhand is reachable, auth is valid, and all environments are reachable', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => [
        { id: 1, name: 'production', reachable: true, hawserConnected: true },
        { id: 2, name: 'staging', reachable: true, hawserConnected: false },
      ],
    });

    expect(result.dockhandReachable).toBe(true);
    expect(result.authValid).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.environments).toHaveLength(2);
    expect(result.overall).toBe('ok');
  });

  it('reports degraded when the auth probe signals an invalid credential (401)', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: async () => false,
      listEnvironments: async () => [
        { id: 1, name: 'production', reachable: true, hawserConnected: true },
      ],
    });

    expect(result.dockhandReachable).toBe(true);
    expect(result.authValid).toBe(false);
    expect(result.overall).toBe('degraded');
  });

  it('reports degraded when at least one environment is unreachable, even with valid auth', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => [
        { id: 1, name: 'production', reachable: true, hawserConnected: true },
        { id: 2, name: 'offline-site', reachable: false, hawserConnected: false },
      ],
    });

    expect(result.authValid).toBe(true);
    expect(result.overall).toBe('degraded');
  });

  it('reports down when the health probe throws (unreachable/timeout), without calling auth or environments probes', async () => {
    let authProbeCalled = false;
    let envProbeCalled = false;

    const result = await runSelfCheck({
      probeHealth: async () => {
        throw new Error('ECONNREFUSED');
      },
      probeAuth: async () => {
        authProbeCalled = true;
        return true;
      },
      listEnvironments: async () => {
        envProbeCalled = true;
        return [];
      },
    });

    expect(result.dockhandReachable).toBe(false);
    expect(result.authValid).toBe(false);
    expect(result.environments).toEqual([]);
    expect(result.overall).toBe('down');
    expect(typeof result.latencyMs).toBe('number');
    expect(authProbeCalled).toBe(false);
    expect(envProbeCalled).toBe(false);
  });

  it('reports down when the health probe times out (rejects)', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {
        return Promise.reject(new Error('timeout'));
      },
      probeAuth: async () => true,
      listEnvironments: async () => [],
    });

    expect(result.dockhandReachable).toBe(false);
    expect(result.overall).toBe('down');
  });

  it('never includes secret values (e.g. tokens) in the result — outcome-only verification', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => [{ id: 1, name: 'production', reachable: true, hawserConnected: true }],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/password/i);
  });

  it('degrades gracefully (does not throw) if the environments probe itself fails', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => {
        throw new Error('network error listing environments');
      },
    });

    expect(result.dockhandReachable).toBe(true);
    expect(result.environments).toEqual([]);
    expect(result.overall).toBe('degraded');
  });

  it('returns degraded within the phase deadline (not a hang) when the auth probe never resolves (Fix round 3, Finding 2)', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: () => new Promise<boolean>(() => {}), // never settles
      listEnvironments: async () => [{ id: 1, name: 'production', reachable: true, hawserConnected: true }],
      phaseTimeoutMs: 20,
    });

    expect(result.dockhandReachable).toBe(true);
    expect(result.authValid).toBe(false);
    expect(result.overall).toBe('degraded');
  });

  it('returns degraded within the phase deadline (not a hang) when the environments probe never resolves', async () => {
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: () => new Promise<SelfCheckEnvironment[]>(() => {}), // never settles
      phaseTimeoutMs: 20,
    });

    expect(result.dockhandReachable).toBe(true);
    expect(result.authValid).toBe(true);
    expect(result.environments).toEqual([]);
    expect(result.overall).toBe('degraded');
  });

  it('returns down within the phase deadline (not a hang) when the health probe never resolves', async () => {
    const result = await runSelfCheck({
      probeHealth: () => new Promise<void>(() => {}), // never settles
      probeAuth: async () => true,
      listEnvironments: async () => [],
      phaseTimeoutMs: 20,
    });

    expect(result.dockhandReachable).toBe(false);
    expect(result.overall).toBe('down');
  });

  it('uses the injected clock to measure latency deterministically', async () => {
    const timestamps = [1000, 1250];
    const result = await runSelfCheck({
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => [],
      now: () => timestamps.shift()!,
    });

    expect(result.latencyMs).toBe(250);
  });
});
