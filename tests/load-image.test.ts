/**
 * `load_image` (POST /api/images/load) — the coverage-gap follow-up (17 MISSING_TOOL
 * endpoints), and the one requiring new client plumbing (`DockhandClient.postRawBody`,
 * covered separately by dockhand-client-post-raw-body.test.ts).
 *
 * Read off src/routes/api/images/load/+server.ts: `docker load` from an uploaded tar
 * for air-gapped hosts. The request body IS the raw tar bytes (Content-Type
 * application/x-tar) — this tool base64-decodes its `tarContent` input (same convention
 * as upload_container_file's base64 branch) into a Buffer before handing it to the
 * client. Local/socket or direct TCP only server-side (Hawser rejected — surfaces as a
 * normal error response, nothing this tool special-cases).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerImageTools } from '../src/tools/images.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  postRawBody: ReturnType<typeof vi.fn>;
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
    post: vi.fn().mockResolvedValue({ ok: true }),
    postRawBody: vi.fn().mockResolvedValue({ success: true, loaded: 'alpine:3.20' }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerImageTools(server as any, client as any);
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

describe('image tools — registration includes load_image', () => {
  it('is registered', () => {
    const { handlers } = setup();
    expect(handlers.has('load_image')).toBe(true);
  });
});

describe('load_image', () => {
  it('happy path: base64-decodes tarContent into a Buffer and posts it raw with the tar content-type', async () => {
    const tarBytes = Buffer.from('fake-tar-bytes');
    const { client, result } = await call('load_image', {
      environmentId: 4,
      tarContent: tarBytes.toString('base64'),
    });
    expect(client.postRawBody).toHaveBeenCalledTimes(1);
    const [path, body, contentType, params] = client.postRawBody.mock.calls[0];
    expect(path).toBe('/api/images/load');
    expect(Buffer.isBuffer(body)).toBe(true);
    expect((body as Buffer).equals(tarBytes)).toBe(true);
    expect(contentType).toBe('application/x-tar');
    expect(params).toEqual({ env: 4 });
    expect(jsonOut(result)).toEqual({ success: true, loaded: 'alpine:3.20' });
  });

  it('happy path: environmentId omitted (local/default Docker host)', async () => {
    const { client } = await call('load_image', { tarContent: Buffer.from('x').toString('base64') });
    const [, , , params] = client.postRawBody.mock.calls[0];
    expect(params).toEqual({ env: undefined });
  });

  it('requires tarContent — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('load_image')!);
    const result = schema.safeParse({ environmentId: 4 });
    expect(result.success).toBe(false);
  });

  it('GEGENVERSUCH: with tarContent present, the same schema accepts the call', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('load_image')!);
    const result = schema.safeParse({ tarContent: 'AAAA' });
    expect(result.success).toBe(true);
  });

  it('error path: backend 400 (no body / tar missing) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.postRawBody.mockRejectedValueOnce(new Error('400 Request body (an image tar) is required'));
    const result = await handlers.get('load_image')!({ tarContent: 'AAAA' });
    expectToolError(result, 'Request body (an image tar) is required');
  });

  it('error path: backend 403 (permission denied / Hawser rejected) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.postRawBody.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('load_image')!({ tarContent: 'AAAA', environmentId: 2 });
    expectToolError(result, 'Permission denied');
  });

  it('error path: backend 500 (daemon rejected the tar) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.postRawBody.mockRejectedValueOnce(new Error('500 The daemon rejected the tar or the load failed'));
    const result = await handlers.get('load_image')!({ tarContent: 'AAAA' });
    expectToolError(result, 'The daemon rejected the tar');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.postRawBody.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('load_image')!({ tarContent: 'AAAA' });
    expectToolError(result, 'ECONNREFUSED');
  });
});
