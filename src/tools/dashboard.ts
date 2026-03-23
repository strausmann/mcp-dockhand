/**
 * Dashboard and activity feed tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerDashboardTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'get_dashboard_stats',
    'Get dashboard statistics (containers, images, volumes, networks overview)',
    {},
    async () => {
      const data = await client.get('/api/dashboard/stats');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_dashboard_preferences',
    'Get dashboard display preferences',
    {},
    async () => {
      const data = await client.get('/api/dashboard/preferences');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_dashboard_preferences',
    'Set dashboard display preferences',
    { preferences: z.record(z.unknown()).describe('Dashboard preferences') },
    async ({ preferences }) => {
      const data = await client.put('/api/dashboard/preferences', preferences);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_activity_feed',
    'Get the activity feed (recent actions and events)',
    {
      environmentId: z.number().optional().describe('Filter by environment ID'),
    },
    async ({ environmentId }) => {
      const data = await client.get('/api/activity', environmentId ? { env: environmentId } : undefined);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container_activity',
    'Get container-specific activity feed',
    {},
    async () => {
      const data = await client.get('/api/activity/containers');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_activity_events',
    'Get activity events',
    {},
    async () => {
      const data = await client.get('/api/activity/events');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_activity_stats',
    'Get activity statistics',
    {},
    async () => {
      const data = await client.get('/api/activity/stats');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_merged_logs',
    'Get merged logs from multiple containers',
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
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );
}
