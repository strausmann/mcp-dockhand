/**
 * `get_openapi_spec` (GET /api/docs) — the coverage-gap follow-up (17 MISSING_TOOL
 * endpoints).
 *
 * Read off src/routes/api/docs/+server.ts: returns the CONNECTED instance's own
 * generated OpenAPI 3.0 document (unauthenticated, gated by FEAT_API_DOCS — 404 when
 * the instance has it disabled). Deliberately distinct from this project's build-time
 * pinned contract (docs/dockhand-openapi.json): this tool is runtime introspection of
 * whatever instance the client is configured against.
 */
import { describe, it, expect, vi } from 'vitest';
import { registerSystemTools } from '../src/tools/system.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
}

function jsonOut(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

function setup(): { handlers: Map<string, ToolHandler>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _d: string, _s: Record<string, unknown>, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerSystemTools(server as any, client as any);
  return { handlers, client };
}

function expectToolError(result: unknown, contains: string) {
  const r = result as { isError?: boolean; content: { text: string }[] };
  expect(r.isError).toBe(true);
  const parsed = JSON.parse(r.content[0]!.text) as { error: string };
  expect(parsed.error).toContain(contains);
}

describe('system tools — registration includes get_openapi_spec', () => {
  it('is registered', () => {
    const { handlers } = setup();
    expect(handlers.has('get_openapi_spec')).toBe(true);
  });
});

describe('get_openapi_spec', () => {
  it('happy path: GET /api/docs with no arguments', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('get_openapi_spec')!({});
    expect(client.get).toHaveBeenCalledWith('/api/docs');
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('roundtrip: an arbitrary OpenAPI document shape comes back through unchanged', async () => {
    const { handlers, client } = setup();
    const spec = { openapi: '3.0.0', info: { title: 'Dockhand API', version: '1.16.0' }, paths: {} };
    client.get.mockResolvedValueOnce(spec);
    const result = await handlers.get('get_openapi_spec')!({});
    expect(jsonOut(result)).toEqual(spec);
  });

  it('error path: backend 404 (API docs disabled on this instance) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('404 Not found'));
    const result = await handlers.get('get_openapi_spec')!({});
    expectToolError(result, 'Not found');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_openapi_spec')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});
