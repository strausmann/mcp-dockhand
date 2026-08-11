/**
 * System, health, settings, and pruning tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';

export function registerSystemTools(server: McpServer, client: DockhandClient): void {

  // --- Health ---

  registerTool(server, 'health_check',
    {},
    async () => {
      return jsonResponse(await client.get('/api/health'));
    }
  );

  registerTool(server, 'health_check_database',
    {},
    async () => {
      return jsonResponse(await client.get('/api/health/database'));
    }
  );

  // --- System Info ---

  registerTool(server, 'get_host_info',
    {},
    async () => {
      return jsonResponse(await client.get('/api/host'));
    }
  );

  registerTool(server, 'get_system_info',
    {},
    async () => {
      return jsonResponse(await client.get('/api/system'));
    }
  );

  registerTool(server, 'get_system_disk',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/system/disk', { env: environmentId }));
    }
  );

  registerTool(server, 'list_system_files',
    {
      path: z.string().optional().describe('Directory path'),
    },
    async ({ path }) => {
      return jsonResponse(await client.get('/api/system/files', path ? { path } : undefined));
    }
  );

  registerTool(server, 'get_system_file_content',
    {
      path: z.string().describe('File path'),
    },
    async ({ path }) => {
      return textResponse(await client.get('/api/system/files/content', { path }));
    }
  );

  registerTool(server, 'get_changelog',
    {},
    async () => {
      return jsonResponse(await client.get('/api/changelog'));
    }
  );

  registerTool(server, 'get_dependencies',
    {},
    async () => {
      return jsonResponse(await client.get('/api/dependencies'));
    }
  );

  // --- Settings ---

  registerTool(server, 'get_general_settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/general'));
    }
  );

  registerTool(server, 'update_general_settings',
    {
      settings: z.record(z.string(), z.unknown()).describe('Settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.post('/api/settings/general', settings));
    }
  );

  // Page slugs the landing/env-click navigation preferences can target — the
  // same allowlist Dockhand validates against server-side (nav-preferences-core.ts
  // PAGE_SLUGS, v1.0.41). Kept as a literal list here (not imported — this
  // package has no dependency on the Dockhand source tree); re-verify against
  // the real handler if Dockhand adds/removes a sidebar page.
  const NAV_PAGE_SLUGS = [
    'dashboard', 'containers', 'logs', 'terminal', 'stacks', 'images', 'volumes',
    'networks', 'templates', 'registry', 'activity', 'backups', 'schedules', 'audit',
  ] as const;
  // env-click is always a concrete page, never 'dashboard' — the handler's
  // parseNavPatch() throws on 'dashboard' for this field specifically
  // (nav-preferences-core.ts). Enforced here too so an invalid value is
  // rejected client-side instead of round-tripping to a 400.
  const NAV_ENV_CLICK_PAGE_SLUGS = [
    'containers', 'logs', 'terminal', 'stacks', 'images', 'volumes',
    'networks', 'templates', 'registry', 'activity', 'backups', 'schedules', 'audit',
  ] as const;

  registerTool(server, 'get_navigation_settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/navigation'));
    }
  );

  registerTool(server, 'update_navigation_settings',
    {
      scope: z.enum(['global', 'user']).optional().describe('Preference scope to update — "global" (default; requires settings:edit) writes the instance default, "user" writes the current session\'s per-user override (requires an authenticated session; 401 if auth is off or no session)'),
      landingPage: z.enum(NAV_PAGE_SLUGS).nullable().optional().describe('Page to land on after login/root navigation. Omit to leave unchanged; pass null (or "") to clear the override (falls back to the global default, and ultimately "dashboard").'),
      envClickPage: z.enum(NAV_ENV_CLICK_PAGE_SLUGS).nullable().optional().describe('Page to open when clicking an environment tile on the Dashboard. Never "dashboard" (the backend rejects that value — you already clicked an environment, landing back on the dashboard makes no sense). Omit to leave unchanged; pass null (or "") to clear the override (falls back to the global default, and ultimately "containers").'),
    },
    async ({ scope, landingPage, envClickPage }) => {
      const body: Record<string, unknown> = {};
      if (landingPage !== undefined) body.landingPage = landingPage;
      if (envClickPage !== undefined) body.envClickPage = envClickPage;
      const params = scope !== undefined ? { scope } : undefined;
      return jsonResponse(await client.put('/api/settings/navigation', body, params));
    }
  );

  registerTool(server, 'get_theme_settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/theme'));
    }
  );

  registerTool(server, 'get_scanner_settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/scanner'));
    }
  );

  registerTool(server, 'update_scanner_settings',
    {
      settings: z.record(z.string(), z.unknown()).describe('Scanner settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.post('/api/settings/scanner', settings));
    }
  );

  // --- License ---

  registerTool(server, 'get_license',
    {},
    async () => {
      return jsonResponse(await client.get('/api/license'));
    }
  );

  registerTool(server, 'activate_license',
    {
      name: z.string().describe('License holder/organization name (required by the real endpoint alongside the key)'),
      licenseKey: z.string().describe('License key'),
    },
    async ({ name, licenseKey }) => {
      return jsonResponse(await client.post('/api/license', { name, key: licenseKey }));
    }
  );

  // --- Metrics ---

  registerTool(server, 'get_prometheus_metrics',
    {},
    async () => {
      return textResponse(await client.get('/api/metrics'));
    }
  );

  // --- Pruning ---

  registerTool(server, 'prune_all',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/all', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_containers',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/containers', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_images',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/images', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_networks',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/networks', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'prune_volumes',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/prune/volumes', undefined, { env: environmentId }));
    }
  );

  // --- Batch ---

  registerTool(server, 'execute_batch',
    {
      environmentId: z.number().optional().describe('Environment ID the entities belong to'),
      operation: z.string().describe('Operation to run. Valid per entityType: containers = start|stop|restart|pause|unpause|remove; images|volumes|networks = remove; stacks = start|stop|restart|down|remove (required by the real endpoint)'),
      entityType: z.enum(['containers', 'images', 'volumes', 'networks', 'stacks']).describe('Type of entity the batch operation targets (required by the real endpoint)'),
      items: z.array(z.object({
        id: z.string().describe('Entity ID or name to operate on'),
        name: z.string().describe('Entity display name (used for cleanup bookkeeping on container removal, and in progress reporting)'),
      })).min(1).describe('Entities to process; must be a non-empty array (required by the real endpoint)'),
      options: z.object({
        force: z.boolean().optional().describe('Force the operation where applicable (e.g. force-remove a running container or in-use image/volume)'),
        removeVolumes: z.boolean().optional().describe('For stacks with operation "down": also remove named volumes'),
      }).optional().describe('Optional per-operation flags'),
    },
    async ({ environmentId, operation, entityType, items, options }) => {
      const body: Record<string, unknown> = { operation, entityType, items };
      if (options !== undefined) body.options = options;
      return jsonResponse(await client.post('/api/batch', body, { env: environmentId }));
    }
  );

  // --- Legal ---

  registerTool(server, 'get_legal_license',
    {},
    async () => {
      return textResponse(await client.get('/api/legal/license'));
    }
  );

  registerTool(server, 'get_privacy_policy',
    {},
    async () => {
      return textResponse(await client.get('/api/legal/privacy'));
    }
  );

  registerTool(server, 'deactivate_license',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/license'));
    }
  );

  registerTool(server, 'write_system_file',
    {
      path: z.string().describe('Absolute path on the Dockhand server to create as a directory'),
    },
    async ({ path }) => {
      return jsonResponse(await client.post('/api/system/files', { path }));
    }
  );

  registerTool(server, 'reset_scanner_settings',
    {
      environmentId: z.number().describe('Environment ID (required by the real endpoint)'),
      removeImages: z.boolean().describe('Must be true to confirm scanner image removal (required by the real endpoint)'),
      scanner: z.enum(['grype', 'trivy']).optional().describe('Limit removal to one scanner; omit to remove both'),
    },
    async ({ environmentId, removeImages, scanner }) => {
      const query: Record<string, string | number | undefined> = { env: environmentId };
      if (removeImages) query.removeImages = 'true';
      if (scanner) query.scanner = scanner;
      return jsonResponse(await client.delete('/api/settings/scanner', query));
    }
  );

  registerTool(server, 'clear_scanner_cache',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/settings/scanner/cache'));
    }
  );
}
