/**
 * registerTool is the single choke point every tool passes through, which makes it
 * the only place the call identifier has to be created.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('tool call correlation', () => {
  let written: string[];

  beforeEach(async () => {
    vi.resetModules();
    process.env['LOG_LEVEL'] = 'debug';
    written = [];
    // NOT process.stderr.write: pino.destination({ fd: 2, sync: true }) is a SonicBoom
    // stream that calls fs.writeSync(fd, ...) directly and never touches
    // process.stderr.write, so a spy there captures nothing and the test reads as
    // "the logger wrote nothing" no matter what it wrote. Verified against Task 1's
    // logger while implementing Task 3. Spy on the DEFAULT import — a namespace
    // import is a frozen ESM object and vi.spyOn cannot replace a property on it.
    //
    // The mock MUST report how many bytes it "wrote" via its return value: SonicBoom
    // (node_modules/sonic-boom/index.js, releaseWritingBuf) treats fs.writeSync's return
    // as the number of released bytes and keeps retrying whatever it thinks is still
    // unwritten. A hardcoded `return 0` (as an earlier draft of this test had) tells
    // SonicBoom that nothing was ever written, so it retries the same buffer forever —
    // a busy loop that ran the suite out of heap during this task's RED check. Sibling
    // tests (tests/tool-error-logging.test.ts, tests/login-failure-visibility.test.ts)
    // already return Buffer.byteLength(text) for exactly this reason.
    vi.spyOn(fs, 'writeSync').mockImplementation((_fd: unknown, chunk: unknown) => {
      const text = String(chunk);
      written.push(text);
      return Buffer.byteLength(text);
    });
  });

  afterEach(() => {
    delete process.env['LOG_LEVEL'];
    vi.restoreAllMocks();
  });

  async function invoke(name: string, callback: () => Promise<unknown>) {
    const { registerTool } = await import('../src/utils/tool-helper.js');
    let handler!: (args: unknown) => Promise<unknown>;
    const server = { tool: (_n: string, _d: string, _s: unknown, cb: never) => { handler = cb; } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTool(server as any, name, { id: z.number().optional() }, callback as never);
    return handler({});
  }

  function lines() {
    return written.join('').trim().split('\n').map((l) => JSON.parse(l));
  }

  it('emits a start and a success line carrying the same call id', async () => {
    await invoke('list_stacks', async () => ({ content: [] }) as never);

    const [start, done] = lines();
    expect(start.tool).toBe('list_stacks');
    expect(start.call).toMatch(UUID);
    expect(done.call).toBe(start.call);
    expect(done.msg).toBe('ok');
    expect(typeof done.ms).toBe('number');
  });

  it('puts the endpoint template in the context, never a concrete path', async () => {
    await invoke('get_stack_env_raw', async () => ({ content: [] }) as never);

    const [start] = lines();
    expect(start.route).toBe('/api/stacks/{name}/env/raw');
  });

  it('logs a failure at error level with the same call id', async () => {
    await invoke('list_stacks', async () => {
      throw new Error('Dockhand API error: GET https://d.example/api/stacks returned 500');
    });

    const [, failure] = lines();
    expect(failure.level).toBe('error');
    expect(failure.call).toMatch(UUID);
    expect(failure.tool).toBe('list_stacks');
  });

  it('gives two concurrent invocations different call ids', async () => {
    const { registerTool } = await import('../src/utils/tool-helper.js');
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = { tool: (n: string, _d: string, _s: unknown, cb: never) => handlers.set(n, cb) };

    const slow = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { content: [] } as never;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTool(server as any, 'list_stacks', {}, slow as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTool(server as any, 'list_containers', {}, slow as never);

    await Promise.all([handlers.get('list_stacks')!({}), handlers.get('list_containers')!({})]);

    const calls = new Set(lines().map((l) => l.call));
    expect(calls.size).toBe(2);
  });
});
