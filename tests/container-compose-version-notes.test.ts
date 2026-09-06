/**
 * `get_container_compose` (GET /api/containers/{id}/compose) and
 * `get_container_version_notes` (GET /api/containers/{id}/version-notes) — the
 * coverage-gap follow-up (17 MISSING_TOOL endpoints). Contracts read off the real
 * handlers:
 *   src/routes/api/containers/[id]/compose/+server.ts        GET (path id!:string,
 *     query env?:int) — {compose, composeFullEnv, serviceName, stackProject}.
 *   src/routes/api/containers/[id]/version-notes/+server.ts  GET (path id!:string,
 *     query env?:int, versions!:string comma-separated) — release notes for a semver
 *     update-check's target + skipped versions.
 * Both require the `containers:view` permission and treat `env` as optional (the
 * local/default Docker host when omitted) — same convention as get_container_stats/
 * get_container_top in this file, except THEIR env is mandatory at the tool schema
 * level while these two mirror the handler's own optionality.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerContainerTools } from '../src/tools/containers.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
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
    get: vi.fn().mockResolvedValue({ ok: true }),
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

function expectToolError(result: unknown, contains: string) {
  const r = result as { isError?: boolean; content: { text: string }[] };
  expect(r.isError).toBe(true);
  const parsed = JSON.parse(r.content[0]!.text) as { error: string };
  expect(parsed.error).toContain(contains);
}

describe('containers tools — registration includes compose + version-notes', () => {
  it('both new tools are registered', () => {
    const { handlers } = setup();
    expect(handlers.has('get_container_compose')).toBe(true);
    expect(handlers.has('get_container_version_notes')).toBe(true);
  });
});

describe('get_container_compose', () => {
  it('happy path: GET .../compose with environmentId, encodePath()d containerId', async () => {
    const { client, result } = await call('get_container_compose', { environmentId: 3, containerId: 'gitea' });
    expect(client.get).toHaveBeenCalledWith('/api/containers/gitea/compose', { env: 3 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: environmentId omitted (local/default Docker host)', async () => {
    const { client } = await call('get_container_compose', { containerId: 'gitea' });
    expect(client.get).toHaveBeenCalledWith('/api/containers/gitea/compose', { env: undefined });
  });

  it('path-encodes a container id that needs it', async () => {
    const { client } = await call('get_container_compose', { containerId: 'my container/1' });
    expect(client.get).toHaveBeenCalledWith('/api/containers/my%20container%2F1/compose', { env: undefined });
  });

  it('roundtrip: the four documented fields come back through unchanged', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce({
      compose: 'services:\n  app:\n    image: gitea:1\n',
      composeFullEnv: 'services:\n  app:\n    image: gitea:1\n    environment:\n      PATH: /usr/bin\n',
      serviceName: 'app',
      stackProject: 'gitea-stack',
    });
    const result = await handlers.get('get_container_compose')!({ containerId: 'gitea' });
    expect(jsonOut(result)).toEqual({
      compose: 'services:\n  app:\n    image: gitea:1\n',
      composeFullEnv: 'services:\n  app:\n    image: gitea:1\n    environment:\n      PATH: /usr/bin\n',
      serviceName: 'app',
      stackProject: 'gitea-stack',
    });
  });

  it('error path: backend 403 (permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('get_container_compose')!({ containerId: 'gitea' });
    expectToolError(result, 'Permission denied');
  });

  it('error path: backend 500 (inspect failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('500 Failed to inspect the container'));
    const result = await handlers.get('get_container_compose')!({ containerId: 'gitea' });
    expectToolError(result, 'Failed to inspect the container');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_container_compose')!({ containerId: 'gitea' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('get_container_version_notes', () => {
  it('happy path: GET .../version-notes with environmentId + versions', async () => {
    const { client, result } = await call('get_container_version_notes', {
      environmentId: 3,
      containerId: 'gitea',
      versions: '1.22.0,1.22.1',
    });
    expect(client.get).toHaveBeenCalledWith('/api/containers/gitea/version-notes', {
      env: 3,
      versions: '1.22.0,1.22.1',
    });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: environmentId omitted (local/default Docker host)', async () => {
    const { client } = await call('get_container_version_notes', { containerId: 'gitea', versions: '1.22.0' });
    expect(client.get).toHaveBeenCalledWith('/api/containers/gitea/version-notes', {
      env: undefined,
      versions: '1.22.0',
    });
  });

  it('requires versions — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('get_container_version_notes')!);
    const result = schema.safeParse({ containerId: 'gitea' });
    expect(result.success).toBe(false);
  });

  it('GEGENVERSUCH: with versions present, the same schema accepts the call', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('get_container_version_notes')!);
    const result = schema.safeParse({ containerId: 'gitea', versions: '1.22.0' });
    expect(result.success).toBe(true);
  });

  it('roundtrip: changelogUrl/source/notes/rateLimited come back through unchanged', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce({
      changelogUrl: 'https://github.com/go-gitea/gitea/releases',
      source: 'go-gitea/gitea',
      rateLimited: false,
      notes: [{ version: '1.22.0', name: 'v1.22.0', url: 'https://github.com/go-gitea/gitea/releases/tag/v1.22.0' }],
    });
    const result = await handlers.get('get_container_version_notes')!({ containerId: 'gitea', versions: '1.22.0' });
    expect(jsonOut(result)).toEqual({
      changelogUrl: 'https://github.com/go-gitea/gitea/releases',
      source: 'go-gitea/gitea',
      rateLimited: false,
      notes: [{ version: '1.22.0', name: 'v1.22.0', url: 'https://github.com/go-gitea/gitea/releases/tag/v1.22.0' }],
    });
  });

  it('error path: backend 403 (permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('get_container_version_notes')!({ containerId: 'gitea', versions: '1.22.0' });
    expectToolError(result, 'Permission denied');
  });

  it('error path: backend 500 (release notes resolution failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('500 Failed to resolve release notes'));
    const result = await handlers.get('get_container_version_notes')!({ containerId: 'gitea', versions: '1.22.0' });
    expectToolError(result, 'Failed to resolve release notes');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_container_version_notes')!({ containerId: 'gitea', versions: '1.22.0' });
    expectToolError(result, 'ECONNREFUSED');
  });
});
