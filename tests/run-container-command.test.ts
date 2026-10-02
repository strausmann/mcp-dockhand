/**
 * run_container_command (src/tools/containers.ts) — the one-shot command tool over
 * POST /api/containers/{id}/exec/run. Contract: see the comment above the tool and the
 * matching case in tests/api-contracts.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerContainerTools } from '../src/tools/containers.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

function setup(postResult: unknown = { stdout: 'hi\n', stderr: '', exitCode: 0 }) {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, ZodShape>();
  const server = {
    tool: (name: string, _d: string, s: ZodShape, cb: ToolHandler) => {
      handlers.set(name, cb);
      schemas.set(name, s);
    },
  };
  const client = {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue(postResult),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getRaw: vi.fn().mockResolvedValue(Buffer.from('')),
    postSSE: vi.fn().mockResolvedValue({}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerContainerTools(server as any, client as any);
  return { handler: handlers.get('run_container_command')!, schema: z.object(schemas.get('run_container_command')!), client };
}

function jsonOut(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

describe('run_container_command', () => {
  it('is registered', () => {
    expect(setup().handler).toBeTypeOf('function');
  });

  it('requires environmentId, containerId and a non-empty string cmd', () => {
    const { schema } = setup();
    expect(schema.safeParse({ environmentId: 1, containerId: 'c' }).success).toBe(false);
    expect(schema.safeParse({ environmentId: 1, containerId: 'c', cmd: [] }).success).toBe(false);
    expect(schema.safeParse({ environmentId: 1, containerId: 'c', cmd: [1] }).success).toBe(false);
    expect(schema.safeParse({ containerId: 'c', cmd: ['true'] }).success).toBe(false);
    expect(schema.safeParse({ environmentId: 1, containerId: 'c', cmd: ['true'] }).success).toBe(true);
  });

  it('POSTs cmd only, with envId (not env) in the query', async () => {
    const { handler, client } = setup();
    await handler({ environmentId: 12, containerId: 'acme.sh', cmd: ['sh', '-c', 'echo hi'] });
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith('/api/containers/acme.sh/exec/run', { cmd: ['sh', '-c', 'echo hi'] }, { envId: 12 });
  });

  it('forwards user and workingDir when given', async () => {
    const { handler, client } = setup();
    await handler({ environmentId: 3, containerId: 'app', cmd: ['ls'], user: '1000:1000', workingDir: '/data' });
    expect(client.post).toHaveBeenCalledWith('/api/containers/app/exec/run', { cmd: ['ls'], user: '1000:1000', workingDir: '/data' }, { envId: 3 });
  });

  it('encodes the container id as one path segment', async () => {
    const { handler, client } = setup();
    await handler({ environmentId: 3, containerId: 'a/b', cmd: ['ls'] });
    expect(client.post.mock.calls[0]![0]).toBe('/api/containers/a%2Fb/exec/run');
  });

  it('returns stdout, stderr and a non-zero exitCode as a normal result', async () => {
    const { handler } = setup({ stdout: '', stderr: 'nope\n', exitCode: 3 });
    const result = await handler({ environmentId: 3, containerId: 'app', cmd: ['sh', '-c', 'exit 3'] });
    expect((result as { isError?: boolean }).isError).not.toBe(true);
    expect(jsonOut(result)).toEqual({ stdout: '', stderr: 'nope\n', exitCode: 3 });
  });
});
