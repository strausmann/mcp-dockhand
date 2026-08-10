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

  registerTool(server, 'list_containers',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers', { env: environmentId }));
    }
  );

  registerTool(server, 'get_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}`, { env: environmentId }));
    }
  );

  registerTool(server, 'inspect_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/inspect`, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_logs',
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

  registerTool(server, 'get_container_stats',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/stats`, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_top',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/top`, { env: environmentId }));
    }
  );

  registerTool(server, 'start_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/start`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'stop_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/stop`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'restart_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/restart`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'pause_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/pause`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'unpause_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/unpause`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'rename_container',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      name: z.string().describe('New container name'),
    },
    async ({ environmentId, containerId, name }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/rename`, { name }, { env: environmentId }));
    }
  );

  registerTool(server, 'update_container',
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

  registerTool(server, 'create_container',
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

  registerTool(server, 'get_container_shells',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
    },
    async ({ environmentId, containerId }) => {
      return jsonResponse(await client.get(`/api/containers/${encodePath(containerId)}/shells`, { env: environmentId }));
    }
  );

  // --- Container Files ---

  registerTool(server, 'list_container_files',
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

  registerTool(server, 'get_container_file_content',
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

  registerTool(server, 'create_container_file',
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

  registerTool(server, 'delete_container_file',
    {
      environmentId: z.number().describe('Environment ID'),
      containerId: z.string().describe('Container ID'),
      path: z.string().describe('File path inside container'),
    },
    async ({ environmentId, containerId, path }) => {
      return jsonResponse(await client.delete(`/api/containers/${encodePath(containerId)}/files/delete`, { env: environmentId, path }));
    }
  );

  registerTool(server, 'rename_container_file',
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

  registerTool(server, 'chmod_container_file',
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

  registerTool(server, 'download_container_file',
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
  registerTool(server, 'upload_container_file',
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

  registerTool(server, 'check_container_updates',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/containers/check-updates', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'get_pending_updates',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/pending-updates', { env: environmentId }));
    }
  );

  registerTool(server, 'batch_update_containers',
    {
      environmentId: z.number().describe('Environment ID'),
      containerIds: z.array(z.string()).describe('Array of container IDs to update'),
    },
    async ({ environmentId, containerIds }) => {
      return jsonResponse(await client.postSSE('/api/containers/batch-update', { containerIds }, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_sizes',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/sizes', { env: environmentId }));
    }
  );

  registerTool(server, 'get_containers_stats',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/stats', { env: environmentId }));
    }
  );

  // --- Destructive / advanced ops ---

  registerTool(server, 'delete_container',
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

  registerTool(server, 'exec_container',
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

  registerTool(server, 'write_container_file_content',
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

  registerTool(server, 'batch_update_containers_stream',
    {
      environmentId: z.number().describe('Environment ID'),
      containerIds: z.array(z.string()).describe('Array of container IDs to update'),
    },
    async ({ environmentId, containerIds }) => {
      return jsonResponse(await client.postSSE('/api/containers/batch-update-stream', { containerIds }, { env: environmentId }));
    }
  );

  registerTool(server, 'clear_pending_updates',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.delete('/api/containers/pending-updates', { env: environmentId }));
    }
  );

  registerTool(server, 'update_container_runtime',
    {
      containerId: z.string().describe('Container ID or name'),
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.string(), z.unknown()).describe('Runtime configuration to apply. Accepted keys (Docker in-place update allowlist): RestartPolicy, CpuShares, CpuPeriod, CpuQuota, CpuRealtimePeriod, CpuRealtimeRuntime, CpusetCpus, CpusetMems, NanoCpus, Memory, MemorySwap, MemoryReservation, MemorySwappiness, KernelMemory, BlkioWeight, BlkioWeightDevice, BlkioDeviceReadBps, BlkioDeviceWriteBps, BlkioDeviceReadIOps, BlkioDeviceWriteIOps, PidsLimit. Any other key is silently ignored by the server, not an error.'),
    },
    async ({ containerId, environmentId, config }) => {
      return jsonResponse(await client.post(`/api/containers/${encodePath(containerId)}/update-runtime`, config, { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_update_check',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/containers/check-updates', { env: environmentId }));
    }
  );
}
