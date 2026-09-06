/**
 * `list_git_remote_branches` (POST /api/git/branches) — the coverage-gap follow-up
 * (17 MISSING_TOOL endpoints).
 *
 * Read off src/routes/api/git/branches/+server.ts: despite the POST method, this is a
 * READ operation (`git ls-remote`), NOT branch creation — POST is used only because the
 * body can carry a credentialId, not because it mutates state server-side. Accepts
 * EITHER an existing repositoryId (uses its stored url + credential) OR a fresh url
 * (+ optional credentialId); the repo target is checked against the shared SSRF policy
 * before any git subprocess runs. Requires `git:edit`.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerGitStackTools } from '../src/tools/git-stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
}

function jsonOut(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

function setup(): { handlers: Map<string, ToolHandler>; schemas: Map<string, ZodShape>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, ZodShape>();
  const server = {
    tool: (name: string, _d: string, s: ZodShape, cb: ToolHandler) => {
      handlers.set(name, cb);
      schemas.set(name, s);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ ok: true }),
    post: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerGitStackTools(server as any, client as any);
  return { handlers, schemas, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { client, result };
}

function expectToolError(result: unknown, contains: string) {
  const r = result as { isError?: boolean; content: { text: string }[] };
  expect(r.isError).toBe(true);
  const parsed = JSON.parse(r.content[0]!.text) as { error: string };
  expect(parsed.error).toContain(contains);
}

describe('git-stacks tools — registration includes list_git_remote_branches', () => {
  it('is registered', () => {
    const { handlers } = setup();
    expect(handlers.has('list_git_remote_branches')).toBe(true);
  });
});

describe('list_git_remote_branches', () => {
  it('happy path: repositoryId alone sends only repositoryId in the body', async () => {
    const { client, result } = await call('list_git_remote_branches', { repositoryId: 5 });
    expect(client.post).toHaveBeenCalledWith('/api/git/branches', { repositoryId: 5 });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: url + credentialId (new-repo flow) sends both, no repositoryId', async () => {
    const { client } = await call('list_git_remote_branches', {
      url: 'https://github.com/example/repo.git',
      credentialId: 2,
    });
    expect(client.post).toHaveBeenCalledWith('/api/git/branches', {
      url: 'https://github.com/example/repo.git',
      credentialId: 2,
    });
  });

  it('happy path: url alone (no credential — public repo)', async () => {
    const { client } = await call('list_git_remote_branches', { url: 'https://github.com/example/repo.git' });
    expect(client.post).toHaveBeenCalledWith('/api/git/branches', {
      url: 'https://github.com/example/repo.git',
    });
  });

  it('roundtrip: branches with name+sha come back through unchanged', async () => {
    const { handlers, client } = setup();
    client.post.mockResolvedValueOnce({ branches: [{ name: 'main', sha: 'a1b2c3d' }, { name: 'develop', sha: 'e4f5a6b' }] });
    const result = await handlers.get('list_git_remote_branches')!({ repositoryId: 5 });
    expect(jsonOut(result)).toEqual({ branches: [{ name: 'main', sha: 'a1b2c3d' }, { name: 'develop', sha: 'e4f5a6b' }] });
  });

  it('error path: backend 400 (SSRF-blocked target) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 URL points to a disallowed target'));
    const result = await handlers.get('list_git_remote_branches')!({ url: 'http://169.254.169.254/' });
    expectToolError(result, 'disallowed target');
  });

  it('error path: backend 404 (repository not found) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('404 Repository not found'));
    const result = await handlers.get('list_git_remote_branches')!({ repositoryId: 999 });
    expectToolError(result, 'Repository not found');
  });

  it('error path: backend 500 (ls-remote failed/timeout) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('500 Failed to fetch branches: timeout'));
    const result = await handlers.get('list_git_remote_branches')!({ repositoryId: 5 });
    expectToolError(result, 'Failed to fetch branches');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('list_git_remote_branches')!({ repositoryId: 5 });
    expectToolError(result, 'ECONNREFUSED');
  });
});
