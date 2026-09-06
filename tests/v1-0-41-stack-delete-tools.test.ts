import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registerStackTools } from '../src/tools/stacks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Tool coverage for the "Worthwhile" endpoints from Dockhand v1.0.41
 * (Issue #164, points 1-2). Every request shape below is ground-truthed
 * against the real SvelteKit handlers in `Finsys/dockhand` v1.0.41
 * (commit 905c4a0) — see the PR description for the file:line evidence per
 * endpoint. NOT against any prior mcp-dockhand doc or generated schema.
 */

function readSource(file: string): string {
  return readFileSync(join(__dirname, '..', 'src', 'tools', file), 'utf-8');
}

/** Extract the registerTool(...) source block for a named tool (same helper
 * pattern as tests/deploy-stack.test.ts / tests/stack-env-tools.test.ts). */
function extractToolBlock(source: string, toolName: string): string {
  const startPattern = new RegExp(`registerTool\\s*\\(\\s*server\\s*,\\s*'${toolName}'`);
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Tool '${toolName}' not found in source`);
  }
  const startIdx = startMatch.index;
  const afterStart = source.slice(startIdx + 1);
  const nextToolMatch = /registerTool\s*\(/.exec(afterStart);
  const endIdx = nextToolMatch ? startIdx + 1 + nextToolMatch.index : source.length;
  return source.slice(startIdx, endIdx);
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
function jsonOut(res: unknown): Record<string, unknown> {
  return JSON.parse((res as { content: { text: string }[] }).content[0].text);
}

function setupHandlers<TServer, TClient>(
  register: (server: TServer, client: TClient) => void,
) {
  const handlers = new Map<string, ToolHandler>();
  const server = { tool: (n: string, _d: string, _s: unknown, cb: ToolHandler) => handlers.set(n, cb) };
  const client = {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  };
  // The fakes above only implement the slice of McpServer/DockhandClient each
  // register*Tools() function actually calls -- real structural typing would
  // reject them, so the cast is deliberate, not a shortcut.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(server as any as TServer, client as any as TClient);
  return { handlers, client };
}

// ---------------------------------------------------------------------------
// 1. delete_stack: new optional `files` param
// Handler ground truth: src/routes/api/stacks/[name]/+server.ts (DELETE) —
// `const files = url.searchParams.get('files') !== 'false'` (default true,
// i.e. omitted/anything-but-'false' deletes files; only 'false' keeps them).
// ---------------------------------------------------------------------------
describe('delete_stack: files parameter (Issue #164, point 1)', () => {
  const source = readSource('stacks.ts');
  const block = extractToolBlock(source, 'delete_stack');

  it('declares files as an optional boolean', () => {
    expect(block).toMatch(/files:\s*z\.boolean\(\)\.optional\(\)\.describe/);
  });

  it('sends files=false only when explicitly requested (default omits the param, backend keeps deleting)', async () => {
    const { handlers, client } = setupHandlers(registerStackTools);
    const handler = handlers.get('delete_stack');
    if (!handler) throw new Error('delete_stack not registered');

    await handler({ environmentId: 1, name: 'web' });
    const [, defaultParams] = client.delete.mock.calls[0]!;
    expect((defaultParams as Record<string, unknown>).files).toBeUndefined();

    await handler({ environmentId: 1, name: 'web', files: false });
    const [, keepFilesParams] = client.delete.mock.calls[1]!;
    expect((keepFilesParams as Record<string, unknown>).files).toBe('false');
  });

  it('still passes force and env exactly as before (no regression)', async () => {
    const { handlers, client } = setupHandlers(registerStackTools);
    const handler = handlers.get('delete_stack');
    if (!handler) throw new Error('delete_stack not registered');
    await handler({ environmentId: 7, name: 'web', force: true });
    const [path, params] = client.delete.mock.calls[0]!;
    expect(path).toContain('/api/stacks/web');
    expect((params as Record<string, unknown>).env).toBe(7);
    expect((params as Record<string, unknown>).force).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 2. get_stack_delete_preview (new tool)
// Handler ground truth: src/routes/api/stacks/[name]/delete-preview/+server.ts
// (GET) — path param `name`, query param `env`; response
// { stackName, sourceType, stackDir, gitDir, namedVolumes, canDeleteFiles }.
// ---------------------------------------------------------------------------
describe('get_stack_delete_preview (new tool, Issue #164, point 2)', () => {
  const source = readSource('stacks.ts');

  it('is registered', () => {
    expect(source).toContain("'get_stack_delete_preview'");
  });

  it('targets GET /api/stacks/{name}/delete-preview with encodePath(name) and env query param', () => {
    const block = extractToolBlock(source, 'get_stack_delete_preview');
    expect(block).toMatch(/client\.get\(/);
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/delete-preview/);
    expect(block).toMatch(/env:\s*environmentId/);
  });

  it('requires environmentId and name, calls the endpoint and returns the preview payload', async () => {
    const { handlers, client } = setupHandlers(registerStackTools);
    const handler = handlers.get('get_stack_delete_preview');
    if (!handler) throw new Error('get_stack_delete_preview not registered');
    client.get.mockResolvedValueOnce({
      stackName: 'web', sourceType: 'internal', stackDir: '/opt/stacks/web',
      gitDir: null, namedVolumes: ['web_data'], canDeleteFiles: true,
    });
    const out = jsonOut(await handler({ environmentId: 3, name: 'web' }));
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/stacks/web/delete-preview'),
      expect.objectContaining({ env: 3 }),
    );
    expect(out.canDeleteFiles).toBe(true);
    expect(out.namedVolumes).toEqual(['web_data']);
  });
});
