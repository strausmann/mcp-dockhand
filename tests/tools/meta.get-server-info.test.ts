import { describe, it, expect } from 'vitest';
import { buildServerInfo } from '../../src/tools/meta.js';
import type { ToolPolicySummary } from '../../src/utils/tool-policy.js';

const POLICY: ToolPolicySummary = {
  readOnly: true,
  allow: ['cancel_job'],
  deny: ['delete_*'],
  registered: 10,
  total: 20,
  readmittedWriteTools: ['cancel_job'],
};

describe('buildServerInfo', () => {
  it('assembles identity + best-effort dockhand version', async () => {
    const info = await buildServerInfo({
      toolPolicy: POLICY,
      dockhandUrl: 'https://dock.example.com',
      getDockhandServerVersion: async () => '1.0.41',
    });
    expect(info.version).toBeDefined();
    expect(info.dockhandUrl).toBe('https://dock.example.com');
    expect(info.dockhandServerVersion).toBe('1.0.41');
    expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('echoes the injected tool policy summary unchanged', async () => {
    const info = await buildServerInfo({
      toolPolicy: POLICY,
      dockhandUrl: 'https://dock.example.com',
      getDockhandServerVersion: async () => '1.0.41',
    });
    expect(info.toolPolicy).toEqual(POLICY);
  });

  it('degrades dockhand version to null on failure', async () => {
    const info = await buildServerInfo({
      toolPolicy: POLICY,
      dockhandUrl: 'https://dock.example.com',
      getDockhandServerVersion: async () => {
        throw new Error('unreachable');
      },
    });
    expect(info.dockhandServerVersion).toBeNull();
  });
});
