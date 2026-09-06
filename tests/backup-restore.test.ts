/**
 * Backup restore tools (#202, cluster D — HIGHEST RISK) — request contracts for the
 * three restic RESTORE endpoints, and above all the confirmOverwrite safety rule.
 *
 * Every contract below was read off the Finsys/dockhand v1.0.46 handler, not the
 * changelog or the `@openapi body:` annotation:
 *   src/routes/api/backup/restore/preview/+server.ts   POST — destinationId!, snapshotId!,
 *     includeTargets?, targetEnvId?, and (when mode is supplied) environmentId?,
 *     targetType?, targetName?, targetPath?, volumeDestinations?, skipStackFiles?,
 *     mergeStackFiles?, volumes? — backed by jobResult()/createJobResponse(), which
 *     returns synchronous buffered JSON for an `Accept: application/json` caller (what
 *     client.post() sends) — so plain client.post(), never client.postSSE().
 *   src/routes/api/backup/restore/+server.ts            POST — destinationId!, snapshotId!,
 *     mode?, targetType?, targetName?, targetPath?, volumes?, volumeDestinations?,
 *     environmentId?, postRestore?, restoreSecrets?, skipStackFiles?, confirmOverwrite?
 *     — confirmOverwrite is REQUIRED only when mode:'in-place' (validateRestoreRequest(),
 *     src/lib/server/backups/validate.ts:122). Backed by createJobResponse() directly —
 *     same Accept:json buffering, plain client.post().
 *   src/routes/api/backup/restore/stop/+server.ts       POST (no job-polling; a plain
 *     json() response) — snapshotId?, environmentId?, both optional
 *     (`request.json().catch(() => ({}))`).
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerBackupRestoreTools, runBackupRestoreBodySchema } from '../src/tools/backup-restore.js';

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
  registerBackupRestoreTools(server as any, client as any);
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

describe('backup restore tools — registration', () => {
  it('registers all three operations', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual([
      'preview_backup_restore',
      'run_backup_restore',
      'stop_backup_restore',
    ]);
  });
});

describe('preview_backup_restore', () => {
  it('happy path: metadata-only preview with only the required fields', async () => {
    const { client, result } = await call('preview_backup_restore', {
      destinationId: 3,
      snapshotId: 'abc123',
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore/preview', {
      destinationId: 3,
      snapshotId: 'abc123',
    });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: includeTargets + targetEnvId forwarded', async () => {
    const { client } = await call('preview_backup_restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      includeTargets: true,
      targetEnvId: 2,
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore/preview', {
      destinationId: 3,
      snapshotId: 'abc123',
      includeTargets: true,
      targetEnvId: 2,
    });
  });

  it('happy path: mode supplied forwards the extra target-resolution fields, including mergeStackFiles', async () => {
    const { client } = await call('preview_backup_restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
      environmentId: 1,
      targetType: 'stack',
      targetName: 'nextcloud',
      targetPath: '/restore/nextcloud',
      volumeDestinations: [{ volume: 'data', kind: 'volume', target: 'nextcloud_data_restored' }],
      skipStackFiles: false,
      mergeStackFiles: true,
      volumes: ['data'],
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore/preview', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
      environmentId: 1,
      targetType: 'stack',
      targetName: 'nextcloud',
      targetPath: '/restore/nextcloud',
      volumeDestinations: [{ volume: 'data', kind: 'volume', target: 'nextcloud_data_restored' }],
      skipStackFiles: false,
      mergeStackFiles: true,
      volumes: ['data'],
    });
  });

  it('requires destinationId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('preview_backup_restore')!);
    expect(schema.safeParse({ snapshotId: 'abc123' }).success).toBe(false);
  });

  it('requires snapshotId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('preview_backup_restore')!);
    expect(schema.safeParse({ destinationId: 3 }).success).toBe(false);
  });

  it('GEGENVERSUCH: with both required fields present, the same schema accepts the call', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('preview_backup_restore')!);
    expect(schema.safeParse({ destinationId: 3, snapshotId: 'abc123' }).success).toBe(true);
  });

  it('uses plain client.post, never postSSE (no postSSE method invoked)', async () => {
    const { handlers, client } = setup();
    const postSSE = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).postSSE = postSSE;
    await handlers.get('preview_backup_restore')!({ destinationId: 3, snapshotId: 'abc123' });
    expect(client.post).toHaveBeenCalled();
    expect(postSSE).not.toHaveBeenCalled();
  });

  it('error path: backend 403 (manage permission denied, per handler not the @openapi annotation) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('preview_backup_restore')!({ destinationId: 3, snapshotId: 'abc123' });
    expectToolError(result, 'Permission denied');
  });

  it('error path: backend 400 (missing required fields) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Missing required fields: destinationId, snapshotId'));
    const result = await handlers.get('preview_backup_restore')!({ destinationId: 3, snapshotId: 'abc123' });
    expectToolError(result, 'Missing required fields');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('preview_backup_restore')!({ destinationId: 3, snapshotId: 'abc123' });
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('runBackupRestoreBodySchema — confirmOverwrite safety rule', () => {
  it('mode:"in-place" WITHOUT confirmOverwrite is rejected', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'in-place',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'confirmOverwrite')).toBe(true);
    }
  });

  it('mode:"in-place" with confirmOverwrite:false is rejected', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'in-place',
      confirmOverwrite: false,
    });
    expect(result.success).toBe(false);
  });

  it('GEGENVERSUCH: mode:"in-place" WITH confirmOverwrite:true passes', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'in-place',
      confirmOverwrite: true,
    });
    expect(result.success).toBe(true);
  });

  it('mode:"new-location" WITHOUT confirmOverwrite passes (not blocked)', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
    });
    expect(result.success).toBe(true);
  });

  it('mode omitted (defaults server-side to new-location) WITHOUT confirmOverwrite passes', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid mode value', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'sideways',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid postRestore value (server whitelists exactly 4)', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      postRestore: 'destroy-everything',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed volumeDestinations array (object elements)', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
      volumeDestinations: [
        { volume: 'data', kind: 'volume', target: 'nextcloud_data_restored' },
        { volume: 'config', kind: 'path', target: '/restore/nextcloud/config' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects volumeDestinations passed as a bare string instead of an array of objects', () => {
    const result = runBackupRestoreBodySchema.safeParse({
      destinationId: 3,
      snapshotId: 'abc123',
      volumeDestinations: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });
});

describe('run_backup_restore', () => {
  it('happy path: minimal new-location restore (mode omitted)', async () => {
    const { client, result } = await call('run_backup_restore', {
      destinationId: 3,
      snapshotId: 'abc123',
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore', {
      destinationId: 3,
      snapshotId: 'abc123',
    });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: full new-location clone body forwarded as objects/arrays, un-stringified', async () => {
    const { client } = await call('run_backup_restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
      targetType: 'stack',
      targetName: 'nextcloud-restored',
      targetPath: '/restore/nextcloud',
      volumes: ['data', 'config'],
      volumeDestinations: [
        { volume: 'data', kind: 'volume', target: 'nextcloud_data_restored' },
        { volume: 'config', kind: 'path', target: '/restore/nextcloud/config' },
      ],
      environmentId: 1,
      postRestore: 'redeploy',
      restoreSecrets: false,
      skipStackFiles: true,
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
      targetType: 'stack',
      targetName: 'nextcloud-restored',
      targetPath: '/restore/nextcloud',
      volumes: ['data', 'config'],
      volumeDestinations: [
        { volume: 'data', kind: 'volume', target: 'nextcloud_data_restored' },
        { volume: 'config', kind: 'path', target: '/restore/nextcloud/config' },
      ],
      environmentId: 1,
      postRestore: 'redeploy',
      restoreSecrets: false,
      skipStackFiles: true,
    });
    // The array-of-objects survived the round trip un-stringified.
    const sentBody = client.post.mock.calls[0]![1] as { volumeDestinations: unknown[] };
    expect(Array.isArray(sentBody.volumeDestinations)).toBe(true);
    expect(typeof sentBody.volumeDestinations[0]).toBe('object');
  });

  it('happy path: mode:"in-place" WITH confirmOverwrite:true is sent through', async () => {
    const { client } = await call('run_backup_restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'in-place',
      confirmOverwrite: true,
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'in-place',
      confirmOverwrite: true,
    });
  });

  it('SAFETY: mode:"in-place" WITHOUT confirmOverwrite never reaches client.post — structured tool error instead', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('run_backup_restore')!({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'in-place',
    });
    expect(client.post).not.toHaveBeenCalled();
    expectToolError(result, 'confirmOverwrite');
  });

  it('SAFETY: mode:"in-place" with confirmOverwrite:false never reaches client.post', async () => {
    const { handlers, client } = setup();
    const result = await handlers.get('run_backup_restore')!({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'in-place',
      confirmOverwrite: false,
    });
    expect(client.post).not.toHaveBeenCalled();
    expectToolError(result, 'confirmOverwrite');
  });

  it('GEGENVERSUCH: mode:"new-location" and NO confirmOverwrite is NOT blocked', async () => {
    const { client, result } = await call('run_backup_restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore', {
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
    });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('requires destinationId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('run_backup_restore')!);
    expect(schema.safeParse({ snapshotId: 'abc123' }).success).toBe(false);
  });

  it('requires snapshotId — the tool schema rejects a call missing it', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('run_backup_restore')!);
    expect(schema.safeParse({ destinationId: 3 }).success).toBe(false);
  });

  it('uses plain client.post, never postSSE (no postSSE method invoked)', async () => {
    const { handlers, client } = setup();
    const postSSE = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).postSSE = postSSE;
    await handlers.get('run_backup_restore')!({ destinationId: 3, snapshotId: 'abc123' });
    expect(client.post).toHaveBeenCalled();
    expect(postSSE).not.toHaveBeenCalled();
  });

  it('error path: backend 400 (invalid restore request) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Invalid restore request'));
    const result = await handlers.get('run_backup_restore')!({
      destinationId: 3,
      snapshotId: 'abc123',
      mode: 'new-location',
      targetPath: '/restore/x',
    });
    expectToolError(result, 'Invalid restore request');
  });

  it('error path: backend 403 (permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('run_backup_restore')!({ destinationId: 3, snapshotId: 'abc123' });
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const result = await handlers.get('run_backup_restore')!({ destinationId: 3, snapshotId: 'abc123' });
    expectToolError(result, 'ETIMEDOUT');
  });
});

describe('stop_backup_restore', () => {
  it('happy path: no args at all — the handler does request.json().catch(()=>({})) server-side', async () => {
    const { client, result } = await call('stop_backup_restore', {});
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore/stop', {});
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: snapshotId + environmentId forwarded', async () => {
    const { client } = await call('stop_backup_restore', { snapshotId: 'abc123', environmentId: 2 });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore/stop', {
      snapshotId: 'abc123',
      environmentId: 2,
    });
  });

  it('happy path: snapshotId alone (omitting it stops ALL restore helpers per the handler)', async () => {
    const { client } = await call('stop_backup_restore', { snapshotId: 'abc123' });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore/stop', { snapshotId: 'abc123' });
  });

  it('GEGENVERSUCH: an empty-object schema (no required fields) still accepts a fully-populated call', () => {
    const { schemas } = setup();
    const schema = z.object(schemas.get('stop_backup_restore')!);
    expect(schema.safeParse({ snapshotId: 'abc123', environmentId: 2 }).success).toBe(true);
  });

  it('uses plain client.post, never postSSE (no postSSE method invoked)', async () => {
    const { handlers, client } = setup();
    const postSSE = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).postSSE = postSSE;
    await handlers.get('stop_backup_restore')!({});
    expect(client.post).toHaveBeenCalled();
    expect(postSSE).not.toHaveBeenCalled();
  });

  it('error path: backend 400 (invalid snapshotId) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('400 Invalid snapshotId'));
    const result = await handlers.get('stop_backup_restore')!({ snapshotId: 'not-valid' });
    expectToolError(result, 'Invalid snapshotId');
  });

  it('error path: backend 403 (environment access denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('403 Environment access denied'));
    const result = await handlers.get('stop_backup_restore')!({ environmentId: 2 });
    expectToolError(result, 'Environment access denied');
  });

  it('error path: backend 500 (cancel failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('500 internal error'));
    const result = await handlers.get('stop_backup_restore')!({});
    expectToolError(result, 'internal error');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.post.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await handlers.get('stop_backup_restore')!({});
    expectToolError(result, 'ECONNRESET');
  });
});
