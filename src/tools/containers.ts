/**
 * Container management tools (20+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerContainerTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_containers',
    'List all containers in a Dockhand environment',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      const data = await client.get('/api/containers', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container',
    'Get details of a specific container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.get(`/api/containers/${containerId}`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'inspect_container',
    'Docker inspect a container (full low-level details)',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.get(`/api/containers/${containerId}/inspect`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container_logs',
    'Get logs of a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      tail: z.number().optional().describe('Number of lines from the end (default: 100)'),
    },
    async ({ environmentId, containerId, tail }) => {
      const data = await client.get(`/api/containers/${containerId}/logs`, {
        env: environmentId,
        tail: tail ?? 100,
      });
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container_stats',
    'Get resource usage statistics of a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.get(`/api/containers/${containerId}/stats`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container_top',
    'Get running processes inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.get(`/api/containers/${containerId}/top`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'start_container',
    'Start a stopped container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.post(`/api/containers/${containerId}/start`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'stop_container',
    'Stop a running container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.post(`/api/containers/${containerId}/stop`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'restart_container',
    'Restart a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.post(`/api/containers/${containerId}/restart`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'pause_container',
    'Pause a running container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.post(`/api/containers/${containerId}/pause`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'unpause_container',
    'Unpause a paused container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.post(`/api/containers/${containerId}/unpause`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'rename_container',
    'Rename a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      name: z.string().describe('New container name'),
    },
    async ({ environmentId, containerId, name }) => {
      const data = await client.post(`/api/containers/${containerId}/rename`, { name }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_container',
    'Update a container (recreate with new settings)',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      settings: z.record(z.unknown()).optional().describe('Container settings to update'),
    },
    async ({ environmentId, containerId, settings }) => {
      const data = await client.post(`/api/containers/${containerId}/update`, settings, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_container',
    'Create a new container directly (without Compose)',
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

      const data = await client.post('/api/containers', body, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container_shells',
    'Get available shells inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      const data = await client.get(`/api/containers/${containerId}/shells`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Container Files ---

  server.tool(
    'list_container_files',
    'List files inside a container at a given path',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().optional().describe('Path inside container (default: /)'),
    },
    async ({ environmentId, containerId, path }) => {
      const data = await client.get(`/api/containers/${containerId}/files`, {
        env: environmentId,
        path: path ?? '/',
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_container_file_content',
    'Read file content inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
    },
    async ({ environmentId, containerId, path }) => {
      const data = await client.get(`/api/containers/${containerId}/files/content`, {
        env: environmentId,
        path,
      });
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_container_file',
    'Create a file inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
      content: z.string().describe('File content'),
    },
    async ({ environmentId, containerId, path, content }) => {
      const data = await client.post(`/api/containers/${containerId}/files/create`, { path, content }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_container_file',
    'Delete a file inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
    },
    async ({ environmentId, containerId, path }) => {
      const data = await client.post(`/api/containers/${containerId}/files/delete`, { path }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'rename_container_file',
    'Rename a file inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      oldPath: z.string().describe('Current file path'),
      newPath: z.string().describe('New file path'),
    },
    async ({ environmentId, containerId, oldPath, newPath }) => {
      const data = await client.post(`/api/containers/${containerId}/files/rename`, { oldPath, newPath }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'chmod_container_file',
    'Change file permissions inside a container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
      mode: z.string().describe('Permission mode (e.g. 0755)'),
    },
    async ({ environmentId, containerId, path, mode }) => {
      const data = await client.post(`/api/containers/${containerId}/files/chmod`, { path, mode }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Global container endpoints ---

  server.tool(
    'check_container_updates',
    'Check all containers for available image updates',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post('/api/containers/check-updates', undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_pending_updates',
    'Get containers with pending image updates',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get('/api/containers/pending-updates', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'batch_update_containers',
    'Batch update multiple containers to their latest images',
    {
      environmentId: z.number().describe('Environment ID'),
      containerIds: z.array(z.string()).describe('Array of container IDs to update'),
    },
    async ({ environmentId, containerIds }) => {
      const result = await client.postSSE('/api/containers/batch-update', { containerIds }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'get_container_sizes',
    'Get disk sizes of all containers',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get('/api/containers/sizes', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_containers_stats',
    'Get aggregated stats for all containers',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get('/api/containers/stats', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
