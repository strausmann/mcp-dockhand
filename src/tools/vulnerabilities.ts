/**
 * Image vulnerability reporting tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerVulnerabilityTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_vulnerabilities', 'List detected image vulnerabilities for an environment (environmentId is required — omitting it returns an empty list, not an aggregate across environments); use `get_vulnerability_count` for a summary total or `export_vulnerabilities` to download the full report.',
    {
      environmentId: z.number().describe('Environment ID (required)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/vulnerabilities', { env: environmentId }));
    }
  );

  registerTool(server, 'get_vulnerability_count', 'Return the count of detected vulnerabilities for an environment, e.g. by severity (environmentId is required — omitting it returns zero, not an aggregate); for the full list use `list_vulnerabilities` or trigger a fresh scan with `scan_all_vulnerabilities`.',
    {
      environmentId: z.number().describe('Environment ID (required)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/vulnerabilities/count', { env: environmentId }));
    }
  );

  registerTool(server, 'export_vulnerabilities', 'Export the vulnerability report for an environment in the requested format (environmentId is required — omitting it returns an empty report); see `list_vulnerabilities` for the in-app list or `get_vulnerability_count` for a summary total.',
    {
      environmentId: z.number().describe('Environment ID (required)'),
      format: z.string().optional().describe('Export format, e.g. "json" or "csv"'),
    },
    async ({ environmentId, format }) => {
      return jsonResponse(await client.get('/api/vulnerabilities/export', { env: environmentId, format }));
    }
  );

  registerTool(server, 'scan_all_vulnerabilities', 'Trigger a vulnerability scan across all images now to refresh results (may block until every image has been scanned); afterwards read them with `list_vulnerabilities` or `get_vulnerability_count`.',
    {
      environmentId: z.number().optional().describe('Environment ID to scope the scan to (optional)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/vulnerabilities/scan-all', undefined, { env: environmentId }));
    }
  );
}
