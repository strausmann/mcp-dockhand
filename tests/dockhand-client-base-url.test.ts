/**
 * DockhandClient.getBaseUrl() — exposes the client's own normalized base URL (trailing
 * slash(es) stripped by normalizeBaseUrl(), src/utils/url.ts, Issue #116), as opposed to
 * the raw `DOCKHAND_URL` config value, which may still carry one. `get_server_info`
 * (src/tools/meta.ts) reports this value rather than the raw env var so the diagnostic
 * reflects what the client actually talks to.
 */
import { describe, it, expect } from 'vitest';
import { DockhandClient } from '../src/client/dockhand-client.js';
import type { DockhandConfig } from '../src/types/dockhand.js';

function config(overrides: Partial<DockhandConfig> = {}): DockhandConfig {
  return {
    url: 'https://dockhand.example.com',
    username: 'admin',
    password: 'secret',
    ...overrides,
  };
}

describe('DockhandClient.getBaseUrl', () => {
  it('returns the configured URL unchanged when it has no trailing slash', () => {
    const client = new DockhandClient(config({ url: 'https://dockhand.example.com' }));
    expect(client.getBaseUrl()).toBe('https://dockhand.example.com');
  });

  it('strips a trailing slash (the Issue #116 normalization), unlike the raw config value', () => {
    const client = new DockhandClient(config({ url: 'https://dockhand.example.com/' }));
    expect(client.getBaseUrl()).toBe('https://dockhand.example.com');
  });

  it('strips multiple trailing slashes', () => {
    const client = new DockhandClient(config({ url: 'https://dockhand.example.com///' }));
    expect(client.getBaseUrl()).toBe('https://dockhand.example.com');
  });
});
