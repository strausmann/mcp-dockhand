/**
 * User and role management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerUserTools(server: McpServer, client: DockhandClient): void {

  // --- Users ---

  registerTool(server, 'list_users',
    {},
    async () => {
      return jsonResponse(await client.get('/api/users'));
    }
  );

  registerTool(server, 'create_user',
    {
      username: z.string().describe('Username'),
      password: z.string().describe('Password'),
      email: z.string().optional().describe('Email address'),
      roles: z.array(z.string()).optional().describe('Role names to assign'),
    },
    async ({ username, password, email, roles }) => {
      const body: Record<string, unknown> = { username, password };
      if (email) body.email = email;
      if (roles) body.roles = roles;
      return jsonResponse(await client.post('/api/users', body));
    }
  );

  registerTool(server, 'get_user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.get(`/api/users/${encodePath(userId)}`));
    }
  );

  registerTool(server, 'update_user',
    {
      userId: z.number().describe('User ID'),
      settings: z.record(z.string(), z.unknown()).describe('User settings to update'),
    },
    async ({ userId, settings }) => {
      return jsonResponse(await client.put(`/api/users/${encodePath(userId)}`, settings));
    }
  );

  registerTool(server, 'delete_user',
    {
      userId: z.number().describe('User ID'),
      confirmDisableAuth: z.boolean().optional().describe('Confirm deleting the last remaining admin user, which disables authentication (only required when userId is the last admin — the real endpoint 409s without it)'),
    },
    async ({ userId, confirmDisableAuth }) => {
      const query: Record<string, string | number | undefined> = {};
      if (confirmDisableAuth) query.confirmDisableAuth = 'true';
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}`, query));
    }
  );

  registerTool(server, 'enable_user_mfa',
    {
      userId: z.number().describe('User ID'),
      // Dockhand 1.0.42 rejects any action other than "setup"/"verify" (#1399: a
      // stray empty POST used to destroy a live enrolment). An omitted action still
      // means "setup" — the handler reads the body via
      // `request.json().catch(() => ({}))` — but we send it explicitly and always:
      // it makes the intent unambiguous at the call site, and the OpenAPI contract
      // marks the field required (`action:string!`), which the validator gates on.
      action: z.enum(['setup', 'verify']).default('setup').describe('"setup" (default) regenerates the secret; "verify" confirms a code and requires token'),
      token: z.string().optional().describe('The TOTP code — required when action is "verify"'),
    },
    async ({ userId, action, token }) => {
      const body: Record<string, unknown> = { action };
      if (token !== undefined) body.token = token;
      return jsonResponse(await client.post(`/api/users/${encodePath(userId)}/mfa`, body));
    }
  );

  registerTool(server, 'disable_user_mfa',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}/mfa`));
    }
  );

  registerTool(server, 'get_user_roles',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.get(`/api/users/${encodePath(userId)}/roles`));
    }
  );

  registerTool(server, 'add_user_role',
    {
      userId: z.number().describe('User ID'),
      roleId: z.number().describe('Role ID to assign (required by the real endpoint)'),
      environmentId: z.number().optional().describe('Scope this role assignment to a single environment; omit for an unscoped (all-environments) assignment'),
    },
    async ({ userId, roleId, environmentId }) => {
      const body: Record<string, unknown> = { roleId };
      if (environmentId !== undefined) body.environmentId = environmentId;
      return jsonResponse(await client.post(`/api/users/${encodePath(userId)}/roles`, body));
    }
  );

  registerTool(server, 'remove_user_role',
    {
      userId: z.number().describe('User ID'),
      roleId: z.number().describe('Role ID to remove (required by the real endpoint)'),
      environmentId: z.number().optional().describe('Only remove the assignment scoped to this environment; omit to remove the unscoped (all-environments) assignment'),
    },
    async ({ userId, roleId, environmentId }) => {
      const body: Record<string, unknown> = { roleId };
      if (environmentId !== undefined) body.environmentId = environmentId;
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}/roles`, undefined, body));
    }
  );

  // --- Roles ---

  registerTool(server, 'list_roles',
    {},
    async () => {
      return jsonResponse(await client.get('/api/roles'));
    }
  );

  registerTool(server, 'create_role',
    {
      name: z.string().describe('Role name'),
      permissions: z.record(z.string(), z.array(z.string())).describe('Permissions object mapping resource categories (e.g. containers, images, volumes, networks, stacks, environments, registries, notifications, configsets, settings, users, git, license, audit_logs, activity, schedules, backups) to arrays of allowed action strings; required by the real endpoint'),
      description: z.string().optional().describe('Role description'),
      environmentIds: z.array(z.number()).optional().describe('Environment IDs this role is scoped to (enterprise environment-scoped roles)'),
    },
    async ({ name, permissions, description, environmentIds }) => {
      const body: Record<string, unknown> = { name, permissions };
      if (description !== undefined) body.description = description;
      if (environmentIds !== undefined) body.environmentIds = environmentIds;
      return jsonResponse(await client.post('/api/roles', body));
    }
  );

  registerTool(server, 'get_role',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      return jsonResponse(await client.get(`/api/roles/${encodePath(roleId)}`));
    }
  );

  registerTool(server, 'update_role',
    {
      roleId: z.number().describe('Role ID'),
      config: z.record(z.string(), z.unknown()).describe('Role configuration to update'),
    },
    async ({ roleId, config }) => {
      return jsonResponse(await client.put(`/api/roles/${encodePath(roleId)}`, config));
    }
  );

  registerTool(server, 'delete_role',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      return jsonResponse(await client.delete(`/api/roles/${encodePath(roleId)}`));
    }
  );

  // --- Profile ---

  registerTool(server, 'get_profile',
    {},
    async () => {
      return jsonResponse(await client.get('/api/profile'));
    }
  );

  registerTool(server, 'update_profile',
    {
      settings: z.record(z.string(), z.unknown()).describe('Profile settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/profile', settings));
    }
  );

  registerTool(server, 'get_profile_preferences',
    {},
    async () => {
      return jsonResponse(await client.get('/api/profile/preferences'));
    }
  );

  registerTool(server, 'update_profile_preferences',
    {
      preferences: z.record(z.string(), z.unknown()).describe('Preferences to update'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.put('/api/profile/preferences', preferences));
    }
  );

  // --- UI Preferences ---

  registerTool(server, 'get_favorites',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/preferences/favorites', { env: environmentId }));
    }
  );

  registerTool(server, 'set_favorites',
    {
      environmentId: z.number().describe('Environment ID'),
      favorites: z.array(z.unknown()).describe('Favorites list'),
    },
    async ({ environmentId, favorites }) => {
      return jsonResponse(await client.post('/api/preferences/favorites', {
        environmentId,
        action: 'reorder',
        favorites,
      }));
    }
  );

  registerTool(server, 'get_favorite_groups',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/preferences/favorite-groups', { env: environmentId }));
    }
  );

  registerTool(server, 'set_favorite_groups',
    {
      environmentId: z.number().describe('Environment ID'),
      groups: z.array(z.unknown()).describe('Favorite groups'),
    },
    async ({ environmentId, groups }) => {
      return jsonResponse(await client.post('/api/preferences/favorite-groups', {
        environmentId,
        action: 'reorder',
        groups,
      }));
    }
  );

  registerTool(server, 'get_grid_preferences',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/grid'));
    }
  );

  registerTool(server, 'set_grid_preferences',
    {
      preferences: z.record(z.string(), z.unknown()).describe('Grid preferences'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.post('/api/preferences/grid', preferences));
    }
  );

  // --- Config Sets ---

  registerTool(server, 'list_config_sets',
    {},
    async () => {
      return jsonResponse(await client.get('/api/config-sets'));
    }
  );

  registerTool(server, 'create_config_set',
    {
      config: z.record(z.string(), z.unknown()).describe('Config set data'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/config-sets', config));
    }
  );

  registerTool(server, 'get_config_set',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      return jsonResponse(await client.get(`/api/config-sets/${encodePath(configSetId)}`));
    }
  );

  registerTool(server, 'update_config_set',
    {
      configSetId: z.number().describe('Config set ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated config set data'),
    },
    async ({ configSetId, config }) => {
      return jsonResponse(await client.put(`/api/config-sets/${encodePath(configSetId)}`, config));
    }
  );

  registerTool(server, 'delete_config_set',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      return jsonResponse(await client.delete(`/api/config-sets/${encodePath(configSetId)}`));
    }
  );

  registerTool(server, 'clear_user_roles',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}/roles`));
    }
  );

  registerTool(server, 'reset_grid_preferences',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/preferences/grid'));
    }
  );
}
