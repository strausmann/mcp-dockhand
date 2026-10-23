/**
 * Tools and contract params added for Dockhand 1.0.54 (#299, #300, #301, #303).
 *
 * Request shapes were read off the real Finsys/dockhand v1.0.54 handlers (9efea8b), not
 * the changelog:
 *   src/routes/api/environments/report/+server.ts
 *     GET ?env=<id>&format=json|csv|pdf. Without env: every accessible environment.
 *     json -> application/json attachment, csv -> text/csv, pdf -> application/pdf bytes.
 *   src/routes/api/environments/[id]/report/+server.ts
 *     GET -> {settings}. POST body {enabled, cron, format: pdf|csv, notificationId}.
 *   src/routes/api/stack-stats/+server.ts
 *     GET ?env=<id> -> per-stack totals. Without env the handler returns [] silently.
 *   src/routes/api/settings/minimum-release-age/+server.ts
 *     GET -> {hours, overridden, inherited}. POST body {hours} (whole number 0..720).
 *   src/routes/api/settings/semver/+server.ts            rejectOlderImages
 *   src/routes/api/backup/destinations{,/[id],/test}     sshPrivateKey, sshKnownHosts
 *   src/routes/api/backup/restore/preview/+server.ts     postRestore
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerEnvironmentTools } from '../../src/tools/environments.js';
import { registerStackTools } from '../../src/tools/stacks.js';
import { registerSettingsTools } from '../../src/tools/settings.js';
import { registerBackupDestinationTools } from '../../src/tools/backup-destinations.js';
import { registerBackupRestoreTools } from '../../src/tools/backup-restore.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  getRaw: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Register = (server: any, client: any) => void;

function setup(register: Register) {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, ZodShape>();
  const server = {
    tool: (name: string, _d: string, s: ZodShape, _a: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
      schemas.set(name, s);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ ok: true }),
    getRaw: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
    post: vi.fn().mockResolvedValue({ ok: true }),
    put: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  };
  register(server, client);
  return { handlers, schemas, client };
}

async function call(register: Register, name: string, args: Record<string, unknown>) {
  const ctx = setup(register);
  const handler = ctx.handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return { ...ctx, result };
}

function text(res: unknown): string {
  return (res as { content: { text: string }[] }).content[0]!.text;
}

function parse(schemas: Map<string, ZodShape>, name: string, args: Record<string, unknown>) {
  return z.object(schemas.get(name)!).safeParse(args);
}

describe('export_environment_report (#299)', () => {
  it('requests one environment as json by default and returns the parsed report', async () => {
    const { client, result } = await call(registerEnvironmentTools, 'export_environment_report', { environmentId: 3 });
    expect(client.get).toHaveBeenCalledWith('/api/environments/report', { env: 3, format: 'json' });
    expect(JSON.parse(text(result))).toEqual({ ok: true });
  });

  it('omits env to report on every accessible environment', async () => {
    const { client } = await call(registerEnvironmentTools, 'export_environment_report', {});
    expect(client.get).toHaveBeenCalledWith('/api/environments/report', { env: undefined, format: 'json' });
  });

  it('returns csv as plain text', async () => {
    const ctx = setup(registerEnvironmentTools);
    ctx.client.get.mockResolvedValueOnce('name,containers\nprod,12\n');
    const result = await ctx.handlers.get('export_environment_report')!({ environmentId: 1, format: 'csv' });
    expect(ctx.client.get).toHaveBeenCalledWith('/api/environments/report', { env: 1, format: 'csv' });
    expect(text(result)).toBe('name,containers\nprod,12\n');
  });

  it('fetches pdf as raw bytes and returns it base64-framed', async () => {
    const { client, result } = await call(registerEnvironmentTools, 'export_environment_report', { environmentId: 1, format: 'pdf' });
    expect(client.get).not.toHaveBeenCalled();
    expect(client.getRaw).toHaveBeenCalledWith('/api/environments/report', { env: 1, format: 'pdf' });
    expect(text(result)).toBe(`base64:${Buffer.from('%PDF-1.7').toString('base64')}`);
  });

  it('rejects an unknown format', () => {
    const { schemas } = setup(registerEnvironmentTools);
    expect(parse(schemas, 'export_environment_report', { format: 'xlsx' }).success).toBe(false);
  });
});

describe('environment report schedule (#299)', () => {
  it('get_environment_report_schedule reads the per-environment config', async () => {
    const { client } = await call(registerEnvironmentTools, 'get_environment_report_schedule', { environmentId: 4 });
    expect(client.get).toHaveBeenCalledWith('/api/environments/4/report');
  });

  it('set_environment_report_schedule sends only the supplied fields', async () => {
    const { client } = await call(registerEnvironmentTools, 'set_environment_report_schedule', {
      environmentId: 4, enabled: true, cron: '0 6 1 * *', format: 'pdf', notificationId: 3,
    });
    expect(client.post).toHaveBeenCalledWith('/api/environments/4/report', {
      enabled: true, cron: '0 6 1 * *', format: 'pdf', notificationId: 3,
    });
  });

  it('set_environment_report_schedule sends an empty body when only disabling defaults apply', async () => {
    const { client } = await call(registerEnvironmentTools, 'set_environment_report_schedule', { environmentId: 4 });
    expect(client.post).toHaveBeenCalledWith('/api/environments/4/report', {});
  });

  it('only accepts pdf or csv as the scheduled format (handler returns 400 otherwise)', () => {
    const { schemas } = setup(registerEnvironmentTools);
    expect(parse(schemas, 'set_environment_report_schedule', { environmentId: 1, format: 'json' }).success).toBe(false);
    expect(parse(schemas, 'set_environment_report_schedule', { environmentId: 1, format: 'csv' }).success).toBe(true);
  });

  it('accepts null to clear the notification channel', () => {
    const { schemas } = setup(registerEnvironmentTools);
    expect(parse(schemas, 'set_environment_report_schedule', { environmentId: 1, notificationId: null }).success).toBe(true);
  });
});

describe('get_stack_stats (#300)', () => {
  it('requests the env-scoped per-stack snapshot', async () => {
    const { client } = await call(registerStackTools, 'get_stack_stats', { environmentId: 2 });
    expect(client.get).toHaveBeenCalledWith('/api/stack-stats', { env: 2 });
  });

  it('requires environmentId (the handler silently returns [] without it)', () => {
    const { schemas } = setup(registerStackTools);
    expect(parse(schemas, 'get_stack_stats', {}).success).toBe(false);
  });
});

describe('minimum release age (#301)', () => {
  it('get_minimum_release_age reads the global setting', async () => {
    const { client } = await call(registerSettingsTools, 'get_minimum_release_age', {});
    expect(client.get).toHaveBeenCalledWith('/api/settings/minimum-release-age');
  });

  it('set_minimum_release_age posts {hours}', async () => {
    const { client } = await call(registerSettingsTools, 'set_minimum_release_age', { hours: 48 });
    expect(client.post).toHaveBeenCalledWith('/api/settings/minimum-release-age', { hours: 48 });
  });

  it('validates hours as a whole number from 0 to 720', () => {
    const { schemas } = setup(registerSettingsTools);
    for (const ok of [0, 1, 720]) expect(parse(schemas, 'set_minimum_release_age', { hours: ok }).success).toBe(true);
    for (const bad of [-1, 721, 1.5]) expect(parse(schemas, 'set_minimum_release_age', { hours: bad }).success).toBe(false);
  });
});

describe('update_semver_settings.rejectOlderImages (#303)', () => {
  it('sends rejectOlderImages when set', async () => {
    const { client } = await call(registerSettingsTools, 'update_semver_settings', { rejectOlderImages: false });
    expect(client.post).toHaveBeenCalledWith('/api/settings/semver', { rejectOlderImages: false });
  });

  it('omits rejectOlderImages when unset (the handler then keeps the stored value)', async () => {
    const { client } = await call(registerSettingsTools, 'update_semver_settings', { enabled: true });
    expect(client.post).toHaveBeenCalledWith('/api/settings/semver', { enabled: true });
  });
});

describe('backup destination SFTP credentials (#303)', () => {
  const ssh = { sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----', sshKnownHosts: 'host ssh-ed25519 AAAA' };

  it('create_backup_destination sends sshPrivateKey and sshKnownHosts', async () => {
    const { client } = await call(registerBackupDestinationTools, 'create_backup_destination', {
      name: 'nas', repository: 'sftp:backup@nas:/restic', password: 'pw', ...ssh,
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations', {
      name: 'nas', repository: 'sftp:backup@nas:/restic', password: 'pw', ...ssh,
    });
  });

  it('create_backup_destination omits both when unset', async () => {
    const { client } = await call(registerBackupDestinationTools, 'create_backup_destination', {
      name: 'local', repository: '/backups', password: 'pw',
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations', { name: 'local', repository: '/backups', password: 'pw' });
  });

  it('update_backup_destination sends them only when supplied (absent keeps the stored value)', async () => {
    const { client } = await call(registerBackupDestinationTools, 'update_backup_destination', { destinationId: 7, sshKnownHosts: ssh.sshKnownHosts });
    expect(client.put).toHaveBeenCalledWith('/api/backup/destinations/7', { sshKnownHosts: ssh.sshKnownHosts });
  });

  it('test_backup_destination_inline sends them for an unsaved destination', async () => {
    const { client } = await call(registerBackupDestinationTools, 'test_backup_destination_inline', {
      repository: 'sftp:backup@nas:/restic', password: 'pw', ...ssh,
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/destinations/test', {
      repository: 'sftp:backup@nas:/restic', password: 'pw', ...ssh,
    });
  });
});

describe('preview_backup_restore.postRestore (#303)', () => {
  it('forwards postRestore', async () => {
    const { client } = await call(registerBackupRestoreTools, 'preview_backup_restore', {
      destinationId: 1, snapshotId: 'abc', mode: 'new-location', postRestore: 'redeploy',
    });
    expect(client.post).toHaveBeenCalledWith('/api/backup/restore/preview', {
      destinationId: 1, snapshotId: 'abc', mode: 'new-location', postRestore: 'redeploy',
    });
  });

  it('only accepts the four values the restore handler whitelists', () => {
    const { schemas } = setup(registerBackupRestoreTools);
    expect(parse(schemas, 'preview_backup_restore', { destinationId: 1, snapshotId: 'a', postRestore: 'reboot' }).success).toBe(false);
  });
});
