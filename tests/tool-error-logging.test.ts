/**
 * registerTool() (src/utils/tool-helper.ts) is the single chokepoint every
 * MCP tool callback runs through. Before this fix a thrown error (e.g. a
 * failed Dockhand login surfacing lazily on the first `client.get()` call
 * inside a tool) was caught and turned into a structured MCP error response
 * — but never logged anywhere. Since the login failure itself only ever
 * throws (see src/auth/session.ts), and nothing between the throw and this
 * wrapper logs it either, the failure was completely invisible in
 * `docker logs`, matching Issue #116 part 2: "no corresponding log output ...
 * even with LOG_LEVEL=debug set" (LOG_LEVEL isn't read anywhere in the
 * codebase — it's a no-op).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerTool } from '../src/utils/tool-helper.js';

interface CapturedTool {
  name: string;
  description: string;
  schema: unknown;
  handler: (args: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: true }>;
}

function fakeServer() {
  const tools = new Map<string, CapturedTool>();
  return {
    tools,
    // Mirrors the subset of McpServer.tool() that registerTool() calls.
    tool(name: string, description: string, schema: unknown, handler: CapturedTool['handler']) {
      tools.set(name, { name, description, schema, handler });
    },
  };
}

describe('registerTool error logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the tool name and error message when the callback throws (fail loud)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = fakeServer();

    registerTool(server as never, 'health_check', {}, async () => {
      throw new Error('Dockhand login failed (HTTP 307): redirected to "/login?redirect=..." instead of authenticating');
    });

    const result = await server.tools.get('health_check')!.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Dockhand login failed');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0].join(' ');
    expect(logged).toContain('health_check');
    expect(logged).toContain('Dockhand login failed');
  });

  it('logs "Unknown error" for a thrown non-Error value without crashing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = fakeServer();

    registerTool(server as never, 'get_system_info', {}, async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'boom';
    });

    const result = await server.tools.get('get_system_info')!.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown error');
    const logged = errorSpy.mock.calls[0].join(' ');
    expect(logged).toContain('get_system_info');
    expect(logged).toContain('Unknown error');
  });

  it('does not log anything when the callback succeeds (happy path)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = fakeServer();

    registerTool(server as never, 'get_host_info', { id: z.number() }, async ({ id }) => {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id }) }] };
    });

    const result = await server.tools.get('get_host_info')!.handler({ id: 42 });

    expect(result.isError).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('propagates a network-error message from a rejected client call and still logs it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = fakeServer();

    registerTool(server as never, 'list_containers', {}, async () => {
      throw new Error('fetch failed: ECONNREFUSED 100.100.200.50:443');
    });

    const result = await server.tools.get('list_containers')!.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ECONNREFUSED');
    expect(errorSpy.mock.calls[0].join(' ')).toContain('ECONNREFUSED');
  });
});
