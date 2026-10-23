import { describe, it, expect } from 'vitest';
import { runSelfCheck } from '../../src/tools/meta.js';
import type { SelfCheckEnvironment } from '../../src/tools/meta.js';
import type { ToolPolicySummary } from '../../src/utils/tool-policy.js';

/**
 * Walks an arbitrary JSON-like value and yields a dotted path for every key/leaf it
 * contains (Issue #224). Lets a check name the exact field it denies instead of
 * regex-sweeping a `JSON.stringify()` of the whole thing — where a match against an
 * unrelated field's name or value would fail the test for the wrong reason.
 */
function walkEntries(value: unknown, path = 'result'): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [[path, value]];
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      entries.push(...walkEntries(child, `${path}.${key}`));
    }
  }
  return entries;
}

const POLICY: ToolPolicySummary = {
  readOnly: false,
  allow: [],
  deny: [],
  registered: 3,
  total: 3,
  readmittedWriteTools: [],
};

describe('runSelfCheck', () => {
  it('reports ok when Dockhand is reachable, auth is valid, and all environments are reachable', async () => {
    const result = await runSelfCheck({
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => [{ id: 1, name: 'production', reachable: true, hawserConnected: true }],
    });

    // Field-scoped (Issue #224): walk the actual result shape and name the offending
    // field/value on failure. A blind `JSON.stringify(result)` sweep would fail for
    // the wrong reason the day a legitimate, non-secret field name happens to contain
    // one of these words (e.g. "authTokenPresent: boolean") — this still catches an
    // unexpected new field anywhere in the tree, but says exactly which one.
    for (const [path, value] of walkEntries(result)) {
      expect(path, `field name "${path}"`).not.toMatch(/token|secret|password/i);
      if (typeof value === 'string') {
        expect(value, `value of "${path}"`).not.toMatch(/token|secret|password/i);
      }
    }
  });

  it('degrades gracefully (does not throw) if the environments probe itself fails', async () => {
    const result = await runSelfCheck({
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
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
      toolPolicy: POLICY,
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => [],
      now: () => timestamps.shift()!,
    });

    expect(result.latencyMs).toBe(250);
  });
  it('echoes the injected tool policy summary on every outcome, including down', async () => {
    const summary: ToolPolicySummary = {
      readOnly: true,
      allow: ['cancel_job'],
      deny: ['delete_*'],
      registered: 2,
      total: 5,
      readmittedWriteTools: ['cancel_job'],
    };
    const ok = await runSelfCheck({
      toolPolicy: summary,
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async () => [],
    });
    expect(ok.toolPolicy).toEqual(summary);

    const down = await runSelfCheck({
      toolPolicy: summary,
      probeHealth: async () => {
        throw new Error('unreachable');
      },
      probeAuth: async () => true,
      listEnvironments: async () => [],
    });
    expect(down.overall).toBe('down');
    expect(down.toolPolicy).toEqual(summary);
  });

  // Read-only mode (issue #254, security review): the per-environment connection test is
  // POST /api/environments/{id}/test, a write, so runSelfCheck asks listEnvironments not to
  // run it, and an untested environment must not degrade `overall`.
  it('read-only: asks listEnvironments to skip connection tests; untested envs do not degrade', async () => {
    const seen: Array<{ testConnections: boolean }> = [];
    const result = await runSelfCheck({
      toolPolicy: { ...POLICY, readOnly: true },
      readOnly: true,
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async (opts) => {
        seen.push(opts);
        return [
          { id: 1, name: 'production', reachable: false, hawserConnected: false, tested: false, skipReason: 'x' },
        ];
      },
    });

    expect(seen).toEqual([{ testConnections: false }]);
    expect(result.overall).toBe('ok');
    expect(result.environments[0]).toMatchObject({ tested: false });
  });

  it('default: asks listEnvironments to run connection tests', async () => {
    const seen: Array<{ testConnections: boolean }> = [];
    await runSelfCheck({
      toolPolicy: POLICY,
      probeHealth: async () => {},
      probeAuth: async () => true,
      listEnvironments: async (opts) => {
        seen.push(opts);
        return [];
      },
    });
    expect(seen).toEqual([{ testConnections: true }]);
  });
});
