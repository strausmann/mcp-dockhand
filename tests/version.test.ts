import { describe, it, expect, afterEach } from 'vitest';
import { getServerVersion, getGitSha, getBuildDate, getUptimeSeconds } from '../src/version.js';

describe('version', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads injected env, falls back when absent', () => {
    process.env.MCP_SERVER_VERSION = '1.12.0';
    process.env.MCP_GIT_SHA = 'abc1234';
    process.env.MCP_BUILD_DATE = '2026-08-11T00:00:00Z';
    expect(getServerVersion()).toBe('1.12.0');
    expect(getGitSha()).toBe('abc1234');
    expect(getBuildDate()).toBe('2026-08-11T00:00:00Z');
    delete process.env.MCP_SERVER_VERSION;
    expect(getServerVersion()).toBe('0.0.0-dev');
  });

  it('uptime is a non-negative integer', () => {
    expect(getUptimeSeconds()).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(getUptimeSeconds())).toBe(true);
  });
});
