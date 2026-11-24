/**
 * Schedule management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerScheduleTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_schedules',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules'));
    }
  );

  registerTool(server, 'get_schedule_settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules/settings'));
    }
  );

  registerTool(server, 'update_schedule_settings',
    {
      settings: z.record(z.string(), z.unknown()).describe('Schedule settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/schedules/settings', settings));
    }
  );

  registerTool(server, 'get_schedule_executions',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules/executions'));
    }
  );

  registerTool(server, 'get_schedule_execution',
    { executionId: z.number().describe('Execution ID') },
    async ({ executionId }) => {
      return jsonResponse(await client.get(`/api/schedules/executions/${encodePath(executionId)}`));
    }
  );

  registerTool(server, 'run_schedule_now',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}/run`));
    }
  );

  registerTool(server, 'toggle_schedule',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}/toggle`));
    }
  );

  registerTool(server, 'toggle_system_schedule',
    { scheduleId: z.number().describe('System schedule ID') },
    async ({ scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/system/${encodePath(scheduleId)}/toggle`));
    }
  );

  registerTool(server, 'delete_schedule',
    {
      type: z.string().describe('Schedule type identifier'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.delete(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}`));
    }
  );

  registerTool(server, 'delete_schedule_execution',
    { executionId: z.number().describe('Schedule execution ID') },
    async ({ executionId }) => {
      return jsonResponse(await client.delete(`/api/schedules/executions/${encodePath(executionId)}`));
    }
  );

  // --- Per-container start/stop schedule (Dockhand 1.0.55+, #340) ---
  //
  // Ground truth: Finsys/dockhand v1.0.59,
  // src/routes/api/scheduled-actions/[containerName]/+server.ts. `env` is required on
  // both methods (400 otherwise). The PUT does not merge: an empty or missing time is
  // read as null, so both times are required here (null is the explicit "none"), and
  // both null deletes the schedule. `enabled` only applies when a schedule is written;
  // omitted, an existing row keeps its on/off state. A container scheduled by its
  // dockhand.start.at / dockhand.stop.at labels answers 409, a system container 403.

  registerTool(server, 'get_container_start_stop_schedule',
    {
      environmentId: z.number().describe('Environment ID the container belongs to (required)'),
      containerName: z.string().describe('Container name (not the ID)'),
    },
    async ({ environmentId, containerName }) => {
      return jsonResponse(await client.get(`/api/scheduled-actions/${encodePath(containerName)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'set_container_start_stop_schedule',
    {
      environmentId: z.number().describe('Environment ID the container belongs to (required)'),
      containerName: z.string().describe('Container name (not the ID) of an existing container: an unknown name answers 404, so a schedule left behind by a removed container cannot be cleared here'),
      startAt: z.string().nullable().describe('Daily start time as HH:MM, or a five-field cron expression, in the environment\'s timezone; null for no scheduled start. Required: the endpoint does not merge, an omitted time would be cleared'),
      stopAt: z.string().nullable().describe('Daily stop time as HH:MM, or a five-field cron expression; null for no scheduled stop. Required for the same reason. startAt and stopAt both null DELETES the schedule'),
      enabled: z.boolean().optional().describe('Whether the schedule runs. Omitted, an existing schedule keeps its current state (a new one is enabled). Ignored when both times are null'),
    },
    async ({ environmentId, containerName, startAt, stopAt, enabled }) => {
      const body: Record<string, unknown> = { startAt, stopAt };
      if (enabled !== undefined) body.enabled = enabled;
      return jsonResponse(await client.put(`/api/scheduled-actions/${encodePath(containerName)}`, body, { env: environmentId }));
    }
  );
}
