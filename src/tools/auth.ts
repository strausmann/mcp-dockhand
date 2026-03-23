/**
 * Authentication and session management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerAuthTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'get_auth_session',
    'Check the current authentication session status',
    {},
    async () => {
      const data = await client.get('/api/auth/session');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_auth_providers',
    'List available authentication providers',
    {},
    async () => {
      const data = await client.get('/api/auth/providers');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_auth_settings',
    'Get authentication settings',
    {},
    async () => {
      const data = await client.get('/api/auth/settings');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_oidc_provider',
    'Create a new OIDC authentication provider',
    { config: z.record(z.unknown()).describe('OIDC provider configuration') },
    async ({ config }) => {
      const data = await client.post('/api/auth/oidc', config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_oidc_provider',
    'Get details of an OIDC provider',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      const data = await client.get(`/api/auth/oidc/${providerId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_oidc_provider',
    'Test an OIDC provider connection',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      const data = await client.post(`/api/auth/oidc/${providerId}/test`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_ldap_provider',
    'Create a new LDAP authentication provider',
    { config: z.record(z.unknown()).describe('LDAP provider configuration') },
    async ({ config }) => {
      const data = await client.post('/api/auth/ldap', config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_ldap_provider',
    'Get details of a LDAP provider',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      const data = await client.get(`/api/auth/ldap/${providerId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_ldap_provider',
    'Test a LDAP provider connection',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      const data = await client.post(`/api/auth/ldap/${providerId}/test`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Hawser Token Management ---

  server.tool(
    'list_hawser_tokens',
    'List all Hawser agent tokens',
    {},
    async () => {
      const data = await client.get('/api/hawser/tokens');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_hawser_token',
    'Create a new Hawser agent token for an environment',
    {
      name: z.string().describe('Token name'),
      environmentId: z.number().describe('Environment ID to associate'),
      expiresAt: z.string().optional().describe('Expiration date (ISO 8601)'),
    },
    async ({ name, environmentId, expiresAt }) => {
      const body: Record<string, unknown> = { name, environmentId };
      if (expiresAt) body.expiresAt = expiresAt;
      const data = await client.post('/api/hawser/tokens', body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'revoke_hawser_token',
    'Revoke (delete) a Hawser agent token',
    { tokenId: z.string().describe('Token ID to revoke') },
    async ({ tokenId }) => {
      const data = await client.delete('/api/hawser/tokens', { id: tokenId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
