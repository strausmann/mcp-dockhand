/**
 * Docker volume management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerVolumeTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_volumes',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/volumes', { env: environmentId }));
    }
  );

  registerTool(server, 'get_volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodePath(volumeName)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'inspect_volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodePath(volumeName)}/inspect`, { env: environmentId }));
    }
  );

  registerTool(server, 'browse_volume',
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

  registerTool(server, 'get_volume_file_content',
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

  registerTool(server, 'release_volume_browse',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.post(`/api/volumes/${encodePath(volumeName)}/browse/release`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'clone_volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Source volume name'),
      name: z.string().describe('Name for the cloned volume (required by the real endpoint)'),
    },
    async ({ environmentId, volumeName, name }) => {
      return jsonResponse(await client.post(`/api/volumes/${encodePath(volumeName)}/clone`, { name }, { env: environmentId }));
    }
  );

  registerTool(server, 'export_volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.get(`/api/volumes/${encodePath(volumeName)}/export`, { env: environmentId }));
    }
  );

  registerTool(server, 'remove_volume',
    {
      environmentId: z.number().describe('Environment ID'),
      volumeName: z.string().describe('Volume name'),
    },
    async ({ environmentId, volumeName }) => {
      return jsonResponse(await client.delete(`/api/volumes/${encodePath(volumeName)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'create_volume',
    {
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.string(), z.unknown()).describe('Volume creation payload (e.g. {name, driver, driverOpts, labels})'),
    },
    async ({ environmentId, config }) => {
      return jsonResponse(await client.post('/api/volumes', config, { env: environmentId }));
    }
  );
}
