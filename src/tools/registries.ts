/**
 * Docker registry management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerRegistryTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_registries',
    'List all configured Docker registries',
    {},
    async () => {
      const data = await client.get('/api/registries');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_registry',
    'Add a new Docker registry',
    {
      config: z.record(z.unknown()).describe('Registry configuration (name, url, username, password, etc.)'),
    },
    async ({ config }) => {
      const data = await client.post('/api/registries', config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_registry',
    'Get details of a Docker registry',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      const data = await client.get(`/api/registries/${registryId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_registry',
    'Update a Docker registry configuration',
    {
      registryId: z.number().describe('Registry ID'),
      config: z.record(z.unknown()).describe('Updated registry configuration'),
    },
    async ({ registryId, config }) => {
      const data = await client.put(`/api/registries/${registryId}`, config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_registry',
    'Delete a Docker registry',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      const data = await client.delete(`/api/registries/${registryId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_default_registry',
    'Set a registry as the default',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      const data = await client.post(`/api/registries/${registryId}/default`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Registry Search ---

  server.tool(
    'search_registry',
    'Search a Docker registry for images',
    {
      query: z.string().describe('Search query'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ query, environmentId }) => {
      const data = await client.get('/api/registry/search', { q: query, env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_registry_catalog',
    'Get the catalog of a Docker registry',
    {
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ environmentId }) => {
      const data = await client.get('/api/registry/catalog', environmentId ? { env: environmentId } : undefined);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_registry_image',
    'Get image details from a registry',
    {
      image: z.string().describe('Image name'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ image, environmentId }) => {
      const data = await client.get('/api/registry/image', { image, env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_registry_tags',
    'Get available tags for an image in a registry',
    {
      image: z.string().describe('Image name'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ image, environmentId }) => {
      const data = await client.get('/api/registry/tags', { image, env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
