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
// The logger writes via pino.destination({ fd: 2, sync: true }) (SonicBoom), which
// calls fs.writeSync(fd, ...) directly rather than console.error/process.stderr.write.
// Default import, not `import * as fs`: the namespace form is a frozen ES module
// object and vi.spyOn cannot redefine a property on it.
import fs from 'node:fs';

function captureLoggerOutput(): { written: string[]; restore: () => void } {
  const written: string[] = [];
  const spy = vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
    if (fd === 2) {
      const text = String(buffer);
      written.push(text);
      return Buffer.byteLength(text);
    }
    return 0;
  });
  return { written, restore: () => spy.mockRestore() };
}

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
    const { written, restore } = captureLoggerOutput();
    const server = fakeServer();

    registerTool(server as never, 'health_check', {}, async () => {
      throw new Error('Dockhand login failed (HTTP 307): redirected to "/login?redirect=..." instead of authenticating');
    });

    const result = await server.tools.get('health_check')!.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Dockhand login failed');

    // Since Task 7 (call correlation, tests/tool-correlation.test.ts) registerTool also
    // logs a "start" line before the callback runs, so a failure now produces two lines,
    // not one. The error line is the one that carries the diagnosis.
    expect(written).toHaveLength(2);
    const [, errorLine] = written;
    expect(errorLine).toContain('health_check');
    expect(errorLine).toContain('Dockhand login failed');
    restore();
  });

  // Asserting on the parsed line rather than on the object handed to the logger: the
  // two were not the same. `err: { type: 'ToolError', message }` reached the log as
  // "err":{"type":"Object","message":...,"stack":""} — pino's default serializer for
  // the `err` key treats anything with a `message` as error-like and overwrites `type`
  // with the constructor name. Every tool-failure line in production said "Object",
  // and no test noticed, because none of them read a whole emitted line.
  it('emits the error fields it was given, unmangled by the error serializer', async () => {
    const { written, restore } = captureLoggerOutput();
    const server = fakeServer();

    registerTool(server as never, 'list_stacks', {}, async () => {
      throw new Error('Dockhand login failed (HTTP 401)');
    });

    await server.tools.get('list_stacks')!.handler({});
    restore();

    const line = JSON.parse(written.find((l) => l.includes('tool failed'))!) as Record<string, unknown>;

    expect(line.errType).toBe('ToolError');
    expect(line.errMessage).toBe('Dockhand login failed (HTTP 401)');
    // The shape that was actually being emitted, named explicitly so a return to it
    // cannot pass by satisfying the two assertions above through some other route.
    expect(line.err).toBeUndefined();
    // The failed line must still carry the tool's endpoint (Codex #219): route stopped
    // being a bound context field and is now added call-time on start/ok/failed — the
    // catch path must not be the one that gets forgotten.
    expect(line.route).toBe('/api/stacks');
  });

  it('logs "Unknown error" for a thrown non-Error value without crashing', async () => {
    const { written, restore } = captureLoggerOutput();
    const server = fakeServer();

    registerTool(server as never, 'get_system_info', {}, async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'boom';
    });

    const result = await server.tools.get('get_system_info')!.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown error');
    const [, errorLine] = written;
    expect(errorLine).toContain('get_system_info');
    expect(errorLine).toContain('Unknown error');
    restore();
  });

  it('logs only a start and an ok line when the callback succeeds (happy path)', async () => {
    const { written, restore } = captureLoggerOutput();
    const server = fakeServer();

    registerTool(server as never, 'get_host_info', { id: z.number() }, async ({ id }) => {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id }) }] };
    });

    const result = await server.tools.get('get_host_info')!.handler({ id: 42 });

    expect(result.isError).toBeUndefined();
    // Task 7 added an unconditional "start"/"ok" pair around every call (see
    // tests/tool-correlation.test.ts) — a success no longer logs nothing, but it must
    // never log at error level.
    expect(written).toHaveLength(2);
    expect(written.some((line) => line.includes('"level":"error"'))).toBe(false);
    restore();
  });

  it('propagates a network-error message from a rejected client call and still logs it', async () => {
    const { written, restore } = captureLoggerOutput();
    const server = fakeServer();

    registerTool(server as never, 'list_containers', {}, async () => {
      throw new Error('fetch failed: ECONNREFUSED 100.100.200.50:443');
    });

    const result = await server.tools.get('list_containers')!.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ECONNREFUSED');
    const [, errorLine] = written;
    expect(errorLine).toContain('ECONNREFUSED');
    restore();
  });
});
