/**
 * Docker network management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerNetworkTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_networks',
    'List all Docker networks in an environment',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      const data = await client.get('/api/networks', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_network',
    'Get details of a specific Docker network',
    {
      environmentId: z.number().describe('Environment ID'),
      networkId: z.string().describe('Network ID'),
    },
    async ({ environmentId, networkId }) => {
      const data = await client.get(`/api/networks/${networkId}`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'inspect_network',
    'Inspect a Docker network (full low-level details)',
    {
      environmentId: z.number().describe('Environment ID'),
      networkId: z.string().describe('Network ID'),
    },
    async ({ environmentId, networkId }) => {
      const data = await client.get(`/api/networks/${networkId}/inspect`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_network',
    'Create a new Docker network',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Network name'),
      driver: z.string().optional().describe('Network driver (default: bridge)'),
      internal: z.boolean().optional().describe('Internal network (no external access)'),
      attachable: z.boolean().optional().describe('Allow manual container attachment'),
      enableIPv6: z.boolean().optional().describe('Enable IPv6'),
      labels: z.record(z.string()).optional().describe('Network labels'),
      options: z.record(z.string()).optional().describe('Driver-specific options'),
    },
    async ({ environmentId, name, driver, internal, attachable, enableIPv6, labels, options }) => {
      const body: Record<string, unknown> = { name };
      if (driver) body.driver = driver;
      if (internal !== undefined) body.internal = internal;
      if (attachable !== undefined) body.attachable = attachable;
      if (enableIPv6 !== undefined) body.enableIPv6 = enableIPv6;
      if (labels) body.labels = labels;
      if (options) body.options = options;

      const data = await client.post('/api/networks', body, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'remove_network',
    'Remove a Docker network',
    {
      environmentId: z.number().describe('Environment ID'),
      networkId: z.string().describe('Network ID'),
    },
    async ({ environmentId, networkId }) => {
      const data = await client.delete(`/api/networks/${networkId}`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'connect_container_to_network',
    'Connect a container to a Docker network',
    {
      environmentId: z.number().describe('Environment ID'),
      networkId: z.string().describe('Network ID'),
      containerId: z.string().describe('Container ID to connect'),
    },
    async ({ environmentId, networkId, containerId }) => {
      const data = await client.post(`/api/networks/${networkId}/connect`, { containerId }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'disconnect_container_from_network',
    'Disconnect a container from a Docker network',
    {
      environmentId: z.number().describe('Environment ID'),
      networkId: z.string().describe('Network ID'),
      containerId: z.string().describe('Container ID to disconnect'),
    },
    async ({ environmentId, networkId, containerId }) => {
      const data = await client.post(`/api/networks/${networkId}/disconnect`, { containerId }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
