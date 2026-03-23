/**
 * Notification management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerNotificationTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_notifications',
    'List all notification configurations',
    {},
    async () => {
      const data = await client.get('/api/notifications');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_notification',
    'Create a new notification configuration',
    {
      config: z.record(z.unknown()).describe('Notification configuration (name, type, settings)'),
    },
    async ({ config }) => {
      const data = await client.post('/api/notifications', config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_notification',
    'Get details of a notification configuration',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      const data = await client.get(`/api/notifications/${notificationId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_notification',
    'Update a notification configuration',
    {
      notificationId: z.number().describe('Notification ID'),
      config: z.record(z.unknown()).describe('Updated notification configuration'),
    },
    async ({ notificationId, config }) => {
      const data = await client.put(`/api/notifications/${notificationId}`, config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_notification',
    'Delete a notification configuration',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      const data = await client.delete(`/api/notifications/${notificationId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_notification',
    'Send a test notification using a saved configuration',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      const data = await client.post(`/api/notifications/${notificationId}/test`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_notification_config',
    'Send a test notification without saving the configuration first',
    {
      config: z.record(z.unknown()).describe('Notification configuration to test'),
    },
    async ({ config }) => {
      const data = await client.post('/api/notifications/test', config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'trigger_test_notification',
    'Trigger a test notification event',
    {},
    async () => {
      const data = await client.post('/api/notifications/trigger-test');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
