/**
 * `get_scanner_settings`'s `checkNewerVersions` query parameter (Dockhand 1.0.51, T7) —
 * a new, OPTIONAL parameter on an existing tool; the pre-1.0.51 contract (no arguments
 * at all) must keep working unchanged.
 *
 * Ground-truthed against `Finsys/dockhand` v1.0.51,
 * `src/routes/api/settings/scanner/+server.ts`:
 *   GET /api/settings/scanner?checkNewerVersions=true
 *   `url.searchParams.get('checkNewerVersions') === 'true'` (line 40) — when true, also
 *   asks the registry whether a newer scanner RELEASE exists (adds `newerVersions` to
 *   the response); slower, so opt-in and default false.
 *
 * `env`/`checkUpdates`/`settingsOnly` (pre-existing query params on this same handler,
 * unchanged by 1.0.51) are OUT OF SCOPE for this test file — this tool did not expose
 * them before 1.0.51 either, and T7 only adds `checkNewerVersions`.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerSystemTools } from '../src/tools/system.js';

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
  registerSystemTools(server as any, client as any);
  return { handlers, schemas, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('get_scanner_settings — checkNewerVersions param (T7)', () => {
  it('pre-1.0.51 contract: no arguments, checkNewerVersions omitted from the query', async () => {
    const { client, result } = await call('get_scanner_settings', {});
    expect(client.get).toHaveBeenCalledWith('/api/settings/scanner', { checkNewerVersions: undefined });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('T7: checkNewerVersions:true is forwarded as the literal query string "true"', async () => {
    const { client } = await call('get_scanner_settings', { checkNewerVersions: true });
    expect(client.get).toHaveBeenCalledWith('/api/settings/scanner', { checkNewerVersions: 'true' });
  });

  it('GEGENVERSUCH: checkNewerVersions:false is NOT forwarded as "true" (omitted instead)', async () => {
    const { client } = await call('get_scanner_settings', { checkNewerVersions: false });
    expect(client.get).toHaveBeenCalledWith('/api/settings/scanner', { checkNewerVersions: undefined });
  });

  it('checkNewerVersions is optional — the tool schema accepts a call without it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('get_scanner_settings')!);
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('a non-boolean checkNewerVersions is rejected by the tool schema', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('get_scanner_settings')!);
    const result = schema.safeParse({ checkNewerVersions: 'yes' });
    expect(result.success).toBe(false);
  });
});
