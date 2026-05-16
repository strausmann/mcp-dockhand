/**
 * Image management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerImageTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_images', 'List all Docker images available in an environment; use `pull_image` to fetch new images from a registry or `remove_image` to delete unused ones.',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/images', { env: environmentId }));
    }
  );

  registerTool(server, 'get_image_history', 'Retrieve the layer-by-layer build history of a Docker image; for vulnerability findings use `scan_image`, and use `list_images` to look up valid image IDs first.',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.get(`/api/images/${encodePath(imageId)}/history`, { env: environmentId }));
    }
  );

  registerTool(server, 'tag_image', 'Add a new tag to a local Docker image (local metadata mutation only); to upload the tagged image to a registry use `push_image`, or use `remove_image` to delete the image entirely.',
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

  registerTool(server, 'remove_image', 'Permanently delete a Docker image from the environment (destructive — image is removed and cannot be recovered locally); use `list_images` to confirm the target ID before calling, or `tag_image` to rename instead.',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.delete(`/api/images/${encodePath(imageId)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'pull_image', 'Pull a Docker image from a remote registry into the environment (inbound registry transfer); to send an image back out use `push_image`, or use `list_images` to verify the image arrived.',
    {
      environmentId: z.number().describe('Environment ID'),
      image: z.string().describe('Image name with tag (e.g. nginx:latest)'),
    },
    async ({ environmentId, image }) => {
      return jsonResponse(await client.post('/api/images/pull', { image }, { env: environmentId }));
    }
  );

  registerTool(server, 'push_image', 'Push a locally tagged Docker image to a remote registry (outbound registry transfer); to apply or change a tag before pushing use `tag_image`, or use `pull_image` for the opposite inbound direction.',
    {
      environmentId: z.number().describe('Environment ID'),
      image: z.string().describe('Image name with tag'),
    },
    async ({ environmentId, image }) => {
      return jsonResponse(await client.post('/api/images/push', { image }, { env: environmentId }));
    }
  );

  registerTool(server, 'scan_image', 'Run a vulnerability scan (CVE analysis via Trivy/Grype) against a Docker image; for layer provenance use `get_image_history` instead, and use `export_image` to extract the image filesystem for offline analysis.',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID to scan'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.post('/api/images/scan', { imageId }, { env: environmentId }));
    }
  );

  registerTool(server, 'export_image', 'Export a Docker image as a tar archive (filesystem extraction to disk); for vulnerability analysis use `scan_image` instead, and use `pull_image` if the image is not yet present locally.',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.get(`/api/images/${encodePath(imageId)}/export`, { env: environmentId }));
    }
  );

  registerTool(server, 'list_image_scans', 'List the cached vulnerability-scan results across all images in an environment (read-only summary view); contrast with `scan_image` (POST) which actually runs a fresh scan for a single image, or `get_image_history` for layer provenance instead of CVE data.',
    {
      environmentId: z.number().describe('Environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/images/scan', { env: environmentId }));
    }
  );
}
