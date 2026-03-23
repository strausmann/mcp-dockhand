/**
 * Audit log tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerAuditTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'get_audit_log',
    'Get the audit log (who did what and when)',
    {
      limit: z.number().optional().describe('Maximum number of entries'),
      offset: z.number().optional().describe('Offset for pagination'),
    },
    async ({ limit, offset }) => {
      const params: Record<string, string | number | undefined> = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      const data = await client.get('/api/audit', Object.keys(params).length > 0 ? params : undefined);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_audit_events',
    'Get audit event types',
    {},
    async () => {
      const data = await client.get('/api/audit/events');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_audit_users',
    'Get audit data grouped by user',
    {},
    async () => {
      const data = await client.get('/api/audit/users');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'export_audit_log',
    'Export the audit log',
    {
      format: z.string().optional().describe('Export format (e.g. csv, json)'),
    },
    async ({ format }) => {
      const data = await client.get('/api/audit/export', format ? { format } : undefined);
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );
}
