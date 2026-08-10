/**
 * Container management tools (20+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

/**
 * Keys accepted in `update_container`'s `settings` fallback (#142).
 *
 * Source of truth: Finsys/dockhand v1.0.41 (commit 905c4a0).
 *   - `startAfterUpdate` / `repullImage` are top-level control flags the handler
 *     destructures out of the request body BEFORE the rest is treated as
 *     `CreateContainerOptions` (src/routes/api/containers/[id]/update/+server.ts:26
 *     `const { startAfterUpdate, repullImage, ...options } = body;`).
 *   - Everything else must match a `CreateContainerOptions` field
 *     (src/lib/server/docker.ts:1351-1453) exactly, or Dockhand silently drops it
 *     while still recreating the container (see `createContainer()`, which only
 *     ever reads named fields off `options` — an unknown key like `command`
 *     instead of `cmd` is never referenced anywhere and has no effect).
 *
 * Update this set when re-validating against a newer Dockhand release
 * (.claude/skills/dockhand-mcp-dev/references/upstream-validation.md).
 */
const UPDATE_CONTAINER_ALLOWED_SETTINGS_KEYS = new Set([
  // top-level control flags, not part of CreateContainerOptions
  'startAfterUpdate', 'repullImage',
  // CreateContainerOptions fields
  'name', 'image', 'ports', 'volumes', 'volumeBinds', 'env', 'labels', 'cmd',
  'entrypoint', 'workingDir', 'restartPolicy', 'restartMaxRetries', 'networkMode',
  'additionalNetworks', 'networks', 'networkAliases', 'networkIpv4Address',
  'networkIpv6Address', 'networkGwPriority', 'networkConfigs', 'user', 'privileged',
  'healthcheck', 'memory', 'memoryReservation', 'memorySwap', 'cpuShares', 'cpuQuota',
  'cpuPeriod', 'nanoCpus', 'capAdd', 'capDrop', 'devices', 'dns', 'dnsSearch',
  'dnsOptions', 'securityOpt', 'ulimits', 'tty', 'stdinOpen', 'oomKillDisable',
  'pidsLimit', 'shmSize', 'tmpfs', 'sysctls', 'logDriver', 'logOptions', 'ipcMode',
  'pidMode', 'utsMode', 'hostname', 'cgroupParent', 'stopSignal', 'init',
  'stopTimeout', 'macAddress', 'extraHosts', 'deviceRequests', 'runtime',
  'readonlyRootfs', 'cpusetCpus', 'cpusetMems', 'groupAdd', 'memorySwappiness',
  'usernsMode', 'domainname',
]);

/**
 * Fields accepted by `update_container_runtime`'s in-place update, i.e.
 * Docker's `POST /containers/{id}/update` — the only Docker API that
 * changes container properties without recreating the container.
 *
 * Source of truth: Finsys/dockhand v1.0.41 (commit 905c4a0),
 * `IN_PLACE_UPDATE_FIELDS` in src/lib/server/docker.ts:1236-1280. Dockhand
 * filters the request body against exactly this allowlist server-side and
 * silently drops anything outside it (not an error) — by design, so a
 * caller cannot sneak a recreate-only field (image, env, ports, ...)
 * through this path (src/routes/api/containers/[id]/update-runtime/+server.ts).
 *
 * This tool still sends `config` unfiltered (`z.record`) and lets the
 * server enforce the allowlist (#155 keeps this non-breaking) — this
 * constant exists only to name the accepted keys in the tool/schema
 * description below, and to anchor the regression test in
 * tests/update-container-runtime-fields.test.ts.
 *
 * Update this list (and the description strings below) when re-validating
 * against a newer Dockhand release
 * (.claude/skills/dockhand-mcp-dev/references/upstream-validation.md).
 */
