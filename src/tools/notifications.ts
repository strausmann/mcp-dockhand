/**
 * Notification management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerNotificationTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_notifications', 'List all saved notification configurations; use `get_notification` to fetch a single entry by ID.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/notifications'));
    }
  );

  registerTool(server, 'create_notification', 'Create and persist a new notification configuration; use `test_notification` to verify it after saving.',
    {
      config: z.record(z.string(), z.unknown()).describe('Notification configuration (name, type, settings)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/notifications', config));
    }
  );

  registerTool(server, 'get_notification', 'Retrieve full details of a single saved notification configuration by ID; use `list_notifications` to discover IDs.',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.get(`/api/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'update_notification', 'Update an existing saved notification configuration by ID; use `get_notification` to inspect the current values first.',
    {
      notificationId: z.number().describe('Notification ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated notification configuration'),
    },
    async ({ notificationId, config }) => {
      return jsonResponse(await client.put(`/api/notifications/${encodePath(notificationId)}`, config));
    }
  );

  registerTool(server, 'delete_notification', 'Permanently delete a saved notification configuration by ID (destructive); use `list_notifications` to confirm the ID before deleting.',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.delete(`/api/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'test_notification', 'Fire a test message through a saved notification configuration identified by ID; use `test_notification_config` to test an unsaved config blob instead.',
    { notificationId: z.number().describe('Notification ID') },
    async ({ notificationId }) => {
      return jsonResponse(await client.post(`/api/notifications/${encodePath(notificationId)}/test`));
    }
  );

  registerTool(server, 'test_notification_config', 'Send a test message using a raw config blob without saving it first; use `test_notification` to test an already-saved configuration by ID.',
    {
      config: z.record(z.string(), z.unknown()).describe('Notification configuration to test'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/notifications/test', config));
    }
  );

  registerTool(server, 'trigger_test_notification', 'Fire the standard test-event payload to all configured notification channels; use `test_notification` to target a single saved configuration instead.',
    {},
    async () => {
      return jsonResponse(await client.post('/api/notifications/trigger-test'));
    }
  );

  registerTool(server, 'get_test_notification_payload', 'Retrieve the canonical test-event payload that `trigger_test_notification` would POST without actually firing it (useful for previewing the shape before sending); use `trigger_test_notification` (POST) to actually deliver it, or `test_notification_config` to dry-run against a specific config blob.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/notifications/trigger-test'));
    }
  );
}
