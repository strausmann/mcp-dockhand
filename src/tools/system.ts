/**
 * System, health, settings, and pruning tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerSystemTools(server: McpServer, client: DockhandClient): void {

  // --- Health ---

  registerTool(server, 'health_check', 'Check Dockhand server health',
    {},
    async () => {
      return jsonResponse(await client.get('/api/health'));
    }
  );

  registerTool(server, 'health_check_database', 'Check Dockhand database health',
    {},
    async () => {
      return jsonResponse(await client.get('/api/health/database'));
    }
  );

  // --- System Info ---

  registerTool(server, 'get_host_info', 'Get host information of the Dockhand server',
    {},
    async () => {
      return jsonResponse(await client.get('/api/host'));
    }
  );

  registerTool(server, 'get_system_info', 'Get Dockhand system information',
    {},
    async () => {
      return jsonResponse(await client.get('/api/system'));
    }
  );

  registerTool(server, 'get_system_disk', 'Get disk usage on the Dockhand server',
    {},
    async () => {
      return jsonResponse(await client.get('/api/system/disk'));
    }
  );

  registerTool(server, 'list_system_files', 'List system files on the Dockhand server',
    {
      path: z.string().optional().describe('Directory path'),
    },
    async ({ path }) => {
      return jsonResponse(await client.get('/api/system/files', path ? { path } : undefined));
    }
  );

  registerTool(server, 'get_system_file_content', 'Read a system file on the Dockhand server',
    {
      path: z.string().describe('File path'),
    },
    async ({ path }) => {
      return textResponse(await client.get('/api/system/files/content', { path }));
    }
  );

  registerTool(server, 'get_changelog', 'Get the Dockhand changelog',
    {},
    async () => {
      return jsonResponse(await client.get('/api/changelog'));
    }
  );

  registerTool(server, 'get_dependencies', 'Get Dockhand dependencies',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dependencies'));
    }
  );

  // --- Settings ---

  registerTool(server, 'get_general_settings', 'Get general Dockhand settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/general'));
    }
  );

  registerTool(server, 'update_general_settings', 'Update general Dockhand settings',
    {
      settings: z.record(z.unknown()).describe('Settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.post('/api/settings/general', settings));
    }
  );

  registerTool(server, 'get_theme_settings', 'Get Dockhand theme settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/theme'));
    }
  );

  registerTool(server, 'get_scanner_settings', 'Get vulnerability scanner settings (Trivy/Grype)',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/scanner'));
    }
  );

  registerTool(server, 'update_scanner_settings', 'Update vulnerability scanner settings',
    {
      settings: z.record(z.unknown()).describe('Scanner settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.post('/api/settings/scanner', settings));
    }
  );

  // --- License ---

  registerTool(server, 'get_license', 'Get Dockhand license information',
    {},
    async () => {
      return jsonResponse(await client.get('/api/license'));
    }
  );

  registerTool(server, 'activate_license', 'Activate a Dockhand license',
    {
      licenseKey: z.string().describe('License key'),
    },
    async ({ licenseKey }) => {
      return jsonResponse(await client.post('/api/license', { key: licenseKey }));
    }
  );

  // --- Metrics ---

  registerTool(server, 'get_prometheus_metrics', 'Get Prometheus metrics from Dockhand',
    {},
    async () => {
      return textResponse(await client.get('/api/metrics'));
    }
  );

  // --- Pruning ---

  registerTool(server, 'prune_all', 'Prune all unused Docker resources (containers, images, networks, volumes) - DESTRUCTIVE!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/all', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_containers', 'Prune stopped containers - DESTRUCTIVE!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/containers', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_images', 'Prune unused Docker images - DESTRUCTIVE!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/images', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_networks', 'Prune unused Docker networks',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/networks', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_volumes', 'Prune unused Docker volumes - DESTRUCTIVE! Data will be lost!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/volumes', undefined, { env: environmentId }));
    }
  );

  // --- Batch ---

  registerTool(server, 'list_batch_operations', 'Get available batch operations',
    {},
    async () => {
      return jsonResponse(await client.post('/api/batch'));
    }
  );

  // --- Legal ---

  registerTool(server, 'get_legal_license', 'Get legal license information',
    {},
    async () => {
      return textResponse(await client.get('/api/legal/license'));
    }
  );

  registerTool(server, 'get_privacy_policy', 'Get privacy policy',
    {},
    async () => {
      return textResponse(await client.get('/api/legal/privacy'));
    }
  );
}
