/**
 * Dashboard and activity feed tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerDashboardTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_dashboard_stats', 'Retrieve read-only counts of containers, images, volumes, and networks for the dashboard overview; use `get_dashboard_preferences` to read layout settings or `set_dashboard_preferences` to change them.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dashboard/stats'));
    }
  );

  registerTool(server, 'get_dashboard_preferences', 'Read the current dashboard layout and display preferences; use `set_dashboard_preferences` to persist changes or `get_dashboard_stats` to fetch live resource counts.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dashboard/preferences'));
    }
  );

  registerTool(server, 'set_dashboard_preferences', 'Write updated dashboard layout and display preferences; use `get_dashboard_preferences` to read the current values before overwriting them.',
    { preferences: z.record(z.string(), z.unknown()).describe('Dashboard preferences') },
    async ({ preferences }) => {
      return jsonResponse(await client.post('/api/dashboard/preferences', preferences));
    }
  );

  registerTool(server, 'get_activity_feed', 'Retrieve the paginated activity stream of recent actions across all resources; for typed event definitions see `get_activity_events`, for aggregate counts see `get_activity_stats`, and for container-scoped entries see `get_container_activity`.',
    {
      environmentId: z.number().optional().describe('Filter by environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/activity', environmentId ? { env: environmentId } : undefined));
    }
  );

  registerTool(server, 'get_container_activity', 'Retrieve the container-scoped subset of the activity feed; for the full cross-resource stream use `get_activity_feed`, or use `get_activity_stats` for aggregated counts.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/containers'));
    }
  );

  registerTool(server, 'get_activity_events', 'Retrieve the catalog of available activity event types and their definitions; for the live paginated stream of recent actions use `get_activity_feed`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/events'));
    }
  );

  registerTool(server, 'get_activity_stats', 'Retrieve aggregated activity statistics such as event counts and summaries; for the full paginated activity stream use `get_activity_feed`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/activity/stats'));
    }
  );

  registerTool(server, 'get_merged_logs', 'Fetch and interleave log lines from multiple containers into a single chronological stream, useful for debugging interactions across containers in the same stack; use `get_container_logs` to retrieve logs from a single container, or `get_container_top` to inspect live processes.',
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

  registerTool(server, 'clear_activity', 'Permanently delete (truncate) the activity log for the entire environment scope; pair with `get_activity_feed` to inspect the current entries before clearing, or `get_activity_stats` for aggregate counts that survive a clear.',
    {
      environmentId: z.number().describe('Environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.delete('/api/activity', { environmentId }));
    }
  );
}
