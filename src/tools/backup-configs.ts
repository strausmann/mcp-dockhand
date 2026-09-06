/**
 * Backup config tools — bind a stack/container (`targetName`) to a backup
 * destination, an optional cron schedule and a retention policy.
 *
 * Ground truth: Finsys/dockhand v1.0.46,
 * src/routes/api/backup/configs/+server.ts            GET (list), POST (create)
 * src/routes/api/backup/configs/[id]/+server.ts        GET (get), PUT (update), DELETE
 * src/routes/api/backup/configs/[id]/run/+server.ts    POST (run)
 * src/routes/api/backup/configs/[id]/stop/+server.ts   POST (stop)
 *
 * List query params (all optional): `type` (config type, e.g. "container"/"stack"),
 * `target` (targetName filter) and `env` (environmentId filter) — read directly off
 * the GET handler's `url.searchParams`.
 *
 * create_backup_config requires destinationId + targetName (handler 400s without
 * both); update_backup_config (PUT) does NOT — every field is optional, and the
 * environment is fixed at creation (the PUT handler never reads body.environmentId
 * or body.type/targetName at all, only destinationId/enabled/allVolumes/
 * selectedVolumes/stopBeforeBackup/schedule/retention/options/tags).
 *
 * The body has real nested shapes, modeled as such rather than flattened to
 * strings — the handler passes `retention`/`options`/`selectedVolumes`/`tags`
 * straight through (rescheduling/JSON.stringify happens server-side, not in this
 * client):
 *   - retention: {keepLast?, keepDaily?, keepWeekly?, keepMonthly?, keepYearly?}
 *     (all numbers) — keys verified against
 *     src/lib/server/backups/helpers.ts RETENTION_KEEP_KEYS.
 *   - options: a free-form object, forwarded as-is.
 *   - selectedVolumes / tags: string arrays.
 *
 * `run` is backed by createJobResponse() (src/lib/server/sse.ts upstream) — a
 * streamed job for SSE/browser callers, but a synchronous buffered JSON result for
 * any caller sending `Accept: application/json`. client.post() always sends that
 * header (see DockhandClient.request()), so run_backup_config uses the plain
 * client.post(), never client.postSSE() — postSSE would only ever get `{jobId}`
 * back here and there is no polling tool for it (same reasoning as
 * run_backup_destination_task/verify_backup_destination in backup-destinations.ts).
 *
 * Neither `run` nor `stop` reads a request body — the run handler destructures
 * `request` only to hand it to createJobResponse() for Accept-header detection,
 * and the stop handler doesn't even take `request` as a parameter.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

const retentionShape = z.object({
  keepLast: z.number().optional().describe('Keep the last N snapshots regardless of age'),
  keepDaily: z.number().optional().describe('Keep one snapshot per day for N days'),
  keepWeekly: z.number().optional().describe('Keep one snapshot per week for N weeks'),
  keepMonthly: z.number().optional().describe('Keep one snapshot per month for N months'),
  keepYearly: z.number().optional().describe('Keep one snapshot per year for N years'),
}).partial();

/**
 * Fields accepted by BOTH create (POST) and update (PUT) — verified against both
 * handlers reading body.enabled/allVolumes/selectedVolumes/stopBeforeBackup/
 * schedule/retention/options/tags. `type` and `environmentId` are deliberately
 * NOT in here: the PUT handler never reads body.type or body.environmentId at
 * all (the environment is fixed at creation, per its own doc comment) — putting
 * them on update_backup_config would accept a value the server silently ignores.
 */
const sharedConfigFields = {
  enabled: z.boolean().optional().describe('Whether the config is active and its schedule registered (default: true on create)'),
  allVolumes: z.boolean().optional().describe('Back up all volumes of the target (default: true on create); set false together with selectedVolumes to back up only specific volumes'),
  selectedVolumes: z.array(z.string()).optional().describe('Specific volume names to back up when allVolumes is false'),
  stopBeforeBackup: z.boolean().optional().describe('Stop the target container/stack before the backup runs, restart it after (default: false on create)'),
  schedule: z.string().optional().describe('Cron expression for automatic runs; omit/empty for a manual run-once config'),
  retention: retentionShape.optional().describe('restic forget/prune retention policy — object with keepLast/keepDaily/keepWeekly/keepMonthly/keepYearly counts, all optional'),
  options: z.record(z.string(), z.unknown()).optional().describe('Free-form additional backup options object, forwarded as-is'),
  tags: z.array(z.string()).optional().describe('Restic tags applied to snapshots created by this config'),
};

