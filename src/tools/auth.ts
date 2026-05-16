/**
 * Authentication and session management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerAuthTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_auth_session', 'Retrieve the current authentication session status; pair with `get_auth_providers` and `get_auth_settings` to inspect the full org-wide auth state.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/session'));
    }
  );

  registerTool(server, 'get_auth_providers', 'List all authentication providers configured for the organisation; use alongside `get_auth_session` and `get_auth_settings` to audit org-wide auth state.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/providers'));
    }
  );

  registerTool(server, 'get_auth_settings', 'Fetch global authentication settings for the organisation; complement with `get_auth_session` and `get_auth_providers` for a complete auth overview.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/settings'));
    }
  );

  registerTool(server, 'create_oidc_provider', 'Create a new OIDC authentication provider; use `get_oidc_provider` to inspect it and `test_oidc_provider` to validate connectivity before going live.',
    { config: z.record(z.string(), z.unknown()).describe('OIDC provider configuration') },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/auth/oidc', config));
    }
  );

  registerTool(server, 'get_oidc_provider', 'Retrieve configuration details of an existing OIDC provider; run `test_oidc_provider` afterwards to verify the connection, or `create_oidc_provider` to add a new one.',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/oidc/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'test_oidc_provider', 'Test connectivity for an OIDC provider to confirm it is reachable and correctly configured; pair with `create_oidc_provider` or `get_oidc_provider` in the setup workflow.',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/oidc/${encodePath(providerId)}/test`));
    }
  );

  registerTool(server, 'initiate_oidc_login', 'Start the OAuth 2.0 / OIDC login flow for a configured provider, returning the redirect URL; call `test_oidc_provider` first to ensure the provider is reachable.',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/oidc/${encodePath(providerId)}/initiate`));
    }
  );

  registerTool(server, 'create_ldap_provider', 'Create a new LDAP authentication provider; use `get_ldap_provider` to inspect the result and `test_ldap_provider` to validate the directory connection.',
    { config: z.record(z.string(), z.unknown()).describe('LDAP provider configuration') },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/auth/ldap', config));
    }
  );

  registerTool(server, 'get_ldap_provider', 'Retrieve configuration details for an existing LDAP provider; use `test_ldap_provider` to verify connectivity or `create_ldap_provider` to register a new directory.',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/ldap/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'test_ldap_provider', 'Test the LDAP directory connection for a configured provider to confirm bind credentials and reachability; pair with `create_ldap_provider` or `get_ldap_provider` in the setup workflow.',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.post(`/api/auth/ldap/${encodePath(providerId)}/test`));
    }
  );

  // --- Hawser Token Management ---

  registerTool(server, 'list_hawser_tokens', 'List all Hawser agent tokens across environments; use `create_hawser_token` to add a new token or `revoke_hawser_token` to permanently remove one.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/hawser/tokens'));
    }
  );

  registerTool(server, 'create_hawser_token', 'Create a new Hawser agent token scoped to a specific environment; use `list_hawser_tokens` to audit existing tokens or `revoke_hawser_token` to remove one.',
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

  registerTool(server, 'revoke_hawser_token', 'Permanently revoke and delete a Hawser agent token, immediately disabling any agent using it; use `list_hawser_tokens` to find the token ID before revoking.',
    { tokenId: z.string().describe('Token ID to revoke') },
    async ({ tokenId }) => {
      return jsonResponse(await client.delete('/api/hawser/tokens', { id: tokenId }));
    }
  );

  // --- Access Tokens (non-Hawser, API token management) ---

  registerTool(server, 'list_auth_tokens', 'List all API access tokens for the current user account (not Hawser agent tokens — see `list_hawser_tokens` for those); pair with `create_auth_token` to issue new ones or `revoke_auth_token` to invalidate an existing token.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/tokens'));
    }
  );

  registerTool(server, 'create_auth_token', 'Issue a new API access token for the current user account (not for Hawser agents — use `create_hawser_token` for those); inspect existing tokens with `list_auth_tokens` and revoke with `revoke_auth_token`.',
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

  registerTool(server, 'revoke_auth_token', 'Permanently revoke and delete an API access token for the current user account, immediately invalidating any client using it; use `list_auth_tokens` to find the token ID first, or `create_auth_token` to issue a fresh one.',
    { tokenId: z.string().describe('Token ID to revoke') },
    async ({ tokenId }) => {
      return jsonResponse(await client.delete(`/api/auth/tokens/${encodePath(tokenId)}`));
    }
  );

  // --- LDAP / OIDC CRUD completion ---

  registerTool(server, 'list_ldap_providers', 'List every LDAP authentication provider configured for the organisation; pair with `create_ldap_provider` to add a new directory, `get_ldap_provider` for detail on one, or `delete_ldap_provider` to remove one.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/ldap'));
    }
  );

  registerTool(server, 'update_ldap_provider', 'Update an existing LDAP provider configuration (bind credentials, search base, attribute mappings); read current values first with `get_ldap_provider` and confirm connectivity with `test_ldap_provider` afterwards.',
    {
      providerId: z.number().describe('LDAP provider ID'),
      config: z.record(z.string(), z.unknown()).describe('LDAP provider configuration to merge'),
    },
    async ({ providerId, config }) => {
      return jsonResponse(await client.put(`/api/auth/ldap/${encodePath(providerId)}`, config));
    }
  );

  registerTool(server, 'delete_ldap_provider', 'Permanently delete an LDAP authentication provider, disabling all logins that depend on it; verify by re-running `list_ldap_providers` or use `update_ldap_provider` instead if you only need to amend the config.',
    { providerId: z.number().describe('LDAP provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.delete(`/api/auth/ldap/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'list_oidc_providers', 'List every OIDC authentication provider configured for the organisation; pair with `create_oidc_provider` to add a new one, `get_oidc_provider` for detail, or `delete_oidc_provider` to remove one.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/auth/oidc'));
    }
  );

  registerTool(server, 'update_oidc_provider', 'Update an existing OIDC provider configuration (client id / secret / endpoints / claim mappings); read current values first with `get_oidc_provider` and re-verify with `test_oidc_provider` afterwards.',
    {
      providerId: z.number().describe('OIDC provider ID'),
      config: z.record(z.string(), z.unknown()).describe('OIDC provider configuration to merge'),
    },
    async ({ providerId, config }) => {
      return jsonResponse(await client.put(`/api/auth/oidc/${encodePath(providerId)}`, config));
    }
  );

  registerTool(server, 'delete_oidc_provider', 'Permanently delete an OIDC authentication provider, disabling all SSO logins through it; verify by re-running `list_oidc_providers` or use `update_oidc_provider` if you only need to amend the config.',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.delete(`/api/auth/oidc/${encodePath(providerId)}`));
    }
  );

  registerTool(server, 'get_oidc_login_url', 'Fetch the OIDC authorisation redirect URL for a configured provider without starting the flow (`GET` variant of `initiate_oidc_login` — useful when you want the URL to embed in a UI rather than to be navigated immediately); call `test_oidc_provider` first to verify the provider is reachable.',
    { providerId: z.number().describe('OIDC provider ID') },
    async ({ providerId }) => {
      return jsonResponse(await client.get(`/api/auth/oidc/${encodePath(providerId)}/initiate`));
    }
  );

  registerTool(server, 'update_auth_settings', 'Write global authentication settings for the organisation (session timeouts, MFA enforcement, default provider, etc.); read the current state first with `get_auth_settings`, and audit provider connections with `get_auth_providers`.',
    {
      settings: z.record(z.string(), z.unknown()).describe('Auth settings to update'),
    },
    async ({ settings }) => {
      return jsonResponse(await client.put('/api/auth/settings', settings));
    }
  );

  // Logout (session cleanup)
  registerTool(server, 'logout', 'Log out the current user and invalidate the active session token on the server.',
    {},
    async () => {
      return jsonResponse(await client.post('/api/auth/logout', {}));
    }
  );
}
