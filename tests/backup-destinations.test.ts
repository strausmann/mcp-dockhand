/**
 * Backup destination tools (#202, cluster A) — request contracts and the
 * operator-safety suffixes.
 *
 * Every contract below was read off the Finsys/dockhand v1.0.46 handler, not the
 * changelog or the openapi doc annotation:
 *   src/routes/api/backup/destinations/+server.ts                 GET, POST {name!, repository!, password!, envVars, backupFlags, restoreFlags, flags, hostPath, cacert, tlsClientCert, policies}
 *   src/routes/api/backup/destinations/[id]/+server.ts             GET, PUT {same fields, all optional}, DELETE
 *   src/routes/api/backup/destinations/[id]/init/+server.ts        POST (no body)
 *   src/routes/api/backup/destinations/[id]/rotate-key/+server.ts  POST {currentPassword!, newPassword!}
 *   src/routes/api/backup/destinations/[id]/task/+server.ts        POST {task!} — enum unlock/check/prune/stats/repair-index/repair-snapshots
 *   src/routes/api/backup/destinations/[id]/test/+server.ts        POST (no body)
 *   src/routes/api/backup/destinations/[id]/verify/+server.ts      POST {dataSubset?}
 *   src/routes/api/backup/destinations/test/+server.ts             POST {destinationId?, repository?, password?, envVars?, cacert?, tlsClientCert?}
 *
 * PUT (not PATCH) confirmed against both the handler export and
 * docs/dockhand-openapi.json (only `put` is listed for /api/backup/destinations/{id}).
 *
 * `task` and `verify` are backed by createJobResponse() upstream — synchronous buffered
 * JSON for an `Accept: application/json` caller (what client.post() sends), so both use
 * plain client.post(), never client.postSSE().
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerBackupDestinationTools } from '../src/tools/backup-destinations.js';
import { describeTool } from '../src/openapi/describe-tool.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
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
    put: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerBackupDestinationTools(server as any, client as any);
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

describe('backup destination tools — registration', () => {
  it('registers all eleven operations', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      'create_backup_destination',
      'delete_backup_destination',
      'get_backup_destination',
      'init_backup_destination',
      'list_backup_destinations',
      'rotate_backup_destination_key',
      'run_backup_destination_task',
      'test_backup_destination',
      'test_backup_destination_inline',
      'update_backup_destination',
      'verify_backup_destination',
    ]);
  });
});

describe('list_backup_destinations', () => {
  it('happy path: GET /api/backup/destinations, no params', async () => {
    const { client, result } = await call('list_backup_destinations', {});
    expect(client.get).toHaveBeenCalledWith('/api/backup/destinations');
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('error path: backend 403 (missing backups:view) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('list_backup_destinations')!({});
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('list_backup_destinations')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('create_backup_destination', () => {
  it('happy path: sends only the required fields when optional ones are omitted', async () => {
    const { client } = await call('create_backup_destination', {
      name: 'S3 Offsite',
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
    });

    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations', {
      name: 'S3 Offsite',
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
    });
  });

  it('forwards envVars as an OBJECT, never flattened to a string', async () => {
    const { client } = await call('create_backup_destination', {
      name: 'S3 Offsite',
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
      envVars: { AWS_ACCESS_KEY_ID: 'AKIA...', AWS_SECRET_ACCESS_KEY: 'secret' },
    });

    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.envVars).toEqual({ AWS_ACCESS_KEY_ID: 'AKIA...', AWS_SECRET_ACCESS_KEY: 'secret' });
    expect(typeof body.envVars).toBe('object');
  });

  it('forwards the split backupFlags/restoreFlags shape the real handler accepts (doc gap: not in the pinned openapi requestBody schema)', async () => {
    const { client } = await call('create_backup_destination', {
      name: 'S3 Offsite',
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
      backupFlags: '--exclude *.tmp',
      restoreFlags: '--exclude-xattr foo',
    });

    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.backupFlags).toBe('--exclude *.tmp');
    expect(body.restoreFlags).toBe('--exclude-xattr foo');
  });

  it('forwards every optional field when supplied', async () => {
    const { client } = await call('create_backup_destination', {
      name: 'S3 Offsite',
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
      flags: '--legacy-flag',
      hostPath: '/mnt/backup',
      cacert: '-----BEGIN CERTIFICATE-----',
      tlsClientCert: '-----BEGIN CERTIFICATE-----',
      policies: '{"pruneEnabled":true}',
    });

    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations', {
      name: 'S3 Offsite',
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
      flags: '--legacy-flag',
      hostPath: '/mnt/backup',
      cacert: '-----BEGIN CERTIFICATE-----',
      tlsClientCert: '-----BEGIN CERTIFICATE-----',
      policies: '{"pruneEnabled":true}',
    });
  });

  it('error path: backend 409 (duplicate name) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('409 A destination with this name already exists'));
    const result = await handlers.get('create_backup_destination')!({
      name: 'dup', repository: '/mnt/x', password: 'p',
    });
    expectToolError(result, 'already exists');
  });

  it('error path: backend 400 (bad repository) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Invalid repository'));
    const result = await handlers.get('create_backup_destination')!({
      name: 'x', repository: 'ftp://nope', password: 'p',
    });
    expectToolError(result, 'Invalid repository');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('create_backup_destination')!({
      name: 'x', repository: '/mnt/x', password: 'p',
    });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('get_backup_destination', () => {
  it('happy path: GET .../destinations/{id}, numeric id path-encoded', async () => {
    const { client } = await call('get_backup_destination', { destinationId: 42 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/destinations/42');
  });

  it('error path: backend 404 is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('404 Destination not found'));
    const result = await handlers.get('get_backup_destination')!({ destinationId: 999 });
    expectToolError(result, 'not found');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_backup_destination')!({ destinationId: 1 });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('update_backup_destination', () => {
  it('happy path: sends only the fields the caller supplied (PUT, not PATCH)', async () => {
    const { client } = await call('update_backup_destination', {
      destinationId: 7,
      name: 'S3 Offsite (renamed)',
    });

    expect(client.put).toHaveBeenCalledWith('/api/backup/destinations/7', { name: 'S3 Offsite (renamed)' });
    const body = client.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['name']);
  });

  it('omitting all flag fields sends none of them (handler: absence means "leave flags untouched")', async () => {
    const { client } = await call('update_backup_destination', {
      destinationId: 7,
      policies: '{"pruneEnabled":false}',
    });

    const body = client.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('flags');
    expect(body).not.toHaveProperty('backupFlags');
    expect(body).not.toHaveProperty('restoreFlags');
    expect(body.policies).toBe('{"pruneEnabled":false}');
  });

  it('forwards envVars as an object when replacing credentials', async () => {
    const { client } = await call('update_backup_destination', {
      destinationId: 7,
      envVars: { AWS_ACCESS_KEY_ID: 'new-key' },
    });

    const body = client.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.envVars).toEqual({ AWS_ACCESS_KEY_ID: 'new-key' });
  });

  it('error path: backend 409 (backup running) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.put.mockRejectedValueOnce(new Error('409 A backup using this destination is currently running'));
    const result = await handlers.get('update_backup_destination')!({ destinationId: 7, repository: '/new' });
    expectToolError(result, 'currently running');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.put.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('update_backup_destination')!({ destinationId: 7, name: 'x' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('delete_backup_destination', () => {
  it('happy path: DELETE .../destinations/{id}', async () => {
    const { client } = await call('delete_backup_destination', { destinationId: 3 });
    expect(client.delete).toHaveBeenCalledWith('/api/backup/destinations/3');
  });

  it('error path: backend 409 (backup running) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('409 A backup using this destination is currently running'));
    const result = await handlers.get('delete_backup_destination')!({ destinationId: 3 });
    expectToolError(result, 'currently running');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('delete_backup_destination')!({ destinationId: 3 });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('init_backup_destination', () => {
  it('happy path: POST .../destinations/{id}/init, no body', async () => {
    const { client } = await call('init_backup_destination', { destinationId: 5 });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/5/init');
  });

  it('error path: backend 500 (init failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('500 restic init failed'));
    const result = await handlers.get('init_backup_destination')!({ destinationId: 5 });
    expectToolError(result, 'restic init failed');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('init_backup_destination')!({ destinationId: 5 });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('rotate_backup_destination_key', () => {
  it('happy path: sends currentPassword and newPassword', async () => {
    const { client } = await call('rotate_backup_destination_key', {
      destinationId: 9, currentPassword: 'old', newPassword: 'new',
    });

    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/9/rotate-key', {
      currentPassword: 'old', newPassword: 'new',
    });
  });

  it('error path: backend 400 (wrong current password) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Current password incorrect'));
    const result = await handlers.get('rotate_backup_destination_key')!({
      destinationId: 9, currentPassword: 'wrong', newPassword: 'new',
    });
    expectToolError(result, 'Current password incorrect');
  });

  it('error path: backend 409 (db out of sync) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('409 dbOutOfSync'));
    const result = await handlers.get('rotate_backup_destination_key')!({
      destinationId: 9, currentPassword: 'old', newPassword: 'new',
    });
    expectToolError(result, 'dbOutOfSync');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('rotate_backup_destination_key')!({
      destinationId: 9, currentPassword: 'old', newPassword: 'new',
    });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('run_backup_destination_task', () => {
  it('happy path: sends the task name, via plain client.post (never postSSE)', async () => {
    const { client } = await call('run_backup_destination_task', { destinationId: 11, task: 'check' });

    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/11/task', { task: 'check' });
  });

  it.each(['unlock', 'check', 'prune', 'stats', 'repair-index', 'repair-snapshots'])(
    'accepts task=%s (the exact enum the handler validates against)',
    async (task) => {
      const { client } = await call('run_backup_destination_task', { destinationId: 11, task });
      expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/11/task', { task });
    }
  );

  it('rejects an unknown task at the zod layer (schema validation, which the real MCP SDK runs before invoking our callback)', () => {
    const { schemas } = setup();
    const shape = schemas.get('run_backup_destination_task')!;
    expect(() => z.object(shape).parse({ destinationId: 11, task: 'nonexistent-task' })).toThrow();
    // The exact enum the handler validates against (task/+server.ts) must all pass.
    for (const task of ['unlock', 'check', 'prune', 'stats', 'repair-index', 'repair-snapshots']) {
      expect(() => z.object(shape).parse({ destinationId: 11, task })).not.toThrow();
    }
  });

  it('surfaces a task result with success:false as a normal (non-error) response — the job endpoint returns 200 either way', async () => {
    const { handlers, client } = setup();
    client.post.mockResolvedValueOnce({ success: false, error: 'repository is locked' });
    const handler = handlers.get('run_backup_destination_task')!;
    const result = await handler({ destinationId: 11, task: 'prune' });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(jsonOut(result)).toEqual({ success: false, error: 'repository is locked' });
  });

  it('error path: backend 400 (invalid destination id) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Invalid destination ID'));
    const result = await handlers.get('run_backup_destination_task')!({ destinationId: 11, task: 'check' });
    expectToolError(result, 'Invalid destination ID');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('run_backup_destination_task')!({ destinationId: 11, task: 'check' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('test_backup_destination', () => {
  it('happy path: POST .../destinations/{id}/test, no body', async () => {
    const { client } = await call('test_backup_destination', { destinationId: 6 });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/6/test');
  });

  it('error path: backend 404 is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('404 Destination not found'));
    const result = await handlers.get('test_backup_destination')!({ destinationId: 6 });
    expectToolError(result, 'not found');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('test_backup_destination')!({ destinationId: 6 });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('verify_backup_destination', () => {
  it('omits dataSubset when not supplied — sends an empty body (server defaults to "5%")', async () => {
    const { client } = await call('verify_backup_destination', { destinationId: 8 });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/8/verify', {});
  });

  it('happy path: forwards a supplied dataSubset, via plain client.post (never postSSE)', async () => {
    const { client } = await call('verify_backup_destination', { destinationId: 8, dataSubset: '10%' });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/8/verify', { dataSubset: '10%' });
  });

  it('surfaces a result with success:false as a normal (non-error) response', async () => {
    const { handlers, client } = setup();
    client.post.mockResolvedValueOnce({ success: false, error: 'verification failed' });
    const handler = handlers.get('verify_backup_destination')!;
    const result = await handler({ destinationId: 8 });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(jsonOut(result)).toEqual({ success: false, error: 'verification failed' });
  });

  it('error path: backend 400 (invalid id) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Invalid destination ID'));
    const result = await handlers.get('verify_backup_destination')!({ destinationId: 8 });
    expectToolError(result, 'Invalid destination ID');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('verify_backup_destination')!({ destinationId: 8 });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('test_backup_destination_inline', () => {
  it('happy path (saved destination): sends only destinationId', async () => {
    const { client } = await call('test_backup_destination_inline', { destinationId: 4 });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/test', { destinationId: 4 });
  });

  it('happy path (unsaved destination): sends repository/password/envVars as an object, no destinationId', async () => {
    const { client } = await call('test_backup_destination_inline', {
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
      envVars: { AWS_ACCESS_KEY_ID: 'AKIA...' },
    });

    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/test', {
      repository: 's3:s3.amazonaws.com/my-bucket/restic',
      password: 'hunter2',
      envVars: { AWS_ACCESS_KEY_ID: 'AKIA...' },
    });
    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('destinationId');
  });

  it('forwards cacert/tlsClientCert for a pre-save private-CA test', async () => {
    const { client } = await call('test_backup_destination_inline', {
      repository: 'rest:https://internal-restic/repo',
      password: 'p',
      cacert: '-----BEGIN CERTIFICATE-----',
      tlsClientCert: '-----BEGIN CERTIFICATE-----',
    });

    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.cacert).toBe('-----BEGIN CERTIFICATE-----');
    expect(body.tlsClientCert).toBe('-----BEGIN CERTIFICATE-----');
  });

  it('error path: backend 400 (missing repository/password) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Repository and password are required'));
    const result = await handlers.get('test_backup_destination_inline')!({});
    expectToolError(result, 'required');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('test_backup_destination_inline')!({ repository: '/mnt/x', password: 'p' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('operator-safety suffixes', () => {
  const BODY_CREDENTIAL_TOOLS = [
    'create_backup_destination',
    'update_backup_destination',
    'test_backup_destination_inline',
  ];

  it.each(BODY_CREDENTIAL_TOOLS)('%s warns that password/envVars are recorded in the tool call', (name) => {
    const description = describeTool(name);
    expect(description).toMatch(/SECURITY/);
    expect(description).toMatch(/recorded in the tool call/i);
    expect(description).toMatch(/ask the operator/i);
  });

  it('rotate_backup_destination_key warns about currentPassword/newPassword specifically', () => {
    const description = describeTool('rotate_backup_destination_key');
    expect(description).toMatch(/SECURITY/);
    expect(description).toMatch(/currentPassword/);
    expect(description).toMatch(/newPassword/);
  });

  it('get_backup_destination warns the response carries DECRYPTED envVars', () => {
    const description = describeTool('get_backup_destination');
    expect(description).toMatch(/SECURITY/);
    expect(description).toMatch(/DECRYPTED/);
    expect(description).toMatch(/list_backup_destinations/);
  });

  it('run_backup_destination_task warns prune/repair are destructive against the shared repository', () => {
    const description = describeTool('run_backup_destination_task');
    expect(description).toMatch(/WARNING/);
    expect(description).toMatch(/prune/);
    expect(description).toMatch(/repair-index/);
    expect(description).toMatch(/repair-snapshots/);
    expect(description).toMatch(/shared/i);
  });

  it('list_backup_destinations and delete_backup_destination carry no credential suffix', () => {
    expect(describeTool('list_backup_destinations')).not.toMatch(/SECURITY: `password`/);
    expect(describeTool('delete_backup_destination')).not.toMatch(/SECURITY: `password`/);
  });

  it('appends to the derived description instead of replacing it', () => {
    const description = describeTool('create_backup_destination');
    expect(description).toMatch(/backup destination/i);
    expect(description.indexOf('SECURITY')).toBeGreaterThan(0);
    expect(description).not.toBe('No description available.');
  });
});
