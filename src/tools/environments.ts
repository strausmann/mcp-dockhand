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

  registerTool(server, 'list_environments', 'List all Dockhand environments (Docker hosts). Use `get_environment` to fetch a single environment, `create_environment` to add one, or `delete_environment` to remove one.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/environments'));
    }
  );

  registerTool(server, 'get_environment', 'Retrieve full details of a single Dockhand environment by ID. See `list_environments` for all environments, `update_environment` to modify, or `test_environment` to verify connectivity.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}`));
    }
  );

  registerTool(server, 'create_environment', 'Create a new Dockhand environment (Docker host connection). For hawser-standard mode supply host/port or a URL parsed into host/port; edge mode needs no host. Use `test_environment_connection` to probe connectivity before saving, or `update_environment` to modify later.',
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

  // Fix #30 (HIGH): Accept optional connectionType param to skip redundant GET request.
  // Only fetches environment via GET when connectionType is not provided by the caller.
  registerTool(server, 'update_environment', 'Update an existing Dockhand environment (name, host, labels, metrics settings, etc.). For hawser-standard, supply host/port or a URL; pass connectionType to avoid an extra GET. See `create_environment` to add one or `delete_environment` to remove one.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().optional().describe('New name'),
      connectionType: z.string().optional().describe('Connection type of the environment (e.g. hawser-standard). When provided, skips fetching the environment to read it.'),
      host: z.string().optional().describe('Docker host IP or hostname (for hawser-standard mode)'),
      port: z.number().optional().describe('Docker host port (for hawser-standard mode)'),
      url: z.string().optional().describe('Docker host URL (legacy, will be parsed into host/port)'),
      icon: z.string().optional().describe('Icon name for the environment'),
      labels: z.array(z.string()).optional().describe('Labels assigned to the environment'),
      collectActivity: z.boolean().optional().describe('Collect container activity logs'),
      collectMetrics: z.boolean().optional().describe('Collect host metrics (CPU, memory, etc.)'),
      highlightChanges: z.boolean().optional().describe('Highlight recent container changes'),
      socketPath: z.string().optional().describe('Custom Docker socket path (e.g. /var/run/docker.sock)'),
      additionalSettings: z.record(z.string(), z.unknown()).optional().describe('Additional settings not covered by explicit parameters'),
    },
    async ({ environmentId, name, connectionType, host, port, url, icon, labels, collectActivity, collectMetrics, highlightChanges, socketPath, additionalSettings }) => {
      // Only fetch environment when connectionType is not provided (avoids performance regression from PR #21)
      let resolvedConnectionType = connectionType;
      if (!resolvedConnectionType) {
        const env = await client.get(`/api/environments/${encodePath(environmentId)}`) as Record<string, unknown>;
        resolvedConnectionType = (env.connectionType as string) ?? '';
      }
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
      resolveHostPort(body, { host, port, url }, resolvedConnectionType, false);
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}`, body));
    }
  );

  registerTool(server, 'delete_environment', 'Permanently delete a Dockhand environment and remove it from Dockhand. This is irreversible — use `get_environment` to confirm the target before deleting, or `list_environments` to review all registered environments.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.delete(`/api/environments/${encodePath(environmentId)}`));
    }
  );

  registerTool(server, 'test_environment', 'Test Docker connectivity for an already-saved Dockhand environment by ID; validates that the stored connection config still reaches the host. Use `test_environment_connection` instead to probe a connection before saving, or `detect_docker_socket` to auto-discover the local socket.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/test`));
    }
  );

  registerTool(server, 'test_environment_connection', 'Probe a Docker connection with supplied parameters without saving an environment — useful for validating credentials before calling `create_environment`. For hawser-standard provide host/port or a URL; contrast with `test_environment` which tests an existing saved environment by ID.',
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

  registerTool(server, 'detect_docker_socket', 'Auto-detect the Docker socket path on the Dockhand server — useful when the socket location is unknown before calling `create_environment` or `test_environment_connection`. Returns the discovered socket path for use as socketPath in environment configuration.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/environments/detect-socket'));
    }
  );

  registerTool(server, 'get_environment_timezone', 'Retrieve the configured timezone string for a Dockhand environment. Use `set_environment_timezone` to change it; see also `get_environment_update_check` and `get_environment_image_prune` for other per-environment settings.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/timezone`));
    }
  );

  registerTool(server, 'set_environment_timezone', 'Configure the timezone for a Dockhand environment (e.g. Europe/Berlin). Use `get_environment_timezone` to read the current value; see also `set_environment_update_check` and `set_environment_image_prune` for related settings.',
    {
      environmentId: z.number().describe('Environment ID'),
      timezone: z.string().describe('Timezone string (e.g. Europe/Berlin)'),
    },
    async ({ environmentId, timezone }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/timezone`, { timezone }));
    }
  );

  registerTool(server, 'get_environment_update_check', 'Retrieve the automatic image update-check settings for a Dockhand environment. Use `set_environment_update_check` to change them; see also `get_environment_timezone` and `get_environment_image_prune` for other per-environment settings.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/update-check`));
    }
  );

  registerTool(server, 'set_environment_update_check', 'Configure automatic image update-check settings for a Dockhand environment. Use `get_environment_update_check` to read the current values; see also `set_environment_timezone` and `set_environment_image_prune` for related settings.',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.string(), z.unknown()).describe('Update-check settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/update-check`, settings));
    }
  );

  registerTool(server, 'get_environment_image_prune', 'Retrieve the image prune settings for a Dockhand environment (schedule and retention policy). Use `set_environment_image_prune` to change them; see also `get_environment_timezone` and `get_environment_update_check` for other per-environment settings.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/image-prune`));
    }
  );

  registerTool(server, 'set_environment_image_prune', 'Configure the image prune policy for a Dockhand environment (schedule and retention). Use `get_environment_image_prune` to read the current settings; see also `set_environment_timezone` and `set_environment_update_check` for related settings.',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.string(), z.unknown()).describe('Image prune settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/image-prune`, settings));
    }
  );

  registerTool(server, 'list_environment_notifications', 'List all notification channels configured for a Dockhand environment. Use `create_environment_notification` to add one, `get_environment_notification` to inspect a single entry, or `delete_environment_notification` to remove one.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/notifications`));
    }
  );

  registerTool(server, 'create_environment_notification', 'Add a new notification channel to a Dockhand environment using the supplied configuration. Use `list_environment_notifications` to see existing entries, `get_environment_notification` to inspect one, or `delete_environment_notification` to remove one.',
    {
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.string(), z.unknown()).describe('Notification configuration'),
    },
    async ({ environmentId, config }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/notifications`, config));
    }
  );

  registerTool(server, 'get_environment_notification', 'Retrieve details of a single notification channel for a Dockhand environment by notification ID. Use `list_environment_notifications` to discover IDs, `create_environment_notification` to add one, or `delete_environment_notification` to remove one.',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'delete_environment_notification', 'Permanently delete a notification channel from a Dockhand environment — this action cannot be undone. Use `list_environment_notifications` or `get_environment_notification` to confirm the target before removing, or `create_environment_notification` to add a replacement.',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.delete(`/api/environments/${encodePath(environmentId)}/notifications/${encodePath(notificationId)}`));
    }
  );
}
