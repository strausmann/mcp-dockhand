/**
 * Notification management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerNotificationTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_notifications',
    {},
    async () => {
      return jsonResponse(await client.get('/api/notifications'));
    }
  );

  registerTool(server, 'create_notification',
    {
      config: z.record(z.string(), z.unknown()).describe('Notification configuration (name, type, settings)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/notifications', config));
    }
  );

  registerTool(server, 'get_notification',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.get(`/api/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'update_notification',
    {
      notificationId: z.number().describe('Notification ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated notification configuration'),
    },
    async ({ notificationId, config }) => {
      return jsonResponse(await client.put(`/api/notifications/${encodePath(notificationId)}`, config));
    }
  );

  registerTool(server, 'delete_notification',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.delete(`/api/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'test_notification',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.post(`/api/notifications/${encodePath(notificationId)}/test`));
    }
  );

  registerTool(server, 'test_notification_config',
    {
      config: z.record(z.string(), z.unknown()).describe('Notification configuration to test'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/notifications/test', config));
    }
  );

  registerTool(server, 'trigger_test_notification',
    {
      eventType: z.string().describe('Notification event type ID (e.g. container_started, stack_deployed, vulnerability_critical, license_expiring — see `get_test_notification_payload` for the full list); required by the real endpoint'),
      environmentId: z.number().optional().describe('Environment ID; required by the real endpoint for every event type except the system-only "license_expiring"'),
      payload: z.object({
        title: z.string().describe('Notification title'),
        message: z.string().describe('Notification message'),
        type: z.string().optional().describe('Notification severity type (e.g. info, warning); defaults to "info"'),
      }).describe('Notification content; title and message are required by the real endpoint'),
    },
    async ({ eventType, environmentId, payload }) => {
      const body: Record<string, unknown> = { eventType, payload };
      if (environmentId !== undefined) body.environmentId = environmentId;
      return jsonResponse(await client.post('/api/notifications/trigger-test', body));
    }
  );

  registerTool(server, 'get_test_notification_payload',
    {},
    async () => {
      return jsonResponse(await client.get('/api/notifications/trigger-test'));
    }
  );
}
