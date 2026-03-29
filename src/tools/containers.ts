/**
 * Container management tools (20+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerContainerTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_containers', 'List all containers in a Dockhand environment',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers', { env: environmentId }));
    }
  );

  registerTool(server, 'get_container', 'Get details of a specific container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'inspect_container', 'Docker inspect a container (full low-level details)',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/inspect`, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_logs', 'Get logs of a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      tail: z.number().optional().describe('Number of lines from the end (default: 100)'),
    },
    async ({ environmentId, containerId, tail }) => {
      const data = await client.get(`/api/containers/${encodePath(containerId)}/logs`, {
        env: environmentId,
        tail: tail ?? 100,
      });
      return textResponse(data);
    }
  );

  registerTool(server, 'get_container_stats', 'Get resource usage statistics of a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/stats`, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_top', 'Get running processes inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/top`, { env: environmentId }));
    }
  );

  registerTool(server, 'start_container', 'Start a stopped container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/start`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'stop_container', 'Stop a running container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/stop`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'restart_container', 'Restart a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/restart`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'pause_container', 'Pause a running container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/pause`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'unpause_container', 'Unpause a paused container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/unpause`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'rename_container', 'Rename a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      name: z.string().describe('New container name'),
    },
    async ({ environmentId, containerId, name }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/rename`, { name }, { env: environmentId }));
    }
  );

  registerTool(server, 'update_container', 'Update a container (recreate with new settings)',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      settings: z.record(z.unknown()).optional().describe('Container settings to update'),
    },
    async ({ environmentId, containerId, settings }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/update`, settings, { env: environmentId }));
    }
  );

  registerTool(server, 'create_container', 'Create a new container directly (without Compose)',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Container name'),
      image: z.string().describe('Docker image (e.g. nginx:alpine)'),
      startAfterCreate: z.boolean().optional().describe('Start container after creation'),
      env: z.array(z.string()).optional().describe('Environment variables (KEY=VALUE format)'),
      ports: z.record(z.unknown()).optional().describe('Port bindings'),
      volumes: z.array(z.string()).optional().describe('Volume mounts'),
      restartPolicy: z.string().optional().describe('Restart policy (e.g. unless-stopped)'),
      networkMode: z.string().optional().describe('Network mode'),
      labels: z.record(z.string()).optional().describe('Container labels'),
    },
    async ({ environmentId, name, image, startAfterCreate, env: envVars, ports, volumes, restartPolicy, networkMode, labels }) => {
      const body: Record<string, unknown> = { name, image };
      if (startAfterCreate !== undefined) body.startAfterCreate = startAfterCreate;
      if (envVars) body.Env = envVars;
      if (labels) body.Labels = labels;
      const hostConfig: Record<string, unknown> = {};
      if (restartPolicy) hostConfig.RestartPolicy = { Name: restartPolicy };
      if (ports) hostConfig.PortBindings = ports;
      if (volumes) hostConfig.Binds = volumes;
      if (networkMode) hostConfig.NetworkMode = networkMode;
      if (Object.keys(hostConfig).length > 0) body.HostConfig = hostConfig;

      return jsonResponse(await client.post('/api/containers', body, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_shells', 'Get available shells inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/shells`, { env: environmentId }));
    }
  );

  // --- Container Files ---

  registerTool(server, 'list_container_files', 'List files inside a container at a given path',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().optional().describe('Path inside container (default: /)'),
    },
    async ({ environmentId, containerId, path }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/files`, {
        env: environmentId,
        path: path ?? '/',
      }));
    }
  );

  registerTool(server, 'get_container_file_content', 'Read file content inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
    },
    async ({ environmentId, containerId, path }) => {
      const data = await client.get(`/api/containers/${encodePath(containerId)}/files/content`, {
        env: environmentId,
        path,
      });
      return textResponse(data);
    }
  );

  registerTool(server, 'create_container_file', 'Create a file inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
      content: z.string().describe('File content'),
    },
    async ({ environmentId, containerId, path, content }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/files/create`, { path, content }, { env: environmentId }));
    }
  );

  registerTool(server, 'delete_container_file', 'Delete a file inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
    },
    async ({ environmentId, containerId, path }) => {
      return jsonResponse(await client.delete(`/api/containers/${encodePath(containerId)}/files/delete`, { env: environmentId, path }));
    }
  );

  registerTool(server, 'rename_container_file', 'Rename a file inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      oldPath: z.string().describe('Current file path'),
      newPath: z.string().describe('New file path'),
    },
    async ({ environmentId, containerId, oldPath, newPath }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/files/rename`, { oldPath, newPath }, { env: environmentId }));
    }
  );

  registerTool(server, 'chmod_container_file', 'Change file permissions inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
      mode: z.string().describe('Permission mode (e.g. 0755)'),
    },
    async ({ environmentId, containerId, path, mode }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/files/chmod`, { path, mode }, { env: environmentId }));
    }
  );

  // --- Container File Download / Upload ---

  registerTool(server, 'download_container_file', 'Download a file from a container. Returns the raw file content as base64-encoded data (the API returns a tar archive which is decoded automatically)',
    {
      environmentId: z.number().describe('Environment ID (required)'),
      containerId: z.string().describe('Container ID or name'),
      path: z.string().describe('Absolute path to the file inside the container'),
    },
    async ({ environmentId, containerId, path }) => {
      const buffer = await client.getRaw(`/api/containers/${encodePath(containerId)}/files/download`, {
        env: environmentId,
        path,
      });
      return textResponse(`base64:${buffer.toString('base64')}`);
    }
  );

  // Fix #30 (HIGH): Add encoding parameter for binary file support (PR #23).
  // When encoding is 'base64', content is decoded from base64 before upload.
  registerTool(server, 'upload_container_file', 'Upload a file to a container. The file content is sent as multipart form data. For binary files, pass content as base64 and set encoding to "base64".',
    {
      environmentId: z.number().describe('Environment ID (required)'),
      containerId: z.string().describe('Container ID or name'),
      path: z.string().describe('Absolute path to the target directory inside the container'),
      filename: z.string().describe('Name for the uploaded file'),
      content: z.string().describe('File content to upload (plain text or base64-encoded binary)'),
      encoding: z.enum(['utf-8', 'base64']).optional().describe('Content encoding: "utf-8" (default) for text, "base64" for binary data'),
    },
    async ({ environmentId, containerId, path, filename, content, encoding }) => {
      const formData = new FormData();
      const bytes = encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : new TextEncoder().encode(content);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      formData.append('files', blob, filename);

      return jsonResponse(await client.postMultipart(
        `/api/containers/${encodePath(containerId)}/files/upload`,
        formData,
        { env: environmentId, path },
      ));
    }
  );

  // --- Global container endpoints ---

  registerTool(server, 'check_container_updates', 'Check all containers for available image updates',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/containers/check-updates', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'get_pending_updates', 'Get containers with pending image updates',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/pending-updates', { env: environmentId }));
    }
  );

  registerTool(server, 'batch_update_containers', 'Batch update multiple containers to their latest images',
    {
      environmentId: z.number().describe('Environment ID'),
      containerIds: z.array(z.string()).describe('Array of container IDs to update'),
    },
    async ({ environmentId, containerIds }) => {
      return jsonResponse(await client.postSSE('/api/containers/batch-update', { containerIds }, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_sizes', 'Get disk sizes of all containers',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/sizes', { env: environmentId }));
    }
  );

  registerTool(server, 'get_containers_stats', 'Get aggregated stats for all containers',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/stats', { env: environmentId }));
    }
  );
}
