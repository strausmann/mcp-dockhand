/**
 * Regression cover for Issue #232.
 *
 * list_environments and get_environment used to hand back the Dockhand API response
 * verbatim. That response carries two credential fields per environment:
 *   - `hawserToken` — the agent token a node uses to register itself over the Dockhand
 *     WebSocket. Neither tool exists to hand it out: list_hawser_tokens /
 *     create_hawser_token / revoke_hawser_token already own that job (src/tools/auth.ts).
 *   - `tlsKey` — the decrypted private TLS client key for direct/hawser-standard
 *     environments configured with mutual TLS. Heavier than a node token: a private key.
 * Dropping both fields is curation of what a routine lookup tool returns, not
 * concealment — see the full rationale in the issue.
 *
 * create_environment and update_environment are covered here too, beyond the issue's
 * named scope: reading the real upstream handlers (Finsys/dockhand v1.0.44) while
 * fixing this showed both POST and PUT respond with the identical `{ ...env, ... }`
 * spread as GET — same leak, same fix. test_environment/test_environment_connection
 * were checked the same way and do NOT need it: both build a curated response object
 * by hand and never spread the environment row.
 *
 * Two fixtures are used deliberately:
 *   - one WITH hawserToken present, to prove the field is actually removed rather than
 *     "never was in this fixture" (a fixture missing the field would pass trivially and
 *     prove nothing — see the mutation-testing guidance in
 *     .claude/rules/test-coverage-pflicht.md in homelab-management),
 *   - fields named similarly (`tokenCount`) to guard against a future regex-based
 *     implementation (`/token|secret/i`) that the issue explicitly warns against: an
 *     explicit field list must leave lookalike fields untouched.
 */
import { describe, it, expect, vi } from 'vitest';
import { registerEnvironmentTools } from '../src/tools/environments.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[] }>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

/**
 * Registers the environment tools against a fake MCP server that captures each tool's
 * (already error-wrapped) handler by name, plus a mocked client — same pattern as
 * tests/stack-env-merge-behavior.test.ts.
 */
function setup(): { handlers: Map<string, ToolHandler>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerEnvironmentTools(server as any, client as any);
  return { handlers, client };
}

function jsonOut(res: { content: { text: string }[] }): unknown {
  return JSON.parse(res.content[0]!.text);
}

/**
 * One environment as Dockhand's API actually returns it — both credential fields
 * included. `tlsKey` is a plain placeholder string, deliberately NOT a real or
 * PEM-shaped value: a fixture that looks like a real private key would read as a
 * genuine finding in a future secret scan and cost someone an hour chasing it down.
 */
function envFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'hhdocker01',
    connectionType: 'hawser-standard',
    host: '100.100.50.40',
    port: 2376,
    icon: 'server',
    tokenCount: 3, // lookalike field name — must survive an explicit-field-list fix
    hawserToken: 'hawser-secret-value-should-never-leave-this-tool',
    tlsKey: 'not-a-real-key',
    ...overrides,
  };
}

describe('list_environments strips hawserToken (Issue #232)', () => {
  it('removes hawserToken from every entry, keeps every other field intact', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('list_environments');
    if (!handler) throw new Error('list_environments handler was not registered');

    const fixture = [
      envFixture({ id: 1, name: 'hhdocker01' }),
      envFixture({ id: 2, name: 'hhdocker02', hawserToken: 'a-different-secret-value' }),
    ];
    client.get.mockResolvedValue(fixture);

    const out = jsonOut(await handler({})) as Record<string, unknown>[];

    expect(client.get).toHaveBeenCalledWith('/api/environments');
    expect(out).toHaveLength(2);
    for (const env of out) {
      expect(env).not.toHaveProperty('hawserToken');
      expect(env).not.toHaveProperty('tlsKey');
    }
    // Every other field survives untouched, including the lookalike `tokenCount`.
    expect(out[0]).toEqual({
      id: 1,
      name: 'hhdocker01',
      connectionType: 'hawser-standard',
      host: '100.100.50.40',
      port: 2376,
      icon: 'server',
      tokenCount: 3,
    });
    expect(out[1]).toMatchObject({ id: 2, name: 'hhdocker02', tokenCount: 3 });
  });

  it('passes through a non-array payload unchanged in shape (defensive, no crash)', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('list_environments');
    if (!handler) throw new Error('list_environments handler was not registered');

    client.get.mockResolvedValue(null);

    const out = jsonOut(await handler({}));
    expect(out).toBeNull();
  });
});

describe('get_environment strips hawserToken (Issue #232)', () => {
  it('removes hawserToken from the single environment object, keeps every other field', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('get_environment');
    if (!handler) throw new Error('get_environment handler was not registered');

    client.get.mockResolvedValue(envFixture());

    const out = jsonOut(await handler({ environmentId: 1 })) as Record<string, unknown>;

    expect(client.get).toHaveBeenCalledWith('/api/environments/1');
    expect(out).not.toHaveProperty('hawserToken');
    expect(out).not.toHaveProperty('tlsKey');
    expect(out).toEqual({
      id: 1,
      name: 'hhdocker01',
      connectionType: 'hawser-standard',
      host: '100.100.50.40',
      port: 2376,
      icon: 'server',
      tokenCount: 3,
    });
  });
});

describe('create_environment strips hawserToken (Issue #232 follow-on)', () => {
  it('removes hawserToken from the created environment, keeps every other field', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('create_environment');
    if (!handler) throw new Error('create_environment handler was not registered');
    client.post.mockResolvedValue(envFixture({ id: 3, name: 'hhdocker03' }));

    const out = jsonOut(
      await handler({ name: 'hhdocker03', connectionType: 'hawser-standard' }),
    ) as Record<string, unknown>;

    expect(out).not.toHaveProperty('hawserToken');
    expect(out).not.toHaveProperty('tlsKey');
    expect(out).toEqual({
      id: 3,
      name: 'hhdocker03',
      connectionType: 'hawser-standard',
      host: '100.100.50.40',
      port: 2376,
      icon: 'server',
      tokenCount: 3,
    });
  });
});

describe('update_environment strips hawserToken (Issue #232 follow-on)', () => {
  it('removes hawserToken from the updated environment, keeps every other field', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('update_environment');
    if (!handler) throw new Error('update_environment handler was not registered');
    client.put.mockResolvedValue(envFixture({ name: 'renamed' }));

    // connectionType passed explicitly so the internal GET (used to resolve it when
    // omitted) is skipped — irrelevant to this leak, kept out of the test.
    const out = jsonOut(
      await handler({ environmentId: 1, name: 'renamed', connectionType: 'hawser-standard' }),
    ) as Record<string, unknown>;

    expect(client.get).not.toHaveBeenCalled();
    expect(out).not.toHaveProperty('hawserToken');
    expect(out).not.toHaveProperty('tlsKey');
    expect(out).toEqual({
      id: 1,
      name: 'renamed',
      connectionType: 'hawser-standard',
      host: '100.100.50.40',
      port: 2376,
      icon: 'server',
      tokenCount: 3,
    });
  });
});
