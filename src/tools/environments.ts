/**
 * Environment (Docker Host) management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerEnvironmentTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_environments',
    'List all Dockhand environments (Docker hosts)',
    {},
    async () => {
      const data = await client.get('/api/environments');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_environment',
    'Get details of a specific environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get(`/api/environments/${environmentId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_environment',
    'Create a new environment (Docker host)',
    {
      name: z.string().describe('Environment name'),
      connectionType: z.string().describe('Connection type (e.g. hawser-standard, hawser-edge)'),
      url: z.string().optional().describe('Docker host URL (for standard mode)'),
    },
    async ({ name, connectionType, url }) => {
      const body: Record<string, unknown> = { name, connectionType };
      if (url) body.url = url;
      const data = await client.post('/api/environments', body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_environment',
    'Update an existing environment',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().optional().describe('New name'),
      settings: z.record(z.unknown()).optional().describe('Settings to update'),
    },
    async ({ environmentId, name, settings }) => {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (settings) Object.assign(body, settings);
      const data = await client.put(`/api/environments/${environmentId}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_environment',
    'Delete an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.delete(`/api/environments/${environmentId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_environment',
    'Test connection to an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post(`/api/environments/${environmentId}/test`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_environment_connection',
    'Test a Docker connection without saving an environment',
    {
      connectionType: z.string().describe('Connection type'),
      url: z.string().optional().describe('Docker host URL'),
    },
    async ({ connectionType, url }) => {
      const body: Record<string, unknown> = { connectionType };
      if (url) body.url = url;
      const data = await client.post('/api/environments/test', body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'detect_docker_socket',
    'Auto-detect Docker socket on the server',
    {},
    async () => {
      const data = await client.get('/api/environments/detect-socket');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_environment_timezone',
    'Get the timezone of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get(`/api/environments/${environmentId}/timezone`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_environment_timezone',
    'Set the timezone of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      timezone: z.string().describe('Timezone string (e.g. Europe/Berlin)'),
    },
    async ({ environmentId, timezone }) => {
      const data = await client.put(`/api/environments/${environmentId}/timezone`, { timezone });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_environment_update_check',
    'Get update-check settings of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get(`/api/environments/${environmentId}/update-check`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_environment_update_check',
    'Set update-check settings of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.unknown()).describe('Update-check settings'),
    },
    async ({ environmentId, settings }) => {
      const data = await client.put(`/api/environments/${environmentId}/update-check`, settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_environment_image_prune',
    'Get image prune settings of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get(`/api/environments/${environmentId}/image-prune`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_environment_image_prune',
    'Set image prune settings of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.unknown()).describe('Image prune settings'),
    },
    async ({ environmentId, settings }) => {
      const data = await client.put(`/api/environments/${environmentId}/image-prune`, settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'list_environment_notifications',
    'List notifications configured for an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get(`/api/environments/${environmentId}/notifications`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_environment_notification',
    'Create a notification for an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.unknown()).describe('Notification configuration'),
    },
    async ({ environmentId, config }) => {
      const data = await client.post(`/api/environments/${environmentId}/notifications`, config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_environment_notification',
    'Get a specific notification of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      const data = await client.get(`/api/environments/${environmentId}/notifications/${notificationId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_environment_notification',
    'Delete a notification from an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      const data = await client.delete(`/api/environments/${environmentId}/notifications/${notificationId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
