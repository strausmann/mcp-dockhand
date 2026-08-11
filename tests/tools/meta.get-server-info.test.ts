import { describe, it, expect } from 'vitest';
import { buildServerInfo } from '../../src/tools/meta.js';

describe('buildServerInfo', () => {
  it('assembles identity + best-effort dockhand version', async () => {
    const info = await buildServerInfo({
      dockhandUrl: 'https://dock.example.com',
      getDockhandServerVersion: async () => '1.0.41',
    });
    expect(info.version).toBeDefined();
    expect(info.dockhandUrl).toBe('https://dock.example.com');
    expect(info.dockhandServerVersion).toBe('1.0.41');
    expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('degrades dockhand version to null on failure', async () => {
    const info = await buildServerInfo({
      dockhandUrl: 'https://dock.example.com',
      getDockhandServerVersion: async () => {
        throw new Error('unreachable');
      },
    });
    expect(info.dockhandServerVersion).toBeNull();
  });
});
