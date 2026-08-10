/**
 * Behavioural tests for `update_container` (#142).
 *
 * Dockhand's POST /api/containers/{id}/update handler (Finsys/dockhand v1.0.41,
 * `src/routes/api/containers/[id]/update/+server.ts`) does two things that make an
 * under-validated MCP tool dangerous:
 *
 *   1. It unconditionally parses a JSON body (`await request.json()`). A request with
 *      no body throws "Unexpected end of JSON input" -> HTTP 500. The old schema made
 *      `settings` optional, so the no-argument call this tool advertised as valid was
 *      guaranteed to fail server-side with an unhelpful, Dockhand-attributed error.
 *   2. It merges the body straight into `CreateContainerOptions`
 *      (`src/lib/server/docker.ts`, `updateContainer()`/`createContainer()`) without any
 *      schema validation. A key that isn't one of the real field names (e.g. `command`
 *      instead of `cmd`) is silently dropped, and the container is still *recreated* —
 *      so a typo doesn't just fail to apply, it can leave a running container broken
 *      while the tool reports success.
 *
 * These tests lock in the fix: the tool now (a) refuses a no-argument call itself, with
 * a clear message, before ever sending a request, and (b) rejects unrecognized `settings`
 * keys the same way, instead of forwarding them into a request Dockhand will silently
 * mangle.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerContainerTools } from '../src/tools/containers.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: 'text'; text: string }[];
  isError?: true;
}>;

interface MockClient {
  post: ReturnType<typeof vi.fn>;
}

/**
 * Register the container tools against a fake MCP server that captures each tool's
 * (already error-wrapped, see src/utils/tool-helper.ts) handler by name, plus a mocked
 * client. Mirrors the fixture in tests/stack-env-merge-behavior.test.ts.
 */
function setup(): { handler: ToolHandler; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = {
    post: vi.fn().mockResolvedValue({ success: true, id: 'abc123' }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerContainerTools(server as any, client as any);
  const handler = handlers.get('update_container');
  if (!handler) throw new Error('update_container handler was not registered');
  return { handler, client };
}

function jsonOut(res: Awaited<ReturnType<ToolHandler>>): Record<string, unknown> {
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

describe('update_container — settings contract (#142)', () => {
  it('rejects a call with no fields at all, without contacting Dockhand (regression for the guaranteed 500)', async () => {
    const { handler, client } = setup();

    const res = await handler({ environmentId: 9, containerId: 'abc123' });

    expect(res.isError).toBe(true);
    expect(jsonOut(res).error).toMatch(/at least one field/i);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects an empty settings object with no other fields, without contacting Dockhand', async () => {
    const { handler, client } = setup();

    const res = await handler({ environmentId: 9, containerId: 'abc123', settings: {} });

    expect(res.isError).toBe(true);
    expect(jsonOut(res).error).toMatch(/at least one field/i);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('accepts a call with only an explicit field set (image) and sends it as the request body', async () => {
    const { handler, client } = setup();

    const res = await handler({ environmentId: 9, containerId: 'abc123', image: 'alpine:3.21' });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/abc123/update',
      { image: 'alpine:3.21' },
      { env: 9 },
    );
  });

  it('rejects settings with the exact typo from #142 ("command" instead of "cmd") before recreating the container', async () => {
    const { handler, client } = setup();

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      settings: { name: 'repro-updctr', image: 'alpine:3.21', command: ['sleep', '7200'], startAfterUpdate: true },
    });

    expect(res.isError).toBe(true);
    expect(jsonOut(res).error).toMatch(/command/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects settings with any unrecognized key, naming it in the error', async () => {
    const { handler, client } = setup();

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      settings: { totallyMadeUpField: 'x' },
    });

    expect(res.isError).toBe(true);
    expect(jsonOut(res).error).toMatch(/totallyMadeUpField/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('accepts settings keys that are real CreateContainerOptions fields not exposed as explicit parameters (e.g. ports, memory)', async () => {
    const { handler, client } = setup();

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      settings: { ports: { '80/tcp': { HostPort: '8080' } }, memory: 536870912 },
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/abc123/update',
      { ports: { '80/tcp': { HostPort: '8080' } }, memory: 536870912 },
      { env: 9 },
    );
  });

  it('accepts the startAfterUpdate/repullImage control flags via settings (top-level body fields the handler destructures before touching CreateContainerOptions)', async () => {
    const { handler, client } = setup();

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      settings: { startAfterUpdate: true, repullImage: true, image: 'alpine:3.21' },
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/abc123/update',
      { startAfterUpdate: true, repullImage: true, image: 'alpine:3.21' },
      { env: 9 },
    );
  });

  it('exposes startAfterUpdate as an explicit parameter, merged alongside other explicit fields', async () => {
    const { handler, client } = setup();

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      image: 'alpine:3.21',
      cmd: ['sleep', '7200'],
      startAfterUpdate: true,
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/abc123/update',
      { image: 'alpine:3.21', cmd: ['sleep', '7200'], startAfterUpdate: true },
      { env: 9 },
    );
  });

  it('lets explicit parameters win over a conflicting key in settings (mirrors the update_environment additionalSettings precedent)', async () => {
    const { handler, client } = setup();

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      image: 'alpine:3.22',
      settings: { image: 'alpine:3.21' },
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/abc123/update',
      { image: 'alpine:3.22' },
      { env: 9 },
    );
  });

  it('sends all explicit fields (cmd, entrypoint, env, labels, restartPolicy, networkMode, workingDir) correctly named in the body', async () => {
    const { handler, client } = setup();

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      cmd: ['sleep', '7200'],
      entrypoint: ['/bin/sh', '-c'],
      env: ['FOO=bar'],
      labels: { team: 'ops' },
      restartPolicy: 'unless-stopped',
      networkMode: 'bridge',
      workingDir: '/data',
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/abc123/update',
      {
        cmd: ['sleep', '7200'],
        entrypoint: ['/bin/sh', '-c'],
        env: ['FOO=bar'],
        labels: { team: 'ops' },
        restartPolicy: 'unless-stopped',
        networkMode: 'bridge',
        workingDir: '/data',
      },
      { env: 9 },
    );
  });
});