export const UPDATE_CONTAINER_RUNTIME_ACCEPTED_FIELDS = [
  // Restart policy — the headline use case (dockhand#1153)
  'RestartPolicy',
  // CPU
  'CpuShares', 'CpuPeriod', 'CpuQuota', 'CpuRealtimePeriod', 'CpuRealtimeRuntime',
  'CpusetCpus', 'CpusetMems', 'NanoCpus',
  // Memory
  'Memory', 'MemorySwap', 'MemoryReservation', 'MemorySwappiness', 'KernelMemory',
  // Block I/O
  'BlkioWeight', 'BlkioWeightDevice',
  'BlkioDeviceReadBps', 'BlkioDeviceWriteBps',
  'BlkioDeviceReadIOps', 'BlkioDeviceWriteIOps',
  // Misc
  'PidsLimit',
] as const;

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

  registerTool(server, 'update_container', 'Recreate a single container with updated settings for a specific container ID. Explicit parameters cover the common fields (image, cmd, entrypoint, env, labels, restartPolicy, networkMode, workingDir, startAfterUpdate); `settings` is a fallback for the remaining CreateContainerOptions fields (e.g. ports, volumeBinds, healthcheck, memory limits, repullImage) and is merged underneath the explicit parameters. Unrecognized `settings` keys are rejected — Dockhand silently ignores fields that do not match its own field names while still recreating the container (e.g. "cmd", not "command"). At least one field is required: Dockhand always recreates the container and has no meaningful no-argument update. Use `batch_update_containers` to pull the latest image for multiple containers at once, or `rename_container` to change only the container name.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      image: z.string().optional().describe('Docker image (e.g. nginx:alpine)'),
      cmd: z.array(z.string()).optional().describe('Command to run, overriding the image default (e.g. ["sleep", "7200"])'),
      entrypoint: z.array(z.string()).optional().describe('Entrypoint override'),
      env: z.array(z.string()).optional().describe('Environment variables (KEY=VALUE format)'),
      labels: z.record(z.string(), z.string()).optional().describe('Container labels'),
      restartPolicy: z.string().optional().describe('Restart policy (e.g. unless-stopped)'),
      networkMode: z.string().optional().describe('Network mode'),
      workingDir: z.string().optional().describe('Working directory inside the container'),
      startAfterUpdate: z.boolean().optional().describe('Start the recreated container after updating'),
      settings: z.record(z.string(), z.unknown()).optional().describe('Additional CreateContainerOptions fields not covered above (e.g. ports, volumeBinds, healthcheck, memory, capAdd, repullImage); merged underneath the explicit parameters, unrecognized keys are rejected'),
    },
    async ({ environmentId, containerId, image, cmd, entrypoint, env: envVars, labels, restartPolicy, networkMode, workingDir, startAfterUpdate, settings }) => {
      if (settings) {
        const unknownKeys = Object.keys(settings).filter((key) => !UPDATE_CONTAINER_ALLOWED_SETTINGS_KEYS.has(key));
        if (unknownKeys.length > 0) {
          throw new Error(
            `update_container: settings contains unrecognized key(s): ${unknownKeys.join(', ')}. ` +
            'Dockhand silently drops fields that do not match its CreateContainerOptions field names ' +
            'while still recreating the container — double-check the field name (e.g. "cmd", not "command").'
          );
        }
      }

      const body: Record<string, unknown> = {};
      if (settings) Object.assign(body, settings);
      if (image !== undefined) body.image = image;
      if (cmd !== undefined) body.cmd = cmd;
      if (entrypoint !== undefined) body.entrypoint = entrypoint;
      if (envVars !== undefined) body.env = envVars;
      if (labels !== undefined) body.labels = labels;
      if (restartPolicy !== undefined) body.restartPolicy = restartPolicy;
      if (networkMode !== undefined) body.networkMode = networkMode;
      if (workingDir !== undefined) body.workingDir = workingDir;
      if (startAfterUpdate !== undefined) body.startAfterUpdate = startAfterUpdate;

      if (Object.keys(body).length === 0) {
        throw new Error(
          'update_container requires at least one field to update (e.g. image, cmd, restartPolicy, ' +
          'or settings) — Dockhand always recreates the container and has no meaningful no-argument update.'
        );
      }

      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/update`, body, { env: environmentId }));
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

  registerTool(server, 'create_container_file', 'Create an empty file or an empty directory at the specified path inside a container; the real endpoint does NOT accept content — use `write_container_file_content` to create a file WITH content, `get_container_file_content` to read an existing file, or `delete_container_file` to remove it.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File or directory path inside container'),
      type: z.enum(['file', 'directory']).describe('Whether to create an empty file or a directory (required by the real endpoint)'),
    },
    async ({ environmentId, containerId, path, type }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/files/create`, { path, type }, { env: environmentId }));
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
  registerTool(server, 'upload_container_file', 'Upload a file into a container as multipart form data; for binary files pass content as base64 and set encoding to "base64". Use `download_container_file` to retrieve a file from the container, `write_container_file_content` to write plain-text content directly, or `list_container_files` to confirm the target path.',
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

      return jsonResponse(await client.postMultipart(`/api/containers/${encodePath(containerId)}/files/upload`, formData, { env: environmentId, path }));
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

  registerTool(server, 'batch_update_containers', 'Pull the latest images and recreate multiple containers in one operation by supplying an array of container IDs; contrast with `update_container` which targets a single container ID. Use `check_container_updates` to discover which containers have newer images, or `execute_batch` for other bulk lifecycle operations (start/stop/restart/remove/etc.) across containers, images, volumes, networks, or stacks.',
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

  // --- Destructive / advanced ops ---

  registerTool(server, 'delete_container', 'Permanently delete a container (optionally force-killing it first); contrast with `stop_container` which leaves the container around for inspection. Use `list_containers` to find the ID first; for batch removal across multiple containers, see `batch_update_containers` (recreate cycle).',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID to delete'),
      force: z.boolean().optional().describe('Force-kill the container first if it is running'),
    },
    async ({ environmentId, containerId, force }) => {
      const query: Record<string, string | number | undefined> = { env: environmentId };
      if (force) query.force = 'true';
      return jsonResponse(await client.delete(`/api/containers/${encodePath(containerId)}`, query));
    }
  );

  registerTool(server, 'exec_container', 'Create a Docker exec instance for terminal attachment inside a running container (like opening a `docker exec -it` session) and return an execId plus WebSocket connectionInfo for a terminal client to attach to. This does NOT run a one-shot command and does NOT return output — the Dockhand REST API has no endpoint for arbitrary command execution with captured output; only the `shell` to attach and the `user` to run as are honored. Use `get_container_shells` to discover available shells first, or `get_container_logs`/`get_container_top` if you need output or process info without an interactive session.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      shell: z.string().optional().describe('Shell executable to exec into (default: /bin/sh); see `get_container_shells` for what is available'),
      user: z.string().optional().describe('User to exec as (e.g. "root" or "1000:1000")'),
    },
    async ({ environmentId, containerId, shell, user }) => {
      const body: Record<string, unknown> = {};
      if (shell) body.shell = shell;
      if (user) body.user = user;
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/exec`, body, { envId: environmentId }));
    }
  );

  registerTool(server, 'write_container_file_content', 'Overwrite or create a file inside a container with plain-text content via PUT (idempotent compared to `create_container_file` which uses POST and may fail if the file exists). Use `get_container_file_content` to read the file back, `upload_container_file` for binary content, or `delete_container_file` to remove it.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('Absolute path to the target file inside the container'),
      content: z.string().describe('Plain-text content to write'),
    },
    async ({ environmentId, containerId, path, content }) => {
      return jsonResponse(await client.put(`/api/containers/${encodePath(containerId)}/files/content`, { content }, { env: environmentId, path }));
    }
  );

  registerTool(server, 'batch_update_containers_stream', 'Streaming variant of `batch_update_containers` — pulls latest images and recreates multiple containers while emitting progress events via Server-Sent Events; use this when you want incremental log output, otherwise `batch_update_containers` returns the same result without the stream. Discover candidates first via `check_container_updates` and `get_pending_updates`.',
    {
      environmentId: z.number().describe('Environment ID'),
      containerIds: z.array(z.string()).describe('Array of container IDs to update'),
    },
    async ({ environmentId, containerIds }) => {
      return jsonResponse(await client.postSSE('/api/containers/batch-update-stream', { containerIds }, { env: environmentId }));
    }
  );

  registerTool(server, 'clear_pending_updates', 'Permanently clear the cached pending-updates list for an environment, forcing the next `check_container_updates` call to re-probe the registry from scratch; use `get_pending_updates` to inspect the cache before clearing.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.delete('/api/containers/pending-updates', { env: environmentId }));
    }
  );

  registerTool(server, 'update_container_runtime', 'Update the runtime configuration (restart policy, CPU/memory limits, block I/O weights, pids limit) of an existing container in place via Docker native update API, never recreating the container. Accepts config keys RestartPolicy, CpuShares, CpuPeriod, CpuQuota, CpuRealtimePeriod, CpuRealtimeRuntime, CpusetCpus, CpusetMems, NanoCpus, Memory, MemorySwap, MemoryReservation, MemorySwappiness, KernelMemory, BlkioWeight, BlkioWeightDevice, BlkioDeviceReadBps, BlkioDeviceWriteBps, BlkioDeviceReadIOps, BlkioDeviceWriteIOps, PidsLimit; any other key is silently ignored by the server, not an error. For image or environment changes use `update_container`, and for lifecycle actions see `restart_container`.',
    {
      containerId: z.string().describe('Container ID or name'),
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.string(), z.unknown()).describe('Runtime configuration to apply. Accepted keys (Docker in-place update allowlist): RestartPolicy, CpuShares, CpuPeriod, CpuQuota, CpuRealtimePeriod, CpuRealtimeRuntime, CpusetCpus, CpusetMems, NanoCpus, Memory, MemorySwap, MemoryReservation, MemorySwappiness, KernelMemory, BlkioWeight, BlkioWeightDevice, BlkioDeviceReadBps, BlkioDeviceWriteBps, BlkioDeviceReadIOps, BlkioDeviceWriteIOps, PidsLimit. Any other key is silently ignored by the server, not an error.'),
    },
    async ({ containerId, environmentId, config }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/update-runtime`, config, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_update_check', 'Read the current image-update-check result for containers without re-probing the registry; run `check_container_updates` to refresh it or `get_pending_updates` for the pending list.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/check-updates', { env: environmentId }));
    }
  );
}
