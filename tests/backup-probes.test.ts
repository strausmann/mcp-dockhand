/**
 * Backup stack-path probe tools (#202, cluster E) — two independent read-only GETs
 * that help a caller resolve/validate a stack's backup path before configuring a
 * backup schedule/destination.
 *
 * Ground truth: Finsys/dockhand v1.0.46 handlers (both `GET`, guarded by
 * `requireBackups(auth,'view')`, query `target!` + `env?`):
 *   src/routes/api/backup/stack-dir-listing/+server.ts
 *   src/routes/api/backup/stack-path/+server.ts
 *
 * Both handlers never throw for an operational failure — they catch and return
 * `{ kind: 'unknown', reason }` with a 200. `target` missing is the one case that
 * short-circuits with a 400 `{ error: 'target is required' }` BEFORE the try/catch,
 * so that still propagates through client.get() as a rejected promise the same way
 * every other tool's 400 does.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerBackupProbeTools } from '../src/tools/backup-probes.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
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
    get: vi.fn().mockResolvedValue({ kind: 'listed', hostPath: '/docker/stacks/paperless', entries: [] }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerBackupProbeTools(server as any, client as any);
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

describe('backup stack-path probe tools — registration', () => {
  it('registers both operations', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual([
      'preview_backup_stack_path',
      'probe_backup_stack_dir',
    ]);
  });
});

describe('probe_backup_stack_dir', () => {
  it('happy path: GET /api/backup/stack-dir-listing, target only', async () => {
    const { client, result } = await call('probe_backup_stack_dir', { target: 'paperless' });
    expect(client.get).toHaveBeenCalledWith('/api/backup/stack-dir-listing', { target: 'paperless', env: undefined });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(jsonOut(result)).toEqual({ kind: 'listed', hostPath: '/docker/stacks/paperless', entries: [] });
  });

  it('happy path: forwards env (environmentId) as a query param alongside target', async () => {
    const { client } = await call('probe_backup_stack_dir', { target: 'paperless', environmentId: 3 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/stack-dir-listing', { target: 'paperless', env: 3 });
  });

  it('rejects a call missing the required target at the zod layer', () => {
    const { schemas } = setup();
    const shape = schemas.get('probe_backup_stack_dir')!;
    expect(() => z.object(shape).parse({})).toThrow();
    expect(() => z.object(shape).parse({ target: 'paperless' })).not.toThrow();
  });

  it('error path: backend 400 (target missing, bypassing zod e.g. via a raw call) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('400 target is required'));
    const result = await handlers.get('probe_backup_stack_dir')!({ target: 'x' });
    expectToolError(result, 'target is required');
  });

  it('error path: backend 403 (missing backups:view, or no enterprise env access) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('probe_backup_stack_dir')!({ target: 'paperless' });
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('probe_backup_stack_dir')!({ target: 'paperless' });
    expectToolError(result, 'ECONNREFUSED');
  });

  it('surfaces a kind:"unknown" operational-failure result as a normal (non-error) response — the handler never throws for this case', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce({ kind: 'unknown', reason: 'host unreachable' });
    const result = await handlers.get('probe_backup_stack_dir')!({ target: 'paperless' });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(jsonOut(result)).toEqual({ kind: 'unknown', reason: 'host unreachable' });
  });
});

describe('preview_backup_stack_path', () => {
  it('happy path: GET /api/backup/stack-path, target only', async () => {
    const { client, result } = await call('preview_backup_stack_path', { target: 'paperless' });
    expect(client.get).toHaveBeenCalledWith('/api/backup/stack-path', { target: 'paperless', env: undefined });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(jsonOut(result)).toEqual({ kind: 'listed', hostPath: '/docker/stacks/paperless', entries: [] });
  });

  it('happy path: forwards env (environmentId) as a query param alongside target', async () => {
    const { client } = await call('preview_backup_stack_path', { target: 'paperless', environmentId: 5 });
    expect(client.get).toHaveBeenCalledWith('/api/backup/stack-path', { target: 'paperless', env: 5 });
  });

  it('rejects a call missing the required target at the zod layer', () => {
    const { schemas } = setup();
    const shape = schemas.get('preview_backup_stack_path')!;
    expect(() => z.object(shape).parse({})).toThrow();
    expect(() => z.object(shape).parse({ target: 'paperless' })).not.toThrow();
  });

  it('error path: backend 403 (missing backups:view, or no enterprise env access) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('preview_backup_stack_path')!({ target: 'paperless' });
    expectToolError(result, 'Permission denied');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('preview_backup_stack_path')!({ target: 'paperless' });
    expectToolError(result, 'ECONNREFUSED');
  });

  it('surfaces a kind:"unknown" operational-failure result as a normal (non-error) response — the handler never throws for this case', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce({ kind: 'unknown', reason: 'could not resolve compose file' });
    const result = await handlers.get('preview_backup_stack_path')!({ target: 'paperless' });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(jsonOut(result)).toEqual({ kind: 'unknown', reason: 'could not resolve compose file' });
  });
});
