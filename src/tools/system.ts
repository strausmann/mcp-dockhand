/**
 * System, health, settings, and pruning tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerSystemTools(server: McpServer, client: DockhandClient): void {

  // --- Health ---

  server.tool(
    'health_check',
    'Check Dockhand server health',
    {},
    async () => {
      const data = await client.get('/api/health');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'health_check_database',
    'Check Dockhand database health',
    {},
    async () => {
      const data = await client.get('/api/health/database');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- System Info ---

  server.tool(
    'get_host_info',
    'Get host information of the Dockhand server',
    {},
    async () => {
      const data = await client.get('/api/host');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_system_info',
    'Get Dockhand system information',
    {},
    async () => {
      const data = await client.get('/api/system');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_system_disk',
    'Get disk usage on the Dockhand server',
    {},
    async () => {
      const data = await client.get('/api/system/disk');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'list_system_files',
    'List system files on the Dockhand server',
    {
      path: z.string().optional().describe('Directory path'),
    },
    async ({ path }) => {
      const data = await client.get('/api/system/files', path ? { path } : undefined);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_system_file_content',
    'Read a system file on the Dockhand server',
    {
      path: z.string().describe('File path'),
    },
    async ({ path }) => {
      const data = await client.get('/api/system/files/content', { path });
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_changelog',
    'Get the Dockhand changelog',
    {},
    async () => {
      const data = await client.get('/api/changelog');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_dependencies',
    'Get Dockhand dependencies',
    {},
    async () => {
      const data = await client.get('/api/dependencies');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Settings ---

  server.tool(
    'get_general_settings',
    'Get general Dockhand settings',
    {},
    async () => {
      const data = await client.get('/api/settings/general');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_general_settings',
    'Update general Dockhand settings',
    {
      settings: z.record(z.unknown()).describe('Settings to update'),
    },
    async ({ settings }) => {
      const data = await client.put('/api/settings/general', settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_theme_settings',
    'Get Dockhand theme settings',
    {},
    async () => {
      const data = await client.get('/api/settings/theme');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_theme_settings',
    'Update Dockhand theme settings',
    {
      settings: z.record(z.unknown()).describe('Theme settings to update'),
    },
    async ({ settings }) => {
      const data = await client.put('/api/settings/theme', settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_scanner_settings',
    'Get vulnerability scanner settings (Trivy/Grype)',
    {},
    async () => {
      const data = await client.get('/api/settings/scanner');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_scanner_settings',
    'Update vulnerability scanner settings',
    {
      settings: z.record(z.unknown()).describe('Scanner settings to update'),
    },
    async ({ settings }) => {
      const data = await client.put('/api/settings/scanner', settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- License ---

  server.tool(
    'get_license',
    'Get Dockhand license information',
    {},
    async () => {
      const data = await client.get('/api/license');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'activate_license',
    'Activate a Dockhand license',
    {
      licenseKey: z.string().describe('License key'),
    },
    async ({ licenseKey }) => {
      const data = await client.post('/api/license', { key: licenseKey });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Metrics ---

  server.tool(
    'get_prometheus_metrics',
    'Get Prometheus metrics from Dockhand',
    {},
    async () => {
      const data = await client.get('/api/metrics');
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Pruning ---

  server.tool(
    'prune_all',
    'Prune all unused Docker resources (containers, images, networks, volumes) - DESTRUCTIVE!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post('/api/prune/all', undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'prune_containers',
    'Prune stopped containers - DESTRUCTIVE!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post('/api/prune/containers', undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'prune_images',
    'Prune unused Docker images - DESTRUCTIVE!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post('/api/prune/images', undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'prune_networks',
    'Prune unused Docker networks',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post('/api/prune/networks', undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'prune_volumes',
    'Prune unused Docker volumes - DESTRUCTIVE! Data will be lost!',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post('/api/prune/volumes', undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Batch ---

  server.tool(
    'get_batch_operations',
    'Get available batch operations',
    {},
    async () => {
      const data = await client.get('/api/batch');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Legal ---

  server.tool(
    'get_legal_license',
    'Get legal license information',
    {},
    async () => {
      const data = await client.get('/api/legal/license');
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_privacy_policy',
    'Get privacy policy',
    {},
    async () => {
      const data = await client.get('/api/legal/privacy');
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );
}
