/**
 * Authentication and session management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerAuthTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_auth_session', 'Check the current authentication session status',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/session'));
    }
  );

  registerTool(server, 'get_auth_providers', 'List available authentication providers',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/providers'));
    }
  );

  registerTool(server, 'get_auth_settings', 'Get authentication settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/settings'));
    }
  );

  registerTool(server, 'create_oidc_provider', 'Create a new OIDC authentication provider',
    { config: z.record(z.string(), z.unknown()).describe('OIDC provider configuration') },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/auth/oidc', config));
    }
  );

  registerTool(server, 'get_oidc_provider', 'Get details of an OIDC provider',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/oidc/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'test_oidc_provider', 'Test an OIDC provider connection',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/oidc/${encodePath(providerId)}/test`));
    }
  );

  registerTool(server, 'initiate_oidc_login', 'Initiate an OIDC login flow',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/oidc/${encodePath(providerId)}/initiate`));
    }
  );

  registerTool(server, 'create_ldap_provider', 'Create a new LDAP authentication provider',
    { config: z.record(z.string(), z.unknown()).describe('LDAP provider configuration') },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/auth/ldap', config));
    }
  );

  registerTool(server, 'get_ldap_provider', 'Get details of a LDAP provider',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/ldap/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'test_ldap_provider', 'Test a LDAP provider connection',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/ldap/${encodePath(providerId)}/test`));
    }
  );

  // --- Hawser Token Management ---

  registerTool(server, 'list_hawser_tokens', 'List all Hawser agent tokens',
    {},
    async () => {
      return jsonResponse(await client.get('/api/hawser/tokens'));
    }
  );

  registerTool(server, 'create_hawser_token', 'Create a new Hawser agent token for an environment',
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

  registerTool(server, 'revoke_hawser_token', 'Revoke (delete) a Hawser agent token',
    { tokenId: z.string().describe('Token ID to revoke') },
    async ({ tokenId }) => {
      return jsonResponse(await client.delete('/api/hawser/tokens', { id: tokenId }));
    }
  );

  // Logout (session cleanup)
  registerTool(server, 'logout', 'Logout and invalidate the current session',
    {},
    async () => {
      return jsonResponse(await client.post('/api/auth/logout', {}));
    }
  );
}
