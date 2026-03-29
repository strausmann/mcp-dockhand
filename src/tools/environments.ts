/**
 * Environment (Docker Host) management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

/**
 * Resolve host/port from explicit args or a URL string into the request body.
 * Only applies to hawser-standard connections — other types ignore host/port.
 *
 * @param body        - The request body to mutate
 * @param args        - User-supplied host, port, url
 * @param connectionType - The connection type of the environment
 * @param useDefaultPort - If true, default port 2376 when not explicitly set (create/test).
 *                         If false, only set port when the caller provided one (update).
 */
function resolveHostPort(
  body: Record<string, unknown>,
  args: { host?: string; port?: number; url?: string },
  connectionType: string,
  useDefaultPort: boolean,
): void {
  if (connectionType !== 'hawser-standard') return;

  if (args.host) {
    body.host = args.host;
    if (useDefaultPort) {
      body.port = args.port ?? 2376;
    } else if (args.port !== undefined) {
      body.port = args.port;
    }
    return;
  }

  if (args.url) {
    try {
      const parsed = new URL(args.url);
      body.host = parsed.hostname;
      if (parsed.port) {
        body.port = parseInt(parsed.port, 10);
      } else if (useDefaultPort) {
        body.port = 2376;
      }
    } catch {
      try {
        const parsed = new URL(`tcp://${args.url}`);
        body.host = parsed.hostname;
        if (parsed.port) {
          body.port = parseInt(parsed.port, 10);
        } else if (useDefaultPort) {
          body.port = 2376;
        }
      } catch {
        throw new Error(
          'Invalid Docker host URL for hawser-standard. Provide host:port or tcp://host:port.',
        );
      }
    }
  }
}

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
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}`));
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
      resolveHostPort(body, { host, port, url }, connectionType, true);
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
      icon: z.string().optional().describe('Icon name for the environment'),
      labels: z.array(z.string()).optional().describe('Labels assigned to the environment'),
      collectActivity: z.boolean().optional().describe('Collect container activity logs'),
      collectMetrics: z.boolean().optional().describe('Collect host metrics (CPU, memory, etc.)'),
      highlightChanges: z.boolean().optional().describe('Highlight recent container changes'),
      socketPath: z.string().optional().describe('Custom Docker socket path (e.g. /var/run/docker.sock)'),
      additionalSettings: z.record(z.unknown()).optional().describe('Additional settings not covered by explicit parameters'),
    },
    async ({ environmentId, name, host, port, url, icon, labels, collectActivity, collectMetrics, highlightChanges, socketPath, additionalSettings }) => {
      const env = await client.get(`/api/environments/${encodePath(environmentId)}`) as Record<string, unknown>;
      const connectionType = (env.connectionType as string) ?? '';
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      // Merge additional settings first so explicit fields can override them
      if (additionalSettings) Object.assign(body, additionalSettings);
      if (icon !== undefined) body.icon = icon;
      if (labels !== undefined) body.labels = labels;
      if (collectActivity !== undefined) body.collectActivity = collectActivity;
      if (collectMetrics !== undefined) body.collectMetrics = collectMetrics;
      if (highlightChanges !== undefined) body.highlightChanges = highlightChanges;
      if (socketPath !== undefined) body.socketPath = socketPath;
      resolveHostPort(body, { host, port, url }, connectionType, false);
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}`, body));
    }
  );

  registerTool(server, 'delete_environment', 'Delete an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.delete(`/api/environments/${encodePath(environmentId)}`));
    }
  );

  registerTool(server, 'test_environment', 'Test connection to an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/test`));
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
      resolveHostPort(body, { host, port, url }, connectionType, true);
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
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/timezone`));
    }
  );

  registerTool(server, 'set_environment_timezone', 'Set the timezone of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      timezone: z.string().describe('Timezone string (e.g. Europe/Berlin)'),
    },
    async ({ environmentId, timezone }) => {
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/timezone`, { timezone }));
    }
  );

  registerTool(server, 'get_environment_update_check', 'Get update-check settings of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/update-check`));
    }
  );

  registerTool(server, 'set_environment_update_check', 'Set update-check settings of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.unknown()).describe('Update-check settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/update-check`, settings));
    }
  );

  registerTool(server, 'get_environment_image_prune', 'Get image prune settings of an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/image-prune`));
    }
  );

  registerTool(server, 'set_environment_image_prune', 'Set image prune settings of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.unknown()).describe('Image prune settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/image-prune`, settings));
    }
  );

  registerTool(server, 'list_environment_notifications', 'List notifications configured for an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/notifications`));
    }
  );

  registerTool(server, 'create_environment_notification', 'Create a notification for an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.unknown()).describe('Notification configuration'),
    },
    async ({ environmentId, config }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/notifications`, config));
    }
  );

  registerTool(server, 'get_environment_notification', 'Get a specific notification of an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'delete_environment_notification', 'Delete a notification from an environment',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.delete(`/api/environments/${encodePath(environmentId)}/notifications/${encodePath(notificationId)}`));
    }
  );
}
