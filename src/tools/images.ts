/**
 * Image management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerImageTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_images',
    'List all Docker images in an environment',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      const data = await client.get('/api/images', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_image',
    'Get details of a specific Docker image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      const data = await client.get(`/api/images/${imageId}`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_image_history',
    'Get the layer history of a Docker image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      const data = await client.get(`/api/images/${imageId}/history`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'tag_image',
    'Add a tag to a Docker image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
      repo: z.string().describe('Repository name'),
      tag: z.string().describe('Tag name'),
    },
    async ({ environmentId, imageId, repo, tag }) => {
      const data = await client.post(`/api/images/${imageId}/tag`, { repo, tag }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'remove_image',
    'Remove a Docker image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      const data = await client.delete(`/api/images/${imageId}`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'pull_image',
    'Pull a Docker image from a registry',
    {
      environmentId: z.number().describe('Environment ID'),
      image: z.string().describe('Image name with tag (e.g. nginx:latest)'),
    },
    async ({ environmentId, image }) => {
      const data = await client.post('/api/images/pull', { image }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'push_image',
    'Push a Docker image to a registry',
    {
      environmentId: z.number().describe('Environment ID'),
      image: z.string().describe('Image name with tag'),
    },
    async ({ environmentId, image }) => {
      const data = await client.post('/api/images/push', { image }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'scan_image',
    'Run a vulnerability scan on a Docker image (Trivy/Grype)',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID to scan'),
    },
    async ({ environmentId, imageId }) => {
      const data = await client.post('/api/images/scan', { imageId }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'export_image',
    'Export a Docker image as a tarball',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      const data = await client.post(`/api/images/${imageId}/export`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
