/**
 * User and role management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerUserTools(server: McpServer, client: DockhandClient): void {

  // --- Users ---

  server.tool(
    'list_users',
    'List all Dockhand users',
    {},
    async () => {
      const data = await client.get('/api/users');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_user',
    'Create a new Dockhand user',
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
      const data = await client.post('/api/users', body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_user',
    'Get details of a Dockhand user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      const data = await client.get(`/api/users/${userId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_user',
    'Update a Dockhand user',
    {
      userId: z.number().describe('User ID'),
      settings: z.record(z.unknown()).describe('User settings to update'),
    },
    async ({ userId, settings }) => {
      const data = await client.put(`/api/users/${userId}`, settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_user',
    'Delete a Dockhand user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      const data = await client.delete(`/api/users/${userId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_user_mfa_status',
    'Get MFA status of a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      const data = await client.get(`/api/users/${userId}/mfa`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'enable_user_mfa',
    'Enable MFA for a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      const data = await client.post(`/api/users/${userId}/mfa`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'disable_user_mfa',
    'Disable MFA for a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      const data = await client.delete(`/api/users/${userId}/mfa`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_user_roles',
    'Get roles assigned to a user',
    { userId: z.number().describe('User ID') },
    async ({ userId }) => {
      const data = await client.get(`/api/users/${userId}/roles`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_user_roles',
    'Set roles for a user',
    {
      userId: z.number().describe('User ID'),
      roles: z.array(z.string()).describe('Role names to assign'),
    },
    async ({ userId, roles }) => {
      const data = await client.put(`/api/users/${userId}/roles`, { roles });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Roles ---

  server.tool(
    'list_roles',
    'List all Dockhand roles',
    {},
    async () => {
      const data = await client.get('/api/roles');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_role',
    'Create a new Dockhand role',
    {
      name: z.string().describe('Role name'),
      permissions: z.array(z.string()).optional().describe('Permissions to grant'),
    },
    async ({ name, permissions }) => {
      const body: Record<string, unknown> = { name };
      if (permissions) body.permissions = permissions;
      const data = await client.post('/api/roles', body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_role',
    'Get details of a Dockhand role',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      const data = await client.get(`/api/roles/${roleId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_role',
    'Update a Dockhand role',
    {
      roleId: z.number().describe('Role ID'),
      config: z.record(z.unknown()).describe('Role configuration to update'),
    },
    async ({ roleId, config }) => {
      const data = await client.put(`/api/roles/${roleId}`, config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_role',
    'Delete a Dockhand role',
    { roleId: z.number().describe('Role ID') },
    async ({ roleId }) => {
      const data = await client.delete(`/api/roles/${roleId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Profile ---

  server.tool(
    'get_profile',
    'Get the current user profile',
    {},
    async () => {
      const data = await client.get('/api/profile');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_profile',
    'Update the current user profile',
    {
      settings: z.record(z.unknown()).describe('Profile settings to update'),
    },
    async ({ settings }) => {
      const data = await client.put('/api/profile', settings);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_profile_preferences',
    'Get profile preferences',
    {},
    async () => {
      const data = await client.get('/api/profile/preferences');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_profile_preferences',
    'Update profile preferences',
    {
      preferences: z.record(z.unknown()).describe('Preferences to update'),
    },
    async ({ preferences }) => {
      const data = await client.put('/api/profile/preferences', preferences);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- UI Preferences ---

  server.tool(
    'get_favorites',
    'Get favorite containers/stacks',
    {},
    async () => {
      const data = await client.get('/api/preferences/favorites');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_favorites',
    'Set favorite containers/stacks',
    {
      favorites: z.array(z.unknown()).describe('Favorites list'),
    },
    async ({ favorites }) => {
      const data = await client.put('/api/preferences/favorites', favorites);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_favorite_groups',
    'Get favorite groups',
    {},
    async () => {
      const data = await client.get('/api/preferences/favorite-groups');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_favorite_groups',
    'Set favorite groups',
    {
      groups: z.array(z.unknown()).describe('Favorite groups'),
    },
    async ({ groups }) => {
      const data = await client.put('/api/preferences/favorite-groups', groups);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_grid_preferences',
    'Get grid display preferences',
    {},
    async () => {
      const data = await client.get('/api/preferences/grid');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'set_grid_preferences',
    'Set grid display preferences',
    {
      preferences: z.record(z.unknown()).describe('Grid preferences'),
    },
    async ({ preferences }) => {
      const data = await client.put('/api/preferences/grid', preferences);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Config Sets ---

  server.tool(
    'list_config_sets',
    'List all config sets',
    {},
    async () => {
      const data = await client.get('/api/config-sets');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_config_set',
    'Create a new config set',
    {
      config: z.record(z.unknown()).describe('Config set data'),
    },
    async ({ config }) => {
      const data = await client.post('/api/config-sets', config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_config_set',
    'Get a specific config set',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      const data = await client.get(`/api/config-sets/${configSetId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_config_set',
    'Update a config set',
    {
      configSetId: z.number().describe('Config set ID'),
      config: z.record(z.unknown()).describe('Updated config set data'),
    },
    async ({ configSetId, config }) => {
      const data = await client.put(`/api/config-sets/${configSetId}`, config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_config_set',
    'Delete a config set',
    { configSetId: z.number().describe('Config set ID') },
    async ({ configSetId }) => {
      const data = await client.delete(`/api/config-sets/${configSetId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
