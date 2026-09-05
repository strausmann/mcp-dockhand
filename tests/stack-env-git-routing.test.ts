/**
 * #231: `update_stack_env` (merge mode) must route a non-secret variable to
 * the DB (PUT /api/stacks/{name}/env) on a GIT stack, not to the .env file
 * (PUT /api/stacks/{name}/env/raw).
 *
 * Ground Truth (Finsys/dockhand v1.0.46):
 *   - `GET /api/stacks/[name]/env` (env/+server.ts): "For a GIT stack, ALL
 *     variables (secret and non-secret) come from the database via this
 *     endpoint - the DB is the canonical store the UI, POST /env/validate,
 *     and deploys read. For an INTERNAL/adopted stack, non-secrets come from
 *     the on-disk `.env` file (written via PUT /env/raw) and only secrets
 *     come from the DB."
 *   - `GET /api/stacks/sources` (stacks/sources/+server.ts): returns a map
 *     keyed by stack name, `{ [stackName]: { sourceType: 'internal'|'git'|
 *     'external', ... } }` — this is what `get_stack_sources` wraps.
 *
 * Before this fix, `update_stack_env` routed EVERY isSecret:false variable to
 * `PUT /env/raw` unconditionally. For a git stack that file is never
 * consulted by GET /env, deploy, or the UI — the write silently lands in a
 * place nothing reads, i.e. the new/changed non-secret is effectively lost
 * from the stack's actual configuration.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerStackTools } from '../src/tools/stacks.js';
import type { EnvVariable } from '../src/types/dockhand.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: 'text'; text: string }[];
  isError?: true;
}>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function setup(): { handler: ToolHandler; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerStackTools(server as any, client as any);
  const handler = handlers.get('update_stack_env');
  if (!handler) throw new Error('update_stack_env handler was not registered');
  return { handler, client };
}

/**
 * Wires client.get so the structured `/env`, the raw `/env/raw`, and
 * `/api/stacks/sources` each return their own mocked payload — the shared
 * helper in stack-env-merge-behavior.test.ts only distinguishes two shapes
 * and would fold the sources lookup into the structured-env mock.
 */
function wireGet(
  client: MockClient,
  opts: { structured: unknown; raw?: string; sources: Record<string, { sourceType: string }> },
) {
  client.get.mockImplementation((path: string) => {
    if (path.endsWith('/env/raw')) return Promise.resolve({ content: opts.raw ?? '' });
    if (path.endsWith('/api/stacks/sources')) return Promise.resolve(opts.sources);
    return Promise.resolve(opts.structured);
  });
}

function envPut(client: MockClient) {
  return client.put.mock.calls.find((c) => String(c[0]).endsWith('/env') && !String(c[0]).endsWith('/env/raw'));
}
function rawPut(client: MockClient) {
  return client.put.mock.calls.find((c) => String(c[0]).endsWith('/env/raw'));
}
function sourcesGet(client: MockClient) {
  return client.get.mock.calls.find((c) => String(c[0]).endsWith('/api/stacks/sources'));
}

