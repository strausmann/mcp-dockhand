/**
 * Schedule management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerScheduleTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_schedules', 'List all user-defined scheduled tasks; use `get_schedule_settings` for the global schedule configuration or `get_schedule_executions` to browse run history.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules'));
    }
  );

  registerTool(server, 'get_schedule_settings', 'Read the global Dockhand schedule configuration (`GET /api/schedules/settings`, instance-wide — not per-environment); use `update_schedule_settings` to persist changes or `list_schedules` to enumerate defined schedules.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules/settings'));
    }
  );

  registerTool(server, 'update_schedule_settings', 'Write the global Dockhand schedule configuration (`PUT /api/schedules/settings`, instance-wide — not per-environment); use `get_schedule_settings` to read the current values before updating.',
    {
      settings: z.record(z.string(), z.unknown()).describe('Schedule settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/schedules/settings', settings));
    }
  );

  registerTool(server, 'get_schedule_executions', 'Retrieve the full execution history list for all schedules; use `get_schedule_execution` to fetch detail for a single run by ID.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules/executions'));
    }
  );

  registerTool(server, 'get_schedule_execution', 'Fetch the detail record for one schedule execution by ID; use `get_schedule_executions` to list all runs and find the relevant ID.',
    { executionId: z.number().describe('Execution ID') },
    async ({ executionId }) => {
      return jsonResponse(await client.get(`/api/schedules/executions/${encodePath(executionId)}`));
    }
  );

  registerTool(server, 'run_schedule_now', 'Trigger a one-shot manual execution of a user-defined schedule immediately, bypassing its timer; use `toggle_schedule` to permanently enable or disable it.',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}/run`));
    }
  );

  registerTool(server, 'toggle_schedule', 'Enable or disable a user-defined schedule; use `toggle_system_schedule` for built-in system schedules or `run_schedule_now` for a one-shot manual trigger.',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}/toggle`));
    }
  );

  registerTool(server, 'toggle_system_schedule', 'Enable or disable a built-in system schedule (internal/platform-level); use `toggle_schedule` for user-defined schedules instead.',
    { scheduleId: z.number().describe('System schedule ID') },
    async ({ scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/system/${encodePath(scheduleId)}/toggle`));
    }
  );

  registerTool(server, 'delete_schedule', 'Permanently delete a scheduled task by type and ID; use `list_schedules` to find the schedule first, or `toggle_schedule` to disable without deleting.',
    {
      type: z.string().describe('Schedule type identifier'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.delete(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}`));
    }
  );

  registerTool(server, 'delete_schedule_execution', 'Permanently delete a single recorded schedule execution from the history; use `get_schedule_executions` to find the execution ID, or `get_schedule_execution` for detail on one row before deleting.',
    { executionId: z.number().describe('Schedule execution ID') },
    async ({ executionId }) => {
      return jsonResponse(await client.delete(`/api/schedules/executions/${encodePath(executionId)}`));
    }
  );
}
