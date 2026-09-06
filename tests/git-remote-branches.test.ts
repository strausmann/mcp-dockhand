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
import { registerGitStackTools, listGitRemoteBranchesBodySchema } from '../src/tools/git-stacks.js';
import { getStatsSnapshot, __resetStats } from '../src/utils/runtime-stats.js';

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

  it('Codex P2: a validation failure routes through the error path — recordError fires, not logged as ok', async () => {
    __resetStats();
    const { handlers, client } = setup();
    // both repositoryId AND url → the cross-field contract rejects it before any request
    const result = await handlers.get('list_git_remote_branches')!({
      repositoryId: 5,
      url: 'https://github.com/example/repo.git',
    });
    expectToolError(result, 'url');
    expect(client.post).not.toHaveBeenCalled();
    // The whole point of the fix: this counts as an error, not a silent ok. A returned
    // errorResponse (the pre-fix behaviour) would leave errorCount at 0.
    const snap = getStatsSnapshot();
    expect(snap.errorCount).toBe(1);
    expect(snap.perTool['list_git_remote_branches']?.errors).toBe(1);
  });
});

// Cross-field repositoryId/url contract (Copilot review, PR #251): the real handler
// (src/routes/api/git/branches/+server.ts, pinned commit
// 049221ceff6223ff10fae49c0cb9757368c565bf) is `if (repositoryId) {...} else if (url)
// {...} else { 400 }` — repositoryId always wins when both are sent, url/credentialId
// are silently ignored. This schema is deliberately STRICTER than that: it rejects the
// ambiguous "both" cases client-side instead of letting the server quietly drop half
// of what was sent.
describe('listGitRemoteBranchesBodySchema — repositoryId/url contract', () => {
  it('neither repositoryId nor url is rejected', () => {
    const result = listGitRemoteBranchesBodySchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'repositoryId')).toBe(true);
    }
  });

  it('both repositoryId and url is rejected', () => {
    const result = listGitRemoteBranchesBodySchema.safeParse({
      repositoryId: 5,
      url: 'https://github.com/example/repo.git',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'url')).toBe(true);
    }
  });

  it('credentialId together with repositoryId is rejected', () => {
    const result = listGitRemoteBranchesBodySchema.safeParse({
      repositoryId: 5,
      credentialId: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'credentialId')).toBe(true);
    }
  });

  it('GEGENVERSUCH: repositoryId alone passes', () => {
    expect(listGitRemoteBranchesBodySchema.safeParse({ repositoryId: 5 }).success).toBe(true);
  });

  it('GEGENVERSUCH: url alone passes', () => {
    expect(
      listGitRemoteBranchesBodySchema.safeParse({ url: 'https://github.com/example/repo.git' }).success,
    ).toBe(true);
  });

  it('GEGENVERSUCH: url with credentialId passes', () => {
    expect(
      listGitRemoteBranchesBodySchema.safeParse({
        url: 'https://github.com/example/repo.git',
        credentialId: 2,
      }).success,
    ).toBe(true);
  });

  it('handler: rejects neither repositoryId nor url before reaching client.post', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('list_git_remote_branches')!({});
    expect(client.post).not.toHaveBeenCalled();
    expectToolError(result, 'repositoryId or url is required');
  });

  it('handler: rejects repositoryId + url before reaching client.post', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('list_git_remote_branches')!({
      repositoryId: 5,
      url: 'https://github.com/example/repo.git',
    });
    expect(client.post).not.toHaveBeenCalled();
    expectToolError(result, 'mutually exclusive');
  });

  it('handler: rejects repositoryId + credentialId before reaching client.post', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('list_git_remote_branches')!({
      repositoryId: 5,
      credentialId: 2,
    });
    expect(client.post).not.toHaveBeenCalled();
    expectToolError(result, 'silently ignored');
  });
});
