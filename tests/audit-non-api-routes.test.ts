/**
 * `get_audit_log_entries` (GET /audit) and `get_audit_log_usernames` (GET /audit/users)
 * — the coverage-gap follow-up (17 MISSING_TOOL endpoints). These are a SEPARATE route
 * family from `/api/audit`/`/api/audit/users` (get_audit_log/get_audit_users in
 * audit.ts, already covered elsewhere) — verified against the real handlers:
 *   src/routes/audit/+server.ts        GET (query username?:string, entity_type?:string,
 *     action?:string, environment_id?:int, from_date?:string, to_date?:string,
 *     limit?:int, offset?:int) — LEGACY single-value snake_case filters, no multi-select.
 *   src/routes/audit/users/+server.ts  GET (no params) — distinct usernames for a
 *     filter dropdown.
 * Both are Enterprise-only (canViewAuditLog()).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerAuditTools } from '../src/tools/audit.js';

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
    get: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAuditTools(server as any, client as any);
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

describe('audit tools — registration includes the non-/api routes', () => {
  it('registers get_audit_log_entries and get_audit_log_usernames alongside the /api/audit family', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual([
      'export_audit_log',
      'get_audit_events',
      'get_audit_log',
      'get_audit_log_entries',
      'get_audit_log_usernames',
      'get_audit_users',
    ]);
  });
});

describe('get_audit_log_entries', () => {
  it('happy path: GET /audit with no filters sends every key as undefined (dropped by the client)', async () => {
    const { client, result } = await call('get_audit_log_entries', {});
    expect(client.get).toHaveBeenCalledWith('/audit', {
      username: undefined,
      entity_type: undefined,
      action: undefined,
      environment_id: undefined,
      from_date: undefined,
      to_date: undefined,
      limit: undefined,
      offset: undefined,
    });
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('happy path: translates camelCase tool args to the legacy snake_case query keys the handler expects', async () => {
    const { client } = await call('get_audit_log_entries', {
      username: 'alice',
      entityType: 'container',
      action: 'delete',
      environmentId: 5,
      fromDate: '2026-01-01T00:00:00Z',
      toDate: '2026-02-01T00:00:00Z',
      limit: 50,
      offset: 10,
    });
    expect(client.get).toHaveBeenCalledWith('/audit', {
      username: 'alice',
      entity_type: 'container',
      action: 'delete',
      environment_id: 5,
      from_date: '2026-01-01T00:00:00Z',
      to_date: '2026-02-01T00:00:00Z',
      limit: 50,
      offset: 10,
    });
  });

  it('error path: backend 403 (Enterprise required / permission denied) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Permission denied'));
    const result = await handlers.get('get_audit_log_entries')!({});
    expectToolError(result, 'Permission denied');
  });

  it('error path: backend 500 (query failed) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('500 Failed to fetch audit logs'));
    const result = await handlers.get('get_audit_log_entries')!({});
    expectToolError(result, 'Failed to fetch audit logs');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_audit_log_entries')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});

describe('get_audit_log_usernames', () => {
  it('happy path: GET /audit/users with no arguments', async () => {
    const { client, result } = await call('get_audit_log_usernames', {});
    expect(client.get).toHaveBeenCalledWith('/audit/users');
    expect(jsonOut(result)).toEqual({ ok: true });
  });

  it('roundtrip: an array of usernames comes back through unchanged', async () => {
    const { handlers, client } = setup();
    client.get.mockResolvedValueOnce(['alice', 'bob']);
    const result = await handlers.get('get_audit_log_usernames')!({});
    expect(jsonOut(result)).toEqual(['alice', 'bob']);
  });

  it('error path: backend 403 (Enterprise required) is a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('403 Enterprise license required'));
    const result = await handlers.get('get_audit_log_usernames')!({});
    expectToolError(result, 'Enterprise license required');
  });

  it('network error propagates as a structured tool error', async () => {
    const { handlers, client } = setup();
    client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await handlers.get('get_audit_log_usernames')!({});
    expectToolError(result, 'ECONNREFUSED');
  });
});
