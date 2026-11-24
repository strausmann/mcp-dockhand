/**
 * Image vulnerability reporting tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerVulnerabilityTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_vulnerabilities',
    {
      environmentId: z.number().describe('Environment ID (required)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/vulnerabilities', { env: environmentId }));
    }
  );

  registerTool(server, 'get_vulnerability_count',
    {
      environmentId: z.number().describe('Environment ID (required)'),
      groupBy: z.enum(['container', 'image', 'stack']).optional().describe('Return per-container, per-image or per-stack counts ({groupBy, groups}, most severe first) instead of the totals. Dockhand 1.0.55+'),
    },
    async ({ environmentId, groupBy }) => {
      const query: Record<string, string | number> = { env: environmentId };
      if (groupBy !== undefined) query.groupBy = groupBy;
      return jsonResponse(await client.get('/api/vulnerabilities/count', query));
    }
  );

  registerTool(server, 'export_vulnerabilities',
    {
      environmentId: z.number().describe('Environment ID (required)'),
      format: z.string().optional().describe('Export format, e.g. "json" or "csv"'),
    },
    async ({ environmentId, format }) => {
      return jsonResponse(await client.get('/api/vulnerabilities/export', { env: environmentId, format }));
    }
  );

  registerTool(server, 'scan_all_vulnerabilities',
    {
      environmentId: z.number().optional().describe('Environment ID to scope the scan to (optional)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/vulnerabilities/scan-all', undefined, { env: environmentId }));
    }
  );
}
