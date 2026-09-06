/**
 * Backup config tools (#202, cluster B) — request contracts and the nested
 * retention/options/selectedVolumes body shape.
 *
 * Every contract below was read off the Finsys/dockhand v1.0.46 handler, not the
 * changelog or the `@openapi body:` annotation:
 *   src/routes/api/backup/configs/+server.ts             GET (query type?, target?, env?), POST {destinationId!, targetName!, type?, environmentId?, enabled?, allVolumes?, selectedVolumes?, stopBeforeBackup?, schedule?, retention?, options?, tags?}
 *   src/routes/api/backup/configs/[id]/+server.ts        GET, PUT {destinationId?, enabled?, allVolumes?, selectedVolumes?, stopBeforeBackup?, schedule?, retention?, options?, tags?} (env is fixed at creation, not accepted here), DELETE
 *   src/routes/api/backup/configs/[id]/run/+server.ts    POST (no body) — backed by createJobResponse(), which returns synchronous buffered JSON for an `Accept: application/json` caller (what client.post() sends) — so plain client.post(), never client.postSSE()
 *   src/routes/api/backup/configs/[id]/stop/+server.ts   POST (no body)
 *
 * retention keys verified against src/lib/server/backups/helpers.ts
 * RETENTION_KEEP_KEYS = ['keepLast', 'keepDaily', 'keepWeekly', 'keepMonthly', 'keepYearly'].
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerBackupConfigTools } from '../src/tools/backup-configs.js';

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
  registerBackupConfigTools(server as any, client as any);
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

describe('backup config tools — registration', () => {
  it('registers all seven operations', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      'create_backup_config',
      'delete_backup_config',
      'get_backup_config',
      'list_backup_configs',
      'run_backup_config',
      'stop_backup_config',
      'update_backup_config',
    ]);
  });
});

describe('list_backup_configs', () => {
  it('happy path: GET /api/backup/configs, no filters', async () => {
    const { client, result } = await call('list_backup_configs', {});
    expect(client.get).toHaveBeenCalledWith('/api/backup/configs', { type: undefined, target: undefined, env: undefined });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: forwards type/target/env as the real query params', async () => {
    const { client } = await call('list_backup_configs', { type: 'stack', targetName: 'nextcloud', environmentId: 2 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/configs', { type: 'stack', target: 'nextcloud', env: 2 });
  });

  it('error path: backend 403 (missing backups:view) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('list_backup_configs')!({});
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('list_backup_configs')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('get_backup_config', () => {
  it('happy path: GET /api/backup/configs/{id}', async () => {
    const { client } = await call('get_backup_config', { configId: 7 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/configs/7');
  });

  it('error path: backend 404 is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('404 Not found'));
    const result = await handlers.get('get_backup_config')!({ configId: 999 });
    expectToolError(result, 'Not found');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const result = await handlers.get('get_backup_config')!({ configId: 7 });
    expectToolError(result, 'ETIMEDOUT');
  });
});

describe('create_backup_config', () => {
  it('happy path: sends only the required fields when optional ones are omitted', async () => {
    const { client } = await call('create_backup_config', {
      destinationId: 3,
      targetName: 'nextcloud',
    });

    expect(client.post).toHaveBeenCalledWith('/api/backup/configs', {
      destinationId: 3,
      targetName: 'nextcloud',
    });
  });

  it('requires destinationId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('create_backup_config')!);
    const result = schema.safeParse({ targetName: 'nextcloud' });
    expect(result.success).toBe(false);
  });

  it('requires targetName — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('create_backup_config')!);
    const result = schema.safeParse({ destinationId: 3 });
    expect(result.success).toBe(false);
  });

  it('GEGENVERSUCH: with both required fields present, the same schema accepts the call', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('create_backup_config')!);
    const result = schema.safeParse({ destinationId: 3, targetName: 'nextcloud' });
    expect(result.success).toBe(true);
  });

  it('forwards the nested retention object as a REAL object, never stringified', async () => {
    const { client } = await call('create_backup_config', {
      destinationId: 3,
      targetName: 'nextcloud',
      retention: { keepDaily: 7, keepWeekly: 4 },
    });

    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.retention).toEqual({ keepDaily: 7, keepWeekly: 4 });
    expect(typeof body.retention).toBe('object');
  });

  it('forwards selectedVolumes as a REAL array, never stringified', async () => {
    const { client } = await call('create_backup_config', {
      destinationId: 3,
      targetName: 'nextcloud',
      selectedVolumes: ['data', 'config'],
    });

    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.selectedVolumes).toEqual(['data', 'config']);
    expect(Array.isArray(body.selectedVolumes)).toBe(true);
  });

  it('forwards options as a REAL free-form object, never stringified', async () => {
    const { client } = await call('create_backup_config', {
      destinationId: 3,
      targetName: 'nextcloud',
      options: { compression: 'max', nested: { a: 1 } },
    });

    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.options).toEqual({ compression: 'max', nested: { a: 1 } });
    expect(typeof body.options).toBe('object');
  });

  it('forwards tags as a REAL array', async () => {
    const { client } = await call('create_backup_config', {
      destinationId: 3,
      targetName: 'nextcloud',
      tags: ['prod', 'critical'],
    });

    const body = client.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.tags).toEqual(['prod', 'critical']);
  });

  it('forwards every optional field when supplied', async () => {
    const { client } = await call('create_backup_config', {
      destinationId: 3,
      targetName: 'nextcloud',
      type: 'stack',
      environmentId: 1,
      enabled: true,
      allVolumes: true,
      stopBeforeBackup: false,
      schedule: '0 3 * * *',
      retention: { keepLast: 5, keepDaily: 7, keepWeekly: 4, keepMonthly: 6, keepYearly: 2 },
      options: { verbose: true },
      tags: ['prod'],
    });

    expect(client.post).toHaveBeenCalledWith('/api/backup/configs', {
      destinationId: 3,
      targetName: 'nextcloud',
      type: 'stack',
      environmentId: 1,
      enabled: true,
      allVolumes: true,
      stopBeforeBackup: false,
      schedule: '0 3 * * *',
      retention: { keepLast: 5, keepDaily: 7, keepWeekly: 4, keepMonthly: 6, keepYearly: 2 },
      options: { verbose: true },
      tags: ['prod'],
    });
  });

  it('error path: backend 400 (invalid targetName / cron / retention) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Invalid targetName'));
    const result = await handlers.get('create_backup_config')!({ destinationId: 3, targetName: 'nextcloud' });
    expectToolError(result, 'Invalid targetName');
  });

  it('error path: backend 500 (persistence error) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('500 Failed to create the backup configuration'));
    const result = await handlers.get('create_backup_config')!({ destinationId: 3, targetName: 'nextcloud' });
    expectToolError(result, 'Failed to create');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await handlers.get('create_backup_config')!({ destinationId: 3, targetName: 'nextcloud' });
    expectToolError(result, 'ECONNRESET');
  });
});

describe('update_backup_config', () => {
  it('happy path: PUT with only configId sends an empty body (pause/resume-style minimal PUT)', async () => {
    const { client } = await call('update_backup_config', { configId: 7 });
    expect(client.put).toHaveBeenCalledWith('/api/backup/configs/7', {});
  });

  it('does NOT require destinationId/targetName (update body is fully optional)', async () => {
    const { client } = await call('update_backup_config', { configId: 7, enabled: false });
    expect(client.put).toHaveBeenCalledWith('/api/backup/configs/7', { enabled: false });
  });

  it('forwards the nested retention object as a REAL object, never stringified', async () => {
    const { client } = await call('update_backup_config', {
      configId: 7,
      retention: { keepDaily: 14 },
    });

    const body = client.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.retention).toEqual({ keepDaily: 14 });
  });

  it('forwards selectedVolumes/options/tags as real object/array shapes', async () => {
    const { client } = await call('update_backup_config', {
      configId: 7,
      selectedVolumes: ['data'],
      options: { verbose: false },
      tags: ['staging'],
    });

    const body = client.put.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.selectedVolumes).toEqual(['data']);
    expect(body.options).toEqual({ verbose: false });
    expect(body.tags).toEqual(['staging']);
  });

  it('forwards destinationId when supplied (allowed on update, just not required)', async () => {
    const { client } = await call('update_backup_config', { configId: 7, destinationId: 9 });
    expect(client.put).toHaveBeenCalledWith('/api/backup/configs/7', { destinationId: 9 });
  });

  it('error path: backend 409 (destination change while running) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.put.mockRejectedValueOnce(new Error('409 Cannot change the destination while a backup is running for this config'));
    const result = await handlers.get('update_backup_config')!({ configId: 7, destinationId: 9 });
    expectToolError(result, 'Cannot change the destination');
  });

  it('error path: backend 400 (invalid cron) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.put.mockRejectedValueOnce(new Error('400 Invalid cron expression'));
    const result = await handlers.get('update_backup_config')!({ configId: 7, schedule: 'bogus' });
    expectToolError(result, 'Invalid cron expression');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.put.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('update_backup_config')!({ configId: 7, enabled: true });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('delete_backup_config', () => {
  it('happy path: DELETE /api/backup/configs/{id}', async () => {
    const { client } = await call('delete_backup_config', { configId: 7 });
    expect(client.delete).toHaveBeenCalledWith('/api/backup/configs/7');
  });

  it('error path: backend 409 (backup running) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('409 A backup is currently running for this config'));
    const result = await handlers.get('delete_backup_config')!({ configId: 7 });
    expectToolError(result, 'currently running');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await handlers.get('delete_backup_config')!({ configId: 7 });
    expectToolError(result, 'ECONNRESET');
  });
});

describe('run_backup_config', () => {
  it('happy path: POST /api/backup/configs/{id}/run using plain client.post (never postSSE)', async () => {
    const { client, result } = await call('run_backup_config', { configId: 7 });
    expect(client.post).toHaveBeenCalledWith('/api/backup/configs/7/run');
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('GEGENVERSUCH: does not call a postSSE-shaped client (proves the tool uses plain post, matching the real handler being a synchronous-JSON job for Accept:application/json callers)', async () => {
    const spyClient = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ status: 'success' }),
      put: vi.fn(),
      delete: vi.fn(),
      postSSE: vi.fn().mockRejectedValue(new Error('postSSE should never be called for this endpoint')),
    };
    const handlersMap = new Map<string, ToolHandler>();
    const server = {
      tool: (name: string, _d: string, _s: ZodShape, cb: ToolHandler) => { handlersMap.set(name, cb); },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerBackupConfigTools(server as any, spyClient as any);
    const result = await handlersMap.get('run_backup_config')!({ configId: 7 });
    expect(spyClient.postSSE).not.toHaveBeenCalled();
    expect(spyClient.post).toHaveBeenCalledWith('/api/backup/configs/7/run');
    expect(jsonOut(result)).toEqual({ status: 'success' });
  });

  it('error path: backend 4xx (permission/env denial) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('run_backup_config')!({ configId: 7 });
    expectToolError(result, 'Permission denied');
  });

  it('error path: backend reports a failed run as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('500 Backup failed'));
    const result = await handlers.get('run_backup_config')!({ configId: 7 });
    expectToolError(result, 'Backup failed');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const result = await handlers.get('run_backup_config')!({ configId: 7 });
    expectToolError(result, 'ETIMEDOUT');
  });
});

describe('stop_backup_config', () => {
  it('happy path: POST /api/backup/configs/{id}/stop, no body', async () => {
    const { client, result } = await call('stop_backup_config', { configId: 7 });
    expect(client.post).toHaveBeenCalledWith('/api/backup/configs/7/stop');
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('error path: backend 500 (cancel failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('500 Failed to cancel'));
    const result = await handlers.get('stop_backup_config')!({ configId: 7 });
    expectToolError(result, 'Failed to cancel');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('stop_backup_config')!({ configId: 7 });
    expectToolError(result, 'ECONNREFUSED');
  });
});
