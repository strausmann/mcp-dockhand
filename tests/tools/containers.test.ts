/**
 * Container tools added in Dockhand 1.0.51 (T3, 2 tools): a synchronous one-shot
 * exec that waits for the command to finish, and a chown counterpart to the
 * pre-existing chmod_container_file.
 *
 * Contracts read off the real Finsys/dockhand v1.0.51 handlers, not the changelog or
 * the `@openapi` summary line alone:
 *   src/routes/api/containers/[id]/exec/run/+server.ts
 *     POST — query envId!:integer (NOT `env` — this is the one container endpoint
 *     that reads `?envId=`, same convention as the pre-existing `exec_container`
 *     tool's `/exec` endpoint). Body cmd!:array<string> (must be a non-empty array of
 *     strings — 400 `{error: 'cmd must be a non-empty array of strings'}` otherwise,
 *     verified at the top of the handler before any Docker call), user?:string,
 *     workingDir?:string. Returns {stdout:string, stderr:string, exitCode:integer}
 *     directly (not wrapped), per `runExecInContainer()`'s result and the handler's
 *     `return json(result)`.
 *   src/routes/api/containers/[id]/files/chown/+server.ts
 *     POST — query env!:integer (the normal convention, unlike exec/run). Body
 *     path!:string, owner!:string, recursive?:boolean (defaults to false via
 *     `recursive === true`). Returns {success:true, path, owner, recursive}.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerContainerTools } from '../../src/tools/containers.js';

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
  registerContainerTools(server as any, client as any);
  return { handlers, schemas, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('T3 container tools — registration', () => {
  it('both new tools are registered alongside the pre-existing exec_container / chmod_container_file', () => {
    const { handlers } = setup();
    for (const name of [
      'run_container_exec',
      'chown_container_file',
      'exec_container',
      'chmod_container_file',
    ]) {
      expect(handlers.has(name)).toBe(true);
    }
  });
});

describe('run_container_exec', () => {
  it('happy path: cmd only -> POST .../exec/run with ?envId= (NOT ?env=), body {cmd}', async () => {
    const { client, result } = await call('run_container_exec', {
      environmentId: 3,
      containerId: 'plex',
      cmd: ['sh', '-c', 'echo hi'],
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/plex/exec/run',
      { cmd: ['sh', '-c', 'echo hi'] },
      { envId: 3 }
    );
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: user + workingDir both sent when provided', async () => {
    const { client } = await call('run_container_exec', {
      environmentId: 3,
      containerId: 'plex',
      cmd: ['id'],
      user: 'root',
      workingDir: '/app',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/plex/exec/run',
      { cmd: ['id'], user: 'root', workingDir: '/app' },
      { envId: 3 }
    );
  });

  it('uses the envId query key, never env (the Dockhand 1.0.51 gotcha)', async () => {
    const { client } = await call('run_container_exec', {
      environmentId: 7,
      containerId: 'plex',
      cmd: ['true'],
    });
    const queryArg = client.post.mock.calls[0]![2] as Record<string, unknown>;
    expect(queryArg).toEqual({ envId: 7 });
    expect(queryArg).not.toHaveProperty('env');
  });

  it('encodePath()s a container id with special characters', async () => {
    const { client } = await call('run_container_exec', {
      environmentId: 1,
      containerId: 'my/weird name',
      cmd: ['true'],
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/my%2Fweird%20name/exec/run',
      { cmd: ['true'] },
      { envId: 1 }
    );
  });
});

describe('chown_container_file', () => {
  it('happy path: path + owner only -> POST .../files/chown with ?env= (NOT ?envId=)', async () => {
    const { client, result } = await call('chown_container_file', {
      environmentId: 3,
      containerId: 'plex',
      path: '/app/data',
      owner: '1000:1000',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/plex/files/chown',
      { path: '/app/data', owner: '1000:1000' },
      { env: 3 }
    );
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: recursive true is forwarded', async () => {
    const { client } = await call('chown_container_file', {
      environmentId: 3,
      containerId: 'plex',
      path: '/app/data',
      owner: '1000:1000',
      recursive: true,
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/plex/files/chown',
      { path: '/app/data', owner: '1000:1000', recursive: true },
      { env: 3 }
    );
  });

  it('recursive false is forwarded explicitly (distinguishable from omitted)', async () => {
    const { client } = await call('chown_container_file', {
      environmentId: 3,
      containerId: 'plex',
      path: '/app/data',
      owner: '1000:1000',
      recursive: false,
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/plex/files/chown',
      { path: '/app/data', owner: '1000:1000', recursive: false },
      { env: 3 }
    );
  });

  it('uses the env query key, never envId (opposite of run_container_exec)', async () => {
    const { client } = await call('chown_container_file', {
      environmentId: 9,
      containerId: 'plex',
      path: '/app/data',
      owner: '1000:1000',
    });
    const queryArg = client.post.mock.calls[0]![2] as Record<string, unknown>;
    expect(queryArg).toEqual({ env: 9 });
    expect(queryArg).not.toHaveProperty('envId');
  });

  it('encodePath()s a container id with special characters', async () => {
    const { client } = await call('chown_container_file', {
      environmentId: 1,
      containerId: 'my/weird name',
      path: '/data',
      owner: 'root',
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/my%2Fweird%20name/files/chown',
      { path: '/data', owner: 'root' },
      { env: 1 }
    );
  });
});

describe('run_container_exec cmd validation (Copilot/Codex review)', () => {
  it('rejects an empty cmd array (handler requires a non-empty command)', () => {
    const { schemas } = setup();
    const shape = z.object(schemas.get('run_container_exec')!);
    expect(shape.safeParse({ environmentId: 1, containerId: 'c', cmd: [] }).success).toBe(false);
    expect(shape.safeParse({ environmentId: 1, containerId: 'c', cmd: ['sh', '-c', 'true'] }).success).toBe(true);
  });
});
