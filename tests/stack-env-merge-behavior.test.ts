/**
 * Behavioural tests for update_stack_env's auto-routing between the DB
 * secrets store (PUT /env) and the .env file (PUT /env/raw).
 *
 * Follow-up to #105 (merge/replace semantics against the DB-only /env
 * endpoint). This suite locks in the routing added in #109:
 *   - isSecret:true  vars -> DB (PUT /env), as before,
 *   - isSecret:false vars -> .env file (PUT /env/raw), auto-upserted,
 *   - the merge-mode structured GET stays load-bearing: on failure, NO
 *     write happens at all (no data loss) — the original #105 fail-safe,
 *   - replace mode rebuilds .env from exactly the non-secret payload.
 *
 * Incident this guards against (root cause of #109): isSecret:false vars
 * sent through update_stack_env were PUT to the DB-only /env endpoint and
 * silently orphaned there — get_stack_env always reads non-secrets from
 * the .env file, so the value written to the DB was never actually applied.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerStackTools } from '../src/tools/stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

/**
 * Register the stack tools against a fake MCP server that captures each tool's
 * (already error-wrapped) handler by name, plus a mocked client.
 */
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

/** Wires client.get so `/env/raw` and the structured `/env` return different mocked payloads. */
function wireGet(client: MockClient, structured: unknown, raw: string) {
  client.get.mockImplementation((path: string) =>
    path.endsWith('/env/raw') ? Promise.resolve(raw) : Promise.resolve(structured));
}

function envPut(client: MockClient) {
  return client.put.mock.calls.find((c) => String(c[0]).endsWith('/env'));
}
function rawPut(client: MockClient) {
  return client.put.mock.calls.find((c) => String(c[0]).endsWith('/env/raw'));
}

