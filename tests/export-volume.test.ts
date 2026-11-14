/**
 * `export_volume` — binary framing (#280).
 *
 * `GET /api/volumes/{name}/export` returns a tar archive (`application/x-tar` /
 * `application/gzip` / `application/octet-stream`, Finsys/dockhand v1.0.51
 * `src/routes/api/volumes/[name]/export/+server.ts`). It must go through `client.getRaw()`
 * (a Buffer, no UTF-8 decode) and be framed as `base64:<...>` text — NOT `client.get()` +
 * `jsonResponse()`, which decodes the binary tar as UTF-8 and corrupts it (#280).
 */
import { describe, it, expect, vi } from 'vitest';
import { registerVolumeTools } from '../src/tools/volumes.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  getRaw: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

const TAR = Buffer.from('fake-volume-tar-bytes');

function setup(): { handlers: Map<string, ToolHandler>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ ok: true }),
    getRaw: vi.fn().mockResolvedValue(TAR),
    post: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerVolumeTools(server as any, client as any);
  return { handlers, client };
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

describe('export_volume — binary framing (#280)', () => {
  it('uses client.getRaw (not get) and frames the tar as base64: text', async () => {
    const { client, result } = await call('export_volume', { environmentId: 1, volumeName: 'my-vol' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/volumes/my-vol/export', { env: 1 });
    expect(client.get).not.toHaveBeenCalled();
    expect(textOut(result)).toBe(`base64:${TAR.toString('base64')}`);
  });

  it('GEGENVERSUCH: the payload is the base64 of the raw bytes, not their UTF-8 text', async () => {
    const { result } = await call('export_volume', { environmentId: 1, volumeName: 'my-vol' });
    const payload = textOut(result).replace(/^base64:/, '');
    expect(Buffer.from(payload, 'base64').equals(TAR)).toBe(true);
    expect(payload).not.toBe(TAR.toString('utf8'));
  });

  it('escapes the volume name in the path', async () => {
    const { client } = await call('export_volume', { environmentId: 1, volumeName: 'a/b' });
    expect(client.getRaw).toHaveBeenCalledWith('/api/volumes/a%2Fb/export', { env: 1 });
  });
});
