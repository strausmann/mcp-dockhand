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

  registerTool(server, 'list_users', 'List all Dockhand users',
    {},
    async () => {
      return jsonResponse(await client.get('/api/users'));
    }
  );

  registerTool(server, 'create_user', 'Create a new Dockhand user',
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

  registerTool(server, 'get_user', 'Get details of a Dockhand user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.get(`/api/users/${encodePath(userId)}`));
    }
  );

  registerTool(server, 'update_user', 'Update a Dockhand user',
    {
      userId: z.number().describe('User ID'),
      settings: z.record(z.unknown()).describe('User settings to update'),
    },
    async ({ userId, settings }) => {
      return jsonResponse(await client.put(`/api/users/${encodePath(userId)}`, settings));
    }
  );

  registerTool(server, 'delete_user', 'Delete a Dockhand user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}`));
    }
  );

  registerTool(server, 'get_user_mfa_status', 'Get MFA status of a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.get(`/api/users/${encodePath(userId)}/mfa`));
    }
  );

  registerTool(server, 'enable_user_mfa', 'Enable MFA for a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.post(`/api/users/${encodePath(userId)}/mfa`));
    }
  );

  registerTool(server, 'disable_user_mfa', 'Disable MFA for a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}/mfa`));
    }
  );

  registerTool(server, 'get_user_roles', 'Get roles assigned to a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.get(`/api/users/${encodePath(userId)}/roles`));
    }
  );

  registerTool(server, 'set_user_roles', 'Set roles for a user',
    {
      userId: z.number().describe('User ID'),
      roles: z.array(z.string()).describe('Role names to assign'),
    },
    async ({ userId, roles }) => {
      return jsonResponse(await client.put(`/api/users/${encodePath(userId)}/roles`, { roles }));
    }
  );

  // --- Roles ---

  registerTool(server, 'list_roles', 'List all Dockhand roles',
    {},
    async () => {
      return jsonResponse(await client.get('/api/roles'));
    }
  );

  registerTool(server, 'create_role', 'Create a new Dockhand role',
    {
      name: z.string().describe('Role name'),
      permissions: z.array(z.string()).optional().describe('Permissions to grant'),
    },
    async ({ name, permissions }) => {
      const body: Record<string, unknown> = { name };
      if (permissions) body.permissions = permissions;
      return jsonResponse(await client.post('/api/roles', body));
    }
  );

  registerTool(server, 'get_role', 'Get details of a Dockhand role',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      return jsonResponse(await client.get(`/api/roles/${encodePath(roleId)}`));
    }
  );

  registerTool(server, 'update_role', 'Update a Dockhand role',
    {
      roleId: z.number().describe('Role ID'),
      config: z.record(z.unknown()).describe('Role configuration to update'),
    },
    async ({ roleId, config }) => {
      return jsonResponse(await client.put(`/api/roles/${encodePath(roleId)}`, config));
    }
  );

  registerTool(server, 'delete_role', 'Delete a Dockhand role',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      return jsonResponse(await client.delete(`/api/roles/${encodePath(roleId)}`));
    }
  );

  // --- Profile ---

  registerTool(server, 'get_profile', 'Get the current user profile',
    {},
    async () => {
      return jsonResponse(await client.get('/api/profile'));
    }
  );

  registerTool(server, 'update_profile', 'Update the current user profile',
    {
      settings: z.record(z.unknown()).describe('Profile settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/profile', settings));
    }
  );

  registerTool(server, 'get_profile_preferences', 'Get profile preferences',
    {},
    async () => {
      return jsonResponse(await client.get('/api/profile/preferences'));
    }
  );

  registerTool(server, 'update_profile_preferences', 'Update profile preferences',
    {
      preferences: z.record(z.unknown()).describe('Preferences to update'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.put('/api/profile/preferences', preferences));
    }
  );

  // --- UI Preferences ---

  registerTool(server, 'get_favorites', 'Get favorite containers/stacks',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/favorites'));
    }
  );

  registerTool(server, 'set_favorites', 'Set favorite containers/stacks',
    {
      favorites: z.array(z.unknown()).describe('Favorites list'),
    },
    async ({ favorites }) => {
      return jsonResponse(await client.put('/api/preferences/favorites', favorites));
    }
  );

  registerTool(server, 'get_favorite_groups', 'Get favorite groups',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/favorite-groups'));
    }
  );

  registerTool(server, 'set_favorite_groups', 'Set favorite groups',
    {
      groups: z.array(z.unknown()).describe('Favorite groups'),
    },
    async ({ groups }) => {
      return jsonResponse(await client.put('/api/preferences/favorite-groups', groups));
    }
  );

  registerTool(server, 'get_grid_preferences', 'Get grid display preferences',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/grid'));
    }
  );

  registerTool(server, 'set_grid_preferences', 'Set grid display preferences',
    {
      preferences: z.record(z.unknown()).describe('Grid preferences'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.put('/api/preferences/grid', preferences));
    }
  );

  // --- Config Sets ---

  registerTool(server, 'list_config_sets', 'List all config sets',
    {},
    async () => {
      return jsonResponse(await client.get('/api/config-sets'));
    }
  );

  registerTool(server, 'create_config_set', 'Create a new config set',
    {
      config: z.record(z.unknown()).describe('Config set data'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/config-sets', config));
    }
  );

  registerTool(server, 'get_config_set', 'Get a specific config set',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      return jsonResponse(await client.get(`/api/config-sets/${encodePath(configSetId)}`));
    }
  );

  registerTool(server, 'update_config_set', 'Update a config set',
    {
      configSetId: z.number().describe('Config set ID'),
      config: z.record(z.unknown()).describe('Updated config set data'),
    },
    async ({ configSetId, config }) => {
      return jsonResponse(await client.put(`/api/config-sets/${encodePath(configSetId)}`, config));
    }
  );

  registerTool(server, 'delete_config_set', 'Delete a config set',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      return jsonResponse(await client.delete(`/api/config-sets/${encodePath(configSetId)}`));
    }
  );
}
