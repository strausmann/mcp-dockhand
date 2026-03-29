/**
 * Docker registry management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerRegistryTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_registries', 'List all configured Docker registries',
    {},
    async () => {
      return jsonResponse(await client.get('/api/registries'));
    }
  );

  registerTool(server, 'create_registry', 'Add a new Docker registry',
    {
      config: z.record(z.unknown()).describe('Registry configuration (name, url, username, password, etc.)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/registries', config));
    }
  );

  registerTool(server, 'get_registry', 'Get details of a Docker registry',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.get(`/api/registries/${encodePath(registryId)}`));
    }
  );

  registerTool(server, 'update_registry', 'Update a Docker registry configuration',
    {
      registryId: z.number().describe('Registry ID'),
      config: z.record(z.unknown()).describe('Updated registry configuration'),
    },
    async ({ registryId, config }) => {
      return jsonResponse(await client.put(`/api/registries/${encodePath(registryId)}`, config));
    }
  );

  registerTool(server, 'delete_registry', 'Delete a Docker registry',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.delete(`/api/registries/${encodePath(registryId)}`));
    }
  );

  registerTool(server, 'set_default_registry', 'Set a registry as the default',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.post(`/api/registries/${encodePath(registryId)}/default`));
    }
  );

  // --- Registry Search ---

  registerTool(server, 'search_registry', 'Search a Docker registry for images',
    {
      query: z.string().describe('Search query'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ query, environmentId }) => {
      return jsonResponse(await client.get('/api/registry/search', { q: query, env: environmentId }));
    }
  );

  registerTool(server, 'get_registry_catalog', 'Get the catalog of a Docker registry',
    {
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/registry/catalog', environmentId ? { env: environmentId } : undefined));
    }
  );

  registerTool(server, 'get_registry_image', 'Get image details from a registry',
    {
      image: z.string().describe('Image name'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ image, environmentId }) => {
      return jsonResponse(await client.get('/api/registry/image', { image, env: environmentId }));
    }
  );

  registerTool(server, 'get_registry_tags', 'Get available tags for an image in a registry',
    {
      image: z.string().describe('Image name'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ image, environmentId }) => {
      return jsonResponse(await client.get('/api/registry/tags', { image, env: environmentId }));
    }
  );
}
