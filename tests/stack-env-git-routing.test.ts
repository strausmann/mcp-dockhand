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
    // Fix-Runde 2 / Codex P2: the DB PUT payload for a git stack carries
    // BOTH types (DELETE-all+INSERT needs the full set), but the reported
    // count must reflect only the ACTUAL secrets in it (1: SECRET_A) — not
    // the 2 entries actually sent to the endpoint. Counting the raw payload
    // length here would misreport a non-secret as a written secret.
    expect(out.db).toEqual({ secretsWritten: 1 });
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

  it('git stack: dbSecretsWritten counts only the ACTUAL secrets sent, not the non-secrets riding along in the same DB PUT', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-git-stack',
      variables: [
        { key: 'ONE_SECRET', value: 's', isSecret: true },
        { key: 'ONE_NONSECRET', value: 'v', isSecret: false },
      ],
    });

    const body = envPut(client)?.[1] as { variables: EnvVariable[] } | undefined;
    expect(body?.variables).toHaveLength(2); // both go to the DB PUT...

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 1 }); // ...but only 1 is actually a secret
  });
});

describe('update_stack_env — replace mode routes non-secrets by resolved stack source type (#231, Fix-Runde 2)', () => {
  it('git stack, mode=replace: (a) non-secrets land in the DB PUT together with the secrets, never in /env/raw, AND (b) an existing secret resent WITHOUT isSecret keeps its isSecret:true (not silently demoted+dropped)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      // EXISTING_SECRET is a pre-existing git-DB secret. The replace payload
      // below resends it WITHOUT isSecret — a plausible caller mistake after
      // a get_stack_env round-trip that returned it masked as '***'.
      structured: { variables: [{ key: 'EXISTING_SECRET', value: 'old-secret-value', isSecret: true }] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 4,
      name: 'my-git-stack',
      mode: 'replace',
      variables: [
        { key: 'EXISTING_SECRET', value: 'old-secret-value' }, // isSecret omitted!
        { key: 'PLAIN', value: 'p', isSecret: false },
      ],
    });

    expect(sourcesGet(client)).toBeDefined();
    expect(rawPut(client)).toBeUndefined();
    expect(client.get.mock.calls.some((c) => String(c[0]).endsWith('/env/raw'))).toBe(false);

    const body = envPut(client)?.[1] as { variables: EnvVariable[] } | undefined;
    expect(body?.variables).toEqual(
      expect.arrayContaining([
        // (b): isSecret preserved as true — not demoted to a plaintext non-secret.
        { key: 'EXISTING_SECRET', value: 'old-secret-value', isSecret: true },
        // (a): the plain non-secret rides along in the SAME DB PUT.
        { key: 'PLAIN', value: 'p', isSecret: false },
      ]),
    );
    expect(body?.variables).toHaveLength(2);

    const out = jsonOut(res);
    // Only EXISTING_SECRET is an actual secret — PLAIN must not inflate the count.
    expect(out.db).toEqual({ secretsWritten: 1 });
  });

  it('git stack, mode=replace: a brand-new key with omitted isSecret defaults to false (no existing row to preserve from)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 4,
      name: 'my-git-stack',
      mode: 'replace',
      variables: [
        { key: 'BRAND_NEW', value: 'v' }, // isSecret omitted, no existing row
        { key: 'PLAIN', value: 'p', isSecret: false },
      ],
    });

    const body = envPut(client)?.[1] as { variables: EnvVariable[] } | undefined;
    expect(body?.variables).toEqual(
      expect.arrayContaining([{ key: 'BRAND_NEW', value: 'v', isSecret: false }]),
    );

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 0 });
  });

  it('internal stack, mode=replace: non-secrets STILL go to /env/raw, only secrets to the DB (regression guard)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      sources: { 'my-internal-stack': { sourceType: 'internal' } },
    });

    const res = await handler({
      environmentId: 4,
      name: 'my-internal-stack',
      mode: 'replace',
      variables: [
        { key: 'SECRET', value: 's', isSecret: true },
        { key: 'PLAIN', value: 'p', isSecret: false },
      ],
    });

    expect(sourcesGet(client)).toBeDefined();
    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'SECRET', value: 's', isSecret: true }] });
    expect(rawPut(client)?.[1]).toEqual({ content: 'PLAIN=p' });

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 1 });
  });

  it('mode=replace, pure-secret payload: still issues NO GET at all (no routing decision needed — Critical 4 preserved)', async () => {
    const { handler, client } = setup();

    await handler({
      environmentId: 4,
      name: 's',
      mode: 'replace',
      variables: [{ key: 'SECRET', value: 's', isSecret: true }],
    });

    expect(client.get).not.toHaveBeenCalled();
  });

  it('git stack, mode=replace: a malformed GET /env response (missing/non-array "variables") THROWS — never silently falls back to an empty existing-secrets map (which would demote a resent secret to plaintext, #244)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      // Malformed: no usable `variables` array at all — e.g. an unexpected
      // API shape (not the documented {variables:[...]} form).
      structured: { error: 'unexpected shape' } as unknown as { variables: EnvVariable[] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 4,
      name: 'my-git-stack',
      mode: 'replace',
      variables: [
        { key: 'EXISTING_SECRET', value: 'old-secret-value' }, // isSecret omitted!
        { key: 'PLAIN', value: 'p', isSecret: false },
      ],
    });

    // Nothing may be written: a malformed existing-state lookup must not
    // silently default to "no existing secrets" and demote EXISTING_SECRET
    // to a plaintext non-secret via the DB PUT (DELETE-all+INSERT).
    expect(envPut(client)).toBeUndefined();
    expect(rawPut(client)).toBeUndefined();

    const out = jsonOut(res);
    expect(typeof out.error).toBe('string');
    expect(String(out.error)).toContain('my-git-stack');
    expect(String(out.error)).toMatch(/variables/i);
  });
});

