/**
 * Integration coverage for the runtime-stats threading in registerTool()
 * (src/utils/tool-helper.ts): every tool dispatch — success or failure —
 * must bump the counters in src/utils/runtime-stats.ts without changing
 * any of the existing error-logging/response behaviour (see
 * tests/tool-error-logging.test.ts for that base coverage).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTool } from '../../src/utils/tool-helper.js';
import { getStatsSnapshot, __resetStats } from '../../src/utils/runtime-stats.js';

interface CapturedTool {
  name: string;
  handler: (args: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: true }>;
}

function fakeServer() {
  const tools = new Map<string, CapturedTool>();
  return {
    tools,
    tool(name: string, _description: string, _schema: unknown, handler: CapturedTool['handler']) {
      tools.set(name, { name, handler });
    },
  };
}

describe('registerTool runtime-stats threading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetStats();
  });

  it('a successful call increments requestCount and perTool.calls, not errorCount', async () => {
    __resetStats();
    const server = fakeServer();
    registerTool(server as never, 'get_host_info', {}, async () => {
      return { content: [{ type: 'text' as const, text: '{}' }] };
    });

    await server.tools.get('get_host_info')!.handler({});

    const snap = getStatsSnapshot();
    expect(snap.requestCount).toBe(1);
    expect(snap.perTool['get_host_info']).toMatchObject({ calls: 1, errors: 0 });
    expect(snap.errorCount).toBe(0);
  });

  it('a throwing call increments requestCount, errorCount, perTool.errors, and sets lastError', async () => {
    __resetStats();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = fakeServer();
    registerTool(server as never, 'list_containers', {}, async () => {
      throw new Error('fetch failed: ECONNREFUSED');
    });

    await server.tools.get('list_containers')!.handler({});

    const snap = getStatsSnapshot();
    expect(snap.requestCount).toBe(1);
    expect(snap.errorCount).toBe(1);
    expect(snap.perTool['list_containers']).toMatchObject({ calls: 1, errors: 1 });
    expect(snap.lastError).toMatchObject({ tool: 'list_containers', message: 'fetch failed: ECONNREFUSED' });
  });
});
