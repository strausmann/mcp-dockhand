/**
 * deriveEnvironmentStatuses() (src/tools/meta.ts) — the pure, injectable per-environment
 * status derivation behind `self_check`'s `listEnvironments` wiring. Extracted in Fix
 * round 1 (Finding 2 of the Task 9 review): this mapping previously lived, untested,
 * inline inside the `registerTool('self_check', ...)` closure. Covers the five cases the
 * review explicitly asked for: hawser-edge connected, hawser-edge disconnected, socket
 * reachable, socket unreachable, and the probe/`/test`-throws fallback.
 */
import { describe, it, expect } from 'vitest';
import { deriveEnvironmentStatuses, type EnvironmentListEntry } from '../../src/tools/meta.js';

describe('deriveEnvironmentStatuses', () => {
  it('a hawser-edge environment whose agent IS in the connected set is reachable and hawserConnected', () => {
    const environments: EnvironmentListEntry[] = [{ id: 1, name: 'hhdocker02', connectionType: 'hawser-edge' }];
    const result = deriveEnvironmentStatuses(environments, new Set([1]), new Map([[1, true]]));

    expect(result).toEqual([{ id: 1, name: 'hhdocker02', reachable: true, hawserConnected: true }]);
  });

  it('a hawser-edge environment whose agent is NOT in the connected set is neither reachable nor hawserConnected', () => {
    const environments: EnvironmentListEntry[] = [{ id: 2, name: 'hhdocker03', connectionType: 'hawser-edge' }];
    // Fix round 1, Finding 1: `reachable` no longer follows from connectionType alone —
    // it is the live /test result, passed in here as `false` (matching the real wiring's
    // "agent unreachable" case, which would also fail its /test probe).
    const result = deriveEnvironmentStatuses(environments, new Set(), new Map([[2, false]]));

    expect(result).toEqual([{ id: 2, name: 'hhdocker03', reachable: false, hawserConnected: false }]);
  });

  it('a socket environment that IS reachable per its /test probe is reachable, and never hawserConnected', () => {
    const environments: EnvironmentListEntry[] = [{ id: 3, name: 'hhdocker01', connectionType: 'socket' }];
    // Even if id 3 somehow appeared in connectedAgentIds, a non-hawser-edge environment
    // must never read as hawserConnected — there is no agent to be connected.
    const result = deriveEnvironmentStatuses(environments, new Set([3]), new Map([[3, true]]));

    expect(result).toEqual([{ id: 3, name: 'hhdocker01', reachable: true, hawserConnected: false }]);
  });

  it('a socket environment that is NOT reachable per its /test probe is reachable:false (Finding 1: no longer hardcoded true)', () => {
    const environments: EnvironmentListEntry[] = [{ id: 4, name: 'hhdocker04', connectionType: 'socket' }];
    const result = deriveEnvironmentStatuses(environments, new Set(), new Map([[4, false]]));

    expect(result).toEqual([{ id: 4, name: 'hhdocker04', reachable: false, hawserConnected: false }]);
  });

  it('an environment missing from perEnvReachable (its /test probe threw or timed out) degrades to reachable:false', () => {
    const environments: EnvironmentListEntry[] = [{ id: 5, name: 'flaky-env', connectionType: 'socket' }];
    // No entry for id 5 at all — the real wiring leaves it unset when Promise.allSettled
    // rejects that probe (throw or withTimeout() timeout). Must degrade, never throw.
    const result = deriveEnvironmentStatuses(environments, new Set(), new Map());

    expect(result).toEqual([{ id: 5, name: 'flaky-env', reachable: false, hawserConnected: false }]);
  });

  it('handles an empty environment list', () => {
    expect(deriveEnvironmentStatuses([], new Set(), new Map())).toEqual([]);
  });

  it('maps multiple environments of mixed connection types independently', () => {
    const environments: EnvironmentListEntry[] = [
      { id: 1, name: 'edge-up', connectionType: 'hawser-edge' },
      { id: 2, name: 'edge-down', connectionType: 'hawser-edge' },
      { id: 3, name: 'socket-up', connectionType: 'socket' },
      { id: 4, name: 'socket-down', connectionType: 'socket' },
    ];
    const connectedAgentIds = new Set([1]);
    const perEnvReachable = new Map([
      [1, true],
      [2, false],
      [3, true],
      [4, false],
    ]);

    const result = deriveEnvironmentStatuses(environments, connectedAgentIds, perEnvReachable);

    expect(result).toEqual([
      { id: 1, name: 'edge-up', reachable: true, hawserConnected: true },
      { id: 2, name: 'edge-down', reachable: false, hawserConnected: false },
      { id: 3, name: 'socket-up', reachable: true, hawserConnected: false },
      { id: 4, name: 'socket-down', reachable: false, hawserConnected: false },
    ]);
  });

  it('treats a missing connectionType as non-hawser (never hawserConnected)', () => {
    const environments: EnvironmentListEntry[] = [{ id: 6, name: 'unknown-type' }];
    const result = deriveEnvironmentStatuses(environments, new Set([6]), new Map([[6, true]]));

    expect(result).toEqual([{ id: 6, name: 'unknown-type', reachable: true, hawserConnected: false }]);
  });
});
