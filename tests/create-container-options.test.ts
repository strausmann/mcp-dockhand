/**
 * create_container request shape against Dockhand's CreateContainerOptions
 * (Finsys/dockhand v1.0.54, src/lib/server/docker.ts):
 *
 *   ports?: { [containerPort]: { HostIp?: string; HostPort: string } }
 *     createContainer wraps each value in an array itself
 *     (`PortBindings[containerPort] = [hostConfig]`), so Docker's own
 *     `{"80/tcp": [{HostPort}]}` form would end up double-wrapped.
 *   restartPolicy?: string     -> HostConfig.RestartPolicy.Name (default 'no')
 *   restartMaxRetries?: number -> MaximumRetryCount, only with 'on-failure'
 *   networkMode?: string, cmd?: string[], volumeBinds?: string[]
 *
 * The lowercase field names themselves are covered in
 * tests/body-contract-real-bugs-169.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerContainerTools } from '../src/tools/containers.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

function setup() {
  let handler: ToolHandler | undefined;
  let schema: ZodShape | undefined;
  const server = {
    tool: (name: string, _d: string, s: ZodShape, _a: unknown, cb: ToolHandler) => {
      if (name === 'create_container') {
        handler = cb;
        schema = s;
      }
    },
  };
  const client = {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
  registerContainerTools(server as never, client as never);
  return { handler: handler!, schema: z.object(schema!), client };
}

const base = { environmentId: 1, name: 'web', image: 'nginx:alpine' };

describe('create_container — ports', () => {
  it('sends Dockhand\'s single-object-per-port shape unchanged', async () => {
    const { handler, client } = setup();
    const ports = { '80/tcp': { HostPort: '8080' }, '443/tcp': { HostIp: '127.0.0.1', HostPort: '8443' } };
    await handler({ ...base, ports });
    expect(client.post.mock.calls[0][1]).toMatchObject({ ports });
  });

  it('requires the protocol in the key, as Dockhand itself builds them (port-parse.ts: `${port}/${protocol}`)', () => {
    const { schema } = setup();
    expect(schema.safeParse({ ...base, ports: { '80': { HostPort: '8080' } } }).success).toBe(false);
    expect(schema.safeParse({ ...base, ports: { '53/udp': { HostPort: '5353' } } }).success).toBe(true);
  });

  it('rejects Docker\'s array form, which Dockhand would double-wrap', () => {
    const { schema } = setup();
    expect(schema.safeParse({ ...base, ports: { '80/tcp': [{ HostPort: '8080' }] } }).success).toBe(false);
  });

  it('rejects a numeric HostPort (Docker requires a string)', () => {
    const { schema } = setup();
    expect(schema.safeParse({ ...base, ports: { '80/tcp': { HostPort: 8080 } } }).success).toBe(false);
  });

  it('rejects a malformed container port key', () => {
    const { schema } = setup();
    expect(schema.safeParse({ ...base, ports: { 'http': { HostPort: '8080' } } }).success).toBe(false);
    expect(schema.safeParse({ ...base, ports: { '80/http': { HostPort: '8080' } } }).success).toBe(false);
  });
});

describe('create_container — restart policy', () => {
  it('only accepts the four Docker restart policies', () => {
    const { schema } = setup();
    for (const ok of ['no', 'always', 'unless-stopped', 'on-failure']) {
      expect(schema.safeParse({ ...base, restartPolicy: ok }).success).toBe(true);
    }
    expect(schema.safeParse({ ...base, restartPolicy: 'sometimes' }).success).toBe(false);
  });

  it('forwards restartMaxRetries for on-failure', async () => {
    const { handler, client } = setup();
    await handler({ ...base, restartPolicy: 'on-failure', restartMaxRetries: 5 });
    expect(client.post.mock.calls[0][1]).toMatchObject({ restartPolicy: 'on-failure', restartMaxRetries: 5 });
  });

  it('rejects a negative or fractional restartMaxRetries', () => {
    const { schema } = setup();
    expect(schema.safeParse({ ...base, restartMaxRetries: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...base, restartMaxRetries: 1.5 }).success).toBe(false);
  });
});

describe('create_container — networkMode, cmd, binds', () => {
  it('sends networkMode and cmd under their CreateContainerOptions names', async () => {
    const { handler, client } = setup();
    await handler({ ...base, networkMode: 'bridge', cmd: ['nginx', '-g', 'daemon off;'] });
    expect(client.post.mock.calls[0][1]).toMatchObject({ networkMode: 'bridge', cmd: ['nginx', '-g', 'daemon off;'] });
  });

  it('merges volumeBinds and the volumes alias instead of dropping one', async () => {
    const { handler, client } = setup();
    await handler({ ...base, volumeBinds: ['/a:/a'], volumes: ['/b:/b:ro'] });
    expect(client.post.mock.calls[0][1]).toMatchObject({ volumeBinds: ['/a:/a', '/b:/b:ro'] });
  });

  it('omits every optional field that was not supplied', async () => {
    const { handler, client } = setup();
    await handler(base);
    expect(client.post).toHaveBeenCalledWith('/api/containers', { name: 'web', image: 'nginx:alpine' }, { env: 1 });
  });
});
