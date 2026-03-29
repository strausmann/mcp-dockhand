/**
 * Auto-update and vulnerability scanning tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerAutoUpdateTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_auto_update_settings', 'Get auto-update settings for all containers',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/auto-update', { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_auto_update', 'Get auto-update settings for a specific container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerName: z.string().describe('Container name'),
    },
    async ({ environmentId, containerName }) => {
      return jsonResponse(await client.get(`/api/auto-update/${encodePath(containerName)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'set_container_auto_update', 'Set auto-update policy for a container (never, any, critical-high, critical, more-than-current)',
    {
      environmentId: z.number().describe('Environment ID'),
      containerName: z.string().describe('Container name'),
      policy: z.enum(['never', 'any', 'critical-high', 'critical', 'more-than-current']).describe('Auto-update policy'),
    },
    async ({ environmentId, containerName, policy }) => {
      return jsonResponse(await client.post(`/api/auto-update/${encodePath(containerName)}`, { policy }, { env: environmentId }));
    }
  );
}
