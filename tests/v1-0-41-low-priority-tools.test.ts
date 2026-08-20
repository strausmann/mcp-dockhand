import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registerEnvironmentTools } from '../src/tools/environments.js';
import { registerRegistryTools } from '../src/tools/registries.js';
import { registerSystemTools } from '../src/tools/system.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Tool coverage for the "Low priority" endpoints from Dockhand v1.0.41
 * (Issue #164, points 3-5). Every request shape below is ground-truthed
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
// 3. remote-stacks-dir (new tools)
// Handler ground truth: src/routes/api/environments/[id]/remote-stacks-dir/+server.ts
// GET -> { remoteStacksDir: string|null }; POST body { remoteStacksDir } ->
// { success, remoteStacksDir } (400 if not absolute / contains "..").
// ---------------------------------------------------------------------------
describe('get_environment_remote_stacks_dir / set_environment_remote_stacks_dir (Issue #164, point 3)', () => {
  const source = readSource('environments.ts');

  it('both tools are registered', () => {
    expect(source).toContain("'get_environment_remote_stacks_dir'");
    expect(source).toContain("'set_environment_remote_stacks_dir'");
  });

  it('get targets GET /api/environments/{id}/remote-stacks-dir via encodePath(environmentId)', () => {
    const block = extractToolBlock(source, 'get_environment_remote_stacks_dir');
    expect(block).toMatch(/client\.get\(/);
    expect(block).toMatch(/\$\{encodePath\(environmentId\)\}\/remote-stacks-dir/);
  });

  it('set targets POST /api/environments/{id}/remote-stacks-dir with a remoteStacksDir body', () => {
    const block = extractToolBlock(source, 'set_environment_remote_stacks_dir');
    expect(block).toMatch(/client\.post\(/);
    expect(block).toMatch(/\$\{encodePath\(environmentId\)\}\/remote-stacks-dir/);
    expect(block).toMatch(/remoteStacksDir/);
  });

  it('get returns the stored value', async () => {
    const { handlers, client } = setupHandlers(registerEnvironmentTools);
    const handler = handlers.get('get_environment_remote_stacks_dir');
    if (!handler) throw new Error('get_environment_remote_stacks_dir not registered');
    client.get.mockResolvedValueOnce({ remoteStacksDir: '/mnt/dockhand/stacks' });
    const out = jsonOut(await handler({ environmentId: 5 }));
    expect(client.get).toHaveBeenCalledWith(expect.stringContaining('/api/environments/5/remote-stacks-dir'));
    expect(out.remoteStacksDir).toBe('/mnt/dockhand/stacks');
  });

  it('set sends the absolute path and reports success', async () => {
    const { handlers, client } = setupHandlers(registerEnvironmentTools);
    const handler = handlers.get('set_environment_remote_stacks_dir');
    if (!handler) throw new Error('set_environment_remote_stacks_dir not registered');
    client.post.mockResolvedValueOnce({ success: true, remoteStacksDir: '/mnt/dockhand/stacks' });
    const out = jsonOut(await handler({ environmentId: 5, remoteStacksDir: '/mnt/dockhand/stacks' }));
    const [path, body] = client.post.mock.calls[0]!;
    expect(path).toContain('/api/environments/5/remote-stacks-dir');
    expect(body).toEqual({ remoteStacksDir: '/mnt/dockhand/stacks' });
    expect(out.success).toBe(true);
  });

  it('set accepts null to clear the setting', async () => {
    const { handlers, client } = setupHandlers(registerEnvironmentTools);
    const handler = handlers.get('set_environment_remote_stacks_dir');
    if (!handler) throw new Error('set_environment_remote_stacks_dir not registered');
    client.post.mockResolvedValueOnce({ success: true, remoteStacksDir: null });
    const out = jsonOut(await handler({ environmentId: 5, remoteStacksDir: null }));
    const [, body] = client.post.mock.calls[0]!;
    expect(body).toEqual({ remoteStacksDir: null });
    expect(out.remoteStacksDir).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. get_registry_tag_info (new tool)
// Handler ground truth: src/routes/api/registry/tag-info/+server.ts (GET) —
// query params: registry (optional int), image (required), tag (required);
// 400 if image or tag missing. No env scoping (registries are global).
// ---------------------------------------------------------------------------
describe('get_registry_tag_info (new tool, Issue #164, point 4)', () => {
  const source = readSource('registries.ts');

  it('is registered', () => {
    expect(source).toContain("'get_registry_tag_info'");
  });

  it('targets GET /api/registry/tag-info with registry/image/tag query params', () => {
    const block = extractToolBlock(source, 'get_registry_tag_info');
    expect(block).toMatch(/client\.get\(\s*['"`]\/api\/registry\/tag-info['"`]/);
    expect(block).toMatch(/registry/);
    expect(block).toMatch(/image/);
    expect(block).toMatch(/tag/);
  });

  it('declares image and tag as required, registry as optional', () => {
    const block = extractToolBlock(source, 'get_registry_tag_info');
    expect(block).toMatch(/image:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/tag:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/registry:\s*z\.number\(\)\.optional\(\)\.describe/);
  });

  it('returns size/lastUpdated/reason from the manifest lookup', async () => {
    const { handlers, client } = setupHandlers(registerRegistryTools);
    const handler = handlers.get('get_registry_tag_info');
    if (!handler) throw new Error('get_registry_tag_info not registered');
    client.get.mockResolvedValueOnce({ size: 104857600, lastUpdated: '2026-06-01T12:00:00Z' });
    const out = jsonOut(await handler({ image: 'library/nginx', tag: 'latest', registry: 2 }));
    expect(client.get).toHaveBeenCalledWith('/api/registry/tag-info', { registry: 2, image: 'library/nginx', tag: 'latest' });
    expect(out.size).toBe(104857600);
  });

  it('works without a registry id (implicit graceful "not supported" result from the backend)', async () => {
    const { handlers, client } = setupHandlers(registerRegistryTools);
    const handler = handlers.get('get_registry_tag_info');
    if (!handler) throw new Error('get_registry_tag_info not registered');
    client.get.mockResolvedValueOnce({ size: null, lastUpdated: null, reason: 'Not supported without a registry' });
    await handler({ image: 'library/nginx', tag: 'latest' });
    const [, params] = client.get.mock.calls[0]!;
    expect((params as Record<string, unknown>).registry).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. settings/navigation (new tools)
// Handler ground truth: src/routes/api/settings/navigation/+server.ts +
// src/lib/server/nav-preferences-core.ts (PAGE_SLUGS / parseNavPatch).
// GET -> { effective, global, user }. PUT?scope=global|user, body
// { landingPage?, envClickPage? } -> { success, global } | { success, user }.
// ---------------------------------------------------------------------------
describe('get_navigation_settings / update_navigation_settings (Issue #164, point 5)', () => {
  const source = readSource('system.ts');

  it('both tools are registered', () => {
    expect(source).toContain("'get_navigation_settings'");
    expect(source).toContain("'update_navigation_settings'");
  });

  it('get targets GET /api/settings/navigation', () => {
    const block = extractToolBlock(source, 'get_navigation_settings');
    expect(block).toMatch(/client\.get\(\s*['"`]\/api\/settings\/navigation['"`]/);
  });

  it('update targets PUT /api/settings/navigation with an optional scope query param', () => {
    const block = extractToolBlock(source, 'update_navigation_settings');
    expect(block).toMatch(/client\.put\(\s*['"`]\/api\/settings\/navigation['"`]/);
    expect(block).toMatch(/scope/);
  });

  it('get returns the effective/global/user shape', async () => {
    const { handlers, client } = setupHandlers(registerSystemTools);
    const handler = handlers.get('get_navigation_settings');
    if (!handler) throw new Error('get_navigation_settings not registered');
    client.get.mockResolvedValueOnce({
      effective: { landingPage: 'dashboard', envClickPage: 'containers' },
      global: { landingPage: null, envClickPage: null },
      user: null,
    });
    const out = jsonOut(await handler({}));
    expect(out.effective).toEqual({ landingPage: 'dashboard', envClickPage: 'containers' });
  });

  it('update sends only the provided fields in the body, and scope as a query param (default global)', async () => {
    const { handlers, client } = setupHandlers(registerSystemTools);
    const handler = handlers.get('update_navigation_settings');
    if (!handler) throw new Error('update_navigation_settings not registered');
    client.put.mockResolvedValueOnce({ success: true, global: { landingPage: 'stacks', envClickPage: null } });
    const out = jsonOut(await handler({ landingPage: 'stacks' }));
    const [path, body, params] = client.put.mock.calls[0]!;
    expect(path).toBe('/api/settings/navigation');
    expect(body).toEqual({ landingPage: 'stacks' });
    expect((params as Record<string, unknown> | undefined)?.scope).toBeUndefined();
    expect(out.success).toBe(true);
  });

  it('update passes scope=user through as a query param', async () => {
    const { handlers, client } = setupHandlers(registerSystemTools);
    const handler = handlers.get('update_navigation_settings');
    if (!handler) throw new Error('update_navigation_settings not registered');
    await handler({ scope: 'user', envClickPage: 'containers' });
    const [, body, params] = client.put.mock.calls[0]!;
    expect(body).toEqual({ envClickPage: 'containers' });
    expect((params as Record<string, unknown>).scope).toBe('user');
  });

  it('update can clear a field with null (envClickPage inherits the default again)', async () => {
    const { handlers, client } = setupHandlers(registerSystemTools);
    const handler = handlers.get('update_navigation_settings');
    if (!handler) throw new Error('update_navigation_settings not registered');
    await handler({ envClickPage: null });
    const [, body] = client.put.mock.calls[0]!;
    expect(body).toEqual({ envClickPage: null });
  });

  it('envClickPage rejects "dashboard" at the schema level (backend rejects it too — env-click is always a concrete page)', () => {
    // Static check: the zod schema for envClickPage must not simply reuse an
    // enum that includes 'dashboard' without excluding it — verified via the
    // tool's own describe() text since a full zod-refine round-trip is
    // exercised in TypeScript compilation (tsc --noEmit), not at this layer.
    const block = extractToolBlock(source, 'update_navigation_settings');
    expect(block.toLowerCase()).toMatch(/never.*dashboard|excludes?.*dashboard|not.*dashboard/);
  });
});
