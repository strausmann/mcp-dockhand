/**
 * Secret-provider tools (Dockhand 1.0.42+) — request contracts and the operator-safety
 * suffix.
 *
 * Every contract below was read off the 1.0.42 handler, not the changelog:
 *   src/routes/api/secret-providers/+server.ts            GET, POST {name!, type!, config!}
 *   src/routes/api/secret-providers/[id]/+server.ts       GET, PUT {name?, type?, config?}, DELETE
 *   src/routes/api/secret-providers/[id]/probe/+server.ts POST {selector?, refs?}
 *   src/routes/api/secret-providers/[id]/test/+server.ts  POST {config?}
 *   src/routes/api/secret-providers/test/+server.ts       POST {type!, config!}
 */

import { describe, it, expect, vi } from 'vitest';
import { registerSecretProviderTools } from '../src/tools/secret-providers.js';
import { describeTool } from '../src/openapi/describe-tool.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function setup(): { handlers: Map<string, ToolHandler>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _d: string, _s: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ ok: true }),
    post: vi.fn().mockResolvedValue({ ok: true }),
    put: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerSecretProviderTools(server as any, client as any);
  return { handlers, client };
}

async function call(name: string, args: Record<string, unknown>) {
  const { handlers, client } = setup();
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  await handler(args);
  return client;
}

describe('secret-provider tools — request contracts', () => {
  it('registers all eight operations', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      'create_secret_provider',
      'delete_secret_provider',
      'get_secret_provider',
      'list_secret_providers',
      'probe_secret_provider',
      'test_secret_provider',
      'test_secret_provider_config',
      'update_secret_provider',
    ]);
  });

  it('create sends name, type and config', async () => {
    const client = await call('create_secret_provider', {
      name: 'vault-prod', type: 'vault', config: { addr: 'https://vault.example' },
    });

    expect(client.post).toHaveBeenCalledWith('/api/secret-providers', {
      name: 'vault-prod', type: 'vault', config: { addr: 'https://vault.example' },
    });
  });

  it('update omits fields the caller did not supply', async () => {
    // The handler leaves an absent field unchanged (`'config' in data ? ... : undefined`),
    // so sending `config: undefined` would be a different request than omitting it.
    const client = await call('update_secret_provider', { id: 3, name: 'renamed' });

    expect(client.put).toHaveBeenCalledWith('/api/secret-providers/3', { name: 'renamed' });
    const body = client.put.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['name']);
  });

  it('update forwards a config rotation when one is given', async () => {
    const client = await call('update_secret_provider', { id: 3, config: { token: 'x' } });

    expect(client.put).toHaveBeenCalledWith('/api/secret-providers/3', { config: { token: 'x' } });
  });

  it('probe sends only the narrowing fields that were supplied', async () => {
    const client = await call('probe_secret_provider', { id: 7, refs: ['DB_PASSWORD'] });

    expect(client.post).toHaveBeenCalledWith('/api/secret-providers/7/probe', {
      refs: ['DB_PASSWORD'],
    });
  });

  it('test against a stored provider sends an empty body when no override is given', async () => {
    const client = await call('test_secret_provider', { id: 7 });

    expect(client.post).toHaveBeenCalledWith('/api/secret-providers/7/test', {});
  });

  it('test of an unsaved config sends type and config', async () => {
    const client = await call('test_secret_provider_config', {
      type: 'doppler', config: { token: 'dp.st.x' },
    });

    expect(client.post).toHaveBeenCalledWith('/api/secret-providers/test', {
      type: 'doppler', config: { token: 'dp.st.x' },
    });
  });

  it('list and delete take no body', async () => {
    const listClient = await call('list_secret_providers', {});
    expect(listClient.get).toHaveBeenCalledWith('/api/secret-providers');

    const deleteClient = await call('delete_secret_provider', { id: 4 });
    expect(deleteClient.delete).toHaveBeenCalledWith('/api/secret-providers/4');
  });
});

describe('operator-safety suffix', () => {
  const CREDENTIAL_TOOLS = [
    'create_secret_provider',
    'update_secret_provider',
    'test_secret_provider',
    'test_secret_provider_config',
  ];
  const SAFE_TOOLS = [
    'list_secret_providers',
    'get_secret_provider',
    'delete_secret_provider',
    'probe_secret_provider',
  ];

  it.each(CREDENTIAL_TOOLS)('%s warns that config carries credentials and asks first', (name) => {
    const description = describeTool(name);

    expect(description).toMatch(/SECURITY/);
    expect(description).toMatch(/recorded in the tool call/i);
    expect(description).toMatch(/ask the operator/i);
  });

  it.each(SAFE_TOOLS)('%s carries no suffix — it never receives a config', (name) => {
    expect(describeTool(name)).not.toMatch(/SECURITY: the `config` object/);
  });

  it('appends to the derived description instead of replacing it', () => {
    // The point of a suffix over an override: the spec-derived text must survive. If this
    // ever starts failing because the summary was reworded upstream, update the expectation
    // — do NOT convert the entry into an override, which would drop the derived half.
    const description = describeTool('create_secret_provider');

    expect(description).toMatch(/secret provider/i);
    expect(description.indexOf('SECURITY')).toBeGreaterThan(0);
    expect(description).not.toBe('No description available.');
  });
});
