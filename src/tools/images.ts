/**
 * Image management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerImageTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_images', 'List all Docker images in an environment',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/images', { env: environmentId }));
    }
  );

  registerTool(server, 'get_image_history', 'Get the layer history of a Docker image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.get(`/api/images/${encodePath(imageId)}/history`, { env: environmentId }));
    }
  );

  registerTool(server, 'tag_image', 'Add a tag to a Docker image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
      repo: z.string().describe('Repository name'),
      tag: z.string().describe('Tag name'),
    },
    async ({ environmentId, imageId, repo, tag }) => {
      return jsonResponse(await client.post(`/api/images/${encodePath(imageId)}/tag`, { repo, tag }, { env: environmentId }));
    }
  );

  registerTool(server, 'remove_image', 'Remove a Docker image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.delete(`/api/images/${encodePath(imageId)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'pull_image', 'Pull a Docker image from a registry',
    {
      environmentId: z.number().describe('Environment ID'),
      image: z.string().describe('Image name with tag (e.g. nginx:latest)'),
    },
    async ({ environmentId, image }) => {
      return jsonResponse(await client.post('/api/images/pull', { image }, { env: environmentId }));
    }
  );

  registerTool(server, 'push_image', 'Push a Docker image to a registry',
    {
      environmentId: z.number().describe('Environment ID'),
      image: z.string().describe('Image name with tag'),
    },
    async ({ environmentId, image }) => {
      return jsonResponse(await client.post('/api/images/push', { image }, { env: environmentId }));
    }
  );

  registerTool(server, 'scan_image', 'Run a vulnerability scan on a Docker image (Trivy/Grype)',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID to scan'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.post('/api/images/scan', { imageId }, { env: environmentId }));
    }
  );

  registerTool(server, 'export_image', 'Export a Docker image as a tarball',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.get(`/api/images/${encodePath(imageId)}/export`, { env: environmentId }));
    }
  );
}
