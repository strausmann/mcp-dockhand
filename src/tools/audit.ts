/**
 * Audit log tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerAuditTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_audit_log',
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

  registerTool(server, 'get_audit_events',
    {},
    async () => {
      return jsonResponse(await client.get('/api/audit/events'));
    }
  );

  registerTool(server, 'get_audit_users',
    {},
    async () => {
      return jsonResponse(await client.get('/api/audit/users'));
    }
  );

  registerTool(server, 'export_audit_log',
    {
      format: z.string().optional().describe('Export format (e.g. csv, json)'),
    },
    async ({ format }) => {
      return textResponse(await client.get('/api/audit/export', format ? { format } : undefined));
    }
  );

  // --- Non-/api audit routes ---
  //
  // `GET /audit` and `GET /audit/users` are a SEPARATE endpoint family from
  // `/api/audit`/`/api/audit/users` above — same underlying data (getAuditLogs /
  // getAuditLogUsers in $lib/server/db), but a distinct route each, verified against
  // src/routes/audit/+server.ts and src/routes/audit/users/+server.ts:
  //   - `/audit` backs the Audit Log page itself and takes LEGACY, single-value,
  //     snake_case filters (username, entity_type, action, environment_id, from_date,
  //     to_date) plus limit/offset — no multi-select support.
  //   - `/api/audit` (get_audit_log above) is the newer, documented API surface:
  //     multi-select camelCase filters (usernames, entityTypes, actions, labels) with
  //     legacy singular aliases kept for backwards compat.
  // Both are real, independently-routable GET endpoints (Enterprise-only, same
  // `canViewAuditLog()` permission check), so both get their own tool.

  registerTool(server, 'get_audit_log_entries',
    {
      username: z.string().optional().describe('Filter by exact username'),
      entityType: z.string().optional().describe('Filter by entity type (e.g. container, stack)'),
      action: z.string().optional().describe('Filter by action (e.g. create, delete)'),
      environmentId: z.number().optional().describe('Filter by environment ID'),
      fromDate: z.string().optional().describe('Start of the date range (ISO 8601)'),
      toDate: z.string().optional().describe('End of the date range (ISO 8601)'),
      limit: z.number().optional().describe('Maximum number of entries'),
      offset: z.number().optional().describe('Offset for pagination'),
    },
    async ({ username, entityType, action, environmentId, fromDate, toDate, limit, offset }) => {
      return jsonResponse(await client.get('/audit', {
        username,
        entity_type: entityType,
        action,
        environment_id: environmentId,
        from_date: fromDate,
        to_date: toDate,
        limit,
        offset,
      }));
    }
  );

  registerTool(server, 'get_audit_log_usernames',
    {},
    async () => {
      return jsonResponse(await client.get('/audit/users'));
    }
  );
}
