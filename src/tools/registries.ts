/**
 * Docker registry management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerRegistryTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_registries', 'List all configured Docker registries; use `get_registry` to fetch a single entry or `create_registry` to add one.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/registries'));
    }
  );

  registerTool(server, 'create_registry', 'Add a new Docker registry with credentials; verify the result with `get_registry` or browse all via `list_registries`.',
    {
      config: z.record(z.string(), z.unknown()).describe('Registry configuration (name, url, username, password, etc.)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/registries', config));
    }
  );

  registerTool(server, 'get_registry', 'Get full details of a single Docker registry by ID; see `list_registries` for all IDs or `update_registry` to modify.',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.get(`/api/registries/${encodePath(registryId)}`));
    }
  );

  registerTool(server, 'update_registry', 'Update an existing Docker registry configuration (URL, credentials, name); use `get_registry` to read the current state first.',
    {
      registryId: z.number().describe('Registry ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated registry configuration'),
    },
    async ({ registryId, config }) => {
      return jsonResponse(await client.put(`/api/registries/${encodePath(registryId)}`, config));
    }
  );

  registerTool(server, 'delete_registry', 'Permanently delete a Docker registry configuration; verify the ID with `get_registry` before removing.',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.delete(`/api/registries/${encodePath(registryId)}`));
    }
  );

  registerTool(server, 'set_default_registry', 'Mark a registry as the default so it is used when no explicit registry is specified; see `list_registries` for available IDs.',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.post(`/api/registries/${encodePath(registryId)}/default`));
    }
  );

  // --- Registry Search ---

  registerTool(server, 'search_registry', 'Search the configured registry for images matching a query; use `get_registry_catalog` for a full image list or `get_registry_tags` for available tags.',
    {
      query: z.string().describe('Search query'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ query, environmentId }) => {
      return jsonResponse(await client.get('/api/registry/search', { q: query, env: environmentId }));
    }
  );

  registerTool(server, 'get_registry_catalog', 'Retrieve the full image catalog of the configured Docker registry; use `search_registry` for filtered results or `get_registry_tags` for image tags.',
    {
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/registry/catalog', environmentId ? { env: environmentId } : undefined));
    }
  );

  registerTool(server, 'get_registry_tags', 'List all available tags for a specific image in the configured registry; use `get_registry_catalog` to discover image names or `search_registry` to search.',
    {
      image: z.string().describe('Image name'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ image, environmentId }) => {
      return jsonResponse(await client.get('/api/registry/tags', { image, env: environmentId }));
    }
  );

  registerTool(server, 'delete_registry_image', 'Permanently delete a specific image from a remote registry (destructive — the registry copy is removed). Pair with `search_registry` to find the image first, or `get_registry_catalog` and `get_registry_tags` to verify what is available before deleting.',
    {
      image: z.string().describe('Image name (e.g. "library/nginx")'),
      tag: z.string().optional().describe('Tag to delete; omit to remove the default tag/digest'),
      environmentId: z.number().optional().describe('Environment ID (uses default registry if omitted)'),
    },
    async ({ image, tag, environmentId }) => {
      const query: Record<string, string | number | undefined> = { image };
      if (tag !== undefined) query.tag = tag;
      if (environmentId !== undefined) query.env = environmentId;
      return jsonResponse(await client.delete('/api/registry/image', query));
    }
  );
}
