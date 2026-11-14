import { describe, it, expect, vi } from 'vitest';
import { registerContainerTools } from '../src/tools/containers.js';

/**
 * Coverage for the `owner` param added to `create_container_file` in Dockhand
 * 1.0.51 (T7b). The tool already existed (path, type); this covers only the
 * additive field.
 *
 * Ground-truthed against the real Finsys/dockhand v1.0.51 handler:
 *   src/routes/api/containers/[id]/files/create/+server.ts (POST)
 *     Destructures `const { path, type, owner } = body` (body-type
 *     `{path:string!, type:string!, owner:string}` per its own `@openapi`
 *     annotation). `owner` is optional — when present and non-empty it is
 *     validated via `parseChownSpec()` (a "user:group"-style owner spec,
 *     same format as the pre-existing chown_container_file tool's `owner`
 *     param) and then applied via `chownContainerPath()` right after the
 *     file/directory is created. No default — omitted means the newly
 *     created path keeps whatever owner `docker exec` left it with.
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function jsonOut(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

function setup() {
  const handlers = new Map<string, ToolHandler>();
  const server = { tool: (n: string, _d: string, _s: unknown, _a: unknown, cb: ToolHandler) => handlers.set(n, cb) };
  const client = {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ success: true, path: '/app/data', type: 'directory', owner: null }),
    put: vi.fn(),
    delete: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerContainerTools(server as any, client as any);
  return { handlers, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('create_container_file — owner (Dockhand 1.0.51)', () => {
  it('forwards owner in the POST body when provided', async () => {
    const { client } = await call('create_container_file', {
      environmentId: 3,
      containerId: 'plex',
      path: '/app/data',
      type: 'directory',
      owner: '1000:1000',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/plex/files/create',
      { path: '/app/data', type: 'directory', owner: '1000:1000' },
      { env: 3 }
    );
  });

  it('accepts a "user:group" named owner spec, not just numeric ids', async () => {
    const { client } = await call('create_container_file', {
      environmentId: 3,
      containerId: 'plex',
      path: '/app/data',
      type: 'file',
      owner: 'app:app',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/plex/files/create',
      { path: '/app/data', type: 'file', owner: 'app:app' },
      { env: 3 }
    );
  });

  it('GEGENVERSUCH: omitting owner leaves it OUT of the body entirely (never sent as undefined/empty)', async () => {
    const { client } = await call('create_container_file', {
      environmentId: 3,
      containerId: 'plex',
      path: '/app/data',
      type: 'directory',
    });
    const [, body] = client.post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body).toEqual({ path: '/app/data', type: 'directory' });
    expect(body).not.toHaveProperty('owner');
  });

  it('result passes through unchanged', async () => {
    const { result } = await call('create_container_file', {
      environmentId: 3,
      containerId: 'plex',
      path: '/app/data',
      type: 'directory',
    });
    expect(jsonOut(result)).toEqual({ success: true, path: '/app/data', type: 'directory', owner: null });
  });
});
