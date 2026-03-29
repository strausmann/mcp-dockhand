/**
 * Dashboard and activity feed tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerDashboardTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_dashboard_stats', 'Get dashboard statistics (containers, images, volumes, networks overview)',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dashboard/stats'));
    }
  );

  registerTool(server, 'get_dashboard_preferences', 'Get dashboard display preferences',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dashboard/preferences'));
    }
  );

  registerTool(server, 'set_dashboard_preferences', 'Set dashboard display preferences',
    { preferences: z.record(z.unknown()).describe('Dashboard preferences') },
    async ({ preferences }) => {
      return jsonResponse(await client.post('/api/dashboard/preferences', preferences));
    }
  );

  registerTool(server, 'get_activity_feed', 'Get the activity feed (recent actions and events)',
    {
      environmentId: z.number().optional().describe('Filter by environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/activity', environmentId ? { env: environmentId } : undefined));
    }
  );

  registerTool(server, 'get_container_activity', 'Get container-specific activity feed',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/containers'));
    }
  );

  registerTool(server, 'get_activity_events', 'Get activity events',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/events'));
    }
  );

  registerTool(server, 'get_activity_stats', 'Get activity statistics',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/stats'));
    }
  );

  registerTool(server, 'get_merged_logs', 'Get merged logs from multiple containers',
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
}
