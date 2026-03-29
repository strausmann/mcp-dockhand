/**
 * Environment (Docker Host) management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerEnvironmentTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_environments', 'List all Dockhand environments (Docker hosts)',
    {},
    async () => {
      return jsonResponse(await client.get('/api/environments'));
    }
  );

  registerTool(server, 'get_environment', 'Get details of a specific environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${environmentId}`));
    }
  );

  registerTool(server, 'create_environment', 'Create a new environment (Docker host). For hawser-standard mode, provide host/port directly or a url that will be parsed into host/port. Edge mode does not require host/port.',
    {
      name: z.string().describe('Environment name'),
      connectionType: z.string().describe('Connection type (e.g. hawser-standard, hawser-edge)'),
      host: z.string().optional().describe('Docker host IP or hostname (for hawser-standard mode)'),
      port: z.number().optional().describe('Docker host port (for hawser-standard mode, default: 2376)'),
      url: z.string().optional().describe('Docker host URL (legacy, will be parsed into host/port for hawser-standard mode)'),
    },
    async ({ name, connectionType, host, port, url }) => {
      const body: Record<string, unknown> = { name, connectionType };
      if (host) {
        body.host = host;
        body.port = port ?? 2376;
      } else if (url) {
        try {
          const parsed = new URL(url);
          body.host = parsed.hostname;
          body.port = parsed.port ? parseInt(parsed.port, 10) : 2376;
        } catch {
          // If URL parsing fails, pass url as-is for backward compatibility
          body.url = url;
        }
      }
      return jsonResponse(await client.post('/api/environments', body));
    }
  );

  registerTool(server, 'update_environment', 'Update an existing environment. For hawser-standard mode, provide host/port directly or a url that will be parsed.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().optional().describe('New name'),
      host: z.string().optional().describe('Docker host IP or hostname (for hawser-standard mode)'),
      port: z.number().optional().describe('Docker host port (for hawser-standard mode)'),
      url: z.string().optional().describe('Docker host URL (legacy, will be parsed into host/port)'),
      settings: z.record(z.unknown()).optional().describe('Additional settings to update'),
    },
    async ({ environmentId, name, host, port, url, settings }) => {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (host) {
        body.host = host;
        if (port !== undefined) body.port = port;
      } else if (url) {
        try {
          const parsed = new URL(url);
          body.host = parsed.hostname;
          body.port = parsed.port ? parseInt(parsed.port, 10) : 2376;
        } catch {
          body.url = url;
        }
      }
      if (settings) Object.assign(body, settings);
      return jsonResponse(await client.put(`/api/environments/${environmentId}`, body));
    }
  );

  registerTool(server, 'delete_environment', 'Delete an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.delete(`/api/environments/${environmentId}`));
    }
  );

  registerTool(server, 'test_environment', 'Test connection to an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post(`/api/environments/${environmentId}/test`));
    }
  );

  registerTool(server, 'test_environment_connection', 'Test a Docker connection without saving an environment. For hawser-standard, provide host/port or a url.',
    {
      connectionType: z.string().describe('Connection type'),
      host: z.string().optional().describe('Docker host IP or hostname (for hawser-standard mode)'),
      port: z.number().optional().describe('Docker host port (for hawser-standard mode, default: 2376)'),
      url: z.string().optional().describe('Docker host URL (legacy, will be parsed into host/port)'),
    },
    async ({ connectionType, host, port, url }) => {
      const body: Record<string, unknown> = { connectionType };
      if (host) {
        body.host = host;
        body.port = port ?? 2376;
      } else if (url) {
        try {
          const parsed = new URL(url);
          body.host = parsed.hostname;
          body.port = parsed.port ? parseInt(parsed.port, 10) : 2376;
        } catch {
          body.url = url;
        }
      }
      return jsonResponse(await client.post('/api/environments/test', body));
    }
  );

  registerTool(server, 'detect_docker_socket', 'Auto-detect Docker socket on the server',
    {},
    async () => {
      return jsonResponse(await client.get('/api/environments/detect-socket'));
    }
  );

  registerTool(server, 'get_environment_timezone', 'Get the timezone of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${environmentId}/timezone`));
    }
  );

  registerTool(server, 'set_environment_timezone', 'Set the timezone of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      timezone: z.string().describe('Timezone string (e.g. Europe/Berlin)'),
    },
    async ({ environmentId, timezone }) => {
      return jsonResponse(await client.put(`/api/environments/${environmentId}/timezone`, { timezone }));
    }
  );

  registerTool(server, 'get_environment_update_check', 'Get update-check settings of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${environmentId}/update-check`));
    }
  );

  registerTool(server, 'set_environment_update_check', 'Set update-check settings of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.unknown()).describe('Update-check settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.put(`/api/environments/${environmentId}/update-check`, settings));
    }
  );

  registerTool(server, 'get_environment_image_prune', 'Get image prune settings of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${environmentId}/image-prune`));
    }
  );

  registerTool(server, 'set_environment_image_prune', 'Set image prune settings of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.unknown()).describe('Image prune settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.put(`/api/environments/${environmentId}/image-prune`, settings));
    }
  );

  registerTool(server, 'list_environment_notifications', 'List notifications configured for an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${environmentId}/notifications`));
    }
  );

  registerTool(server, 'create_environment_notification', 'Create a notification for an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.unknown()).describe('Notification configuration'),
    },
    async ({ environmentId, config }) => {
      return jsonResponse(await client.post(`/api/environments/${environmentId}/notifications`, config));
    }
  );

  registerTool(server, 'get_environment_notification', 'Get a specific notification of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.get(`/api/environments/${environmentId}/notifications/${notificationId}`));
    }
  );

  registerTool(server, 'delete_environment_notification', 'Delete a notification from an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.delete(`/api/environments/${environmentId}/notifications/${notificationId}`));
    }
  );
}
