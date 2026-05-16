/**
 * Audit log tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerAuditTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_audit_log', 'Retrieve paginated audit log entries showing which actor performed which action and when. Each entry includes a timestamp, actor identity, and event type. Supports limit/offset pagination for large logs. To browse the catalog of available event type identifiers, use `get_audit_events`; for log data aggregated by actor, use `get_audit_users`; to download the full log as a file, use `export_audit_log`.',
    {
      limit: z.number().optional().describe('Maximum number of entries'),
      offset: z.number().optional().describe('Offset for pagination'),
    },
    async ({ limit, offset }) => {
      const params: Record<string, string | number | undefined> = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      return jsonResponse(await client.get('/api/audit', Object.keys(params).length > 0 ? params : undefined));
    }
  );

  registerTool(server, 'get_audit_events', 'List the catalog of audit event type identifiers (e.g. user.login, stack.deploy) that the audit system recognises. Use this to understand which event types can appear in the log before querying. For the actual log entries keyed by those event types, use `get_audit_log`; for entries grouped by actor, use `get_audit_users`; for a downloadable archive, use `export_audit_log`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/audit/events'));
    }
  );

  registerTool(server, 'get_audit_users', 'Retrieve audit data aggregated by actor (user), showing a per-user summary of actions taken. Useful for identifying which user performed the most operations or for a user-centric security review. For the full chronological log, use `get_audit_log`; for the catalog of event type identifiers, use `get_audit_events`; for a downloadable file export, use `export_audit_log`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/audit/users'));
    }
  );

  registerTool(server, 'export_audit_log', 'Export the full audit log to a downloadable file in the requested format (e.g. csv, json). Use this when you need an offline archive or need to import audit data into an external tool. For in-API paginated access to log entries, use `get_audit_log`; for event type identifiers, use `get_audit_events`; for a per-actor summary, use `get_audit_users`.',
    {
      format: z.string().optional().describe('Export format (e.g. csv, json)'),
    },
    async ({ format }) => {
      return textResponse(await client.get('/api/audit/export', format ? { format } : undefined));
    }
  );
}