describe('update_stack_env — GET /api/stacks/sources permission (#231, Fix-Runde 3, Codex P2)', () => {
  it('a 403 from GET /api/stacks/sources (missing stacks:view) is translated into an actionable message, not the raw 403', async () => {
    const { handler, client } = setup();
    client.get.mockImplementation((path: string) => {
      if (path.endsWith('/api/stacks/sources')) {
        // What client.get() actually throws for a non-ok response — see
        // DockhandClient.request(): `Dockhand API error: ${method} ${url}
        // returned ${status}: ${errorBody}`.
        return Promise.reject(new Error(
          'Dockhand API error: GET https://dockhand.invalid/api/stacks/sources?env=1 returned 403: {"error":"Permission denied"}'));
      }
      return Promise.resolve({ variables: [] });
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-stack',
      variables: [{ key: 'PLAIN', value: 'v', isSecret: false }],
    });

    const out = jsonOut(res);
    expect(typeof out.error).toBe('string');
    expect(String(out.error)).toContain('stacks:view');
    expect(String(out.error)).toContain('stacks:edit');
  });

  it('a non-403 error from GET /api/stacks/sources is passed through unchanged (not misreported as a permission problem)', async () => {
    const { handler, client } = setup();
    client.get.mockImplementation((path: string) => {
      if (path.endsWith('/api/stacks/sources')) {
        return Promise.reject(new Error('Dockhand API error: GET https://dockhand.invalid/api/stacks/sources?env=1 returned 500: internal error'));
      }
      return Promise.resolve({ variables: [] });
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-stack',
      variables: [{ key: 'PLAIN', value: 'v', isSecret: false }],
    });

    const out = jsonOut(res);
    expect(typeof out.error).toBe('string');
    expect(String(out.error)).not.toContain('stacks:view');
    expect(String(out.error)).toContain('returned 500');
  });
});

