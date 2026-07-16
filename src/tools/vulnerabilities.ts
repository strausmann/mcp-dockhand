/**
 * Image vulnerability reporting tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerVulnerabilityTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_vulnerabilities', 'List all detected image vulnerabilities across scanned containers; use `get_vulnerability_count` for a summary total or `export_vulnerabilities` to download the full report.',
    {
      environmentId: z.number().optional().describe('Environment ID to scope results to (optional)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/vulnerabilities', { env: environmentId }));
    }
  );

  registerTool(server, 'get_vulnerability_count', 'Return the aggregate count of detected vulnerabilities (e.g. by severity); for the full list use `list_vulnerabilities` or trigger a fresh scan with `scan_all_vulnerabilities`.',
    {
      environmentId: z.number().optional().describe('Environment ID to scope the count to (optional)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/vulnerabilities/count', { env: environmentId }));
    }
  );

  registerTool(server, 'export_vulnerabilities', 'Export the full vulnerability report in the requested format for offline use; see `list_vulnerabilities` for the in-app list or `get_vulnerability_count` for a summary total.',
    {
      format: z.string().optional().describe('Export format, e.g. "json" or "csv"'),
      environmentId: z.number().optional().describe('Environment ID to scope the export to (optional)'),
    },
    async ({ format, environmentId }) => {
      return jsonResponse(await client.get('/api/vulnerabilities/export', { format, env: environmentId }));
    }
  );

  registerTool(server, 'scan_all_vulnerabilities', 'Trigger a vulnerability scan across all images now to refresh results; afterwards read them with `list_vulnerabilities` or `get_vulnerability_count`.',
    {
      environmentId: z.number().optional().describe('Environment ID to scope the scan to (optional)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/vulnerabilities/scan-all', undefined, { env: environmentId }));
    }
  );
}
