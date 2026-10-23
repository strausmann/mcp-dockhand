/**
 * User preference tools: sidebar layout (pre-existing) plus the environment-order and
 * tag-order endpoints added in Dockhand 1.0.51 (T2, 6 new tools).
 *
 * Request/response shape for the 6 new tools was read off the real Finsys/dockhand
 * v1.0.51 handlers, not the changelog:
 *   src/routes/api/preferences/environment-order/+server.ts
 *     GET (no body/query) -> {order: array<integer>} (environment ids, most preferred
 *       first). POST (body order!: array<integer>, each entry Number.isInteger, no
 *       duplicates - 400 otherwise) -> {order}. DELETE (no body) -> {order} (reset to
 *       default-by-name).
 *   src/routes/api/preferences/tag-order/+server.ts
 *     Identical shape, tag ids instead of environment ids.
 * Both handlers resolve the owner from the session cookie server-side - no envId/userId
 * parameter is sent by the client, matching the pre-existing sidebar preference tools.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerPreferenceTools } from '../../src/tools/preferences.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function jsonOut(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

function setup(): { handlers: Map<string, ToolHandler>; schemas: Map<string, ZodShape>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, ZodShape>();
  const server = {
    tool: (name: string, _d: string, s: ZodShape, _a: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
      schemas.set(name, s);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ ok: true }),
    post: vi.fn().mockResolvedValue({ ok: true }),
    put: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerPreferenceTools(server as any, client as any);
  return { handlers, schemas, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('preference tools — registration', () => {
  it('all 9 tools are registered (3 sidebar + 6 ordering)', () => {
    const { handlers } = setup();
    for (const name of [
      'get_sidebar_preferences',
      'set_sidebar_preferences',
      'reset_sidebar_preferences',
      'get_environment_order',
      'set_environment_order',
      'reset_environment_order',
      'get_tag_order',
      'set_tag_order',
      'reset_tag_order',
    ]) {
      expect(handlers.has(name)).toBe(true);
    }
  });
});

describe('get_environment_order', () => {
  it('GET /api/preferences/environment-order, no params', async () => {
    const { client, result } = await call('get_environment_order', {});
    expect(client.get).toHaveBeenCalledWith('/api/preferences/environment-order');
    expect(jsonOut(result)).toEqual({ ok: true });
  });
});

describe('set_environment_order', () => {
  it('happy path: POST with {order} body', async () => {
    const { client } = await call('set_environment_order', { order: [3, 1, 2] });
    expect(client.post).toHaveBeenCalledWith('/api/preferences/environment-order', { order: [3, 1, 2] });
  });

  it('error path: backend 400 (duplicate id) propagates', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400: order must not repeat an environment id'));
    const handler = handlers.get('set_environment_order')!;
    const result = await handler({ order: [1, 1] });
    expect(client.post).toHaveBeenCalledWith('/api/preferences/environment-order', { order: [1, 1] });
    const parsed = jsonOut(result) as { error?: string };
    expect(parsed.error).toBeDefined();
  });

  it('network error: rejected client call surfaces as tool error response', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const handler = handlers.get('set_environment_order')!;
    const result = await handler({ order: [1, 2] });
    const parsed = jsonOut(result) as { error?: string };
    expect(parsed.error).toBeDefined();
  });
});

describe('reset_environment_order', () => {
  it('DELETE /api/preferences/environment-order, no body', async () => {
    const { client } = await call('reset_environment_order', {});
    expect(client.delete).toHaveBeenCalledWith('/api/preferences/environment-order');
  });
});

describe('get_tag_order', () => {
  it('GET /api/preferences/tag-order, no params', async () => {
    const { client, result } = await call('get_tag_order', {});
    expect(client.get).toHaveBeenCalledWith('/api/preferences/tag-order');
    expect(jsonOut(result)).toEqual({ ok: true });
  });
});

describe('set_tag_order', () => {
  it('happy path: POST with {order} body', async () => {
    const { client } = await call('set_tag_order', { order: [5, 2] });
    expect(client.post).toHaveBeenCalledWith('/api/preferences/tag-order', { order: [5, 2] });
  });

  it('error path: backend 400 (non-integer id) propagates', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400: order must be an array of tag ids'));
    const handler = handlers.get('set_tag_order')!;
    const result = await handler({ order: [5, 2] });
    expect(client.post).toHaveBeenCalledWith('/api/preferences/tag-order', { order: [5, 2] });
    const parsed = jsonOut(result) as { error?: string };
    expect(parsed.error).toBeDefined();
  });

  it('network error: rejected client call surfaces as tool error response', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const handler = handlers.get('set_tag_order')!;
    const result = await handler({ order: [5, 2] });
    const parsed = jsonOut(result) as { error?: string };
    expect(parsed.error).toBeDefined();
  });
});

describe('reset_tag_order', () => {
  it('DELETE /api/preferences/tag-order, no body', async () => {
    const { client } = await call('reset_tag_order', {});
    expect(client.delete).toHaveBeenCalledWith('/api/preferences/tag-order');
  });
});

describe('order uniqueness validation (Codex review)', () => {
  for (const name of ['set_environment_order', 'set_tag_order']) {
    it(`${name} rejects a repeated id`, () => {
      const { schemas } = setup();
      const shape = z.object(schemas.get(name)!);
      expect(shape.safeParse({ order: [1, 1] }).success).toBe(false);
      expect(shape.safeParse({ order: [1, 2, 3] }).success).toBe(true);
    });
  }
});
