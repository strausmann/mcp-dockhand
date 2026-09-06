/**
 * Image management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerImageTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_images',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/images', { env: environmentId }));
    }
  );

  // POST /api/images/load - `docker load` from an uploaded tar, for air-gapped hosts.
  // The real endpoint's request BODY IS the raw tar bytes (Content-Type
  // application/x-tar), streamed straight to the daemon - not a JSON body and not
  // multipart/form-data. Verified against src/routes/api/images/load/+server.ts: local/
  // socket or direct TCP only (rejects Hawser server-side).
  //
  // `tarContent` itself, however, DOES travel inside the MCP request's own JSON body
  // (the whole point of base64-encoding it) — and that JSON body is bounded by the
  // server's own /mcp request-body limit (MCP_MAX_REQUEST_BODY_BYTES, default 100 MB;
  // see request-body-limit.ts). A tar larger than that limit, once base64-inflated by
  // ~33%, is rejected with HTTP 413 before this tool ever runs — load a larger image
  // tar directly on the Docker host instead (e.g. `docker load -i file.tar`).
  registerTool(server, 'load_image',
    {
      environmentId: z.number().optional().describe('Target environment ID (omit for the local/default Docker host); rejected server-side if the environment is Hawser-connected'),
      tarContent: z.string().describe('Base64-encoded Docker image tar, e.g. the output of `docker save`. Must fit within the server\'s /mcp request-body limit (MCP_MAX_REQUEST_BODY_BYTES, default 100 MB) once base64-inflated (~33% larger than the raw tar) — larger archives should be loaded directly on the Docker host instead'),
    },
    async ({ environmentId, tarContent }) => {
      const buffer = Buffer.from(tarContent, 'base64');
      return jsonResponse(
        await client.postRawBody('/api/images/load', buffer, 'application/x-tar', { env: environmentId })
      );
    }
  );

  registerTool(server, 'get_image_history',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.get(`/api/images/${encodePath(imageId)}/history`, { env: environmentId }));
    }
  );

  registerTool(server, 'tag_image',
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

  registerTool(server, 'remove_image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.delete(`/api/images/${encodePath(imageId)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'pull_image',
    {
      environmentId: z.number().describe('Environment ID'),
      image: z.string().describe('Image name with tag (e.g. nginx:latest)'),
    },
    async ({ environmentId, image }) => {
      return jsonResponse(await client.post('/api/images/pull', { image }, { env: environmentId }));
    }
  );

  registerTool(server, 'push_image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Local image ID to push (required by the real endpoint)'),
      registryId: z.number().describe('Target registry ID (required by the real endpoint)'),
      imageName: z.string().optional().describe('Source tag to push if the image has multiple/no resolvable tag (falls back to the image\'s first RepoTag)'),
      newTag: z.string().optional().describe('Custom target tag/name in the registry (default: derived from the source image name)'),
    },
    async ({ environmentId, imageId, registryId, imageName, newTag }) => {
      const body: Record<string, unknown> = { imageId, registryId };
      if (imageName !== undefined) body.imageName = imageName;
      if (newTag !== undefined) body.newTag = newTag;
      return jsonResponse(await client.post('/api/images/push', body, { env: environmentId }));
    }
  );

  registerTool(server, 'scan_image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageName: z.string().describe('Image name/reference to scan (required by the real endpoint)'),
      scanner: z.enum(['grype', 'trivy']).optional().describe('Force a specific scanner instead of the configured default'),
    },
    async ({ environmentId, imageName, scanner }) => {
      const body: Record<string, unknown> = { imageName };
      if (scanner !== undefined) body.scanner = scanner;
      return jsonResponse(await client.post('/api/images/scan', body, { env: environmentId }));
    }
  );

  registerTool(server, 'export_image',
    {
      environmentId: z.number().describe('Environment ID'),
      imageId: z.string().describe('Image ID'),
    },
    async ({ environmentId, imageId }) => {
      return jsonResponse(await client.get(`/api/images/${encodePath(imageId)}/export`, { env: environmentId }));
    }
  );

  registerTool(server, 'list_image_scans',
    {
      image: z.string().describe('Image name/reference to look up (required by the real endpoint)'),
      environmentId: z.number().optional().describe('Environment ID'),
      scanner: z.enum(['grype', 'trivy']).optional().describe('Filter the cached result by scanner type'),
    },
    async ({ image, environmentId, scanner }) => {
      const query: Record<string, string | number | undefined> = { image };
      if (environmentId !== undefined) query.env = environmentId;
      if (scanner) query.scanner = scanner;
      return jsonResponse(await client.get('/api/images/scan', query));
    }
  );

  registerTool(server, 'export_image_scan',
    {
      environmentId: z.number().describe('Environment ID'),
      format: z.string().optional().describe('Export format, e.g. "json" or "csv"'),
      image: z.string().optional().describe('Image name/reference to export the scan for'),
      imageId: z.string().optional().describe('Image ID to export the scan for'),
    },
    async ({ environmentId, format, image, imageId }) => {
      return jsonResponse(await client.get('/api/images/scan/export', { env: environmentId, format, image, imageId }));
    }
  );
}
