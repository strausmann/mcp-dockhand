/**
 * Container management tools (20+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerContainerTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_containers', 'List all containers in a Dockhand environment, returning summary fields for every container; use `get_container` for a single container\'s details or `inspect_container` for the full low-level Docker JSON.',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers', { env: environmentId }));
    }
  );

  registerTool(server, 'get_container', 'Retrieve the Dockhand summary record for a single container by ID, including status and image fields; use `inspect_container` for the full raw Docker-inspect JSON or `list_containers` to enumerate all containers.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'inspect_container', 'Return the full Docker-inspect JSON for a container (mounts, network settings, host config, and all low-level fields); contrast with `get_container` which returns only the Dockhand summary, or `get_container_stats` for live CPU and memory metrics.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/inspect`, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_logs', 'Fetch the stdout/stderr log tail from a single container, controlled by the optional `tail` line count; use `get_merged_logs` to interleave logs from multiple containers, or `get_container_top` to see the live process list instead.',
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

  registerTool(server, 'get_container_stats', 'Retrieve live CPU, memory, network I/O, and block I/O resource statistics for a single container; use `get_containers_stats` to get an aggregated snapshot across all containers, or `inspect_container` for full Docker-inspect data.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/stats`, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_top', 'Return the live process table (like `docker top`) for a single container, showing PIDs, CPU, and command lines; use `get_container_stats` for resource metrics or `get_container_logs` for log output.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/top`, { env: environmentId }));
    }
  );

  registerTool(server, 'start_container', 'Start a stopped or created container, resuming it from its current state; pair with `stop_container` to stop it again, or use `restart_container` to stop and start in one call.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/start`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'stop_container', 'Stop a running container by sending SIGTERM followed by SIGKILL after a grace period; use `start_container` to restart it, `pause_container` to freeze without stopping, or `restart_container` to stop and start in one call.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/stop`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'restart_container', 'Restart a container by stopping it and then starting it again in a single operation; use `stop_container` / `start_container` separately for finer control, or `pause_container` / `unpause_container` for a non-destructive freeze.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/restart`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'pause_container', 'Freeze all processes in a running container using cgroups freezer without stopping it; use `unpause_container` to resume, or `stop_container` to fully stop instead.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/pause`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'unpause_container', 'Resume all processes in a container that was frozen by `pause_container`, restoring it to the running state; use `start_container` if the container was stopped rather than paused.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/unpause`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'rename_container', 'Rename an existing container to a new name without recreating it; use `update_container` to change settings such as image or restart policy, or `create_container` to provision a new container from scratch.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      name: z.string().describe('New container name'),
    },
    async ({ environmentId, containerId, name }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/rename`, { name }, { env: environmentId }));
    }
  );

  registerTool(server, 'update_container', 'Recreate a single container with updated settings (image, environment, restart policy, etc.) for a specific container ID; use `batch_update_containers` to pull the latest image for multiple containers at once, or `rename_container` to change only the container name.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      settings: z.record(z.string(), z.unknown()).optional().describe('Container settings to update'),
    },
    async ({ environmentId, containerId, settings }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/update`, settings, { env: environmentId }));
    }
  );

  registerTool(server, 'create_container', 'Create a new standalone container directly without a Compose file, accepting image, ports, volumes, environment variables, and restart policy; use `start_container` afterwards to start it, or `update_container` to modify an existing container.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Container name'),
      image: z.string().describe('Docker image (e.g. nginx:alpine)'),
      startAfterCreate: z.boolean().optional().describe('Start container after creation'),
      env: z.array(z.string()).optional().describe('Environment variables (KEY=VALUE format)'),
      ports: z.record(z.string(), z.unknown()).optional().describe('Port bindings'),
      volumes: z.array(z.string()).optional().describe('Volume mounts'),
      restartPolicy: z.string().optional().describe('Restart policy (e.g. unless-stopped)'),
      networkMode: z.string().optional().describe('Network mode'),
      labels: z.record(z.string(), z.string()).optional().describe('Container labels'),
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

  registerTool(server, 'get_container_shells', 'Enumerate the shell executables available inside a container (e.g., bash, sh, ash) that can be used to open an interactive terminal; complement with `get_container_top` to inspect running processes or `get_container_logs` to read log output.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/shells`, { env: environmentId }));
    }
  );

  // --- Container Files ---

  registerTool(server, 'list_container_files', 'List the files and directories inside a container at a given path, defaulting to /; use `get_container_file_content` to read a file\'s content, `create_container_file` to write a new file, or `download_container_file` to retrieve a file as base64.',
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

  registerTool(server, 'get_container_file_content', 'Read and return the text content of a file at the specified path inside a container; use `list_container_files` to browse the directory tree first, `create_container_file` to write a file, or `download_container_file` for binary files returned as base64.',
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

  registerTool(server, 'create_container_file', 'Write a new file with the supplied content at the specified path inside a container; use `get_container_file_content` to read an existing file before overwriting, `delete_container_file` to remove a file, or `upload_container_file` to upload binary content.',
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

  registerTool(server, 'delete_container_file', 'Permanently delete a file at the specified path inside a container; use `list_container_files` to confirm the path first, `create_container_file` to recreate it if needed, or `rename_container_file` to move instead of delete.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
    },
    async ({ environmentId, containerId, path }) => {
      return jsonResponse(await client.delete(`/api/containers/${encodePath(containerId)}/files/delete`, { env: environmentId, path }));
    }
  );

  registerTool(server, 'rename_container_file', 'Rename or move a file inside a container by supplying the old and new paths; use `list_container_files` to browse paths, `chmod_container_file` to change permissions, or `delete_container_file` to remove a file entirely.',
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

  registerTool(server, 'chmod_container_file', 'Change the permission mode (e.g., 0755) of a file inside a container; use `list_container_files` to locate the file, `rename_container_file` to move it, or `get_container_file_content` to inspect its content.',
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

  registerTool(server, 'download_container_file', 'Download a file from a container as base64-encoded data (the API returns a tar archive that is decoded automatically); use `get_container_file_content` for plain-text files, `upload_container_file` to send a file into the container, or `list_container_files` to browse available paths.',
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
  registerTool(server, 'upload_container_file', 'Upload a file into a container as multipart form data; for binary files pass content as base64 and set encoding to "base64". Use `download_container_file` to retrieve a file from the container, `create_container_file` to write plain-text content directly, or `list_container_files` to confirm the target path.',
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

  registerTool(server, 'check_container_updates', 'Probe the registry now to check all containers for newer image versions and populate the update-detection cache; after this call, use `get_pending_updates` to retrieve the discovered list. For per-container policy, see `get_container_auto_update` and `set_container_auto_update`; for environment-wide defaults, see `get_auto_update_settings`.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/containers/check-updates', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'get_pending_updates', 'Retrieve the cached list of containers already discovered to have newer images available, without hitting the registry again; call `check_container_updates` first to refresh this cache. To read or change per-container auto-update policy, use `get_container_auto_update` and `set_container_auto_update`; for environment-wide defaults, see `get_auto_update_settings`.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/pending-updates', { env: environmentId }));
    }
  );

  registerTool(server, 'batch_update_containers', 'Pull the latest images and recreate multiple containers in one operation by supplying an array of container IDs; contrast with `update_container` which targets a single container ID. Use `check_container_updates` to discover which containers have newer images, or `list_batch_operations` to review pending batch history.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerIds: z.array(z.string()).describe('Array of container IDs to update'),
    },
    async ({ environmentId, containerIds }) => {
      return jsonResponse(await client.postSSE('/api/containers/batch-update', { containerIds }, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_sizes', 'Return the on-disk size for all containers in an environment, covering both the read-write layer and virtual image size; use `get_container_stats` for live CPU and memory usage of a single container, or `get_containers_stats` for aggregated runtime stats across all containers.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/sizes', { env: environmentId }));
    }
  );

  registerTool(server, 'get_containers_stats', 'Return aggregated CPU, memory, and I/O stats across all containers in an environment in one call; use `get_container_stats` to get detailed metrics for a single container, or `get_container_sizes` for on-disk size data.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/stats', { env: environmentId }));
    }
  );
}
