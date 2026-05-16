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

  registerTool(server, 'get_system_disk', 'Retrieve disk usage statistics for the Dockhand server host; use `get_host_info` for OS-level details or `get_general_settings` to read application-level configuration.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/system/disk'));
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

  registerTool(server, 'activate_license', 'Activate a new Dockhand license key, registering it with the backend to unlock the corresponding feature tier; use `get_license` to verify the result after activation.',
    {
      licenseKey: z.string().describe('License key'),
    },
    async ({ licenseKey }) => {
      return jsonResponse(await client.post('/api/license', { key: licenseKey }));
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

  registerTool(server, 'list_batch_operations', 'List the batch operations that have been submitted or completed, providing a history view of bulk container actions; use `batch_update_containers` to start a new batch update, or `start_container` / `stop_container` for single-container lifecycle actions.',
    {},
    async () => {
      return jsonResponse(await client.post('/api/batch'));
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

  registerTool(server, 'write_system_file', 'Create or overwrite a file on the Dockhand server filesystem (not inside a container — use `write_container_file_content` for that). Pair with `list_system_files` to discover the path namespace and `get_system_file_content` to read back the result.',
    {
      path: z.string().describe('Absolute path on the Dockhand server'),
      content: z.string().describe('File content to write'),
    },
    async ({ path, content }) => {
      return jsonResponse(await client.post('/api/system/files', { path, content }));
    }
  );

  registerTool(server, 'reset_scanner_settings', 'Permanently reset the vulnerability-scanner settings (Trivy/Grype) to their defaults; read the current values first with `get_scanner_settings`, or use `update_scanner_settings` for targeted changes instead of a full reset.',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/settings/scanner'));
    }
  );

  registerTool(server, 'clear_scanner_cache', 'Permanently delete the scanner result cache so the next `scan_image` call re-runs the scanner from scratch; settings are unaffected (use `reset_scanner_settings` if you want to wipe configuration too).',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/settings/scanner/cache'));
    }
  );
}