function jsonOut(res: unknown): Record<string, unknown> {
  const text = (res as { content: { text: string }[] }).content[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('update_stack_env — merge auto-routing (mocked client)', () => {
  it('mixed payload (1 secret + 1 non-secret): secret -> /env PUT, non-secret -> /env/raw upsert PUT', async () => {
    const { handler, client } = setup();
    wireGet(
      client,
      { variables: [{ key: 'SECRET_A', value: 'super-secret', isSecret: true }] },
      'PLAIN_B=old\n',
    );

    const res = await handler({
      environmentId: 7,
      name: 'my-stack',
      variables: [
        { key: 'SECRET_A', value: 'super-secret', isSecret: true }, // resend, unchanged
        { key: 'PLAIN_B', value: 'new', isSecret: false },
      ],
    });

    // structured GET always happens (load-bearing merge fetch)
    expect(client.get).toHaveBeenCalledWith('/api/stacks/my-stack/env', { env: 7 });
    // raw GET happens because the payload has a non-secret to upsert
    expect(client.get).toHaveBeenCalledWith('/api/stacks/my-stack/env/raw', { env: 7 });

    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'SECRET_A', value: 'super-secret', isSecret: true }] });
    expect(rawPut(client)?.[1]).toEqual({ content: 'PLAIN_B=new\n' });

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 1 });
    expect(out.env).toEqual({ nonSecretsWritten: 1 });
    expect(out.summary).toBeDefined();
    expect(out.success).toBe(true);
  });

  it('pure secret payload: only /env PUT — no /env/raw GET or PUT', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [] }, '');

    const res = await handler({
      environmentId: 1,
      name: 's',
      variables: [{ key: 'TOKEN', value: 'x', isSecret: true }],
    });

    expect(client.get).toHaveBeenCalledTimes(1); // only the structured GET
    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'TOKEN', value: 'x', isSecret: true }] });
    expect(rawPut(client)).toBeUndefined();

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 1 });
    expect(out.env).toEqual({ nonSecretsWritten: 0 });
  });

  it('pure non-secret payload, no existing secrets: no /env PUT at all', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [] }, 'A=1\n');

    const res = await handler({
      environmentId: 1,
      name: 's',
      variables: [{ key: 'A', value: '2' }],
    });

    expect(envPut(client)).toBeUndefined();
    expect(rawPut(client)?.[1]).toEqual({ content: 'A=2\n' });

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 0 });
    expect(out.env).toEqual({ nonSecretsWritten: 1 });
  });

  it('pure non-secret payload with unrelated existing secrets: DB PUT re-affirms the untouched secrets (preserved)', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [{ key: 'SECRET_A', value: '***', isSecret: true }] }, 'A=1\n');

    await handler({ environmentId: 1, name: 's', variables: [{ key: 'A', value: '2' }] });

    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'SECRET_A', value: '***', isSecret: true }] });
    expect(rawPut(client)?.[1]).toEqual({ content: 'A=2\n' });
  });

  it('merge with an empty variables array is a no-op: no DB PUT (no secrets touched), no .env PUT (no payload)', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [{ key: 'B', value: '2', isSecret: false }] }, 'B=2\n');

    const res = await handler({ environmentId: 1, name: 's', variables: [] });

    expect(client.get).toHaveBeenCalledTimes(1); // only the structured GET; no payload non-secrets -> no raw GET
    expect(client.put).not.toHaveBeenCalled();

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 0 });
    expect(out.env).toEqual({ nonSecretsWritten: 0 });
  });

  it('replace mode: secrets exact to /env, .env rebuilt exactly from the non-secret payload (no GET of raw .env)', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({ variables: [] }); // best-effort summary GET only

    await handler({
      environmentId: 2,
      name: 's',
      mode: 'replace',
      variables: [
        { key: 'SECRET', value: 's', isSecret: true },
        { key: 'PLAIN', value: 'p' },
      ],
    });

    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'SECRET', value: 's', isSecret: true }] });
    expect(rawPut(client)?.[1]).toEqual({ content: 'PLAIN=p' });
    // replace never reads the raw .env file — it is rebuilt from scratch
    expect(client.get.mock.calls.some((c) => String(c[0]).endsWith('/env/raw'))).toBe(false);
  });

  it('replace mode with no non-secrets still wipes .env to empty content', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({ variables: [] });

    await handler({
      environmentId: 2,
      name: 's',
      mode: 'replace',
      variables: [{ key: 'S', value: 's', isSecret: true }],
    });

    expect(rawPut(client)?.[1]).toEqual({ content: '' });
    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'S', value: 's', isSecret: true }] });
  });

  it('merge is fail-safe: when the structured GET fails, NO write is issued at all (no data loss)', async () => {
    const { handler, client } = setup();
    client.get.mockRejectedValue(new Error('network down'));

    // registerTool wraps handlers in try/catch → returns an error response, does not throw
    await handler({ environmentId: 1, name: 's', variables: [{ key: 'X', value: 'y' }] });

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.put).not.toHaveBeenCalled();
  });

  it('merge preserves an existing secret flag on a value-only update (no isSecret) — never demotes a secret to plaintext', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [{ key: 'TOKEN', value: 'old', isSecret: true }] }, '');

    // caller rotates the value but omits isSecret
    await handler({ environmentId: 1, name: 's', variables: [{ key: 'TOKEN', value: 'rotated' }] });

    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'TOKEN', value: 'rotated', isSecret: true }] });
    expect(rawPut(client)).toBeUndefined();
  });

  it('merge tolerates a malformed structured GET response (variables not an array) without crashing', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: null }, '');

    await handler({ environmentId: 1, name: 's', variables: [{ key: 'X', value: 'y', isSecret: true }] });

    expect(envPut(client)?.[1]).toEqual({ variables: [{ key: 'X', value: 'y', isSecret: true }] });
  });

  it('partial failure: DB PUT succeeds, .env/raw PUT fails -> error reported, db.secretsWritten stays set', async () => {
    const { handler, client } = setup();
    wireGet(
      client,
      { variables: [{ key: 'SECRET_A', value: 's', isSecret: true }] },
      'PLAIN_B=old\n',
    );
    client.put.mockImplementation((path: string) =>
      String(path).endsWith('/env/raw') ? Promise.reject(new Error('disk full')) : Promise.resolve({ ok: true }));

    const res = await handler({
      environmentId: 1,
      name: 's',
      variables: [
        { key: 'SECRET_A', value: 's', isSecret: true },
        { key: 'PLAIN_B', value: 'new', isSecret: false },
      ],
    });

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 1 });
    expect(out.env).toEqual({ nonSecretsWritten: 0 });
    expect(typeof out.error).toBe('string');
    expect(out.success).toBe(false);
  });

  it('partial failure: the raw GET itself fails after a successful DB PUT -> error reported, db.secretsWritten stays set', async () => {
    const { handler, client } = setup();
    client.get.mockImplementation((path: string) =>
      path.endsWith('/env/raw')
        ? Promise.reject(new Error('500'))
        : Promise.resolve({ variables: [{ key: 'SECRET_A', value: 's', isSecret: true }] }));

    const res = await handler({
      environmentId: 1,
      name: 's',
      variables: [
        { key: 'SECRET_A', value: 's', isSecret: true },
        { key: 'PLAIN_B', value: 'new', isSecret: false },
      ],
    });

    const out = jsonOut(res);
    expect(out.db).toEqual({ secretsWritten: 1 });
    expect(typeof out.error).toBe('string');
    expect(rawPut(client)).toBeUndefined();
  });
});

describe('update_stack_env — summary (merge and replace)', () => {
  it('merge subset (no new keys) -> summary reflects both stores combined', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [
      { key: 'DB_PASSWORD', value: 's', isSecret: true },
      { key: 'TZ', value: 'Europe/Berlin' },
      { key: 'HOST', value: 'h' },
    ] }, '');
    const res = await handler({ environmentId: 10, name: 'x',
      variables: [{ key: 'DB_PASSWORD', value: '***', isSecret: true }] });
    const out = jsonOut(res);
    expect(out.summary).toEqual({ added: 0, updated: 0, preserved: 2, removed: 0 });
    expect(typeof out.hint).toBe('string');
    expect(String(out.hint)).toContain('remove_stack_env_vars');
  });

  it('replace mode: summary reflects a best-effort GET against prior state', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({ variables: [{ key: 'OLD', value: 'x' }] });
    const res = await handler({ environmentId: 10, name: 'x',
      variables: [{ key: 'A', value: 'a' }], mode: 'replace' });
    const out = jsonOut(res);
    expect(out.summary).toEqual({ added: 1, updated: 0, preserved: 0, removed: 1 });
    expect(out.hint).toBeUndefined(); // hint is merge-only
  });

  it('replace mode: a failed best-effort summary GET does not block the write and omits summary', async () => {
    const { handler, client } = setup();
    client.get.mockRejectedValue(new Error('down'));
    const res = await handler({ environmentId: 10, name: 'x',
      variables: [{ key: 'A', value: 'a' }], mode: 'replace' });
    const out = jsonOut(res);
    expect(out.summary).toBeUndefined();
    expect(envPut(client)).toBeDefined();
  });
});
