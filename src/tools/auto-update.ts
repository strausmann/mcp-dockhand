/**
 * Auto-update and vulnerability scanning tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerAutoUpdateTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_auto_update_settings', 'Retrieve environment-wide auto-update defaults that apply to all containers in an environment. Returns the global policy configuration used when no per-container override is set; contrast with `get_container_auto_update` (per-container read) and `set_container_auto_update` (per-container write). To see which containers actually have newer images available, use `check_container_updates`; for the pre-built list of containers already discovered as outdated, use `get_pending_updates`.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/auto-update', { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_auto_update', 'Read the per-container auto-update policy override for a single container, which takes precedence over the environment-wide defaults returned by `get_auto_update_settings`. Use `set_container_auto_update` to change this per-container policy. To check whether a newer image is actually available in the registry right now, call `check_container_updates`; to see all containers already flagged as outdated, use `get_pending_updates`.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerName: z.string().describe('Container name'),
    },
    async ({ environmentId, containerName }) => {
      return jsonResponse(await client.get(`/api/auto-update/${encodePath(containerName)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'set_container_auto_update', 'Write a per-container auto-update policy override (never, any, critical-high, critical, or more-than-current), replacing the environment-wide defaults from `get_auto_update_settings`. Read the current per-container setting with `get_container_auto_update` before changing it. After setting the policy, use `check_container_updates` to trigger an immediate registry check or `get_pending_updates` to review containers already queued for update.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerName: z.string().describe('Container name'),
      policy: z.enum(['never', 'any', 'critical-high', 'critical', 'more-than-current']).describe('Auto-update policy'),
    },
    async ({ environmentId, containerName, policy }) => {
      return jsonResponse(await client.post(`/api/auto-update/${encodePath(containerName)}`, { policy }, { env: environmentId }));
    }
  );

  registerTool(server, 'clear_container_auto_update', 'Permanently delete the per-container auto-update policy override, falling back to the environment-wide defaults (see `get_auto_update_settings`); read the override first with `get_container_auto_update`, or use `set_container_auto_update` to replace it instead of clearing.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerName: z.string().describe('Container name'),
    },
    async ({ environmentId, containerName }) => {
      return jsonResponse(await client.delete(`/api/auto-update/${encodePath(containerName)}`, { env: environmentId }));
    }
  );
}