function jsonOut(res: Awaited<ReturnType<ToolHandler>>): Record<string, unknown> {
  const text = res.content[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('update_stack_env — merge mode routes non-secrets by resolved stack source type (#231)', () => {
  it('git stack: a brand-new non-secret key is PUT to the DB (/env), never to /env/raw', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 3,
      name: 'my-git-stack',
      variables: [{ key: 'NEW_VAR', value: 'v1', isSecret: false }],
    });

    expect(sourcesGet(client)).toBeDefined();
    expect(client.get).toHaveBeenCalledWith('/api/stacks/sources', { env: 3 });

    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'NEW_VAR', value: 'v1', isSecret: false }] });
    expect(rawPut(client)).toBeUndefined();

    const out = jsonOut(res);
    expect(out.success).toBe(true);
    // The variable landed in the DB, not the file — env.nonSecretsWritten
    // stays 0 because nothing was written to .env this call.
    expect(out.env).toEqual({ nonSecretsWritten: 0 });
  });

  it('internal stack: a brand-new non-secret key is STILL PUT to /env/raw, not the DB (regression guard)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      raw: '',
      sources: { 'my-internal-stack': { sourceType: 'internal' } },
    });

    const res = await handler({
      environmentId: 3,
      name: 'my-internal-stack',
      variables: [{ key: 'NEW_VAR', value: 'v1', isSecret: false }],
    });

    expect(client.get).toHaveBeenCalledWith('/api/stacks/sources', { env: 3 });
    expect(envPut(client)).toBeUndefined();
    expect(rawPut(client)?.[1]).toEqual({ content: 'NEW_VAR=v1' });

    const out = jsonOut(res);
    expect(out.env).toEqual({ nonSecretsWritten: 1 });
  });

  it('git stack, mixed payload: an existing secret (resent unchanged) and a new non-secret both land in the DB PUT; no /env/raw call at all', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [{ key: 'SECRET_A', value: 'super-secret', isSecret: true }] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 5,
      name: 'my-git-stack',
      variables: [
        // no isSecret field: merge preserves the existing secret flag —
        // this must NOT land in promotedKeys (it isn't newly promoted).
        { key: 'SECRET_A', value: 'super-secret' },
        { key: 'PLAIN_B', value: 'new-value', isSecret: false },
      ],
    });

    expect(envPut(client)?.[1]).toEqual({
      variables: [
        { key: 'SECRET_A', value: 'super-secret', isSecret: true },
        { key: 'PLAIN_B', value: 'new-value', isSecret: false },
      ],
    });
    expect(rawPut(client)).toBeUndefined();
    expect(client.get.mock.calls.some((c) => String(c[0]).endsWith('/env/raw'))).toBe(false);

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 2 });
    expect(out.env).toEqual({ nonSecretsWritten: 0 });
    expect(out.success).toBe(true);
  });

  it('git stack: a payload with ONLY secrets still resolves the source type when a DB PUT will fire (a pure-secret payload can still need the lookup once the stack has existing DB rows)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [{ key: 'EXISTING_NONSECRET', value: 'keep-me', isSecret: false }] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    await handler({
      environmentId: 1,
      name: 'my-git-stack',
      variables: [{ key: 'TOKEN', value: 'x', isSecret: true }],
    });

    expect(sourcesGet(client)).toBeDefined();
  });

  it('git stack: an existing DB non-secret NOT touched by this call is preserved in the DB PUT (DELETE-all+INSERT semantics — dropping it means losing it)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [{ key: 'EXISTING_NONSECRET', value: 'keep-me', isSecret: false }] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-git-stack',
      variables: [{ key: 'NEW_VAR', value: 'v2', isSecret: false }],
    });

    expect(rawPut(client)).toBeUndefined();
    const body = envPut(client)?.[1] as { variables: EnvVariable[] } | undefined;
    expect(body?.variables).toEqual(
      expect.arrayContaining([
        { key: 'EXISTING_NONSECRET', value: 'keep-me', isSecret: false },
        { key: 'NEW_VAR', value: 'v2', isSecret: false },
      ]),
    );
    expect(body?.variables).toHaveLength(2);

    const out = jsonOut(res);
    expect(out.success).toBe(true);
  });

  it('git stack: a pure-secret payload preserves existing DB non-secrets too (no /env/raw call, sources lookup still runs)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [{ key: 'EXISTING_NONSECRET', value: 'keep-me', isSecret: false }] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-git-stack',
      variables: [{ key: 'NEW_SECRET', value: 's3cr3t', isSecret: true }],
    });

    expect(sourcesGet(client)).toBeDefined();
    expect(rawPut(client)).toBeUndefined();
    expect(client.get.mock.calls.some((c) => String(c[0]).endsWith('/env/raw'))).toBe(false);

    const body = envPut(client)?.[1] as { variables: EnvVariable[] } | undefined;
    expect(body?.variables).toEqual(
      expect.arrayContaining([
        { key: 'EXISTING_NONSECRET', value: 'keep-me', isSecret: false },
        { key: 'NEW_SECRET', value: 's3cr3t', isSecret: true },
      ]),
    );
    expect(body?.variables).toHaveLength(2);

    const out = jsonOut(res);
    expect(out.success).toBe(true);
  });
});
