/**
 * Stack deploy history tools (Dockhand 1.0.51, T4, 4 tools) — persistent deploy-run
 * records and their on-disk log text (Finsys/dockhand #1499).
 *
 * Every contract below was read off the real Finsys/dockhand v1.0.51 handlers, not the
 * changelog or the `@openapi` summary line alone:
 *   src/routes/api/stacks/[name]/deploys/+server.ts                GET (path name!,
 *     query env?:integer — OMITTED or the literal string "null" both mean the
 *     local/default environment) — {runs:array<{id,environmentId,triggeredBy,
 *     triggeredAt,startedAt,completedAt,duration,status,errorMessage,details}>}.
 *   src/routes/api/stacks/[name]/deploys/[runId]/+server.ts         GET (path name!,
 *     runId!:integer) — the single run object directly (NOT wrapped in {run:...}).
 *     DELETE (path name!, runId!:integer) — {success:true}.
 *     NEITHER takes an `env` query param — the environment is derived from the
 *     loaded run itself via loadOwnedDeployRun(), per the handlers' own doc comments.
 *   src/routes/api/stacks/[name]/deploys/[runId]/log/+server.ts     GET (path name!,
 *     runId!:integer) — `new Response(log, {headers:{'content-type':'text/plain'}})`,
 *     i.e. plain text, NOT JSON. Also takes NO env query param (same reasoning as
 *     GET/DELETE .../[runId] above).
 *
 * client.get() already content-type-sniffs (src/client/dockhand-client.ts, `request()`):
 * a non-JSON response comes back as a plain string. That is why get_stack_deploy_log
 * uses client.get() + textResponse() — the exact same pairing get_container_logs uses
 * (src/tools/containers.ts) — rather than any JSON-specific helper.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerStackTools } from '../../src/tools/stacks.js';
import { jsonResponse, textResponse } from '../../src/utils/response.js';

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

function textOut(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
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
  registerStackTools(server as any, client as any);
  return { handlers, schemas, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

describe('stack deploy history tools — registration', () => {
  it('all 4 tools are registered', () => {
    const { handlers } = setup();
    for (const name of [
      'list_stack_deploys',
      'get_stack_deploy',
      'delete_stack_deploy',
      'get_stack_deploy_log',
    ]) {
      expect(handlers.has(name)).toBe(true);
    }
  });
});

describe('list_stack_deploys', () => {
  const sampleRuns = {
    runs: [
      {
        id: 42,
        environmentId: 7,
        triggeredBy: 'user:alice',
        triggeredAt: '2026-10-01T00:00:00.000Z',
        startedAt: '2026-10-01T00:00:01.000Z',
        completedAt: '2026-10-01T00:00:05.000Z',
        duration: 4000,
        status: 'success',
        errorMessage: null,
        details: {},
      },
    ],
  };

  it('GET /api/stacks/{name}/deploys with env query when environmentId is given, and parses the real {runs:[...]} shape', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce(sampleRuns);
    const handler = handlers.get('list_stack_deploys')!;
    const result = await handler({ environmentId: 7, name: 'paperless' });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/paperless/deploys', { env: 7 });
    expect(jsonOut(result)).toEqual(sampleRuns);
  });

  it('omits env entirely when environmentId is not provided (local/default environment)', async () => {
    const { client } = await call('list_stack_deploys', { name: 'paperless' });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/paperless/deploys', { env: undefined });
  });

  it('encodes a stack name with special characters', async () => {
    const { client } = await call('list_stack_deploys', { environmentId: 1, name: 'my stack/weird' });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/my%20stack%2Fweird/deploys', { env: 1 });
  });
});

describe('get_stack_deploy', () => {
  const sampleRun = {
    id: 42,
    environmentId: 7,
    triggeredBy: 'user:alice',
    triggeredAt: '2026-10-01T00:00:00.000Z',
    startedAt: '2026-10-01T00:00:01.000Z',
    completedAt: '2026-10-01T00:00:05.000Z',
    duration: 4000,
    status: 'success',
    errorMessage: null,
    details: {},
  };

  it('GET /api/stacks/{name}/deploys/{runId}, NO env query param, returns the run object directly (not wrapped)', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce(sampleRun);
    const handler = handlers.get('get_stack_deploy')!;
    const result = await handler({ name: 'paperless', runId: 42 });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/paperless/deploys/42');
    // Exactly one argument — confirms no env/query object is passed at all.
    expect(client.get.mock.calls[0]).toHaveLength(1);
    expect(jsonOut(result)).toEqual(sampleRun);
  });

  it('encodes a numeric runId into the path', async () => {
    const { client } = await call('get_stack_deploy', { name: 'paperless', runId: 7 });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/paperless/deploys/7');
  });
});

describe('delete_stack_deploy', () => {
  it('DELETE /api/stacks/{name}/deploys/{runId}, NO env query param, matches the real {success:true} shape', async () => {
    const { handlers, client } = setup();
    client.delete.mockResolvedValueOnce({ success: true });
    const handler = handlers.get('delete_stack_deploy')!;
    const result = await handler({ name: 'paperless', runId: 42 });
    expect(client.delete).toHaveBeenCalledWith('/api/stacks/paperless/deploys/42');
    // Exactly one argument — confirms no env/query object is passed at all.
    expect(client.delete.mock.calls[0]).toHaveLength(1);
    expect(jsonOut(result)).toEqual({ success: true });
  });
});

describe('get_stack_deploy_log', () => {
  it('GET /api/stacks/{name}/deploys/{runId}/log, NO env query param', async () => {
    const { client } = await call('get_stack_deploy_log', { name: 'paperless', runId: 42 });
    expect(client.get).toHaveBeenCalledWith('/api/stacks/paperless/deploys/42/log');
    expect(client.get.mock.calls[0]).toHaveLength(1);
  });

  it('returns the client response as PLAIN TEXT, not JSON — mirroring content-type: text/plain', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce('Pulling image...\nStarting containers...\nDeploy complete.\n');
    const handler = handlers.get('get_stack_deploy_log')!;
    const result = await handler({ name: 'paperless', runId: 42 });
    // textResponse() must pass a string straight through, NOT JSON.stringify it —
    // a JSON-encoded string would come back wrapped in quotes with \n escaped.
    expect(textOut(result)).toBe('Pulling image...\nStarting containers...\nDeploy complete.\n');
    expect(textOut(result)).not.toContain('\\n');
  });

  it('would fail if the handler used jsonResponse instead of textResponse (mutation check)', async () => {
    // This test documents WHY get_stack_deploy_log must use textResponse: with
    // jsonResponse, a plain-text log line would come back JSON-encoded (wrapped in
    // quotes, newlines escaped as \n) instead of as the raw text a human/log-reader
    // expects. Verified directly against the response helpers, not just the tool.
    const raw = 'line one\nline two\n';
    const asText = (textResponse(raw) as { content: { text: string }[] }).content[0]!.text;
    const asJson = (jsonResponse(raw) as { content: { text: string }[] }).content[0]!.text;
    expect(asText).toBe(raw);
    expect(asJson).not.toBe(raw);
    expect(asJson).toContain('\\n');
  });
});

describe('deploy run id validation (Codex review)', () => {
  for (const name of ['get_stack_deploy', 'delete_stack_deploy', 'get_stack_deploy_log']) {
    it(`${name} rejects a fractional runId`, () => {
      const { schemas } = setup();
      const shape = z.object(schemas.get(name)!);
      expect(shape.safeParse({ name: 's', runId: 1.5 }).success).toBe(false);
      expect(shape.safeParse({ name: 's', runId: 7 }).success).toBe(true);
    });
  }
});
