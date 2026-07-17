/**
 * Behavioural tests for the update_stack_env merge-semantic implementation.
 *
 * Unlike the static-analysis suite (stack-env-merge.test.ts), these tests
 * execute the registered tool handler against a mocked DockhandClient and
 * assert on the actual GET/PUT calls. This locks in the runtime behaviour that
 * the regex tests cannot verify:
 *   - existing variables (incl. secret values) survive a partial update,
 *   - collisions are overwritten, new keys are added,
 *   - replace mode skips the GET,
 *   - the merge path is fail-safe: a failed GET issues NO PUT (no data loss).
 *
 * Incident this guards against: hangar-print-hub (2026-06-01), 7 of 8 variables
 * deleted by a single-key update_stack_env call.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerStackTools } from '../src/tools/stacks.js';
import type { EnvVariable } from '../src/types/dockhand.js';

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

function putBody(client: MockClient): { variables: EnvVariable[] } {
  return client.put.mock.calls[0][1] as { variables: EnvVariable[] };
}

describe('update_stack_env — merge behaviour (mocked client)', () => {
  it('merge (default): GETs existing, preserves untouched vars incl. secret value, overwrites on collision, adds new', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({
      variables: [
        { key: 'SECRET_A', value: 'super-secret', isSecret: true },
        { key: 'PLAIN_B', value: 'b-old' },
      ],
    });

    await handler({
      environmentId: 7,
      name: 'my-stack',
      variables: [
        { key: 'PLAIN_B', value: 'b-new' }, // collision → overwrite
        { key: 'NEW_C', value: 'c', isSecret: true }, // new
      ],
    });

    // GET against the /env endpoint with the env query param
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get.mock.calls[0][0]).toBe('/api/stacks/my-stack/env');
    expect(client.get.mock.calls[0][1]).toEqual({ env: 7 });

    // PUT the merged full list back to the same endpoint
    expect(client.put).toHaveBeenCalledTimes(1);
    expect(client.put.mock.calls[0][0]).toBe('/api/stacks/my-stack/env');
    expect(client.put.mock.calls[0][2]).toEqual({ env: 7 });

    const body = putBody(client);
    const byKey = new Map(body.variables.map((v) => [v.key, v]));
    expect(body.variables).toHaveLength(3);
    // untouched secret survives with value + flag — the linchpin of the whole fix
    expect(byKey.get('SECRET_A')).toEqual({ key: 'SECRET_A', value: 'super-secret', isSecret: true });
    expect(byKey.get('PLAIN_B')).toEqual({ key: 'PLAIN_B', value: 'b-new' });
    expect(byKey.get('NEW_C')).toEqual({ key: 'NEW_C', value: 'c', isSecret: true });
  });

  it('merge with empty input is a no-op — existing variables are preserved, nothing is wiped', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({
      variables: [
        { key: 'A', value: '1', isSecret: true },
        { key: 'B', value: '2' },
      ],
    });

    await handler({ environmentId: 1, name: 's', variables: [] });

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(putBody(client).variables).toEqual([
      { key: 'A', value: '1', isSecret: true },
      { key: 'B', value: '2' },
    ]);
  });

  it('replace mode: does NOT GET, PUTs exactly the provided variables', async () => {
    const { handler, client } = setup();

    await handler({
      environmentId: 2,
      name: 's',
      mode: 'replace',
      variables: [{ key: 'ONLY', value: 'x' }],
    });

    expect(client.get).not.toHaveBeenCalled();
    expect(putBody(client).variables).toEqual([{ key: 'ONLY', value: 'x' }]);
  });

  it('merge is fail-safe: when the GET fails, NO PUT is issued (no data loss)', async () => {
    const { handler, client } = setup();
    client.get.mockRejectedValue(new Error('network down'));

    // registerTool wraps handlers in try/catch → returns an error response, does not throw
    await handler({ environmentId: 1, name: 's', variables: [{ key: 'X', value: 'y' }] });

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.put).not.toHaveBeenCalled();
  });

  it('merge preserves an existing secret flag on a value-only update (no isSecret) — never demotes a secret to plaintext', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({
      variables: [{ key: 'TOKEN', value: 'old', isSecret: true }],
    });

    // caller rotates the value but omits isSecret
    await handler({ environmentId: 1, name: 's', variables: [{ key: 'TOKEN', value: 'rotated' }] });

    expect(putBody(client).variables).toEqual([
      { key: 'TOKEN', value: 'rotated', isSecret: true },
    ]);
  });

  it('merge tolerates a malformed GET response (variables not an array) without crashing', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({ variables: null });

    await handler({ environmentId: 1, name: 's', variables: [{ key: 'X', value: 'y' }] });

    expect(client.put).toHaveBeenCalledTimes(1);
    expect(putBody(client).variables).toEqual([{ key: 'X', value: 'y' }]);
  });
});

// Response-Parser: jsonResponse liefert { content: [{ type:'text', text: JSON.stringify(x) }] }
function jsonOut(res: unknown): Record<string, unknown> {
  const text = (res as { content: { text: string }[] }).content[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('update_stack_env — summary/hint (merge only)', () => {
  it('merge subset (no new keys) → summary + remove hint', async () => {
    const { handler, client } = setup();
    client.get.mockResolvedValue({ variables: [
      { key: 'DB_PASSWORD', value: 's', isSecret: true },
      { key: 'TZ', value: 'Europe/Berlin' },
      { key: 'HOST', value: 'h' },
    ] });
    const res = await handler({ environmentId: 10, name: 'x',
      variables: [{ key: 'DB_PASSWORD', value: '***', isSecret: true }] });
    const out = jsonOut(res);
    expect(out.summary).toEqual({ added: 0, updated: 0, preserved: 2, removed: 0 });
    expect(typeof out.hint).toBe('string');
    expect(String(out.hint)).toContain('remove_stack_env_vars');
  });

  it('replace mode: no summary/hint and no extra GET (existing contract preserved)', async () => {
    const { handler, client } = setup();
    const res = await handler({ environmentId: 10, name: 'x',
      variables: [{ key: 'A', value: 'a' }], mode: 'replace' });
    const out = jsonOut(res);
    expect(client.get).not.toHaveBeenCalled();
    expect(out.summary).toBeUndefined();
    expect(out.hint).toBeUndefined();
  });
});
