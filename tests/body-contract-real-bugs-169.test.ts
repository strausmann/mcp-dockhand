/**
 * Behavioural tests for the 7 real body-contract bugs from #169 (P2.1 triage,
 * verified against the real `Finsys/dockhand` v1.0.41 handler code —
 * see the handler citations in each `describe` block below).
 *
 * 4 field-fixes (same class as #168 — a required body field was missing or
 * had the wrong shape):
 *   - `activate_license`      — POST /api/license           (license/+server.ts)
 *   - `create_role`           — POST /api/roles             (roles/+server.ts)
 *   - `trigger_test_notification` — POST /api/notifications/trigger-test
 *     (notifications/trigger-test/+server.ts)
 *   - `create_container_file` — POST /api/containers/{id}/files/create
 *     (containers/[id]/files/create/+server.ts)
 *
 * 2 tool redesigns (the tool was wired to the wrong interaction pattern):
 *   - `list_batch_operations` -> `execute_batch` — POST /api/batch is the
 *     batch *executor*, not a "list past batches" endpoint (batch/+server.ts)
 *   - `set_user_roles` -> `add_user_role` + `remove_user_role` — the real
 *     endpoint is a single-role add/remove, not a bulk-replace-by-name call
 *     (users/[id]/roles/+server.ts)
 *
 * 1 removal (the tool was wired to a real endpoint, but the wrong HTTP verb
 * for what its name promised):
 *   - `set_git_stack_env_files` — `POST /api/git/stacks/{id}/env-files` is
 *     100% read-only: it reads and parses ONE `.env` file (`{path}` ->
 *     `{vars}}`), it does not write anything. There is no PUT/PATCH/DELETE
 *     variant and no `write*GitStackEnvFile` server function at all
 *     (git/stacks/[id]/env-files/+server.ts). The real "set env for a Git
 *     stack" use case is already covered by `update_git_stack`
 *     (envFilePath/envVars) and `update_stack_env`. `get_git_stack_env_files`
 *     (GET, lists filenames) is untouched.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerSystemTools } from '../src/tools/system.js';
import { registerUserTools } from '../src/tools/users.js';
import { registerNotificationTools } from '../src/tools/notifications.js';
import { registerContainerTools } from '../src/tools/containers.js';
import { registerGitStackTools } from '../src/tools/git-stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: 'text'; text: string }[];
  isError?: true;
}>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function makeMockClient(): MockClient {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  };
}

function registerAndCapture(
  register: (server: unknown, client: unknown) => void,
): { handlers: Map<string, ToolHandler>; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client = makeMockClient();
  register(server, client);
  return { handlers, client };
}

function jsonOut(res: Awaited<ReturnType<ToolHandler>>): Record<string, unknown> {
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

describe('activate_license — POST /api/license requires {name, key} (license/+server.ts:47)', () => {
  it('sends both name and key in the body', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerSystemTools(s as never, c as never));
    const handler = handlers.get('activate_license')!;

    const res = await handler({ name: 'ACME Corp', licenseKey: 'ABC-123' });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith('/api/license', { name: 'ACME Corp', key: 'ABC-123' });
  });
});

describe('create_role — POST /api/roles requires {name, permissions} as an object (roles/+server.ts:48)', () => {
  it('sends a required permissions object (category -> action array), not an array', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerUserTools(s as never, c as never));
    const handler = handlers.get('create_role')!;

    const res = await handler({
      name: 'auditor',
      permissions: { containers: ['view'], audit_logs: ['view'] },
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith('/api/roles', {
      name: 'auditor',
      permissions: { containers: ['view'], audit_logs: ['view'] },
    });
  });

  it('forwards optional description and environmentIds when given', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerUserTools(s as never, c as never));
    const handler = handlers.get('create_role')!;

    await handler({
      name: 'scoped-viewer',
      permissions: { containers: ['view'] },
      description: 'Read-only for env 3',
      environmentIds: [3],
    });

    expect(client.post).toHaveBeenCalledWith('/api/roles', {
      name: 'scoped-viewer',
      permissions: { containers: ['view'] },
      description: 'Read-only for env 3',
      environmentIds: [3],
    });
  });
});

describe('trigger_test_notification — POST /api/notifications/trigger-test requires {eventType, payload:{title,message}} (notifications/trigger-test/+server.ts:19-27)', () => {
  it('sends eventType and payload in the body', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerNotificationTools(s as never, c as never));
    const handler = handlers.get('trigger_test_notification')!;

    const res = await handler({
      eventType: 'container_unhealthy',
      environmentId: 1,
      payload: { title: 'Container unhealthy', message: 'web-1 is unhealthy', type: 'warning' },
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith('/api/notifications/trigger-test', {
      eventType: 'container_unhealthy',
      environmentId: 1,
      payload: { title: 'Container unhealthy', message: 'web-1 is unhealthy', type: 'warning' },
    });
  });

  it('omits environmentId from the body when not given (system-only events like license_expiring)', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerNotificationTools(s as never, c as never));
    const handler = handlers.get('trigger_test_notification')!;

    await handler({
      eventType: 'license_expiring',
      payload: { title: 'License expiring', message: 'Renew soon' },
    });

    expect(client.post).toHaveBeenCalledWith('/api/notifications/trigger-test', {
      eventType: 'license_expiring',
      payload: { title: 'License expiring', message: 'Renew soon' },
    });
  });
});

describe('create_container_file — POST .../files/create requires {path, type}, ignores content (containers/[id]/files/create/+server.ts:23-31)', () => {
  it('sends path and type, and never sends content (the real endpoint does not read it)', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerContainerTools(s as never, c as never));
    const handler = handlers.get('create_container_file')!;

    const res = await handler({
      environmentId: 9,
      containerId: 'abc123',
      path: '/app/data',
      type: 'directory',
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/containers/abc123/files/create',
      { path: '/app/data', type: 'directory' },
      { env: 9 },
    );
    // Regression guard: no stray `content` key sneaks into the body even if
    // a caller somehow supplies one at the JS level (zod strips unknown keys
    // by default for object schemas built with a plain shape).
    const sentBody = client.post.mock.calls[0][1] as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty('content');
  });
});

describe('execute_batch (formerly list_batch_operations) — POST /api/batch is the executor, not a history list (batch/+server.ts:146-167)', () => {
  it('sends {operation, entityType, items} and the env query param', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerSystemTools(s as never, c as never));
    expect(handlers.has('list_batch_operations')).toBe(false);
    const handler = handlers.get('execute_batch')!;
    expect(handler).toBeDefined();

    const res = await handler({
      environmentId: 4,
      operation: 'restart',
      entityType: 'containers',
      items: [{ id: 'abc123', name: 'web' }],
    });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith(
      '/api/batch',
      { operation: 'restart', entityType: 'containers', items: [{ id: 'abc123', name: 'web' }] },
      { env: 4 },
    );
  });

  it('forwards optional options (force / removeVolumes) when given', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerSystemTools(s as never, c as never));
    const handler = handlers.get('execute_batch')!;

    await handler({
      operation: 'down',
      entityType: 'stacks',
      items: [{ id: 'my-stack', name: 'my-stack' }],
      options: { removeVolumes: true },
    });

    expect(client.post).toHaveBeenCalledWith(
      '/api/batch',
      {
        operation: 'down',
        entityType: 'stacks',
        items: [{ id: 'my-stack', name: 'my-stack' }],
        options: { removeVolumes: true },
      },
      { env: undefined },
    );
  });
});

describe('add_user_role / remove_user_role (formerly set_user_roles) — single-role add/remove, not bulk-replace (users/[id]/roles/+server.ts:61,108)', () => {
  it('set_user_roles no longer exists', async () => {
    const { handlers } = registerAndCapture((s, c) => registerUserTools(s as never, c as never));
    expect(handlers.has('set_user_roles')).toBe(false);
  });

  it('add_user_role POSTs {roleId, environmentId?} to /api/users/{id}/roles', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerUserTools(s as never, c as never));
    const handler = handlers.get('add_user_role')!;
    expect(handler).toBeDefined();

    const res = await handler({ userId: 7, roleId: 3, environmentId: 1 });

    expect(res.isError).toBeUndefined();
    expect(client.post).toHaveBeenCalledWith('/api/users/7/roles', { roleId: 3, environmentId: 1 });
  });

  it('add_user_role omits environmentId when not given (unscoped assignment)', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerUserTools(s as never, c as never));
    const handler = handlers.get('add_user_role')!;

    await handler({ userId: 7, roleId: 3 });

    expect(client.post).toHaveBeenCalledWith('/api/users/7/roles', { roleId: 3 });
  });

  it('remove_user_role DELETEs /api/users/{id}/roles with {roleId, environmentId?} as the body (not query params)', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerUserTools(s as never, c as never));
    const handler = handlers.get('remove_user_role')!;
    expect(handler).toBeDefined();

    const res = await handler({ userId: 7, roleId: 3, environmentId: 1 });

    expect(res.isError).toBeUndefined();
    expect(client.delete).toHaveBeenCalledWith('/api/users/7/roles', undefined, { roleId: 3, environmentId: 1 });
  });

  it('remove_user_role omits environmentId from the body when not given', async () => {
    const { handlers, client } = registerAndCapture((s, c) => registerUserTools(s as never, c as never));
    const handler = handlers.get('remove_user_role')!;

    await handler({ userId: 7, roleId: 3 });

    expect(client.delete).toHaveBeenCalledWith('/api/users/7/roles', undefined, { roleId: 3 });
  });
});

describe('set_git_stack_env_files — removed (POST .../env-files is read-only, no write endpoint exists)', () => {
  it('is no longer registered', async () => {
    const { handlers } = registerAndCapture((s, c) => registerGitStackTools(s as never, c as never));
    expect(handlers.has('set_git_stack_env_files')).toBe(false);
    // get_git_stack_env_files (GET, lists filenames) is untouched.
    expect(handlers.has('get_git_stack_env_files')).toBe(true);
  });
});
