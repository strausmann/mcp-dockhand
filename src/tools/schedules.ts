/**
 * Schedule management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerScheduleTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_schedules', 'List all scheduled tasks',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules'));
    }
  );

  registerTool(server, 'get_schedule_settings', 'Get schedule settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules/settings'));
    }
  );

  registerTool(server, 'update_schedule_settings', 'Update schedule settings',
    {
      settings: z.record(z.unknown()).describe('Schedule settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/schedules/settings', settings));
    }
  );

  registerTool(server, 'get_schedule_executions', 'Get schedule execution history',
    {},
    async () => {
      return jsonResponse(await client.get('/api/schedules/executions'));
    }
  );

  registerTool(server, 'get_schedule_execution', 'Get details of a specific schedule execution',
    { executionId: z.number().describe('Execution ID') },
    async ({ executionId }) => {
      return jsonResponse(await client.get(`/api/schedules/executions/${encodePath(executionId)}`));
    }
  );

  registerTool(server, 'get_schedule', 'Get a specific schedule by type and ID',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.get(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}`));
    }
  );

  registerTool(server, 'run_schedule_now', 'Run a schedule immediately',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}/run`));
    }
  );

  registerTool(server, 'toggle_schedule', 'Enable or disable a schedule',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/${encodePath(type)}/${encodePath(scheduleId)}/toggle`));
    }
  );

  registerTool(server, 'toggle_system_schedule', 'Enable or disable a system schedule',
    { scheduleId: z.number().describe('System schedule ID') },
    async ({ scheduleId }) => {
      return jsonResponse(await client.post(`/api/schedules/system/${encodePath(scheduleId)}/toggle`));
    }
  );
}