describe('update_stack_env — merge summary baseline on a git stack (#231, Fix-Runde 2, Codex P2)', () => {
  it('git stack: changing an existing non-secret reports it as "updated", an untouched existing non-secret as "preserved" (not added/missing)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [
        { key: 'A', value: 'old-a', isSecret: false },
        { key: 'B', value: 'keep-b', isSecret: false },
      ] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-git-stack',
      variables: [{ key: 'A', value: 'new-a', isSecret: false }],
    });

    const out = jsonOut(res);
    expect(out.summary).toEqual({ added: 0, updated: 1, preserved: 1, removed: 0 });
  });

  it('git stack, empty merge payload, NO existing secrets: summary reports ALL existing non-secrets as "preserved" (not preserved:0) — no sourceType lookup needed, since nothing gets written either way', async () => {
    const { handler, client } = setup();
    // Deliberately no secrets at all in the existing state: with an empty
    // payload and existingSecretsCount === 0, neither the DB PUT nor the
    // .env/raw PUT will fire (see willFireDbPutPreGit) — the sourceType
    // lookup is genuinely unnecessary here, unlike the sibling scenario
    // where an existing secret would need "re-affirming" through the DB PUT.
    wireGet(client, {
      structured: { variables: [
        { key: 'A', value: 'a', isSecret: false },
        { key: 'B', value: 'b', isSecret: false },
      ] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-git-stack',
      variables: [],
    });

    // No write at all -> no reason to ask which stack type this is.
    expect(sourcesGet(client)).toBeUndefined();
    expect(client.put).not.toHaveBeenCalled();

    const out = jsonOut(res);
    expect(out.summary).toEqual({ added: 0, updated: 0, preserved: 2, removed: 0 });
  });

  it('git stack, empty merge payload, WITH an existing secret: the DB PUT re-affirms it, so the sourceType lookup DOES still happen (regression guard, distinguishes this from the no-write case above)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [
        { key: 'A', value: 'a', isSecret: false },
        { key: 'SECRET_B', value: 's', isSecret: true },
      ] },
      sources: { 'my-git-stack': { sourceType: 'git' } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-git-stack',
      variables: [],
    });

    expect(sourcesGet(client)).toBeDefined();
    expect(envPut(client)?.[1]).toEqual({
      variables: [
        { key: 'A', value: 'a', isSecret: false },
        { key: 'SECRET_B', value: 's', isSecret: true },
      ],
    });

    const out = jsonOut(res);
    expect(out.summary).toEqual({ added: 0, updated: 0, preserved: 2, removed: 0 });
  });
});

describe('update_stack_env — GET /api/stacks/sources malformed source record (#231, Fix-Runde 5, Codex P2a)', () => {
  it('a PRESENT record with no recognizable sourceType (e.g. {}) THROWS — never silently treated as non-git (would route a git stack\'s non-secret into the dead /env/raw)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      // The record for 'my-stack' exists but carries no sourceType at all.
      sources: { 'my-stack': {} as unknown as { sourceType: string } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-stack',
      variables: [{ key: 'NEW_VAR', value: 'v', isSecret: false }],
    });

    expect(rawPut(client)).toBeUndefined();
    expect(envPut(client)).toBeUndefined();

    const out = jsonOut(res);
    expect(typeof out.error).toBe('string');
    expect(String(out.error)).toContain('my-stack');
    expect(String(out.error)).toMatch(/sourceType/i);
  });

  it('a PRESENT record with an unrecognized sourceType value THROWS too (schema drift, not a documented internal|git|external value)', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      sources: { 'my-stack': { sourceType: 'quantum' } },
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-stack',
      variables: [{ key: 'NEW_VAR', value: 'v', isSecret: false }],
    });

    const out = jsonOut(res);
    expect(typeof out.error).toBe('string');
    expect(rawPut(client)).toBeUndefined();
  });

  it('an ABSENT record (stack has no source row at all) is treated as non-git, same as Dockhand\'s own GET /env fallback — regression guard', async () => {
    const { handler, client } = setup();
    wireGet(client, {
      structured: { variables: [] },
      raw: '',
      sources: {}, // no entry for 'my-stack' at all
    });

    const res = await handler({
      environmentId: 1,
      name: 'my-stack',
      variables: [{ key: 'NEW_VAR', value: 'v', isSecret: false }],
    });

    expect(rawPut(client)?.[1]).toEqual({ content: 'NEW_VAR=v' });
    const out = jsonOut(res);
    expect(out.success).toBe(true);
  });

  it('external and internal sourceType values still resolve correctly (regression guard)', async () => {
    for (const sourceType of ['external', 'internal']) {
      const { handler, client } = setup();
      wireGet(client, {
        structured: { variables: [] },
        raw: '',
        sources: { 'my-stack': { sourceType } },
      });

      await handler({
        environmentId: 1,
        name: 'my-stack',
        variables: [{ key: 'NEW_VAR', value: 'v', isSecret: false }],
      });

      expect(rawPut(client)?.[1]).toEqual({ content: 'NEW_VAR=v' });
    }
  });
});
