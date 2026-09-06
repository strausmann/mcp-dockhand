/**
 * Backup destination tools — restic repository configs backups write into.
 *
 * Ground truth: Finsys/dockhand v1.0.46,
 * src/routes/api/backup/destinations/+server.ts               GET, POST
 * src/routes/api/backup/destinations/[id]/+server.ts          GET, PUT, DELETE
 * src/routes/api/backup/destinations/[id]/init/+server.ts     POST
 * src/routes/api/backup/destinations/[id]/rotate-key/+server.ts POST
 * src/routes/api/backup/destinations/[id]/task/+server.ts     POST
 * src/routes/api/backup/destinations/[id]/test/+server.ts     POST
 * src/routes/api/backup/destinations/[id]/verify/+server.ts   POST
 * src/routes/api/backup/destinations/test/+server.ts          POST
 *
 * Update is PUT, not PATCH (verified against the handler and the pinned
 * docs/dockhand-openapi.json, both agree — there is no PATCH route for this
 * resource at all).
 *
 * `task` and `verify` are backed by `createJobResponse()` (src/lib/server/sse.ts
 * upstream) — a streamed job for SSE/browser callers, but a synchronous buffered
 * JSON result for any caller sending `Accept: application/json`. `client.post()`
 * always sends that header (see DockhandClient.request()), so both tools use the
 * plain `client.post()`/no `postSSE()` — postSSE would only ever get `{jobId}`
 * back here and there is no polling tool for it.
 *
 * Doc gap noticed while reading the handler (not present in the pinned openapi
 * spec's `requestBody` schema, only in the actual handler body): POST/PUT accept
 * a split `{backupFlags, restoreFlags}` shape in addition to the legacy bare
 * `flags` string documented in the `@openapi body:` annotation
 * (validateAndSerializeFlags(body.backupFlags, body.restoreFlags) is tried FIRST,
 * `flags` is the fallback). Both create_backup_destination and
 * update_backup_destination below wrap the real (handler) contract, so they send
 * backupFlags/restoreFlags — `npm run api:validate` reports this as an advisory
 * BODY_PARAM_UNKNOWN finding, not a hard failure, since it only checks against the
 * documented spec shape. Reported in the task report as a candidate upstream
 * doc-annotation fix.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

const REPO_TASKS = ['unlock', 'check', 'prune', 'stats', 'repair-index', 'repair-snapshots'] as const;

export function registerBackupDestinationTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_backup_destinations',
    {},
    async () => {
      return jsonResponse(await client.get('/api/backup/destinations'));
    }
  );

  registerTool(server, 'create_backup_destination',
    {
      name: z.string().describe('Destination display name (must be unique)'),
      repository: z.string().describe('restic repository target: a local absolute path, or a rest:/s3:/b2:/azure:/gs: URL'),
      password: z.string().describe('restic repository encryption password'),
      envVars: z.record(z.string(), z.string()).optional().describe('Cloud storage credential environment variables (e.g. AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), stored encrypted at rest'),
      backupFlags: z.string().optional().describe('Extra restic flags applied on backup runs against this destination'),
      restoreFlags: z.string().optional().describe('Extra restic flags applied on restore runs against this destination'),
      flags: z.string().optional().describe('Legacy bare backup-flags string; ignored server-side when backupFlags/restoreFlags is supplied'),
      hostPath: z.string().optional().describe('Host filesystem path this destination is mounted from, when repository is a local path'),
      cacert: z.string().optional().describe('PEM-encoded CA certificate for a private/self-signed TLS backend'),
      tlsClientCert: z.string().optional().describe('PEM-encoded client certificate+key for mutual TLS'),
      policies: z.string().optional().describe('JSON-encoded maintenance policy object (pruneEnabled, pruneSchedule, pruneMaxUnused, checkEnabled, checkSchedule, verifyEnabled, verifySchedule, verifyDataSubset, autoUnlock); omitted defaults server-side to prune+check enabled monthly, verify disabled'),
    },
    async ({ name, repository, password, envVars, backupFlags, restoreFlags, flags, hostPath, cacert, tlsClientCert, policies }) => {
      const body: Record<string, unknown> = { name, repository, password };
      if (envVars !== undefined) body.envVars = envVars;
      if (backupFlags !== undefined) body.backupFlags = backupFlags;
      if (restoreFlags !== undefined) body.restoreFlags = restoreFlags;
      if (flags !== undefined) body.flags = flags;
      if (hostPath !== undefined) body.hostPath = hostPath;
      if (cacert !== undefined) body.cacert = cacert;
      if (tlsClientCert !== undefined) body.tlsClientCert = tlsClientCert;
      if (policies !== undefined) body.policies = policies;
      return jsonResponse(await client.post('/api/backup/destinations', body));
    }
  );

  registerTool(server, 'get_backup_destination',
    { destinationId: z.number().describe('Backup destination id (from list_backup_destinations)') },
    async ({ destinationId }) => {
      return jsonResponse(await client.get(`/api/backup/destinations/${encodePath(destinationId)}`));
    }
  );

  registerTool(server, 'update_backup_destination',
    {
      destinationId: z.number().describe('Backup destination id (from list_backup_destinations)'),
      name: z.string().optional().describe('New destination display name (must remain unique)'),
      repository: z.string().optional().describe('New restic repository target: a local absolute path, or a rest:/s3:/b2:/azure:/gs: URL. Refused with 409 while a backup using this destination is running'),
      password: z.string().optional().describe('New restic repository encryption password. Refused with 409 while a backup using this destination is running'),
      envVars: z.record(z.string(), z.string()).optional().describe('Replacement cloud storage credential environment variables, stored encrypted at rest'),
      backupFlags: z.string().optional().describe('Extra restic flags applied on backup runs; omit all three flag fields to leave flags untouched'),
      restoreFlags: z.string().optional().describe('Extra restic flags applied on restore runs; omit all three flag fields to leave flags untouched'),
      flags: z.string().optional().describe('Legacy bare backup-flags string; ignored server-side when backupFlags/restoreFlags is supplied'),
      hostPath: z.string().optional().describe('New host filesystem path this destination is mounted from, when repository is a local path'),
      cacert: z.string().optional().describe('New PEM-encoded CA certificate for a private/self-signed TLS backend'),
      tlsClientCert: z.string().optional().describe('New PEM-encoded client certificate+key for mutual TLS'),
      policies: z.string().optional().describe('New JSON-encoded maintenance policy object; supplying it re-registers the repo_prune/repo_check/repo_verify maintenance schedules'),
    },
    async ({ destinationId, name, repository, password, envVars, backupFlags, restoreFlags, flags, hostPath, cacert, tlsClientCert, policies }) => {
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (repository !== undefined) body.repository = repository;
      if (password !== undefined) body.password = password;
      if (envVars !== undefined) body.envVars = envVars;
      if (backupFlags !== undefined) body.backupFlags = backupFlags;
      if (restoreFlags !== undefined) body.restoreFlags = restoreFlags;
      if (flags !== undefined) body.flags = flags;
      if (hostPath !== undefined) body.hostPath = hostPath;
      if (cacert !== undefined) body.cacert = cacert;
      if (tlsClientCert !== undefined) body.tlsClientCert = tlsClientCert;
      if (policies !== undefined) body.policies = policies;
      return jsonResponse(await client.put(`/api/backup/destinations/${encodePath(destinationId)}`, body));
    }
  );

  registerTool(server, 'delete_backup_destination',
    { destinationId: z.number().describe('Backup destination id (from list_backup_destinations)') },
    async ({ destinationId }) => {
      return jsonResponse(await client.delete(`/api/backup/destinations/${encodePath(destinationId)}`));
    }
  );

  registerTool(server, 'init_backup_destination',
    { destinationId: z.number().describe('Backup destination id (from list_backup_destinations)') },
    async ({ destinationId }) => {
      return jsonResponse(await client.post(`/api/backup/destinations/${encodePath(destinationId)}/init`));
    }
  );

  registerTool(server, 'rotate_backup_destination_key',
    {
      destinationId: z.number().describe('Backup destination id (from list_backup_destinations)'),
      currentPassword: z.string().describe('Current restic repository password'),
      newPassword: z.string().describe('New restic repository password to rotate to'),
    },
    async ({ destinationId, currentPassword, newPassword }) => {
      return jsonResponse(await client.post(`/api/backup/destinations/${encodePath(destinationId)}/rotate-key`, { currentPassword, newPassword }));
    }
  );

  registerTool(server, 'run_backup_destination_task',
    {
      destinationId: z.number().describe('Backup destination id (from list_backup_destinations)'),
      task: z.enum(REPO_TASKS).describe(
        'Repository maintenance task to run: unlock, check, prune, stats, repair-index or repair-snapshots. ' +
        'WARNING: prune, repair-index and repair-snapshots mutate the restic repository (prune permanently ' +
        'discards unreferenced data, the repair tasks rewrite the index/snapshot metadata) and act on the ' +
        'destination\'s single shared repository, not one backup config — every environment whose configs use ' +
        'this destination is affected.'
      ),
    },
    async ({ destinationId, task }) => {
      return jsonResponse(await client.post(`/api/backup/destinations/${encodePath(destinationId)}/task`, { task }));
    }
  );

  registerTool(server, 'test_backup_destination',
    { destinationId: z.number().describe('Backup destination id (from list_backup_destinations)') },
    async ({ destinationId }) => {
      return jsonResponse(await client.post(`/api/backup/destinations/${encodePath(destinationId)}/test`));
    }
  );

  registerTool(server, 'verify_backup_destination',
    {
      destinationId: z.number().describe('Backup destination id (from list_backup_destinations)'),
      dataSubset: z.string().optional().describe('Fraction/size of the repository to re-read and verify, restic --read-data-subset syntax (e.g. "5%", "1G"); omitted defaults server-side to "5%"'),
    },
    async ({ destinationId, dataSubset }) => {
      const body: Record<string, unknown> = {};
      if (dataSubset !== undefined) body.dataSubset = dataSubset;
      return jsonResponse(await client.post(`/api/backup/destinations/${encodePath(destinationId)}/verify`, body));
    }
  );

  registerTool(server, 'test_backup_destination_inline',
    {
      destinationId: z.number().optional().describe('Test a saved destination using its stored credentials (from list_backup_destinations); when supplied every other field below is ignored server-side'),
      repository: z.string().optional().describe('restic repository target to test (required together with password when destinationId is omitted)'),
      password: z.string().optional().describe('restic repository password to test (required together with repository when destinationId is omitted)'),
      envVars: z.record(z.string(), z.string()).optional().describe('Cloud storage credential environment variables to test with, for an unsaved destination'),
      cacert: z.string().optional().describe('PEM-encoded CA certificate to test with, for an unsaved destination'),
      tlsClientCert: z.string().optional().describe('PEM-encoded client certificate+key to test with, for an unsaved destination'),
    },
    async ({ destinationId, repository, password, envVars, cacert, tlsClientCert }) => {
      const body: Record<string, unknown> = {};
      if (destinationId !== undefined) body.destinationId = destinationId;
      if (repository !== undefined) body.repository = repository;
      if (password !== undefined) body.password = password;
      if (envVars !== undefined) body.envVars = envVars;
      if (cacert !== undefined) body.cacert = cacert;
      if (tlsClientCert !== undefined) body.tlsClientCert = tlsClientCert;
      return jsonResponse(await client.post('/api/backup/destinations/test', body));
    }
  );
}
