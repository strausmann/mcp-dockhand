/**
 * `create_git_stack` and `update_git_stack` gained an explicit, typed
 * `envFilePath` field (discoverability enhancement related to the
 * `set_git_stack_env_files` removal in #169 — see body-contract-real-bugs-169.test.ts).
 *
 * Before this change, "which .env file does this Git stack use on deploy"
 * was only reachable by knowing to put `envFilePath` inside the untyped
 * `config` passthrough object — invisible to anyone browsing the tool's
 * schema. Verified against the real handlers (Finsys/dockhand v1.0.41):
 *   - `POST /api/git/stacks`      reads `data.envFilePath` (git/stacks/+server.ts:123)
 *   - `PUT  /api/git/stacks/{id}` reads `data.envFilePath` (git/stacks/[id]/+server.ts:78)
 *
 * The explicit field is non-breaking: `config` is still accepted as-is, and
 * on a key collision the explicit `envFilePath` argument wins (spread
 * `config` first, then overlay `envFilePath` — same "explicit field wins"
 * pattern already used for `additionalConfig` in create_git_credential /
 * update_git_credential).
 */

import { describe, it, expect, vi } from 'vitest';
import { registerGitStackTools } from '../src/tools/git-stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: 'text'; text: string }[];
  isError?: true;
}>;

interface MockClient {
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function setup(): { handlers: Map<string, ToolHandler>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = {
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerGitStackTools(server as any, client as any);
  return { handlers, client };
}

describe('create_git_stack — explicit envFilePath field', () => {
  it('POSTs envFilePath merged into the config body (POST /api/git/stacks, git/stacks/+server.ts:123)', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('create_git_stack')!;

    const res = await handler({
      config: { url: 'https://example.com/repo.git', branch: 'main' },
      envFilePath: '.env.production',
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith('/api/git/stacks', {
      url: 'https://example.com/repo.git',
      branch: 'main',
      envFilePath: '.env.production',
    });
  });

  it('the explicit envFilePath field wins over a colliding config.envFilePath', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('create_git_stack')!;

    await handler({
      config: { url: 'https://example.com/repo.git', envFilePath: '.env.stale' },
      envFilePath: '.env.production',
    });

    expect(client.post).toHaveBeenCalledWith('/api/git/stacks', {
      url: 'https://example.com/repo.git',
      envFilePath: '.env.production',
    });
  });

  it('omits envFilePath from the body when not given', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('create_git_stack')!;

    await handler({ config: { url: 'https://example.com/repo.git' } });

    expect(client.post).toHaveBeenCalledWith('/api/git/stacks', { url: 'https://example.com/repo.git' });
  });
});

describe('update_git_stack — explicit envFilePath field', () => {
  it('PUTs envFilePath merged into the config body (PUT /api/git/stacks/{id}, git/stacks/[id]/+server.ts:78)', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('update_git_stack')!;

    const res = await handler({
      stackId: 42,
      config: { composePath: 'compose.yaml' },
      envFilePath: '.env.staging',
    });

    expect(res.isError).toBeUndefined();
    expect(client.put).toHaveBeenCalledWith('/api/git/stacks/42', {
      composePath: 'compose.yaml',
      envFilePath: '.env.staging',
    });
  });

  it('the explicit envFilePath field wins over a colliding config.envFilePath', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('update_git_stack')!;

    await handler({
      stackId: 42,
      config: { envFilePath: '.env.stale' },
      envFilePath: '.env.staging',
    });

    expect(client.put).toHaveBeenCalledWith('/api/git/stacks/42', { envFilePath: '.env.staging' });
  });

  it('omits envFilePath from the body when not given', async () => {
    const { handlers, client } = setup();
    const handler = handlers.get('update_git_stack')!;

    await handler({ stackId: 42, config: { composePath: 'compose.yaml' } });

    expect(client.put).toHaveBeenCalledWith('/api/git/stacks/42', { composePath: 'compose.yaml' });
  });
});
