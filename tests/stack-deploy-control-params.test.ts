import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerStackTools } from '../src/tools/stacks.js';

/**
 * Coverage for the `pull`/`build`/`forceRecreate` params added to `create_stack`
 * and `update_stack_compose` in Dockhand 1.0.51 (T7b). Both tools already existed;
 * this covers only the additive fields.
 *
 * Ground-truthed against the real Finsys/dockhand v1.0.51 handlers — NOT copied
 * from deploy_stack's documented defaults, because the two create/update handlers
 * resolve the same three option names differently:
 *
 *   src/routes/api/stacks/+server.ts (POST, create_stack)
 *     Only applied when `start:true` deploys the freshly-created stack (when
 *     `start:false` the stack is written but never deployed, so the options are
 *     simply unused). Destructured straight off `body`, then coerced with plain
 *     `!!x` — so pull/build/forceRecreate ALL default to `false` when omitted
 *     (`const pullOpt = !!pull; const buildOpt = !!build; const forceRecreateOpt
 *     = !!forceRecreate;`). Unlike deploy_stack, this endpoint does NOT default
 *     pull to true.
 *
 *   src/routes/api/stacks/[name]/compose/+server.ts (PUT, update_stack_compose)
 *     Only applied inside the `if (restart)` branch (ignored when restart is
 *     false/omitted). pull/build again default to `false` via `!!x`. forceRecreate
 *     is the odd one out: `forceRecreate === undefined ? true : !!forceRecreate` —
 *     it defaults to TRUE when omitted, preserving the endpoint's pre-1.0.51
 *     hardcoded behavior ("env var changes need --force-recreate to take effect",
 *     per the handler's own comment).
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  postSSE: ReturnType<typeof vi.fn>;
  putSSE: ReturnType<typeof vi.fn>;
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
    postSSE: vi.fn().mockResolvedValue({ success: true, started: true }),
    putSSE: vi.fn().mockResolvedValue({ success: true }),
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

describe('create_stack — pull/build/forceRecreate (Dockhand 1.0.51)', () => {
  it('forwards pull:true in the POST body when provided', async () => {
    const { client } = await call('create_stack', {
      environmentId: 3,
      name: 'mystack',
      compose: 'services: {}',
      pull: true,
    });
    const [, body] = client.postSSE.mock.calls[0]!;
    expect(body).toMatchObject({ pull: true });
  });

  it('forwards build:true in the POST body when provided', async () => {
    const { client } = await call('create_stack', {
      environmentId: 3,
      name: 'mystack',
      compose: 'services: {}',
      build: true,
    });
    const [, body] = client.postSSE.mock.calls[0]!;
    expect(body).toMatchObject({ build: true });
  });

  it('forwards forceRecreate:true in the POST body when provided', async () => {
    const { client } = await call('create_stack', {
      environmentId: 3,
      name: 'mystack',
      compose: 'services: {}',
      forceRecreate: true,
    });
    const [, body] = client.postSSE.mock.calls[0]!;
    expect(body).toMatchObject({ forceRecreate: true });
  });

  it('GEGENVERSUCH: omitting pull/build/forceRecreate leaves them OUT of the body entirely (never sent as false)', async () => {
    const { client } = await call('create_stack', {
      environmentId: 3,
      name: 'mystack',
      compose: 'services: {}',
    });
    const [, body] = client.postSSE.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('pull');
    expect(body).not.toHaveProperty('build');
    expect(body).not.toHaveProperty('forceRecreate');
  });

  it('result passes through unchanged', async () => {
    const { result } = await call('create_stack', {
      environmentId: 3,
      name: 'mystack',
      compose: 'services: {}',
      pull: true,
    });
    expect(jsonOut(result)).toEqual({ success: true, started: true });
  });
});

describe('update_stack_compose — pull/build/forceRecreate (Dockhand 1.0.51)', () => {
  it('forwards pull:true in the PUT body when restart:true', async () => {
    const { client } = await call('update_stack_compose', {
      environmentId: 3,
      name: 'mystack',
      content: 'services: {}',
      restart: true,
      pull: true,
    });
    const [, body] = client.putSSE.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body).toMatchObject({ pull: true, restart: true });
  });

  it('forwards build:true in the PUT body when restart:true', async () => {
    const { client } = await call('update_stack_compose', {
      environmentId: 3,
      name: 'mystack',
      content: 'services: {}',
      restart: true,
      build: true,
    });
    const [, body] = client.putSSE.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body).toMatchObject({ build: true });
  });

  it('forwards forceRecreate:false explicitly in the PUT body (distinguishable from omitted)', async () => {
    const { client } = await call('update_stack_compose', {
      environmentId: 3,
      name: 'mystack',
      content: 'services: {}',
      restart: true,
      forceRecreate: false,
    });
    const [, body] = client.putSSE.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body).toMatchObject({ forceRecreate: false });
  });

  it('GEGENVERSUCH: omitting pull/build/forceRecreate leaves them OUT of the body entirely', async () => {
    const { client } = await call('update_stack_compose', {
      environmentId: 3,
      name: 'mystack',
      content: 'services: {}',
      restart: true,
    });
    const [, body] = client.putSSE.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('pull');
    expect(body).not.toHaveProperty('build');
    expect(body).not.toHaveProperty('forceRecreate');
  });

  it('without restart, uses plain client.put (not putSSE) — new params still forwarded if given', async () => {
    const { client } = await call('update_stack_compose', {
      environmentId: 3,
      name: 'mystack',
      content: 'services: {}',
      pull: true,
    });
    expect(client.putSSE).not.toHaveBeenCalled();
    const [, body] = client.put.mock.calls[0]! as [string, Record<string, unknown>];
    expect(body).toMatchObject({ pull: true });
  });
});
