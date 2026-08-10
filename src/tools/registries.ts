/**
 * Docker registry management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerRegistryTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_registries',
    {},
    async () => {
      return jsonResponse(await client.get('/api/registries'));
    }
  );

  registerTool(server, 'create_registry',
    {
      config: z.record(z.string(), z.unknown()).describe('Registry configuration (name, url, username, password, etc.)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/registries', config));
    }
  );

  registerTool(server, 'get_registry',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.get(`/api/registries/${encodePath(registryId)}`));
    }
  );

  registerTool(server, 'update_registry',
    {
      registryId: z.number().describe('Registry ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated registry configuration'),
    },
    async ({ registryId, config }) => {
      return jsonResponse(await client.put(`/api/registries/${encodePath(registryId)}`, config));
    }
  );

  registerTool(server, 'delete_registry',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.delete(`/api/registries/${encodePath(registryId)}`));
    }
  );

  registerTool(server, 'set_default_registry',
    { registryId: z.number().describe('Registry ID') },
    async ({ registryId }) => {
      return jsonResponse(await client.post(`/api/registries/${encodePath(registryId)}/default`));
    }
  );

  // --- Registry Search ---

  registerTool(server, 'search_registry',
    {
      term: z.string().describe('Search term'),
      limit: z.number().optional().describe('Maximum number of results (default: 25)'),
      registry: z.number().optional().describe('Registry ID to search (use list_registries to discover); omit to search Docker Hub'),
    },
    async ({ term, limit, registry }) => {
      return jsonResponse(await client.get('/api/registry/search', { term, limit, registry }));
    }
  );

  registerTool(server, 'get_registry_catalog',
    {
      registry: z.number().describe('Registry ID (use list_registries to discover)'),
      last: z.string().optional().describe('Pagination cursor from a previous response (opaque, returned as pagination.nextLast)'),
    },
    async ({ registry, last }) => {
      const query: Record<string, string | number> = { registry };
      if (last !== undefined) query.last = last;
      return jsonResponse(await client.get('/api/registry/catalog', query));
    }
  );

  registerTool(server, 'get_registry_tags',
    {
      image: z.string().describe('Image name'),
      environmentId: z.number().optional().describe('Environment ID'),
    },
    async ({ image, environmentId }) => {
      return jsonResponse(await client.get('/api/registry/tags', { image, env: environmentId }));
    }
  );

  registerTool(server, 'get_registry_tag_info',
    {
      registry: z.number().optional().describe('Registry ID (use list_registries to discover); omit or a Docker Hub registry returns a graceful "not supported" result instead of a manifest fetch — Docker Hub tags already carry size/date via get_registry_tags'),
      image: z.string().describe('Image repository/name'),
      tag: z.string().describe('Tag name or digest'),
    },
    async ({ registry, image, tag }) => {
      return jsonResponse(await client.get('/api/registry/tag-info', { registry, image, tag }));
    }
  );

  registerTool(server, 'delete_registry_image',
    {
      registry: z.number().describe('Registry ID (use list_registries to discover)'),
      image: z.string().describe('Image name (e.g. "library/nginx")'),
      tag: z.string().optional().describe('Tag to delete; omit to remove the default tag/digest'),
    },
    async ({ registry, image, tag }) => {
      const query: Record<string, string | number | undefined> = { registry, image };
      if (tag !== undefined) query.tag = tag;
      return jsonResponse(await client.delete('/api/registry/image', query));
    }
  );

  registerTool(server, 'test_registry',
    {
      config: z.record(z.string(), z.unknown()).describe('Registry configuration to test (url, username, password, etc.)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/registries/test', config));
    }
  );
}
