/**
 * Environment (Docker Host) management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

/**
 * Field names on a Dockhand environment payload that a routine lookup must never hand
 * back (Issue #232):
 *   - `hawserToken` — the agent token a node uses to register itself over the Dockhand
 *     WebSocket. Dedicated tools already own issuing/inspecting it (list_hawser_tokens /
 *     create_hawser_token / revoke_hawser_token, src/tools/auth.ts).
 *   - `tlsKey` — the decrypted private TLS client key, for `direct`/`hawser-standard`
 *     environments configured with mutual TLS. The heavier of the two: a private key,
 *     not a revocable node token.
 *
 * Both are decrypted at the data-access layer and land in the row returned to every
 * caller — verified against the real upstream code (Finsys/dockhand v1.0.44,
 * src/lib/server/db.ts): getEnvironments()/getEnvironment()/createEnvironment() all
 * `decrypt(e.tlsKey)` and `decrypt(e.hawserToken)` before returning, and
 * updateEnvironment() ends by calling getEnvironment() (same decryption). This is NOT a
 * deliberate response shape: every sibling credential-bearing endpoint (registries,
 * LDAP, OIDC) explicitly strips its secret before responding in its own route handler
 * (`const { password, ...safeRegistry } = registry`, a `sanitized` object for LDAP/OIDC
 * configs) — only the environments routes spread the row as-is. Whoever reads this in a
 * year: this list is a fix for an oversight, not curation of an endpoint that answers
 * this way on purpose.
 *
 * Deliberately an explicit list, not a heuristic over field names: a pattern like
 * /token|secret|key/i would also catch a field like `tokenCount`, and a false positive
 * here silently drops data a caller needs. The trade-off is that this list is NOT
 * notified when Dockhand adds a new credential field upstream — extend it here if
 * one more shows up (checked at the time of writing: tlsCa/tlsCert are the public CA
 * and client certificate, never encrypted/decrypted in db.ts, so they are not secrets
 * and are intentionally left out).
 *
 * Also applied to create_environment/update_environment: verified against the real
 * upstream handlers (Finsys/dockhand v1.0.44, src/routes/api/environments/+server.ts
 * and src/routes/api/environments/[id]/+server.ts) that POST and PUT both respond with
 * `json(env)` / `{ ...env, ... }` — the same full DB row as GET, both fields included.
 * test_environment and test_environment_connection do NOT need this: both build a
 * curated `{ success, info, isEdgeMode, hawser: {...} }` object by hand and never
 * spread the environment row (verified against the same handlers).
 */
const ENVIRONMENT_CREDENTIAL_FIELDS = ['hawserToken', 'tlsKey'] as const;

/**
 * Returns a shallow copy of a single environment object with every field in
 * ENVIRONMENT_CREDENTIAL_FIELDS removed. Every other field passes through unchanged.
 * Non-object input (defensive — the Dockhand API is expected to always answer with an
 * object here) is returned as-is rather than thrown on.
 */
function stripEnvironmentCredentials(env: unknown): unknown {
  if (typeof env !== 'object' || env === null) return env;
  const copy = { ...(env as Record<string, unknown>) };
  for (const field of ENVIRONMENT_CREDENTIAL_FIELDS) {
    delete copy[field];
  }
  return copy;
}

/**
 * Applies stripEnvironmentCredentials across a list_environments payload (an array of
 * environment objects). Non-array input is returned as-is, defensively.
 */
