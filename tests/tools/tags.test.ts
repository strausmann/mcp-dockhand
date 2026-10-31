/**
 * Tag management tools (Dockhand 1.0.46 -> 1.0.51, T1, 10 tools) — the global tag
 * catalog (list/create/update/delete) plus per-environment tag assignment to
 * containers and stacks (list/get/set).
 *
 * Every contract below was read off the real Finsys/dockhand v1.0.51 handler, not the
 * changelog or the `@openapi` summary line alone:
 *   src/routes/api/tags/+server.ts                       GET (no body/query) — {tags}.
 *     POST (body name!:string, color?:string, icon?:string) — returns the tag object
 *     directly ({id,name,color,icon}), NOT wrapped. Admin-only (auth.isAdmin).
 *   src/routes/api/tags/[id]/+server.ts                  PUT (path id!:integer, body
 *     name?:string, color?:string, icon?:string|null — every field optional, only
 *     provided keys are patched) — {success:true}. Admin-only.
 *     DELETE (path id!:integer) — {success:true}. Admin-only.
 *   src/routes/api/container-tags/+server.ts             GET (query env?:integer —
 *     parseEnvParam() tolerates a missing/invalid value, targets the local/default
 *     environment) — a name -> tagIds map, e.g. {"plex":[1,5]}.
 *   src/routes/api/container-tags/[name]/+server.ts      GET (path name!:string, query
 *     env?:integer) — {tagIds}. PUT (path name!:string, query env?:integer, body
 *     tagIds!:array<integer>) — {tagIds} (echoes back what was set).
 *   src/routes/api/stack-tags/+server.ts                 GET (query env?:integer) — a
 *     name -> tagIds map, e.g. {"nextcloud":[2]}.
 *   src/routes/api/stacks/[name]/tags/+server.ts         GET (path name!:string, query
 *     env?:integer) — {tagIds}. PUT (path name!:string, query env?:integer, body
 *     tagIds!:array<integer>) — {tagIds}.
 *
 * `environmentId` is `.optional()` at the tool-schema level for all 6 assignment tools
 * (list/get/set container-tags, list/get/set stack-tags) — mirroring the handler's own
 * optionality (parseEnvParam(null) => null => local/default environment), same
 * convention documented in tests/container-compose-version-notes.test.ts. The 4 core
 * catalog tools (list/create/update/delete_tag) take NO environmentId — the catalog is
 * global, not per-environment.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerTagTools } from '../../src/tools/tags.js';

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
  registerTagTools(server as any, client as any);
  return { handlers, schemas, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('tags tools — registration', () => {
  it('all 10 tools are registered', () => {
    const { handlers } = setup();
    for (const name of [
      'list_tags',
      'create_tag',
      'update_tag',
      'delete_tag',
      'list_container_tags',
      'get_container_tags',
      'set_container_tags',
      'list_stack_tags',
      'get_stack_tags',
      'set_stack_tags',
    ]) {
      expect(handlers.has(name)).toBe(true);
    }
  });
});

describe('list_tags', () => {
  it('GET /api/tags, no params', async () => {
    const { client, result } = await call('list_tags', {});
    expect(client.get).toHaveBeenCalledWith('/api/tags');
    expect(jsonOut(result)).toEqual({ ok: true });
  });
});

describe('create_tag', () => {
  it('happy path: name only (color/icon omitted from body)', async () => {
    const { client } = await call('create_tag', { name: 'auth' });
    expect(client.post).toHaveBeenCalledWith('/api/tags', { name: 'auth' });
  });

  it('happy path: name + color + icon all sent', async () => {
    const { client } = await call('create_tag', { name: 'auth', color: 'green', icon: 'shield' });
    expect(client.post).toHaveBeenCalledWith('/api/tags', {
      name: 'auth',
      color: 'green',
      icon: 'shield',
    });
  });
});

describe('update_tag', () => {
  it('happy path: only name patched, PUT /api/tags/{tagId}', async () => {
    const { client } = await call('update_tag', { tagId: 3, name: 'security' });
    expect(client.put).toHaveBeenCalledWith('/api/tags/3', { name: 'security' });
  });

  it('happy path: only color patched (name/icon omitted from body)', async () => {
    const { client } = await call('update_tag', { tagId: 3, color: 'blue' });
    expect(client.put).toHaveBeenCalledWith('/api/tags/3', { color: 'blue' });
  });

  it('happy path: all three fields patched', async () => {
    const { client } = await call('update_tag', {
      tagId: 3,
      name: 'security',
      color: 'blue',
      icon: 'cloud',
    });
    expect(client.put).toHaveBeenCalledWith('/api/tags/3', {
      name: 'security',
      color: 'blue',
      icon: 'cloud',
    });
  });

  it('empty patch: no optional field given sends an empty body', async () => {
    const { client } = await call('update_tag', { tagId: 3 });
    expect(client.put).toHaveBeenCalledWith('/api/tags/3', {});
  });

  it('icon cleared to null forwards body.icon=null (handler supports icon: string|null)', async () => {
    const { client } = await call('update_tag', { tagId: 3, icon: null });
    expect(client.put).toHaveBeenCalledWith('/api/tags/3', { icon: null });
  });
});

describe('delete_tag', () => {
  it('DELETE /api/tags/{tagId}', async () => {
    const { client, result } = await call('delete_tag', { tagId: 5 });
    expect(client.delete).toHaveBeenCalledWith('/api/tags/5');
    expect(jsonOut(result)).toEqual({ ok: true });
  });
});

describe('list_container_tags', () => {
  it('happy path: environmentId given -> env query param', async () => {
    const { client } = await call('list_container_tags', { environmentId: 3 });
    expect(client.get).toHaveBeenCalledWith('/api/container-tags', { env: 3 });
  });

  it('happy path: environmentId omitted (local/default environment)', async () => {
    const { client } = await call('list_container_tags', {});
    expect(client.get).toHaveBeenCalledWith('/api/container-tags', { env: undefined });
  });
});

describe('get_container_tags', () => {
  it('happy path: encodePath()d container name, env query param', async () => {
    const { client, result } = await call('get_container_tags', {
      environmentId: 3,
      containerName: 'plex',
    });
    expect(client.get).toHaveBeenCalledWith('/api/container-tags/plex', { env: 3 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: environmentId omitted', async () => {
    const { client } = await call('get_container_tags', { containerName: 'plex' });
    expect(client.get).toHaveBeenCalledWith('/api/container-tags/plex', { env: undefined });
  });

  it('encodePath()s a container name with special characters', async () => {
    const { client } = await call('get_container_tags', {
      environmentId: 1,
      containerName: 'my/weird name',
    });
    expect(client.get).toHaveBeenCalledWith('/api/container-tags/my%2Fweird%20name', { env: 1 });
  });
});

describe('set_container_tags', () => {
  it('happy path: PUT with tagIds body, env query param', async () => {
    const { client, result } = await call('set_container_tags', {
      environmentId: 3,
      containerName: 'plex',
      tagIds: [1, 5],
    });
    expect(client.put).toHaveBeenCalledWith(
      '/api/container-tags/plex',
      { tagIds: [1, 5] },
      { env: 3 }
    );
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: environmentId omitted', async () => {
    const { client } = await call('set_container_tags', {
      containerName: 'plex',
      tagIds: [],
    });
    expect(client.put).toHaveBeenCalledWith(
      '/api/container-tags/plex',
      { tagIds: [] },
      { env: undefined }
    );
  });
});

describe('list_stack_tags', () => {
  it('happy path: environmentId given -> env query param', async () => {
    const { client } = await call('list_stack_tags', { environmentId: 2 });
    expect(client.get).toHaveBeenCalledWith('/api/stack-tags', { env: 2 });
  });

  it('happy path: environmentId omitted', async () => {
    const { client } = await call('list_stack_tags', {});
    expect(client.get).toHaveBeenCalledWith('/api/stack-tags', { env: undefined });
  });
});

describe('get_stack_tags', () => {
  it('happy path: encodePath()d stack name, env query param', async () => {
    const { client, result } = await call('get_stack_tags', {
      environmentId: 2,
      stackName: 'nextcloud',
    });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/nextcloud/tags', { env: 2 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: environmentId omitted', async () => {
    const { client } = await call('get_stack_tags', { stackName: 'nextcloud' });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/nextcloud/tags', { env: undefined });
  });
});

describe('set_stack_tags', () => {
  it('happy path: PUT with tagIds body, env query param', async () => {
    const { client, result } = await call('set_stack_tags', {
      environmentId: 2,
      stackName: 'nextcloud',
      tagIds: [2],
    });
    expect(client.put).toHaveBeenCalledWith(
      '/api/stacks/nextcloud/tags',
      { tagIds: [2] },
      { env: 2 }
    );
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: environmentId omitted', async () => {
    const { client } = await call('set_stack_tags', { stackName: 'nextcloud', tagIds: [4] });
    expect(client.put).toHaveBeenCalledWith(
      '/api/stacks/nextcloud/tags',
      { tagIds: [4] },
      { env: undefined }
    );
  });

  it('encodePath()s a stack name with special characters', async () => {
    const { client } = await call('set_stack_tags', {
      stackName: 'weird/stack',
      tagIds: [1],
    });
    expect(client.put).toHaveBeenCalledWith(
      '/api/stacks/weird%2Fstack/tags',
      { tagIds: [1] },
      { env: undefined }
    );
  });
});

describe('integer-ID validation (Copilot/Codex review)', () => {
  it('update_tag rejects a fractional tagId', () => {
    const { schemas } = setup();
    const shape = z.object(schemas.get('update_tag')!);
    expect(shape.safeParse({ tagId: 1.5 }).success).toBe(false);
    expect(shape.safeParse({ tagId: 3 }).success).toBe(true);
  });
  it('delete_tag rejects a fractional tagId', () => {
    const { schemas } = setup();
    const shape = z.object(schemas.get('delete_tag')!);
    expect(shape.safeParse({ tagId: 1.5 }).success).toBe(false);
    expect(shape.safeParse({ tagId: 3 }).success).toBe(true);
  });
  it('set_container_tags rejects fractional tagIds (upstream would silently clear the assignment)', () => {
    const { schemas } = setup();
    const shape = z.object(schemas.get('set_container_tags')!);
    expect(shape.safeParse({ containerName: 'x', tagIds: [1.5] }).success).toBe(false);
    expect(shape.safeParse({ containerName: 'x', tagIds: [1, 2] }).success).toBe(true);
  });
  it('set_stack_tags rejects fractional tagIds', () => {
    const { schemas } = setup();
    const shape = z.object(schemas.get('set_stack_tags')!);
    expect(shape.safeParse({ stackName: 'x', tagIds: [1.5] }).success).toBe(false);
    expect(shape.safeParse({ stackName: 'x', tagIds: [1, 2] }).success).toBe(true);
  });
});
