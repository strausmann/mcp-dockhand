/**
 * `export_image` — binary framing (#280) + its `tag` query parameter (1.0.51, T7).
 *
 * `GET /api/images/{id}/export` returns a tar archive (`application/x-tar` /
 * `application/gzip`, Finsys/dockhand v1.0.51 `src/routes/api/images/[id]/export/+server.ts`).
 * It must therefore go through `client.getRaw()` (a Buffer, no UTF-8 decode) and be framed as
 * `base64:<...>` text — NOT `client.get()` + `jsonResponse()`, which decodes the binary tar as
 * UTF-8 and corrupts it (#280). The `tag` query param (line 42, `url.searchParams.get('tag')`)
 * stays optional and backward compatible (pre-1.0.51: env + imageId only).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerImageTools } from '../src/tools/images.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  getRaw: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  postRawBody: ReturnType<typeof vi.fn>;
}

const TAR = Buffer.from('fake-image-tar-bytes');

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
    getRaw: vi.fn().mockResolvedValue(TAR),
    post: vi.fn().mockResolvedValue({ ok: true }),
    postRawBody: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerImageTools(server as any, client as any);
  return { handlers, schemas, client };
}

function textOut(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('export_image — binary framing (#280)', () => {
  it('uses client.getRaw (not get) and frames the tar as base64: text', async () => {
    const { client, result } = await call('export_image', { environmentId: 2, imageId: 'sha256:abc123' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/images/sha256%3Aabc123/export', {
      env: 2,
      tag: undefined,
    });
    expect(client.get).not.toHaveBeenCalled();
    expect(textOut(result)).toBe(`base64:${TAR.toString('base64')}`);
  });

  it('GEGENVERSUCH: the payload is the base64 of the raw bytes, not their UTF-8 text', async () => {
    const { result } = await call('export_image', { environmentId: 2, imageId: 'sha256:abc123' });
    const payload = textOut(result).replace(/^base64:/, '');
    expect(Buffer.from(payload, 'base64').equals(TAR)).toBe(true);
    // a UTF-8-decoded-then-JSON path (the #280 bug) would not round-trip to the exact bytes
    expect(payload).not.toBe(TAR.toString('utf8'));
  });
});

describe('export_image — tag param (T7)', () => {
  it('pre-1.0.51 contract: environmentId + imageId only, tag omitted from the query', async () => {
    const { client } = await call('export_image', { environmentId: 2, imageId: 'sha256:abc123' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/images/sha256%3Aabc123/export', {
      env: 2,
      tag: undefined,
    });
  });

  it('T7: tag is forwarded when given', async () => {
    const { client } = await call('export_image', {
      environmentId: 2,
      imageId: 'sha256:abc123',
      tag: 'myapp:1.2.3',
    });
    expect(client.getRaw).toHaveBeenCalledWith('/api/images/sha256%3Aabc123/export', {
      env: 2,
      tag: 'myapp:1.2.3',
    });
  });

  it('tag is optional — the tool schema accepts a call without it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('export_image')!);
    expect(schema.safeParse({ environmentId: 2, imageId: 'sha256:abc123' }).success).toBe(true);
  });

  it('GEGENVERSUCH: a non-string tag is rejected by the tool schema', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('export_image')!);
    expect(schema.safeParse({ environmentId: 2, imageId: 'sha256:abc123', tag: 123 }).success).toBe(false);
  });
});
