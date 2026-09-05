import { describe, it, expect, vi } from 'vitest';
import { registerSettingsTools } from '../src/tools/settings.js';

/**
 * Tool coverage for `get_semver_settings` / `update_semver_settings` (#227),
 * the global newer-version-tag (semver) detection config added upstream in
 * Dockhand v1.0.43. Ground-truthed against `Finsys/dockhand` v1.0.46:
 *
 *   src/routes/api/settings/semver/+server.ts
 *     GET  /api/settings/semver
 *       resp-200: {enabled:boolean!, maxBump:string!, matchFlavor:boolean!, includePrerelease:boolean!}
 *     POST /api/settings/semver
 *       body: {enabled:boolean, maxBump:string, matchFlavor:boolean, includePrerelease:boolean}
 *       resp-200: {success:boolean!}
 *       resp-403: Permission denied (needs settings:edit)
 *
 *   src/lib/server/db.ts (getGlobalSemverConfig/setGlobalSemverConfig,
 *   GLOBAL_SEMVER_KEY = 'global_semver_check')
 *     This is a GLOBAL, single-row setting — NOT env-scoped (no `?env=`
 *     query param anywhere on this route, unlike most other settings/*
 *     endpoints in this codebase).
 *
 *     IMPORTANT (handler quirk, belongs in the tool description): POST does
 *     NOT merge with the existing stored config — `setGlobalSemverConfig`
 *     always writes a brand-new object built from `data`, with per-field
 *     defaults applied to whatever key is missing/invalid (maxBump invalid
 *     or absent -> 'major'; matchFlavor absent -> true via `??`; enabled and
 *     includePrerelease absent -> false via `=== true`). Omitting a field on
 *     update therefore RESETS it to that default, it does not preserve the
 *     previously stored value.
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function jsonOut(res: unknown): Record<string, unknown> {
  return JSON.parse((res as { content: { text: string }[] }).content[0].text);
}

function setup() {
  const handlers = new Map<string, ToolHandler>();
  const server = { tool: (n: string, _d: string, _s: unknown, cb: ToolHandler) => handlers.set(n, cb) };
  const client = {
    get: vi.fn(),
    post: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerSettingsTools(server as any, client as any);
  return { handlers, client };
}

describe('get_semver_settings / update_semver_settings (#227)', () => {
  // Registration smoke test. The actual TDD gegenversuch ran once, before
  // implementation (`registerSettingsTools` did not exist / neither tool was
  // registered) — that red run is not preserved as a committed assertion, it
  // was the manual red step of TDD Step 2. What is committed and green here
  // is the post-implementation check: both tools are, in fact, registered.
  it('both tools are registered', () => {
    const handlers = new Map<string, ToolHandler>();
    const server = { tool: (n: string, _d: string, _s: unknown, cb: ToolHandler) => handlers.set(n, cb) };
    const client = { get: vi.fn(), post: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerSettingsTools(server as any, client as any);
    expect(handlers.has('get_semver_settings')).toBe(true);
    expect(handlers.has('update_semver_settings')).toBe(true);
  });

  describe('get_semver_settings', () => {
    it('happy path: calls GET /api/settings/semver (no env param, global setting) and parses the field shape', async () => {
      const { handlers, client } = setup();
      client.get.mockResolvedValueOnce({
        enabled: true,
        maxBump: 'minor',
        matchFlavor: true,
        includePrerelease: false,
      });

      const handler = handlers.get('get_semver_settings');
      expect(handler).toBeDefined();
      const out = jsonOut(await handler!({}));

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/api/settings/semver');
      expect(out).toEqual({
        enabled: true,
        maxBump: 'minor',
        matchFlavor: true,
        includePrerelease: false,
      });
    });

    it('error path: backend 4xx (not authenticated) is returned as a structured tool error', async () => {
      const { handlers, client } = setup();
      client.get.mockRejectedValueOnce(new Error('401 Not authenticated'));

      const handler = handlers.get('get_semver_settings');
      const result = (await handler!({})) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0]!.text) as { error: string };
      expect(parsed.error).toContain('Not authenticated');
    });

    it('network error propagates as a structured tool error', async () => {
      const { handlers, client } = setup();
      client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const handler = handlers.get('get_semver_settings');
      const result = (await handler!({})) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0]!.text) as { error: string };
      expect(parsed.error).toContain('ECONNREFUSED');
    });
  });

  describe('update_semver_settings', () => {
    it('happy path: sends the full shape, no env param, parses {success}', async () => {
      const { handlers, client } = setup();
      client.post.mockResolvedValueOnce({ success: true });

      const handler = handlers.get('update_semver_settings');
      const out = jsonOut(await handler!({
        enabled: true,
        maxBump: 'minor',
        matchFlavor: false,
        includePrerelease: true,
      }));

      expect(client.post).toHaveBeenCalledTimes(1);
      const [path, body, params] = client.post.mock.calls[0]!;
      expect(path).toBe('/api/settings/semver');
      expect(body).toEqual({
        enabled: true,
        maxBump: 'minor',
        matchFlavor: false,
        includePrerelease: true,
      });
      expect(params).toBeUndefined();
      expect(out).toEqual({ success: true });
    });

    it('minimal call: only supplied fields are sent in the body (no client-side pre-filling of defaults)', async () => {
      const { handlers, client } = setup();
      client.post.mockResolvedValueOnce({ success: true });

      const handler = handlers.get('update_semver_settings');
      await handler!({ maxBump: 'patch' });

      const [path, body] = client.post.mock.calls[0]!;
      expect(path).toBe('/api/settings/semver');
      expect(body).toEqual({ maxBump: 'patch' });
    });

    it('no-args call sends an empty body (the backend then resets every field to its default)', async () => {
      const { handlers, client } = setup();
      client.post.mockResolvedValueOnce({ success: true });

      const handler = handlers.get('update_semver_settings');
      await handler!({});

      const [path, body] = client.post.mock.calls[0]!;
      expect(path).toBe('/api/settings/semver');
      expect(body).toEqual({});
    });

    it('error path: backend 403 (missing settings:edit) is returned as a structured tool error', async () => {
      const { handlers, client } = setup();
      client.post.mockRejectedValueOnce(new Error('403 Permission denied'));

      const handler = handlers.get('update_semver_settings');
      const result = (await handler!({ enabled: true })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0]!.text) as { error: string };
      expect(parsed.error).toContain('Permission denied');
    });

    it('network error propagates as a structured tool error', async () => {
      const { handlers, client } = setup();
      client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const handler = handlers.get('update_semver_settings');
      const result = (await handler!({ enabled: true })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0]!.text) as { error: string };
      expect(parsed.error).toContain('ECONNREFUSED');
    });
  });
});
