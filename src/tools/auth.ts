/**
 * Authentication and session management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerAuthTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_auth_session',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/session'));
    }
  );

  registerTool(server, 'get_auth_providers',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/providers'));
    }
  );

  registerTool(server, 'get_auth_settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/settings'));
    }
  );

  registerTool(server, 'create_oidc_provider',
    { config: z.record(z.string(), z.unknown()).describe('OIDC provider configuration') },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/auth/oidc', config));
    }
  );

  registerTool(server, 'get_oidc_provider',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/oidc/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'test_oidc_provider',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/oidc/${encodePath(providerId)}/test`));
    }
  );

  registerTool(server, 'initiate_oidc_login',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/oidc/${encodePath(providerId)}/initiate`));
    }
  );

  registerTool(server, 'create_ldap_provider',
    { config: z.record(z.string(), z.unknown()).describe('LDAP provider configuration') },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/auth/ldap', config));
    }
  );

  registerTool(server, 'get_ldap_provider',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/ldap/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'test_ldap_provider',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/ldap/${encodePath(providerId)}/test`));
    }
  );

  // --- Hawser Token Management ---

  registerTool(server, 'list_hawser_tokens',
    {},
    async () => {
      return jsonResponse(await client.get('/api/hawser/tokens'));
    }
  );

  registerTool(server, 'create_hawser_token',
    {
      name: z.string().describe('Token name'),
      environmentId: z.number().describe('Environment ID to associate'),
      expiresAt: z.string().optional().describe('Expiration date (ISO 8601)'),
    },
    async ({ name, environmentId, expiresAt }) => {
      const body: Record<string, unknown> = { name, environmentId };
      if (expiresAt) body.expiresAt = expiresAt;
      return jsonResponse(await client.post('/api/hawser/tokens', body));
    }
  );

  registerTool(server, 'revoke_hawser_token',
    { tokenId: z.string().describe('Token ID to revoke') },
    async ({ tokenId }) => {
      return jsonResponse(await client.delete('/api/hawser/tokens', { id: tokenId }));
    }
  );

  // --- Access Tokens (non-Hawser, API token management) ---

  registerTool(server, 'list_auth_tokens',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/tokens'));
    }
  );

  registerTool(server, 'create_auth_token',
    {
      name: z.string().describe('Human-readable token name'),
      expiresAt: z.string().optional().describe('Expiration date (ISO 8601); omit for non-expiring token'),
    },
    async ({ name, expiresAt }) => {
      const body: Record<string, unknown> = { name };
      if (expiresAt) body.expiresAt = expiresAt;
      return jsonResponse(await client.post('/api/auth/tokens', body));
    }
  );

  registerTool(server, 'revoke_auth_token',
    { tokenId: z.string().describe('Token ID to revoke') },
    async ({ tokenId }) => {
      return jsonResponse(await client.delete(`/api/auth/tokens/${encodePath(tokenId)}`));
    }
  );

  // --- LDAP / OIDC CRUD completion ---

  registerTool(server, 'list_ldap_providers',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/ldap'));
    }
  );

  registerTool(server, 'update_ldap_provider',
    {
      providerId: z.number().describe('LDAP provider ID'),
      config: z.record(z.string(), z.unknown()).describe('LDAP provider configuration to merge'),
    },
    async ({ providerId, config }) => {
      return jsonResponse(await client.put(`/api/auth/ldap/${encodePath(providerId)}`, config));
    }
  );

  registerTool(server, 'delete_ldap_provider',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.delete(`/api/auth/ldap/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'list_oidc_providers',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/oidc'));
    }
  );

  registerTool(server, 'update_oidc_provider',
    {
      providerId: z.number().describe('OIDC provider ID'),
      config: z.record(z.string(), z.unknown()).describe('OIDC provider configuration to merge'),
    },
    async ({ providerId, config }) => {
      return jsonResponse(await client.put(`/api/auth/oidc/${encodePath(providerId)}`, config));
    }
  );

  registerTool(server, 'delete_oidc_provider',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.delete(`/api/auth/oidc/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'get_oidc_login_url',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/oidc/${encodePath(providerId)}/initiate`));
    }
  );

  registerTool(server, 'update_auth_settings',
    {
      settings: z.record(z.string(), z.unknown()).describe('Auth settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/auth/settings', settings));
    }
  );

  // Logout (session cleanup)
  registerTool(server, 'logout',
    {},
    async () => {
      return jsonResponse(await client.post('/api/auth/logout', {}));
    }
  );
}
