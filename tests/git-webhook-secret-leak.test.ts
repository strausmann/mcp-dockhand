/**
 * Regression cover for Issue #326.
 *
 * The git stack and git repository tools used to hand back the Dockhand API response
 * verbatim. On Dockhand up to and including 1.0.56 that response carries the stored
 * `webhookSecret` of every git stack / repository in plain text (Finsys/dockhand
 * v1.0.56, src/routes/api/git/stacks/+server.ts GET: `return json(stacks)` over rows
 * selected with `webhookSecret: gitStacks.webhookSecret`; the repository routes spread
 * the row the same way). Anyone who merely listed stacks got every webhook secret into
 * their transcript.
 *
 * Dockhand 1.0.57 fixed this server-side (commit c60baa24, "security and reliability
 * hardening"): every one of these routes now drops `webhookSecret` and adds
 * `hasWebhookSecret: boolean` instead. This MCP server still supports older Dockhand
 * releases, so the tools apply the same transformation themselves — a no-op against
 * 1.0.57+, a fix against anything older.
 *
 * The fixtures deliberately carry the secret (a fixture without it would pass
 * trivially) plus a lookalike field (`webhookEnabled`) that must survive, so an
 * implementation that drops every `webhook*` field fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import { registerGitStackTools } from '../src/tools/git-stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[] }>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  postSSE: ReturnType<typeof vi.fn>;
}

function setup(): { handlers: Map<string, ToolHandler>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), postSSE: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerGitStackTools(server as any, client as any);
  return { handlers, client };
}

const SECRET = 'webhook-secret-value-should-never-leave-this-tool';

function stackRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    stackName: 'example-app',
    environmentId: 1,
    repositoryId: 3,
    webhookEnabled: true,
    webhookSecret: SECRET,
    repository: { id: 3, name: 'example-app', url: 'https://git.example.invalid/app.git', branch: 'main', credentialId: null },
    ...overrides,
  };
}

function repoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 3, name: 'example-app', url: 'https://git.example.invalid/app.git', branch: 'main', webhookEnabled: false, webhookSecret: SECRET, ...overrides };
}

async function call(handlers: Map<string, ToolHandler>, name: string, args: Record<string, unknown>): Promise<string> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`tool ${name} not registered`);
  const res = await handler(args);
  return res.content[0]!.text;
}

describe('git webhook secrets never leave the git stack / repository tools (#326)', () => {
  const cases: Array<{ tool: string; args: Record<string, unknown>; method: keyof MockClient; payload: () => unknown }> = [
    { tool: 'list_git_stacks', args: {}, method: 'get', payload: () => [stackRow(), stackRow({ id: 8, webhookSecret: null })] },
    { tool: 'get_git_stack', args: { stackId: 7 }, method: 'get', payload: () => stackRow() },
    { tool: 'create_git_stack', args: { config: { stackName: 'example-app' } }, method: 'post', payload: () => stackRow() },
    { tool: 'update_git_stack', args: { stackId: 7, config: { webhookEnabled: true } }, method: 'put', payload: () => stackRow() },
    { tool: 'list_git_repositories', args: {}, method: 'get', payload: () => [repoRow(), repoRow({ id: 4, webhookSecret: null })] },
    { tool: 'get_git_repository', args: { repositoryId: 3 }, method: 'get', payload: () => repoRow() },
    { tool: 'create_git_repository', args: { name: 'example-app', url: 'https://git.example.invalid/app.git' }, method: 'post', payload: () => repoRow() },
    { tool: 'update_git_repository', args: { repositoryId: 3, config: { branch: 'main' } }, method: 'put', payload: () => repoRow() },
  ];

  for (const c of cases) {
    it(`${c.tool}: drops webhookSecret, reports hasWebhookSecret, keeps lookalike fields`, async () => {
      const { handlers, client } = setup();
      client[c.method].mockResolvedValue(c.payload());

      const text = await call(handlers, c.tool, c.args);

      // Raw-string check first: a parsed check would miss the secret nested anywhere.
      expect(text).not.toContain(SECRET);
      const parsed = JSON.parse(text) as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        expect(row).not.toHaveProperty('webhookSecret');
        expect(row).toHaveProperty('webhookEnabled');
      }
      expect(rows[0]!.hasWebhookSecret).toBe(true);
      if (rows.length > 1) expect(rows[1]!.hasWebhookSecret).toBe(false);
    });
  }

  it('leaves a Dockhand 1.0.57+ response (already safe, hasWebhookSecret set) unchanged', async () => {
    const { handlers, client } = setup();
    const safe = { id: 7, stackName: 'example-app', webhookEnabled: true, hasWebhookSecret: true };
    client.get.mockResolvedValue([safe]);

    const parsed = JSON.parse(await call(handlers, 'list_git_stacks', {}));

    expect(parsed).toEqual([safe]);
  });

  it('passes non-object payloads through untouched (no throw on an unexpected shape)', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValue({ error: 'Permission denied' });

    const parsed = JSON.parse(await call(handlers, 'get_git_stack', { stackId: 7 }));

    expect(parsed).toEqual({ error: 'Permission denied' });
  });
});
