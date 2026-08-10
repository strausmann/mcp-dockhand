/**
 * System, health, settings, and pruning tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerSystemTools(server: McpServer, client: DockhandClient): void {

  // --- Health ---

  registerTool(server, 'health_check', 'Probe the Dockhand backend overall health endpoint (`GET /api/health`) and return its status; use `health_check_database` to specifically test database-layer connectivity inside the backend.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/health'));
    }
  );

  registerTool(server, 'health_check_database', 'Probe specifically the Dockhand backend database connection (`GET /api/health/database`) and return its health status; use `health_check` for the broader backend health check across all subsystems.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/health/database'));
    }
  );

  // --- System Info ---

  registerTool(server, 'get_host_info', 'Retrieve OS-level host details (hostname, OS, CPU, memory) of the Dockhand server; pair with `get_system_info` for application-level data or `get_system_disk` for storage capacity.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/host'));
    }
  );

  registerTool(server, 'get_system_info', 'Retrieve Dockhand application system information such as version, build, and runtime details; use `get_host_info` for underlying OS/hardware data or `get_system_disk` for disk usage.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/system'));
    }
  );

  registerTool(server, 'get_system_disk', 'Retrieve disk usage statistics for a Dockhand environment; use `get_host_info` for OS-level details or `get_general_settings` to read application-level configuration.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/system/disk', { env: environmentId }));
    }
  );

  registerTool(server, 'list_system_files', 'List the file and directory entries at a given path on the Dockhand server host; use `get_system_file_content` to read the contents of a specific file.',
    {
      path: z.string().optional().describe('Directory path'),
    },
    async ({ path }) => {
      return jsonResponse(await client.get('/api/system/files', path ? { path } : undefined));
    }
  );

  registerTool(server, 'get_system_file_content', 'Read and return the raw text content of a specific file on the Dockhand server host; use `list_system_files` to discover available files and paths first.',
    {
      path: z.string().describe('File path'),
    },
    async ({ path }) => {
      return textResponse(await client.get('/api/system/files/content', { path }));
    }
  );

  registerTool(server, 'get_changelog', 'Retrieve the Dockhand release changelog, listing version history, new features, and bug fixes for the running instance.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/changelog'));
    }
  );

  registerTool(server, 'get_dependencies', 'Retrieve the list of third-party software dependencies bundled with the running Dockhand instance, including versions and licenses.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dependencies'));
    }
  );

  // --- Settings ---

  registerTool(server, 'get_general_settings', 'Read the current general application settings for Dockhand; use `update_general_settings` to modify them, or `get_system_info` for read-only runtime/version data.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/general'));
    }
  );

  registerTool(server, 'update_general_settings', 'Write updated general application settings to Dockhand; use `get_general_settings` to read the current values before making changes.',
    {
      settings: z.record(z.string(), z.unknown()).describe('Settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.post('/api/settings/general', settings));
    }
  );

  registerTool(server, 'get_theme_settings', 'Retrieve the current UI theme configuration for the Dockhand dashboard, including color scheme and appearance preferences.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/theme'));
    }
  );

  registerTool(server, 'get_scanner_settings', 'Read the current vulnerability scanner configuration (Trivy/Grype) for Dockhand; use `update_scanner_settings` to change scanner behaviour or database paths.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/scanner'));
    }
  );

  registerTool(server, 'update_scanner_settings', 'Write updated vulnerability scanner settings (Trivy/Grype) to Dockhand; use `get_scanner_settings` to read the current configuration before applying changes.',
    {
      settings: z.record(z.string(), z.unknown()).describe('Scanner settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.post('/api/settings/scanner', settings));
    }
  );

  // --- License ---

  registerTool(server, 'get_license', 'Read the current operational license information for Dockhand (tier, expiry, seat count); use `activate_license` to register a new key or `get_legal_license` for open-source license text.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/license'));
    }
  );

  registerTool(server, 'activate_license', 'Activate a new Dockhand license by name and key, registering it with the backend to unlock the corresponding feature tier; use `get_license` to verify the result after activation.',
    {
      name: z.string().describe('License holder/organization name (required by the real endpoint alongside the key)'),
      licenseKey: z.string().describe('License key'),
    },
    async ({ name, licenseKey }) => {
      return jsonResponse(await client.post('/api/license', { name, key: licenseKey }));
    }
  );

  // --- Metrics ---

  registerTool(server, 'get_prometheus_metrics', 'Retrieve the Prometheus metrics exposition from Dockhand in text/plain format, suitable for scraping by a Prometheus server or quick manual inspection.',
    {},
    async () => {
      return textResponse(await client.get('/api/metrics'));
    }
  );

  // --- Pruning ---

  registerTool(server, 'prune_all', 'Delete all unused Docker resources in one operation — combines `prune_containers`, `prune_images`, `prune_volumes`, and `prune_networks`; DESTRUCTIVE and cannot be undone.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/all', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_containers', 'Remove all stopped Docker containers to reclaim disk space; DESTRUCTIVE — use `prune_all` to delete containers together with images, volumes, and networks in one call.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/containers', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_images', 'Delete unused (dangling and unreferenced) Docker images to reclaim disk space; DESTRUCTIVE — use `prune_all` to also remove stopped containers, volumes, and networks in one call.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/images', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_networks', 'Remove unused Docker networks that are not referenced by any container; DESTRUCTIVE — use `prune_all` to also prune containers, images, and volumes in a single operation.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/networks', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_volumes', 'Delete unused Docker volumes and permanently destroy their stored data; DESTRUCTIVE and unrecoverable — use `prune_all` to also remove stopped containers, images, and networks in one call.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/volumes', undefined, { env: environmentId }));
    }
  );

  // --- Batch ---

  registerTool(server, 'execute_batch', 'Run one bulk operation (start/stop/restart/pause/unpause/remove/down, depending on entity type) across many containers, images, volumes, networks, or stacks in a single call; use `batch_update_containers` for the specialized pull-and-recreate update flow, or `start_container` / `stop_container` for single-entity lifecycle actions.',
    {
      environmentId: z.number().optional().describe('Environment ID the entities belong to'),
      operation: z.string().describe('Operation to run. Valid per entityType: containers = start|stop|restart|pause|unpause|remove; images|volumes|networks = remove; stacks = start|stop|restart|down|remove (required by the real endpoint)'),
      entityType: z.enum(['containers', 'images', 'volumes', 'networks', 'stacks']).describe('Type of entity the batch operation targets (required by the real endpoint)'),
      items: z.array(z.object({
        id: z.string().describe('Entity ID or name to operate on'),
        name: z.string().describe('Entity display name (used for cleanup bookkeeping on container removal, and in progress reporting)'),
      })).min(1).describe('Entities to process; must be a non-empty array (required by the real endpoint)'),
      options: z.object({
        force: z.boolean().optional().describe('Force the operation where applicable (e.g. force-remove a running container or in-use image/volume)'),
        removeVolumes: z.boolean().optional().describe('For stacks with operation "down": also remove named volumes'),
      }).optional().describe('Optional per-operation flags'),
    },
    async ({ environmentId, operation, entityType, items, options }) => {
      const body: Record<string, unknown> = { operation, entityType, items };
      if (options !== undefined) body.options = options;
      return jsonResponse(await client.post('/api/batch', body, { env: environmentId }));
    }
  );

  // --- Legal ---

  registerTool(server, 'get_legal_license', 'Retrieve the full open-source legal license text for Dockhand; for operational license tier and expiry see `get_license`, or use `activate_license` to register a key.',
    {},
    async () => {
      return textResponse(await client.get('/api/legal/license'));
    }
  );

  registerTool(server, 'get_privacy_policy', 'Retrieve the full privacy policy text describing how Dockhand collects and handles user data.',
    {},
    async () => {
      return textResponse(await client.get('/api/legal/privacy'));
    }
  );

  registerTool(server, 'deactivate_license', 'Permanently deactivate the currently activated Dockhand license, returning the instance to its unlicensed state; read the current license info first with `get_license`, and use `activate_license` to re-register a key afterwards.',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/license'));
    }
  );

  registerTool(server, 'write_system_file', 'Create a directory on the Dockhand server filesystem at an absolute path (not inside a container — use `write_container_file_content` for that). The real endpoint only creates directories; it does not accept or persist file content. Pair with `list_system_files` to discover the path namespace and `get_system_file_content` to read back existing files.',
    {
      path: z.string().describe('Absolute path on the Dockhand server to create as a directory'),
    },
    async ({ path }) => {
      return jsonResponse(await client.post('/api/system/files', { path }));
    }
  );

  registerTool(server, 'reset_scanner_settings', 'Permanently reset the vulnerability-scanner settings (Trivy/Grype) to their defaults by removing the scanner images for an environment; read the current values first with `get_scanner_settings`, or use `update_scanner_settings` for targeted changes instead of a full reset.',
    {
      environmentId: z.number().describe('Environment ID (required by the real endpoint)'),
      removeImages: z.boolean().describe('Must be true to confirm scanner image removal (required by the real endpoint)'),
      scanner: z.enum(['grype', 'trivy']).optional().describe('Limit removal to one scanner; omit to remove both'),
    },
    async ({ environmentId, removeImages, scanner }) => {
      const query: Record<string, string | number | undefined> = { env: environmentId };
      if (removeImages) query.removeImages = 'true';
      if (scanner) query.scanner = scanner;
      return jsonResponse(await client.delete('/api/settings/scanner', query));
    }
  );

  registerTool(server, 'clear_scanner_cache', 'Permanently delete the scanner result cache so the next `scan_image` call re-runs the scanner from scratch; settings are unaffected (use `reset_scanner_settings` if you want to wipe configuration too).',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/settings/scanner/cache'));
    }
  );
}
