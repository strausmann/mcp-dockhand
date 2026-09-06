/**
 * Icon tools (src/tools/icons.ts) — the coverage-gap follow-up (17 MISSING_TOOL
 * endpoints). Contracts read off the real handlers, see the header comment in
 * src/tools/icons.ts for the full endpoint-by-endpoint breakdown.
 *
 * The three binary-image reads (get_container_icon, get_stack_icon, get_selfhst_icon)
 * use client.getRaw() + `textResponse(`base64:${...}`)` — the SAME framing
 * download_container_file/download_backup_snapshot_file use for their own raw bytes.
 * The Gegenversuch for that framing: mutate the callback to drop the `base64:` prefix
 * (or to return the buffer's utf-8 string instead of base64) and confirm the relevant
 * assertion below goes red — done manually while writing this file, not re-encoded
 * here as a snapshot (a snapshot would hide exactly this kind of regression).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerIconTools } from '../src/tools/icons.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  getRaw: ReturnType<typeof vi.fn>;
}

function jsonOut(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

function textOut(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
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
    post: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
    getRaw: vi.fn().mockResolvedValue(Buffer.from('raw-icon-bytes')),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerIconTools(server as any, client as any);
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

describe('icon tools — registration', () => {
  it('registers all ten operations', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual([
      'batch_get_selfhst_icons',
      'get_container_icon',
      'get_container_icon_overrides',
      'get_selfhst_icon',
      'get_selfhst_icon_manifest',
      'get_stack_icon',
      'remove_container_icon',
      'remove_stack_icon',
      'set_container_icon',
      'set_stack_icon',
    ]);
  });
});

// --- Container icon overrides ---

describe('get_container_icon_overrides', () => {
  it('happy path: GET /api/container-icons with an environment filter', async () => {
    const { client, result } = await call('get_container_icon_overrides', { environmentId: 3 });
    expect(client.get).toHaveBeenCalledWith('/api/container-icons', { env: 3 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: environmentId omitted (all environments)', async () => {
    const { client } = await call('get_container_icon_overrides', {});
    expect(client.get).toHaveBeenCalledWith('/api/container-icons', { env: undefined });
  });

  it('roundtrip: a name -> icon map comes back through unchanged', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce({ plex: 'selfhst:plex', db: 'custom:container' });
    const result = await handlers.get('get_container_icon_overrides')!({});
    expect(jsonOut(result)).toEqual({ plex: 'selfhst:plex', db: 'custom:container' });
  });

  it('error path: backend 403 (permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('get_container_icon_overrides')!({});
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_container_icon_overrides')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('get_container_icon', () => {
  it('happy path: GET raw bytes, framed as base64: text (matches download_container_file)', async () => {
    const { client, result } = await call('get_container_icon', { containerName: 'plex', environmentId: 2 });
    expect(client.getRaw).toHaveBeenCalledWith('/api/container-icons/plex', { env: 2 });
    expect(textOut(result)).toBe(`base64:${Buffer.from('raw-icon-bytes').toString('base64')}`);
  });

  it('path-encodes a container name that needs it', async () => {
    const { client } = await call('get_container_icon', { containerName: 'my app/1' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/container-icons/my%20app%2F1', { env: undefined });
  });

  it('error path: backend 404 (no custom icon set) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.getRaw.mockRejectedValueOnce(new Error('404 No custom icon'));
    const result = await handlers.get('get_container_icon')!({ containerName: 'plex' });
    expectToolError(result, 'No custom icon');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.getRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_container_icon')!({ containerName: 'plex' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('set_container_icon', () => {
  it('happy path: icon reference', async () => {
    const { client, result } = await call('set_container_icon', { containerName: 'plex', environmentId: 2, icon: 'selfhst:plex' });
    expect(client.post).toHaveBeenCalledWith('/api/container-icons/plex', { icon: 'selfhst:plex' }, { env: 2 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: uploaded image data URL', async () => {
    const { client } = await call('set_container_icon', { containerName: 'plex', image: 'data:image/png;base64,AAAA' });
    expect(client.post).toHaveBeenCalledWith('/api/container-icons/plex', { image: 'data:image/png;base64,AAAA' }, { env: undefined });
  });

  it('Codex P2 fix: rejects client-side when both icon and image are omitted — never reaches the backend', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('set_container_icon')!({ containerName: 'plex' });
    expectToolError(result, 'provide either icon');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('GEGENVERSUCH: with either field present, the same call reaches the backend (icon)', async () => {
    const { client } = await call('set_container_icon', { containerName: 'plex', icon: 'selfhst:plex' });
    expect(client.post).toHaveBeenCalledWith('/api/container-icons/plex', { icon: 'selfhst:plex' }, { env: undefined });
  });

  it('GEGENVERSUCH: with either field present, the same call reaches the backend (image)', async () => {
    const { client } = await call('set_container_icon', { containerName: 'plex', image: 'data:image/png;base64,AAAA' });
    expect(client.post).toHaveBeenCalledWith('/api/container-icons/plex', { image: 'data:image/png;base64,AAAA' }, { env: undefined });
  });

  it('error path: backend 403 (permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('set_container_icon')!({ containerName: 'plex', icon: 'selfhst:plex' });
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('set_container_icon')!({ containerName: 'plex', icon: 'selfhst:plex' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('remove_container_icon', () => {
  it('happy path: DELETE with environment scope', async () => {
    const { client, result } = await call('remove_container_icon', { containerName: 'plex', environmentId: 2 });
    expect(client.delete).toHaveBeenCalledWith('/api/container-icons/plex', { env: 2 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('error path: backend 403 (permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('remove_container_icon')!({ containerName: 'plex' });
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('remove_container_icon')!({ containerName: 'plex' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

// --- Stack icon overrides ---

describe('get_stack_icon', () => {
  it('happy path: GET raw bytes, framed as base64: text', async () => {
    const { client, result } = await call('get_stack_icon', { stackName: 'gitea', environmentId: 1 });
    expect(client.getRaw).toHaveBeenCalledWith('/api/stacks/gitea/icon', { env: 1 });
    expect(textOut(result)).toBe(`base64:${Buffer.from('raw-icon-bytes').toString('base64')}`);
  });

  it('path-encodes a stack name that needs it', async () => {
    const { client } = await call('get_stack_icon', { stackName: 'my stack' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/stacks/my%20stack/icon', { env: undefined });
  });

  it('error path: backend 404 (no custom icon set) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.getRaw.mockRejectedValueOnce(new Error('404 No custom icon'));
    const result = await handlers.get('get_stack_icon')!({ stackName: 'gitea' });
    expectToolError(result, 'No custom icon');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.getRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_stack_icon')!({ stackName: 'gitea' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('set_stack_icon', () => {
  it('happy path: icon reference', async () => {
    const { client, result } = await call('set_stack_icon', { stackName: 'gitea', environmentId: 1, icon: 'selfhst:gitea' });
    expect(client.post).toHaveBeenCalledWith('/api/stacks/gitea/icon', { icon: 'selfhst:gitea' }, { env: 1 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: uploaded image data URL', async () => {
    const { client } = await call('set_stack_icon', { stackName: 'gitea', image: 'data:image/png;base64,AAAA' });
    expect(client.post).toHaveBeenCalledWith('/api/stacks/gitea/icon', { image: 'data:image/png;base64,AAAA' }, { env: undefined });
  });

  it('Codex P2 fix: rejects client-side when both icon and image are omitted — never reaches the backend', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('set_stack_icon')!({ stackName: 'gitea' });
    expectToolError(result, 'provide either icon');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('GEGENVERSUCH: with either field present, the same call reaches the backend (icon)', async () => {
    const { client } = await call('set_stack_icon', { stackName: 'gitea', icon: 'selfhst:gitea' });
    expect(client.post).toHaveBeenCalledWith('/api/stacks/gitea/icon', { icon: 'selfhst:gitea' }, { env: undefined });
  });

  it('GEGENVERSUCH: with either field present, the same call reaches the backend (image)', async () => {
    const { client } = await call('set_stack_icon', { stackName: 'gitea', image: 'data:image/png;base64,AAAA' });
    expect(client.post).toHaveBeenCalledWith('/api/stacks/gitea/icon', { image: 'data:image/png;base64,AAAA' }, { env: undefined });
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('set_stack_icon')!({ stackName: 'gitea', icon: 'selfhst:gitea' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('remove_stack_icon', () => {
  it('happy path: DELETE with environment scope', async () => {
    const { client, result } = await call('remove_stack_icon', { stackName: 'gitea', environmentId: 1 });
    expect(client.delete).toHaveBeenCalledWith('/api/stacks/gitea/icon', { env: 1 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('error path: backend 403 (permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('remove_stack_icon')!({ stackName: 'gitea' });
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('remove_stack_icon')!({ stackName: 'gitea' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

// --- selfh.st icon catalog ---

describe('get_selfhst_icon_manifest', () => {
  it('happy path: GET with no arguments', async () => {
    const { client, result } = await call('get_selfhst_icon_manifest', {});
    expect(client.get).toHaveBeenCalledWith('/api/icons/selfhst-manifest');
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('roundtrip: the manifest array comes back through unchanged', async () => {
    const { handlers, client } = setup();
    const manifest = [{ Name: 'Plex', Reference: 'plex', Category: 'Media' }];
    client.get.mockResolvedValueOnce(manifest);
    const result = await handlers.get('get_selfhst_icon_manifest')!({});
    expect(jsonOut(result)).toEqual(manifest);
  });

  it('error path: backend 503 (manifest never cached, upstream fetch failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('503 Icon manifest unavailable'));
    const result = await handlers.get('get_selfhst_icon_manifest')!({});
    expectToolError(result, 'Icon manifest unavailable');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_selfhst_icon_manifest')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('get_selfhst_icon', () => {
  it('happy path: GET raw SVG bytes, framed as base64: text (same as the placeholder path — the handler never 404s)', async () => {
    const { client, result } = await call('get_selfhst_icon', { ref: 'plex' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/icons/selfhst/plex');
    expect(textOut(result)).toBe(`base64:${Buffer.from('raw-icon-bytes').toString('base64')}`);
  });

  it('path-encodes a ref (defense in depth even though the handler itself validates it)', async () => {
    const { client } = await call('get_selfhst_icon', { ref: 'a/b' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/icons/selfhst/a%2Fb');
  });

  it('error path: backend 400 (invalid ref) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.getRaw.mockRejectedValueOnce(new Error('400 Invalid icon reference'));
    const result = await handlers.get('get_selfhst_icon')!({ ref: 'not valid!' });
    expectToolError(result, 'Invalid icon reference');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.getRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_selfhst_icon')!({ ref: 'plex' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('batch_get_selfhst_icons', () => {
  it('happy path: POST with the refs array', async () => {
    const { client, result } = await call('batch_get_selfhst_icons', { refs: ['plex', 'gitea'] });
    expect(client.post).toHaveBeenCalledWith('/api/icons/selfhst/batch', { refs: ['plex', 'gitea'] });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('roundtrip: the icons map (data: URIs) comes back through unchanged', async () => {
    const { handlers, client } = setup();
    client.post.mockResolvedValueOnce({ icons: { plex: 'data:image/svg+xml;base64,PHN2Zy4uLg==' } });
    const result = await handlers.get('batch_get_selfhst_icons')!({ refs: ['plex'] });
    expect(jsonOut(result)).toEqual({ icons: { plex: 'data:image/svg+xml;base64,PHN2Zy4uLg==' } });
  });

  it('requires refs — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('batch_get_selfhst_icons')!);
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('GEGENVERSUCH: with refs present, the same schema accepts the call', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('batch_get_selfhst_icons')!);
    const result = schema.safeParse({ refs: ['plex'] });
    expect(result.success).toBe(true);
  });

  it('error path: backend 400 (missing refs array) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Body must include a refs array'));
    const result = await handlers.get('batch_get_selfhst_icons')!({ refs: [] });
    expectToolError(result, 'Body must include a refs array');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('batch_get_selfhst_icons')!({ refs: ['plex'] });
    expectToolError(result, 'ECONNREFUSED');
  });
});
