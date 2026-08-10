/**
 * Dashboard and activity feed tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerDashboardTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_dashboard_stats',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dashboard/stats'));
    }
  );

  registerTool(server, 'get_dashboard_preferences',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dashboard/preferences'));
    }
  );

  registerTool(server, 'set_dashboard_preferences',
    { preferences: z.record(z.string(), z.unknown()).describe('Dashboard preferences') },
    async ({ preferences }) => {
      return jsonResponse(await client.post('/api/dashboard/preferences', preferences));
    }
  );

  registerTool(server, 'get_activity_feed',
    {
      environmentId: z.number().optional().describe('Filter by environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/activity', environmentId ? { env: environmentId } : undefined));
    }
  );

  registerTool(server, 'get_container_activity',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/containers'));
    }
  );

  registerTool(server, 'get_activity_events',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/events'));
    }
  );

  registerTool(server, 'get_activity_stats',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/stats'));
    }
  );

  registerTool(server, 'get_merged_logs',
    {
      environmentId: z.number().describe('Environment ID'),
      containers: z.string().describe('Comma-separated container names or IDs'),
      tail: z.number().optional().describe('Number of lines per container (default: 50)'),
    },
    async ({ environmentId, containers, tail }) => {
      const data = await client.get('/api/logs/merged', {
        env: environmentId,
        containers,
        tail: tail ?? 50,
      });
      return textResponse(data);
    }
  );

  registerTool(server, 'clear_activity',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/activity'));
    }
  );
}
