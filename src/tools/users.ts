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

  registerTool(server, 'list_users', 'List all Dockhand users; pair with `create_user` to provision new accounts.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/users'));
    }
  );

  registerTool(server, 'create_user', 'Create a new Dockhand user account with username and password; use `set_user_roles` to assign roles afterwards.',
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

  registerTool(server, 'get_user', 'Fetch details of a specific Dockhand user by ID; see `list_users` to discover user IDs.',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.get(`/api/users/${encodePath(userId)}`));
    }
  );

  registerTool(server, 'update_user', 'Update settings for any Dockhand user by ID (admin operation); use `get_user` to inspect current values before changing them.',
    {
      userId: z.number().describe('User ID'),
      settings: z.record(z.string(), z.unknown()).describe('User settings to update'),
    },
    async ({ userId, settings }) => {
      return jsonResponse(await client.put(`/api/users/${encodePath(userId)}`, settings));
    }
  );

  registerTool(server, 'delete_user', 'Permanently delete a Dockhand user account by ID; use `list_users` to confirm the target before removing.',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}`));
    }
  );

  registerTool(server, 'enable_user_mfa', 'Enable multi-factor authentication for a user account; pair with `disable_user_mfa` to toggle MFA status.',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.post(`/api/users/${encodePath(userId)}/mfa`));
    }
  );

  registerTool(server, 'disable_user_mfa', 'Disable multi-factor authentication for a user, reducing account security; use `enable_user_mfa` to restore MFA.',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}/mfa`));
    }
  );

  registerTool(server, 'get_user_roles', 'Retrieve the roles currently assigned to a user; use `set_user_roles` to update the assignment.',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.get(`/api/users/${encodePath(userId)}/roles`));
    }
  );

  registerTool(server, 'set_user_roles', 'Assign a list of roles to a user, replacing the current assignment; see `get_user_roles` to inspect existing roles before overwriting.',
    {
      userId: z.number().describe('User ID'),
      roles: z.array(z.string()).describe('Role names to assign'),
    },
    async ({ userId, roles }) => {
      return jsonResponse(await client.post(`/api/users/${encodePath(userId)}/roles`, { roles }));
    }
  );

  // --- Roles ---

  registerTool(server, 'list_roles', 'List all Dockhand roles available for assignment; use `create_role` to define new ones.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/roles'));
    }
  );

  registerTool(server, 'create_role', 'Create a new Dockhand role with a name and optional permissions; use `list_roles` to avoid duplicate role names.',
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

  registerTool(server, 'get_role', 'Fetch details and permissions of a specific Dockhand role by ID; see `list_roles` to discover role IDs.',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      return jsonResponse(await client.get(`/api/roles/${encodePath(roleId)}`));
    }
  );

  registerTool(server, 'update_role', 'Update the configuration of an existing Dockhand role; use `get_role` to inspect current settings before modifying.',
    {
      roleId: z.number().describe('Role ID'),
      config: z.record(z.string(), z.unknown()).describe('Role configuration to update'),
    },
    async ({ roleId, config }) => {
      return jsonResponse(await client.put(`/api/roles/${encodePath(roleId)}`, config));
    }
  );

  registerTool(server, 'delete_role', 'Permanently delete a Dockhand role by ID; use `list_roles` to confirm the target before removing.',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      return jsonResponse(await client.delete(`/api/roles/${encodePath(roleId)}`));
    }
  );

  // --- Profile ---

  registerTool(server, 'get_profile', 'Fetch the calling user\'s own profile data; use `update_profile` to modify self-service settings.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/profile'));
    }
  );

  registerTool(server, 'update_profile', 'Update the current (self) user profile settings; see `get_profile` to read current values first.',
    {
      settings: z.record(z.string(), z.unknown()).describe('Profile settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/profile', settings));
    }
  );

  registerTool(server, 'get_profile_preferences', 'Retrieve the current user\'s own profile preferences; use `update_profile_preferences` to change them.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/profile/preferences'));
    }
  );

  registerTool(server, 'update_profile_preferences', 'Update the self-user\'s own profile preferences; see `get_profile_preferences` to inspect current values.',
    {
      preferences: z.record(z.string(), z.unknown()).describe('Preferences to update'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.put('/api/profile/preferences', preferences));
    }
  );

  // --- UI Preferences ---

  registerTool(server, 'get_favorites', 'Retrieve the UI favorite containers and stacks; use `set_favorites` to update the list.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/favorites'));
    }
  );

  registerTool(server, 'set_favorites', 'Replace the UI favorites list with the provided containers/stacks; see `get_favorites` to read current entries before overwriting.',
    {
      favorites: z.array(z.unknown()).describe('Favorites list'),
    },
    async ({ favorites }) => {
      return jsonResponse(await client.post('/api/preferences/favorites', favorites));
    }
  );

  registerTool(server, 'get_favorite_groups', 'Retrieve the named groups used to organise UI favorites; use `set_favorite_groups` to save changes.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/favorite-groups'));
    }
  );

  registerTool(server, 'set_favorite_groups', 'Replace the UI favorite groups definition; see `get_favorite_groups` to read the existing groups before overwriting.',
    {
      groups: z.array(z.unknown()).describe('Favorite groups'),
    },
    async ({ groups }) => {
      return jsonResponse(await client.post('/api/preferences/favorite-groups', groups));
    }
  );

  registerTool(server, 'get_grid_preferences', 'Retrieve the UI grid display preferences (column widths, sort order, etc.); use `set_grid_preferences` to update them.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/grid'));
    }
  );

  registerTool(server, 'set_grid_preferences', 'Save UI grid display preferences such as column layout and sort order; see `get_grid_preferences` to read current settings.',
    {
      preferences: z.record(z.string(), z.unknown()).describe('Grid preferences'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.post('/api/preferences/grid', preferences));
    }
  );

  // --- Config Sets ---

  registerTool(server, 'list_config_sets', 'List all reusable config sets defined in Dockhand; use `create_config_set` to add new ones.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/config-sets'));
    }
  );

  registerTool(server, 'create_config_set', 'Create a new named config set for reuse across stacks; use `list_config_sets` to verify the name is unique.',
    {
      config: z.record(z.string(), z.unknown()).describe('Config set data'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/config-sets', config));
    }
  );

  registerTool(server, 'get_config_set', 'Fetch the content of a specific config set by ID; use `list_config_sets` to discover available IDs.',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      return jsonResponse(await client.get(`/api/config-sets/${encodePath(configSetId)}`));
    }
  );

  registerTool(server, 'update_config_set', 'Update an existing config set with new data; use `get_config_set` to read current values before overwriting.',
    {
      configSetId: z.number().describe('Config set ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated config set data'),
    },
    async ({ configSetId, config }) => {
      return jsonResponse(await client.put(`/api/config-sets/${encodePath(configSetId)}`, config));
    }
  );

  registerTool(server, 'delete_config_set', 'Permanently delete a config set by ID; use `list_config_sets` to confirm the target before removing.',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      return jsonResponse(await client.delete(`/api/config-sets/${encodePath(configSetId)}`));
    }
  );

  registerTool(server, 'clear_user_roles', 'Permanently remove every role assignment from a user (the user remains, but loses all permissions until reassigned); pair with `get_user_roles` to inspect first, or `set_user_roles` to re-assign roles afterwards.',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      return jsonResponse(await client.delete(`/api/users/${encodePath(userId)}/roles`));
    }
  );

  registerTool(server, 'reset_grid_preferences', 'Permanently delete the current user\'s grid layout preferences, falling back to defaults; read the current state with `get_grid_preferences` or set new values via `set_grid_preferences` instead of a full reset.',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/preferences/grid'));
    }
  );
}
