/**
 * Startup wiring of the tool policy (issue #254): an invalid MCP_TOOLS_* config is a fatal
 * startup error written through logFatalSync (fd 2) before process.exit(1) — same pattern
 * as the other fatal paths, see tests/index-fatal-exit-logging.test.ts — and a valid one
 * is configured before createServer() runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

function capture() {
  const calls: string[] = [];
  vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
    if (fd === 2) {
      const text = String(buffer);
      calls.push(`write:${text}`);
      return Buffer.byteLength(text);
    }
    return 0;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    calls.push(`exit:${code}`);
    throw new Error('process.exit called');
  }) as never);
  return calls;
}

describe('src/index.ts tool policy startup', () => {
  const originalEnv = { ...process.env };
  let uncaughtBefore = process.listeners('uncaughtException');
  let rejectionBefore = process.listeners('unhandledRejection');

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env['DOCKHAND_URL'] = 'https://dockhand.example';
    process.env['DOCKHAND_USERNAME'] = 'admin';
    process.env['DOCKHAND_PASSWORD'] = 'secret';
    delete process.env['MCP_READ_ONLY'];
    delete process.env['MCP_TOOLS_ALLOW'];
    delete process.env['MCP_TOOLS_DENY'];
    uncaughtBefore = process.listeners('uncaughtException');
    rejectionBefore = process.listeners('unhandledRejection');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.doUnmock('../src/server.js');
    for (const l of process.listeners('uncaughtException')) {
      if (!uncaughtBefore.includes(l)) process.removeListener('uncaughtException', l);
    }
    for (const l of process.listeners('unhandledRejection')) {
      if (!rejectionBefore.includes(l)) process.removeListener('unhandledRejection', l);
    }
  });

  it('a MCP_TOOLS_DENY entry matching no tool is fatal: fd-2 line naming it, then exit(1), no server', async () => {
    const createServer = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.doMock('../src/server.js', () => ({ createServer }));
    const calls = capture();
    process.env['MCP_TOOLS_DENY'] = 'contianer_*';

    await expect(import('../src/index.js')).rejects.toThrow('process.exit called');

    expect(calls.at(-1)).toBe('exit:1');
    const line = calls.at(-2)!.slice('write:'.length);
    const parsed = JSON.parse(line);
    expect(parsed).not.toHaveProperty('pid');
    expect(parsed).toMatchObject({ level: 'error', component: 'config' });
    expect(parsed.msg).toContain('MCP_TOOLS_DENY');
    expect(parsed.msg).toContain('contianer_*');
    expect(createServer).not.toHaveBeenCalled();
  });

  it('a valid policy is configured before createServer and logged', async () => {
    let registeredAtStart: boolean | undefined;
    vi.doMock('../src/server.js', () => ({
      createServer: vi.fn().mockImplementation(async () => {
        const { currentToolPolicy: cur } = await import('../src/utils/tool-policy.js');
        registeredAtStart = cur().isRegistered('cancel_job');
        return new Promise(() => {});
      }),
    }));
    const calls: string[] = [];
    vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
      if (fd === 2) {
        calls.push(String(buffer));
        return Buffer.byteLength(String(buffer));
      }
      return 0;
    });
    process.env['MCP_READ_ONLY'] = 'true';

    await import('../src/index.js');
    await new Promise((r) => setTimeout(r, 0));

    expect(registeredAtStart).toBe(false);
    const policyLine = calls.map((c) => c.trim()).find((c) => c.includes('"tool policy"'));
    expect(policyLine).toBeDefined();
    const info = JSON.parse(policyLine!);
    expect(info).toMatchObject({ component: 'tools', readOnly: true });
    expect(info.registered).toBeGreaterThan(0);
    expect(info.registered).toBeLessThan(info.total);
  });

  it('exact MCP_TOOLS_ALLOW re-admitting a write tool under MCP_READ_ONLY logs a warn', async () => {
    vi.doMock('../src/server.js', () => ({ createServer: vi.fn().mockReturnValue(new Promise(() => {})) }));
    const calls: string[] = [];
    vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
      if (fd === 2) {
        calls.push(String(buffer));
        return Buffer.byteLength(String(buffer));
      }
      return 0;
    });
    process.env['MCP_READ_ONLY'] = 'true';
    process.env['MCP_TOOLS_ALLOW'] = 'cancel_job';

    await import('../src/index.js');
    await new Promise((r) => setTimeout(r, 0));

    const warnLine = calls
      .map((c) => c.trim())
      .find((c) => c.includes('write tools re-admitted under MCP_READ_ONLY via exact MCP_TOOLS_ALLOW names'));
    expect(warnLine).toBeDefined();
    expect(JSON.parse(warnLine!)).toMatchObject({ level: 'warn', component: 'tools', tools: ['cancel_job'] });
  });
});