export function registerBackupConfigTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_backup_configs',
    {
      type: z.string().optional().describe('Filter by backup config type (e.g. "container", "stack")'),
      targetName: z.string().optional().describe('Filter by the backed-up target name (container or stack name)'),
      environmentId: z.number().optional().describe('Filter by environment id (from GET /api/environments)'),
    },
    async ({ type, targetName, environmentId }) => {
      return jsonResponse(await client.get('/api/backup/configs', { type, target: targetName, env: environmentId }));
    }
  );

  registerTool(server, 'create_backup_config',
    {
      destinationId: z.number().describe('Backup destination id to write into (from list_backup_destinations)'),
      targetName: z.string().describe('Target container or stack name to back up'),
      type: z.string().optional().describe('Backup config type, e.g. "container" or "stack" (default: "container")'),
      environmentId: z.number().optional().describe('Environment ID the target belongs to (from GET /api/environments); fixed at creation, cannot be changed later'),
      ...sharedConfigFields,
    },
    async ({ destinationId, targetName, type, environmentId, enabled, allVolumes, selectedVolumes, stopBeforeBackup, schedule, retention, options, tags }) => {
      const body: Record<string, unknown> = { destinationId, targetName };
      if (type !== undefined) body.type = type;
      if (environmentId !== undefined) body.environmentId = environmentId;
      if (enabled !== undefined) body.enabled = enabled;
      if (allVolumes !== undefined) body.allVolumes = allVolumes;
      if (selectedVolumes !== undefined) body.selectedVolumes = selectedVolumes;
      if (stopBeforeBackup !== undefined) body.stopBeforeBackup = stopBeforeBackup;
      if (schedule !== undefined) body.schedule = schedule;
      if (retention !== undefined) body.retention = retention;
      if (options !== undefined) body.options = options;
      if (tags !== undefined) body.tags = tags;
      return jsonResponse(await client.post('/api/backup/configs', body));
    }
  );

  registerTool(server, 'get_backup_config',
    { configId: z.number().describe('Backup configuration id (from list_backup_configs)') },
    async ({ configId }) => {
      return jsonResponse(await client.get(`/api/backup/configs/${encodePath(configId)}`));
    }
  );

  registerTool(server, 'update_backup_config',
    {
      configId: z.number().describe('Backup configuration id (from list_backup_configs)'),
      destinationId: z.number().optional().describe('New backup destination id (from list_backup_destinations); refused with 409 while a backup using this config is running'),
      ...sharedConfigFields,
    },
    async ({ configId, destinationId, enabled, allVolumes, selectedVolumes, stopBeforeBackup, schedule, retention, options, tags }) => {
      const body: Record<string, unknown> = {};
      if (destinationId !== undefined) body.destinationId = destinationId;
      if (enabled !== undefined) body.enabled = enabled;
      if (allVolumes !== undefined) body.allVolumes = allVolumes;
      if (selectedVolumes !== undefined) body.selectedVolumes = selectedVolumes;
      if (stopBeforeBackup !== undefined) body.stopBeforeBackup = stopBeforeBackup;
      if (schedule !== undefined) body.schedule = schedule;
      if (retention !== undefined) body.retention = retention;
      if (options !== undefined) body.options = options;
      if (tags !== undefined) body.tags = tags;
      return jsonResponse(await client.put(`/api/backup/configs/${encodePath(configId)}`, body));
    }
  );

  registerTool(server, 'delete_backup_config',
    { configId: z.number().describe('Backup configuration id (from list_backup_configs)') },
    async ({ configId }) => {
      return jsonResponse(await client.delete(`/api/backup/configs/${encodePath(configId)}`));
    }
  );

  registerTool(server, 'run_backup_config',
    { configId: z.number().describe('Backup configuration id (from list_backup_configs). Triggers a manual backup run now; if the config has stopBeforeBackup:true this stops the target container/stack for the duration of the run and restarts it afterwards.') },
    async ({ configId }) => {
      return jsonResponse(await client.post(`/api/backup/configs/${encodePath(configId)}/run`));
    }
  );

  registerTool(server, 'stop_backup_config',
    { configId: z.number().describe('Backup configuration id (from list_backup_configs). Cancels the in-flight backup run for this config, if any.') },
    async ({ configId }) => {
      return jsonResponse(await client.post(`/api/backup/configs/${encodePath(configId)}/stop`));
    }
  );
}
