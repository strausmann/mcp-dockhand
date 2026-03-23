/**
 * Auto-update and vulnerability scanning tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerAutoUpdateTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'get_auto_update_settings',
    'Get auto-update settings for all containers',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get('/api/auto-update', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container_auto_update',
    'Get auto-update settings for a specific container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerName: z.string().describe('Container name'),
    },
    async ({ environmentId, containerName }) => {
      const data = await client.get(`/api/auto-update/${encodeURIComponent(containerName)}`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_container_auto_update',
    'Set auto-update policy for a container (never, any, critical-high, critical, more-than-current)',
    {
      environmentId: z.number().describe('Environment ID'),
      containerName: z.string().describe('Container name'),
      policy: z.enum(['never', 'any', 'critical-high', 'critical', 'more-than-current']).describe('Auto-update policy'),
    },
    async ({ environmentId, containerName, policy }) => {
      const data = await client.put(`/api/auto-update/${encodeURIComponent(containerName)}`, { policy }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
