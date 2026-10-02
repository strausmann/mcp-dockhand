/**
 * Background-job tools (src/tools/jobs.ts) — get_job / cancel_job over
 * GET/DELETE /api/jobs/{id}. Contracts in the header comment of src/tools/jobs.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerJobTools } from '../src/tools/jobs.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function jsonOut(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

function setup(): { handlers: Map<string, ToolHandler>; schemas: Map<string, ZodShape>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, ZodShape>();
  const server = {
    tool: (name: string, _d: string, s: ZodShape, cb: ToolHandler) => {
      handlers.set(name, cb);
      schemas.set(name, s);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ id: 'j-1', status: 'done', lines: [], result: { success: true } }),
    delete: vi.fn().mockResolvedValue({ cancelled: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerJobTools(server as any, client as any);
  return { handlers, schemas, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('job tools — registration', () => {
  it('registers get_job and cancel_job', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(['cancel_job', 'get_job']);
  });

  it('requires a non-empty jobId on both', () => {
    const { schemas } = setup();
    for (const name of ['get_job', 'cancel_job']) {
      const shape = z.object(schemas.get(name)!);
      expect(shape.safeParse({}).success).toBe(false);
      expect(shape.safeParse({ jobId: '' }).success).toBe(false);
      expect(shape.safeParse({ jobId: 'b5d0c1e2-0000-4000-8000-000000000000' }).success).toBe(true);
    }
  });
});

describe('get_job', () => {
  it('GETs /api/jobs/{id} with no query params and returns the body as-is', async () => {
    const { client, result } = await call('get_job', { jobId: 'b5d0c1e2-0000-4000-8000-000000000000' });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/api/jobs/b5d0c1e2-0000-4000-8000-000000000000');
    expect(jsonOut(result)).toEqual({ id: 'j-1', status: 'done', lines: [], result: { success: true } });
  });

  it('encodes the id as one path segment', async () => {
    const { client } = await call('get_job', { jobId: '../x?y' });
    expect(client.get).toHaveBeenCalledWith('/api/jobs/..%2Fx%3Fy');
  });
});

describe('cancel_job', () => {
  it('DELETEs /api/jobs/{id} and returns { cancelled }', async () => {
    const { client, result } = await call('cancel_job', { jobId: 'b5d0c1e2-0000-4000-8000-000000000000' });
    expect(client.delete).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith('/api/jobs/b5d0c1e2-0000-4000-8000-000000000000');
    expect(jsonOut(result)).toEqual({ cancelled: true });
  });
});
