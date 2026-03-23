/**
 * Schedule management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerScheduleTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_schedules',
    'List all scheduled tasks',
    {},
    async () => {
      const data = await client.get('/api/schedules');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_schedule_settings',
    'Get schedule settings',
    {},
    async () => {
      const data = await client.get('/api/schedules/settings');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_schedule_settings',
    'Update schedule settings',
    {
      settings: z.record(z.unknown()).describe('Schedule settings to update'),
    },
    async ({ settings }) => {
      const data = await client.put('/api/schedules/settings', settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_schedule_executions',
    'Get schedule execution history',
    {},
    async () => {
      const data = await client.get('/api/schedules/executions');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_schedule_execution',
    'Get details of a specific schedule execution',
    { executionId: z.number().describe('Execution ID') },
    async ({ executionId }) => {
      const data = await client.get(`/api/schedules/executions/${executionId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_schedule',
    'Get a specific schedule by type and ID',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      const data = await client.get(`/api/schedules/${type}/${scheduleId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'run_schedule_now',
    'Run a schedule immediately',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      const data = await client.post(`/api/schedules/${type}/${scheduleId}/run`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'toggle_schedule',
    'Enable or disable a schedule',
    {
      type: z.string().describe('Schedule type'),
      scheduleId: z.number().describe('Schedule ID'),
    },
    async ({ type, scheduleId }) => {
      const data = await client.post(`/api/schedules/${type}/${scheduleId}/toggle`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'toggle_system_schedule',
    'Enable or disable a system schedule',
    { scheduleId: z.number().describe('System schedule ID') },
    async ({ scheduleId }) => {
      const data = await client.post(`/api/schedules/system/${scheduleId}/toggle`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