function stripEnvironmentListCredentials(payload: unknown): unknown {
  if (!Array.isArray(payload)) return payload;
  return payload.map(stripEnvironmentCredentials);
}

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

  registerTool(server, 'list_environments',
    {},
    async () => {
      return jsonResponse(stripEnvironmentListCredentials(await client.get('/api/environments')));
    }
  );

  registerTool(server, 'get_environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(stripEnvironmentCredentials(await client.get(`/api/environments/${encodePath(environmentId)}`)));
    }
  );

  registerTool(server, 'create_environment',
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
      return jsonResponse(stripEnvironmentCredentials(await client.post('/api/environments', body)));
    }
  );

  // Fix #30 (HIGH): Accept optional connectionType param to skip redundant GET request.
  // Only fetches environment via GET when connectionType is not provided by the caller.
  registerTool(server, 'update_environment',
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
      return jsonResponse(stripEnvironmentCredentials(await client.put(`/api/environments/${encodePath(environmentId)}`, body)));
    }
  );

  registerTool(server, 'delete_environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.delete(`/api/environments/${encodePath(environmentId)}`));
    }
  );

  registerTool(server, 'test_environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/test`));
    }
  );

  registerTool(server, 'test_environment_connection',
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

  registerTool(server, 'detect_docker_socket',
    {},
    async () => {
      return jsonResponse(await client.get('/api/environments/detect-socket'));
    }
  );

  registerTool(server, 'get_environment_timezone',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/timezone`));
    }
  );

  registerTool(server, 'set_environment_timezone',
    {
      environmentId: z.number().describe('Environment ID'),
      timezone: z.string().describe('Timezone string (e.g. Europe/Berlin)'),
    },
    async ({ environmentId, timezone }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/timezone`, { timezone }));
    }
  );

  registerTool(server, 'get_environment_remote_stacks_dir',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/remote-stacks-dir`));
    }
  );

  registerTool(server, 'set_environment_remote_stacks_dir',
    {
      environmentId: z.number().describe('Environment ID'),
      remoteStacksDir: z.string().nullable().describe('Absolute path on the remote host where Dockhand stages this environment\'s stack files before "docker compose up" — needed for direct (agentless) environments, whose daemon has no shared filesystem with Dockhand so relative bind mounts (./config.yaml) never reach it. Must be an absolute path with no ".." segments. Pass null (or "") to clear the setting and revert to the default behavior.'),
    },
    async ({ environmentId, remoteStacksDir }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/remote-stacks-dir`, { remoteStacksDir }));
    }
  );

  registerTool(server, 'get_environment_update_check',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/update-check`));
    }
  );

  registerTool(server, 'set_environment_update_check',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.string(), z.unknown()).describe('Update-check settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/update-check`, settings));
    }
  );

  registerTool(server, 'get_environment_image_prune',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/image-prune`));
    }
  );

  registerTool(server, 'set_environment_image_prune',
    {
      environmentId: z.number().describe('Environment ID'),
      settings: z.record(z.string(), z.unknown()).describe('Image prune settings'),
    },
    async ({ environmentId, settings }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/image-prune`, settings));
    }
  );

  registerTool(server, 'list_environment_notifications',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/notifications`));
    }
  );

  registerTool(server, 'create_environment_notification',
    {
      environmentId: z.number().describe('Environment ID'),
      config: z.record(z.string(), z.unknown()).describe('Notification configuration'),
    },
    async ({ environmentId, config }) => {
      return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/notifications`, config));
    }
  );

  registerTool(server, 'get_environment_notification',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.get(`/api/environments/${encodePath(environmentId)}/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'delete_environment_notification',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
    },
    async ({ environmentId, notificationId }) => {
      return jsonResponse(await client.delete(`/api/environments/${encodePath(environmentId)}/notifications/${encodePath(notificationId)}`));
    }
  );

  registerTool(server, 'update_environment_notification',
    {
      environmentId: z.number().describe('Environment ID'),
      notificationId: z.number().describe('Notification ID'),
      config: z.record(z.string(), z.unknown()).describe('Notification configuration to merge'),
    },
    async ({ environmentId, notificationId, config }) => {
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/notifications/${encodePath(notificationId)}`, config));
    }
  );

  registerTool(server, 'trigger_environment_image_prune',
    {
      environmentId: z.number().describe('Environment ID'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/image-prune`, undefined));
    }
  );
}
