/**
 * listSelfCheckEnvironments() (src/tools/meta.ts) — self_check's environment listing,
 * driven against a recording fake client. Under MCP_READ_ONLY it must not issue the
 * per-environment POST /api/environments/{id}/test (a write upstream: it opens Docker/Hawser
 * connections and updates hawser fields) and must say per environment why it was skipped.
 */
import { describe, it, expect } from 'vitest';
import {
  listSelfCheckEnvironments,
  CONNECTION_TEST_SKIPPED_READ_ONLY,
} from '../../src/tools/meta.js';

function fakeClient() {
  const calls: string[] = [];
  const client = {
    async get(path: string) {
      calls.push(`GET ${path}`);
      if (path === '/api/environments') {
        return [
          { id: 1, name: 'socket-env', connectionType: 'socket' },
          { id: 2, name: 'edge-env', connectionType: 'hawser-edge' },
        ];
      }
      if (path === '/api/hawser/connect') return { connections: [{ environmentId: 2 }] };
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path: string) {
      calls.push(`POST ${path}`);
      return { success: true };
    },
  };
  return { client, calls };
}

describe('listSelfCheckEnvironments', () => {
  it('testConnections=false issues GETs only and marks each environment as untested', async () => {
    const { client, calls } = fakeClient();
    const envs = await listSelfCheckEnvironments(client as never, { testConnections: false });

    expect(calls).toEqual(['GET /api/environments', 'GET /api/hawser/connect']);
    expect(envs).toEqual([
      { id: 1, name: 'socket-env', reachable: false, hawserConnected: false, tested: false, skipReason: CONNECTION_TEST_SKIPPED_READ_ONLY },
      { id: 2, name: 'edge-env', reachable: false, hawserConnected: true, tested: false, skipReason: CONNECTION_TEST_SKIPPED_READ_ONLY },
    ]);
    expect(CONNECTION_TEST_SKIPPED_READ_ONLY).toMatch(/read-only/i);
  });

  it('testConnections=true tests every environment and keeps the original result shape', async () => {
    const { client, calls } = fakeClient();
    const envs = await listSelfCheckEnvironments(client as never, { testConnections: true });

    expect(calls).toEqual([
      'GET /api/environments',
      'GET /api/hawser/connect',
      'POST /api/environments/1/test',
      'POST /api/environments/2/test',
    ]);
    expect(envs).toEqual([
      { id: 1, name: 'socket-env', reachable: true, hawserConnected: false },
      { id: 2, name: 'edge-env', reachable: true, hawserConnected: true },
    ]);
  });
});
