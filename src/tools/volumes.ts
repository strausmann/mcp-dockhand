/**
 * Docker volume management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerVolumeTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_volumes', 'List all Docker volumes in an environment',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/volumes', { env: environmentId }));
    }
  );

  registerTool(server, 'get_volume', 'Get details of a specific Docker volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodeURIComponent(volumeName)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'inspect_volume', 'Inspect a Docker volume (full low-level details)',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodeURIComponent(volumeName)}/inspect`, { env: environmentId }));
    }
  );

  registerTool(server, 'browse_volume', 'Browse files inside a Docker volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
      path: z.string().optional().describe('Path inside the volume (default: /)'),
    },
    async ({ environmentId, volumeName, path }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodeURIComponent(volumeName)}/browse`, {
        env: environmentId,
        path: path ?? '/',
      }));
    }
  );

  registerTool(server, 'get_volume_file_content', 'Read file content from a Docker volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
      path: z.string().describe('File path inside the volume'),
    },
    async ({ environmentId, volumeName, path }) => {
      const data = await client.get(`/api/volumes/${encodeURIComponent(volumeName)}/browse/content`, {
        env: environmentId,
        path,
      });
      return textResponse(data);
    }
  );

  registerTool(server, 'release_volume_browse', 'Release a volume browse session (cleanup helper container)',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.post(`/api/volumes/${encodeURIComponent(volumeName)}/browse/release`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'clone_volume', 'Clone a Docker volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Source volume name'),
      newName: z.string().optional().describe('Name for the cloned volume'),
    },
    async ({ environmentId, volumeName, newName }) => {
      const body: Record<string, unknown> = {};
      if (newName) body.newName = newName;
      return jsonResponse(await client.post(`/api/volumes/${encodeURIComponent(volumeName)}/clone`, body, { env: environmentId }));
    }
  );

  registerTool(server, 'export_volume', 'Export a Docker volume as a tarball',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.post(`/api/volumes/${encodeURIComponent(volumeName)}/export`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'remove_volume', 'Remove a Docker volume (DESTRUCTIVE - data will be lost!)',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.delete(`/api/volumes/${encodeURIComponent(volumeName)}`, { env: environmentId }));
    }
  );
}
