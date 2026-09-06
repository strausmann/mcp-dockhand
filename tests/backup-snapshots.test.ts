/**
 * Backup snapshot + instance tools (#202, cluster C) — restic snapshots stored in a
 * backup destination, plus the install's own stable instance id.
 *
 * Every contract below was read off the Finsys/dockhand v1.0.46 handler, not the
 * changelog or the `@openapi` annotation summary line alone:
 *   src/routes/api/backup/snapshots/+server.ts             GET (query configId?:int,
 *     destinationId?:int, allDestinations?:'true' literal check) — 400 if neither
 *     configId nor destinationId given.
 *   src/routes/api/backup/snapshots/diff/+server.ts        GET (query destinationId!:int,
 *     snapshotA!:string, snapshotB!:string) — 400 if any of the three is missing.
 *   src/routes/api/backup/snapshots/[id]/+server.ts        DELETE (path id!:string, query
 *     destinationId!:int, env?:int) — restic forget --prune, IRREVERSIBLE. Requires
 *     backups:manage (requireBackups(auth,'manage')), unlike every other tool in this
 *     file which only needs backups:view.
 *   src/routes/api/backup/snapshots/[id]/browse/+server.ts GET (path id!:string, query
 *     destinationId!:int, path?:string defaults server-side to '/', env?:int)
 *   src/routes/api/backup/snapshots/[id]/dump/+server.ts   GET (path id!:string, query
 *     destinationId!:int, path!:string, type?:string) — this tool NEVER sends `download`
 *     (the raw binary tar/byte-stream variant is a deferred follow-up, needs
 *     client.getRaw()+base64); omitting it keeps this tool on the inline/redacted preview
 *     branch only.
 *   src/routes/api/backup/snapshots/[id]/metadata/+server.ts GET (path id!:string, query
 *     destinationId!:int) — server-redacted (stack secrets + container Config.Env/Labels
 *     stripped) before it leaves the process.
 *   src/routes/api/backup/instance/+server.ts              GET (no query, no path)
 *
 * All five GET handlers above are job-polled (backed by src/lib/server/sse.ts
 * `jobResult()`/`createJobResponse()`): a caller sending `Accept: application/json` (and
 * NOT `text/event-stream`) gets the buffered `{result}` payload synchronously, per
 * `prefersJSON()` in src/lib/server/sse-parser.ts. DockhandClient.request() (used by
 * client.get/post/put/delete) always sends exactly that header — verified by reading
 * src/client/dockhand-client.ts's `request()` — so every tool below uses the plain
 * client.get()/client.delete(), never postSSE() (there is no polling tool for a bare
 * jobId here, same reasoning as backup-configs.ts's run_backup_config).
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerBackupSnapshotTools } from '../src/tools/backup-snapshots.js';
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
  registerBackupSnapshotTools(server as any, client as any);
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

describe('backup snapshot tools — registration', () => {
  it('registers all seven operations', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      'browse_backup_snapshot',
      'delete_backup_snapshot',
      'diff_backup_snapshots',
      'dump_backup_snapshot_file',
      'get_backup_instance_id',
      'get_backup_snapshot_metadata',
      'list_backup_snapshots',
    ]);
  });
});

describe('list_backup_snapshots', () => {
  it('happy path: GET /api/backup/snapshots, no filters', async () => {
    const { client, result } = await call('list_backup_snapshots', {});
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots', {
      configId: undefined,
      destinationId: undefined,
      allDestinations: undefined,
    });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: forwards EACH of configId/destinationId/allDestinations through (multi-filter query)', async () => {
    const { client } = await call('list_backup_snapshots', {
      configId: 5,
      destinationId: 3,
      allDestinations: true,
    });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots', {
      configId: 5,
      destinationId: 3,
      allDestinations: 'true',
    });
  });

  it('happy path: destinationId alone (no configId), matching the "single destination" branch', async () => {
    const { client } = await call('list_backup_snapshots', { destinationId: 9 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots', {
      configId: undefined,
      destinationId: 9,
      allDestinations: undefined,
    });
  });

  it('allDestinations:false is sent as the literal string "false", never coerced away (handler only special-cases the string "true")', async () => {
    const { client } = await call('list_backup_snapshots', { configId: 5, allDestinations: false });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots', {
      configId: 5,
      destinationId: undefined,
      allDestinations: 'false',
    });
  });

  it('error path: backend 400 (neither configId nor destinationId) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('400 configId or destinationId parameter is required'));
    const result = await handlers.get('list_backup_snapshots')!({});
    expectToolError(result, 'configId or destinationId parameter is required');
  });

  it('error path: backend 403 (env access denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Environment access denied'));
    const result = await handlers.get('list_backup_snapshots')!({ configId: 5 });
    expectToolError(result, 'Environment access denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('list_backup_snapshots')!({ destinationId: 9 });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('diff_backup_snapshots', () => {
  it('happy path: GET /api/backup/snapshots/diff with all three required params', async () => {
    const { client } = await call('diff_backup_snapshots', {
      destinationId: 3,
      snapshotA: 'abc123',
      snapshotB: 'def456',
    });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots/diff', {
      destinationId: 3,
      snapshotA: 'abc123',
      snapshotB: 'def456',
    });
  });

  it('requires destinationId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('diff_backup_snapshots')!);
    const result = schema.safeParse({ snapshotA: 'abc123', snapshotB: 'def456' });
    expect(result.success).toBe(false);
  });

  it('requires snapshotA — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('diff_backup_snapshots')!);
    const result = schema.safeParse({ destinationId: 3, snapshotB: 'def456' });
    expect(result.success).toBe(false);
  });

  it('requires snapshotB — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('diff_backup_snapshots')!);
    const result = schema.safeParse({ destinationId: 3, snapshotA: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('GEGENVERSUCH: with all three required fields present, the same schema accepts the call', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('diff_backup_snapshots')!);
    const result = schema.safeParse({ destinationId: 3, snapshotA: 'abc123', snapshotB: 'def456' });
    expect(result.success).toBe(true);
  });

  it('error path: backend 400 (missing required params) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('400 Missing required params: destinationId, snapshotA, snapshotB'));
    const result = await handlers.get('diff_backup_snapshots')!({ destinationId: 3, snapshotA: 'a', snapshotB: 'b' });
    expectToolError(result, 'Missing required params');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const result = await handlers.get('diff_backup_snapshots')!({ destinationId: 3, snapshotA: 'a', snapshotB: 'b' });
    expectToolError(result, 'ETIMEDOUT');
  });
});

describe('delete_backup_snapshot', () => {
  it('happy path: DELETE /api/backup/snapshots/{id} with destinationId and env', async () => {
    const { client } = await call('delete_backup_snapshot', {
      snapshotId: 'abc123',
      destinationId: 3,
      environmentId: 2,
    });
    expect(client.delete).toHaveBeenCalledWith('/api/backup/snapshots/abc123', {
      destinationId: 3,
      env: 2,
    });
  });

  it('happy path: destinationId alone, env omitted (env is optional)', async () => {
    const { client } = await call('delete_backup_snapshot', { snapshotId: 'abc123', destinationId: 3 });
    expect(client.delete).toHaveBeenCalledWith('/api/backup/snapshots/abc123', {
      destinationId: 3,
      env: undefined,
    });
  });

  it('URL-encodes a snapshot id that needs it', async () => {
    const { client } = await call('delete_backup_snapshot', { snapshotId: 'a/b c', destinationId: 3 });
    expect(client.delete).toHaveBeenCalledWith('/api/backup/snapshots/a%2Fb%20c', {
      destinationId: 3,
      env: undefined,
    });
  });

  it('requires destinationId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('delete_backup_snapshot')!);
    const result = schema.safeParse({ snapshotId: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('error path: backend 404 (snapshot not owned by this installation) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('404 Snapshot not found for this installation'));
    const result = await handlers.get('delete_backup_snapshot')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'Snapshot not found for this installation');
  });

  it('error path: backend 403 (requires backups:manage, or env access denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('delete_backup_snapshot')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'Permission denied');
  });

  it('error path: backend 500 (restic forget failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('500 Failed to forget snapshot'));
    const result = await handlers.get('delete_backup_snapshot')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'Failed to forget snapshot');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.delete.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await handlers.get('delete_backup_snapshot')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'ECONNRESET');
  });

  it('GEGENVERSUCH: uses client.delete, not client.get/post/put — this is the destructive restic forget --prune path, distinct from every read tool in this file which uses client.get', async () => {
    const spyClient = {
      get: vi.fn().mockRejectedValue(new Error('list_backup_snapshots-shaped client.get should never be called for a delete')),
      post: vi.fn().mockRejectedValue(new Error('client.post should never be called for delete_backup_snapshot')),
      put: vi.fn().mockRejectedValue(new Error('client.put should never be called for delete_backup_snapshot')),
      delete: vi.fn().mockResolvedValue({ success: true }),
    };
    const handlersMap = new Map<string, ToolHandler>();
    const server = {
      tool: (name: string, _d: string, _s: ZodShape, cb: ToolHandler) => { handlersMap.set(name, cb); },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerBackupSnapshotTools(server as any, spyClient as any);
    const result = await handlersMap.get('delete_backup_snapshot')!({ snapshotId: 'abc123', destinationId: 3 });
    expect(spyClient.get).not.toHaveBeenCalled();
    expect(spyClient.post).not.toHaveBeenCalled();
    expect(spyClient.put).not.toHaveBeenCalled();
    expect(spyClient.delete).toHaveBeenCalledWith('/api/backup/snapshots/abc123', { destinationId: 3, env: undefined });
    expect(jsonOut(result)).toEqual({ success: true });
  });

  it('the tool description warns this is irreversible (restic forget --prune)', () => {
    setup();
    const description = describeTool('delete_backup_snapshot');
    expect(description.toLowerCase()).toContain('forget');
    expect(description.toLowerCase()).toMatch(/destructive|irreversible/);
  });
});

describe('browse_backup_snapshot', () => {
  it('happy path: GET /api/backup/snapshots/{id}/browse with destinationId, path and env', async () => {
    const { client } = await call('browse_backup_snapshot', {
      snapshotId: 'abc123',
      destinationId: 3,
      path: '/volumes/data',
      environmentId: 2,
    });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots/abc123/browse', {
      destinationId: 3,
      path: '/volumes/data',
      env: 2,
    });
  });

  it('happy path: path omitted — not sent, letting the server default to "/"', async () => {
    const { client } = await call('browse_backup_snapshot', { snapshotId: 'abc123', destinationId: 3 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots/abc123/browse', {
      destinationId: 3,
      path: undefined,
      env: undefined,
    });
  });

  it('requires destinationId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('browse_backup_snapshot')!);
    const result = schema.safeParse({ snapshotId: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('error path: backend 403 (backups:view or env access denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Environment access denied'));
    const result = await handlers.get('browse_backup_snapshot')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'Environment access denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const result = await handlers.get('browse_backup_snapshot')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'ETIMEDOUT');
  });
});

describe('dump_backup_snapshot_file', () => {
  it('happy path: GET /api/backup/snapshots/{id}/dump with destinationId, path and type', async () => {
    const { client } = await call('dump_backup_snapshot_file', {
      snapshotId: 'abc123',
      destinationId: 3,
      path: '/volumes/data',
      type: 'directory',
    });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots/abc123/dump', {
      destinationId: 3,
      path: '/volumes/data',
      type: 'directory',
    });
  });

  it('happy path: type omitted for a plain file preview', async () => {
    const { client } = await call('dump_backup_snapshot_file', {
      snapshotId: 'abc123',
      destinationId: 3,
      path: '/volumes/data/config.json',
    });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots/abc123/dump', {
      destinationId: 3,
      path: '/volumes/data/config.json',
      type: undefined,
    });
  });

  it('requires path — the tool schema rejects a call missing it (the handler 400s without it)', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('dump_backup_snapshot_file')!);
    const result = schema.safeParse({ snapshotId: 'abc123', destinationId: 3 });
    expect(result.success).toBe(false);
  });

  it('has no download parameter in its schema at all — the binary tar/byte-stream variant is a deferred follow-up', () => {
    const { schemas } = setup();
    const schema = schemas.get('dump_backup_snapshot_file')!;
    expect(Object.keys(schema)).not.toContain('download');
  });

  it('PREVIEW-ONLY CONTRACT: never sends a download param, even when every other optional arg is supplied', async () => {
    const { client } = await call('dump_backup_snapshot_file', {
      snapshotId: 'abc123',
      destinationId: 3,
      path: '/metadata',
      type: 'directory',
    });
    const sentParams = client.get.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(sentParams, 'download')).toBe(false);
    // GEGENVERSUCH performed manually (not a mutation the test harness can flip on its
    // own, since there is no download field to toggle): temporarily added
    // `download: '1'` to the params object in src/tools/backup-snapshots.ts and reran
    // this test — it went red (extra key vs. the exact object above), for the right
    // reason (an accidental download passthrough), then reverted. See task report.
    expect(sentParams).toEqual({ destinationId: 3, path: '/metadata', type: 'directory' });
  });

  it('error path: backend 400 (missing/invalid destinationId or path) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('400 path parameter is required'));
    const result = await handlers.get('dump_backup_snapshot_file')!({ snapshotId: 'abc123', destinationId: 3, path: '/volumes/x' });
    expectToolError(result, 'path parameter is required');
  });

  it('error path: backend 500 (restic dump failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('500 restic dump failed'));
    const result = await handlers.get('dump_backup_snapshot_file')!({ snapshotId: 'abc123', destinationId: 3, path: '/volumes/x' });
    expectToolError(result, 'restic dump failed');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('dump_backup_snapshot_file')!({ snapshotId: 'abc123', destinationId: 3, path: '/volumes/x' });
    expectToolError(result, 'ECONNREFUSED');
  });

  it('the tool description warns that dumping a /volumes/* file can expose real secret file contents', () => {
    setup();
    const description = describeTool('dump_backup_snapshot_file');
    expect(description.toLowerCase()).toContain('volumes');
    expect(description.toLowerCase()).toMatch(/secret|sensitive/);
  });
});

describe('get_backup_snapshot_metadata', () => {
  it('happy path: GET /api/backup/snapshots/{id}/metadata with destinationId', async () => {
    const { client } = await call('get_backup_snapshot_metadata', { snapshotId: 'abc123', destinationId: 3 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/snapshots/abc123/metadata', { destinationId: 3 });
  });

  it('requires destinationId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('get_backup_snapshot_metadata')!);
    const result = schema.safeParse({ snapshotId: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('error path: backend 400 (missing/invalid destinationId) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('400 destinationId is required'));
    const result = await handlers.get('get_backup_snapshot_metadata')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'destinationId is required');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const result = await handlers.get('get_backup_snapshot_metadata')!({ snapshotId: 'abc123', destinationId: 3 });
    expectToolError(result, 'ETIMEDOUT');
  });
});

describe('get_backup_instance_id', () => {
  it('happy path: GET /api/backup/instance, no query at all', async () => {
    const { client, result } = await call('get_backup_instance_id', {});
    expect(client.get).toHaveBeenCalledWith('/api/backup/instance');
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('takes no arguments — the tool schema has no fields', () => {
    const { schemas } = setup();
    const schema = schemas.get('get_backup_instance_id')!;
    expect(Object.keys(schema)).toEqual([]);
  });

  it('error path: backend 404 (backup feature disabled) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('404 Backup feature disabled'));
    const result = await handlers.get('get_backup_instance_id')!({});
    expectToolError(result, 'Backup feature disabled');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_backup_instance_id')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});
