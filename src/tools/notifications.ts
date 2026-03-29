/**
 * Notification management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerNotificationTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_notifications', 'List all notification configurations',
    {},
    async () => {
      return jsonResponse(await client.get('/api/notifications'));
    }
  );

  registerTool(server, 'create_notification', 'Create a new notification configuration',
    {
      config: z.record(z.string(), z.unknown()).describe('Notification configuration (name, type, settings)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/notifications', config));
    }
  );

  registerTool(server, 'get_notification', 'Get details of a notification configuration',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.get(`/api/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'update_notification', 'Update a notification configuration',
    {
      notificationId: z.number().describe('Notification ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated notification configuration'),
    },
    async ({ notificationId, config }) => {
      return jsonResponse(await client.put(`/api/notifications/${encodePath(notificationId)}`, config));
    }
  );

  registerTool(server, 'delete_notification', 'Delete a notification configuration',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.delete(`/api/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'test_notification', 'Send a test notification using a saved configuration',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.post(`/api/notifications/${encodePath(notificationId)}/test`));
    }
  );

  registerTool(server, 'test_notification_config', 'Send a test notification without saving the configuration first',
    {
      config: z.record(z.string(), z.unknown()).describe('Notification configuration to test'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/notifications/test', config));
    }
  );

  registerTool(server, 'trigger_test_notification', 'Trigger a test notification event',
    {},
    async () => {
      return jsonResponse(await client.post('/api/notifications/trigger-test'));
    }
  );
}
