import { describe, it, expect, vi } from 'vitest';
import { registerStackTools } from '../src/tools/stacks.js';

/**
 * Tool coverage for `validate_stack_compose` (#230), the Compose Validate
 * preflight linter added upstream in Dockhand v1.0.43. Ground-truthed against
 * `Finsys/dockhand` v1.0.46, `src/routes/api/stacks/[name]/validate/+server.ts`:
 *   POST /api/stacks/{name}/validate?env=<id>
 *   body: {compose:string! , config:{disabled:string[], severity:object},
 *          envVars:object, existing:boolean}
 *   resp: {findings:[{ruleId,severity,message,hint?,service?,line?,fix?,fixDescription?}],
 *          counts:{error,warn,info}}
 *
 * `existing` (line 62/82 of the handler) is NOT documented in the `@openapi`
 * annotation or in docs/dockhand-openapi.json — only visible reading the
 * handler source. It self-excludes the stack's own running containers/ports
 * from cross-stack collision checks; it applies ONLY when validating an
 * already-existing stack.
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
    post: vi.fn().mockResolvedValue({ findings: [], counts: { error: 0, warn: 0, info: 0 } }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerStackTools(server as any, client as any);
  const handler = handlers.get('validate_stack_compose');
  if (!handler) throw new Error('validate_stack_compose not registered');
  return { handler, client };
}

describe('validate_stack_compose (#230)', () => {
  // Registration smoke test. The mandated red/green TDD Step 2 marker ran
  // once, before implementation (`validate_stack_compose` did not exist
  // yet) — that red run is not preserved as a committed assertion, it was
  // the manual gegenversuch. What is committed and green here is the
  // post-implementation check: the tool is, in fact, registered.
  it('the tool is registered', () => {
    const handlers = new Map<string, ToolHandler>();
    const server = { tool: (n: string, _d: string, _s: unknown, cb: ToolHandler) => handlers.set(n, cb) };
    const client = { get: vi.fn(), post: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerStackTools(server as any, client as any);
    expect(handlers.has('validate_stack_compose')).toBe(true);
  });

  it('happy path: sends compose + config + envVars + existing, parses findings/counts', async () => {
    const { handler, client } = setup();
    const composeSrc = 'services:\n  web:\n    image: nginx:latest\n    ports: ["8080:80"]\n';
    client.post.mockResolvedValueOnce({
      findings: [{
        ruleId: 'LATEST_TAG',
        severity: 'warn',
        message: '"web" uses `:latest` (nginx:latest)',
        hint: 'Pin a version tag for reproducible deploys and to enable newer-version detection.',
        service: 'web',
        line: 3,
      }],
      counts: { error: 0, warn: 1, info: 0 },
    });

    const out = jsonOut(await handler({
      environmentId: 7,
      name: 'web-stack',
      compose: composeSrc,
      config: { disabled: ['LATEST_TAG'], severity: { LATEST_TAG: 'info' } },
      envVars: { TZ: 'Europe/Berlin' },
      existing: true,
    }));

    expect(client.post).toHaveBeenCalledTimes(1);
    const [path, body, params] = client.post.mock.calls[0]!;
    expect(path).toBe('/api/stacks/web-stack/validate');
    expect(body).toEqual({
      compose: composeSrc,
      config: { disabled: ['LATEST_TAG'], severity: { LATEST_TAG: 'info' } },
      envVars: { TZ: 'Europe/Berlin' },
      existing: true,
    });
    expect((params as Record<string, unknown>).env).toBe(7);

    expect(out.findings).toHaveLength(1);
    expect((out.findings as Array<Record<string, unknown>>)[0]!.ruleId).toBe('LATEST_TAG');
    expect(out.counts).toEqual({ error: 0, warn: 1, info: 0 });
  });

  it('minimal call: only compose (required) is sent, no config/envVars/existing keys', async () => {
    const { handler, client } = setup();
    await handler({ name: 'new-stack', compose: 'services: {}\n' });

    const [path, body, params] = client.post.mock.calls[0]!;
    expect(path).toBe('/api/stacks/new-stack/validate');
    expect(body).toEqual({ compose: 'services: {}\n' });
    expect((params as Record<string, unknown>).env).toBeUndefined();
  });

  it('path is percent-encoded for stack names with special characters', async () => {
    const { handler, client } = setup();
    await handler({ environmentId: 1, name: 'my stack/x', compose: 'services: {}\n' });
    const [path] = client.post.mock.calls[0]!;
    expect(path).toBe(`/api/stacks/${encodeURIComponent('my stack/x')}/validate`);
  });

  it('error path: backend 4xx (compose content is required) is returned as a structured tool error', async () => {
    const { handler, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 compose content is required'));

    const result = (await handler({ environmentId: 1, name: 'x', compose: '' })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text) as { error: string };
    expect(parsed.error).toContain('compose content is required');
  });

  it('network error propagates as a structured tool error (nothing to parse downstream)', async () => {
    const { handler, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = (await handler({ environmentId: 1, name: 'x', compose: 'services: {}\n' })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text) as { error: string };
    expect(parsed.error).toContain('ECONNREFUSED');
  });
});
