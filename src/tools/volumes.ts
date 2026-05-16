/**
 * Docker volume management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerVolumeTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_volumes', 'List all Docker volumes in an environment; use `get_volume` for a single volume summary or `inspect_volume` for full JSON details.',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/volumes', { env: environmentId }));
    }
  );

  registerTool(server, 'get_volume', 'Return a summary of a named Docker volume (name, driver, mountpoint, labels); use `inspect_volume` for the full low-level docker-inspect JSON payload.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodePath(volumeName)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'inspect_volume', 'Return the full docker-inspect JSON for a volume, including scope, options, and status fields not exposed by `get_volume`.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodePath(volumeName)}/inspect`, { env: environmentId }));
    }
  );

  registerTool(server, 'browse_volume', 'Acquire a browse session and list files inside a Docker volume at a given path; call `release_volume_browse` when done to tear down the helper container.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
      path: z.string().optional().describe('Path inside the volume (default: /)'),
    },
    async ({ environmentId, volumeName, path }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodePath(volumeName)}/browse`, {
        env: environmentId,
        path: path ?? '/',
      }));
    }
  );

  registerTool(server, 'get_volume_file_content', 'Read the text content of a single file inside a Docker volume; requires an active `browse_volume` session on the same volume.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
      path: z.string().describe('File path inside the volume'),
    },
    async ({ environmentId, volumeName, path }) => {
      const data = await client.get(`/api/volumes/${encodePath(volumeName)}/browse/content`, {
        env: environmentId,
        path,
      });
      return textResponse(data);
    }
  );

  registerTool(server, 'release_volume_browse', 'Release the browse session opened by `browse_volume`, stopping and removing the ephemeral helper container to free resources.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.post(`/api/volumes/${encodePath(volumeName)}/browse/release`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'clone_volume', 'Create a new Docker volume as a full data copy of the source volume; unlike `export_volume` this produces a live volume rather than a tar archive.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Source volume name'),
      newName: z.string().optional().describe('Name for the cloned volume'),
    },
    async ({ environmentId, volumeName, newName }) => {
      const body: Record<string, unknown> = {};
      if (newName) body.newName = newName;
      return jsonResponse(await client.post(`/api/volumes/${encodePath(volumeName)}/clone`, body, { env: environmentId }));
    }
  );

  registerTool(server, 'export_volume', 'Export the contents of a Docker volume as a downloadable tar archive; use `clone_volume` instead to duplicate data into a new live volume.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodePath(volumeName)}/export`, { env: environmentId }));
    }
  );

  registerTool(server, 'remove_volume', 'Permanently delete a Docker volume and all its data (destructive, irreversible); ensure no containers are using it before calling; see `list_volumes` to confirm the volume name.',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.delete(`/api/volumes/${encodePath(volumeName)}`, { env: environmentId }));
    }
  );
}
