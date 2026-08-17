/**
 * Secret-provider management tools (Dockhand 1.0.42+, 8 tools).
 *
 * Dockhand can pull a stack's secrets from an external manager (Vault, Infisical, Doppler,
 * 1Password Connect) instead of holding them itself. A provider is configured once, then
 * bound to a stack via `secretProviderId` on create_stack / update_stack_compose; at deploy
 * time its secrets are injected and `get_stack_env` reports the injected key NAMES (never
 * values) in `injectedSecretKeys`.
 *
 * Credential handling — verified against the 1.0.42 handlers, not assumed:
 *   - Responses are safe. `GET /api/secret-providers` returns summaries that "never include
 *     the decrypted config", and `GET /api/secret-providers/{id}` strips it explicitly
 *     (`const { config, ...summary } = full`). Nothing here can leak a stored credential.
 *   - REQUESTS are not. `config` on create/update/test carries the provider's own
 *     credentials in the clear, so they land in the tool-call arguments. That asymmetry is
 *     invisible from the endpoint's description, which is why the four tools that accept
 *     `config` carry an operator-safety suffix (src/openapi/description-suffixes.ts).
 *
 * The tools are offered in full anyway, including create/update/test: configuring a provider
 * is a legitimate administrative operation, and an operator who wants to do it through an
 * agent should be able to. The suffix asks first; it does not refuse.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

/**
 * The provider-specific connection settings. Untyped on purpose: each provider type takes a
 * different shape (Vault wants addr/token/mount, Infisical a machine identity plus project
 * and environment, ...), Dockhand validates it per type, and mirroring four evolving shapes
 * in zod would go stale on the next provider it supports. `probe_secret_provider` and
 * `test_secret_provider` are the way to check a config without guessing at its schema.
 */
const configSchema = z
  .record(z.string(), z.unknown())
  .describe('Provider-specific connection settings — CONTAINS CREDENTIALS, see the security note in this tool\'s description');

export function registerSecretProviderTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_secret_providers',
    {},
    async () => {
      return jsonResponse(await client.get('/api/secret-providers'));
    }
  );

  registerTool(server, 'get_secret_provider',
    { id: z.number().describe('Secret provider ID (from list_secret_providers)') },
    async ({ id }) => {
      return jsonResponse(await client.get(`/api/secret-providers/${encodePath(id)}`));
    }
  );

  registerTool(server, 'create_secret_provider',
    {
      name: z.string().describe('Display name — must be unique; a duplicate is rejected with 400'),
      type: z.string().describe('Provider type, e.g. "vault", "infisical", "doppler", "onepassword-connect" — an unknown type is rejected with 400'),
      config: configSchema,
    },
    async ({ name, type, config }) => {
      return jsonResponse(await client.post('/api/secret-providers', { name, type, config }));
    }
  );

  registerTool(server, 'update_secret_provider',
    {
      id: z.number().describe('Secret provider ID (from list_secret_providers)'),
      name: z.string().optional().describe('New display name — omit to leave unchanged'),
      type: z.string().optional().describe('New provider type — omit to leave unchanged'),
      config: configSchema.optional().describe('Replacement connection settings (rotates the stored credentials) — omit to leave unchanged. CONTAINS CREDENTIALS, see the security note in this tool\'s description'),
    },
    async ({ id, name, type, config }) => {
      // Omitted fields are left unchanged by the handler (`'config' in data ? ... : undefined`),
      // so only send what the caller actually supplied — a `config: undefined` on the wire
      // would read as "present" and is not what "leave unchanged" means.
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (type !== undefined) body.type = type;
      if (config !== undefined) body.config = config;
      return jsonResponse(await client.put(`/api/secret-providers/${encodePath(id)}`, body));
    }
  );

  registerTool(server, 'delete_secret_provider',
    { id: z.number().describe('Secret provider ID (from list_secret_providers)') },
    async ({ id }) => {
      return jsonResponse(await client.delete(`/api/secret-providers/${encodePath(id)}`));
    }
  );

  registerTool(server, 'probe_secret_provider',
    {
      id: z.number().describe('Secret provider ID (from list_secret_providers)'),
      selector: z.string().optional().describe('Restrict the probe to one path/scope within the provider'),
      refs: z.array(z.string()).optional().describe('Specific secret references to look for'),
    },
    async ({ id, selector, refs }) => {
      const body: Record<string, unknown> = {};
      if (selector !== undefined) body.selector = selector;
      if (refs !== undefined) body.refs = refs;
      return jsonResponse(await client.post(`/api/secret-providers/${encodePath(id)}/probe`, body));
    }
  );

  registerTool(server, 'test_secret_provider',
    {
      id: z.number().describe('Secret provider ID (from list_secret_providers)'),
      config: configSchema.optional().describe('Override settings to test WITHOUT saving them — omit to test the stored config. CONTAINS CREDENTIALS, see the security note in this tool\'s description'),
    },
    async ({ id, config }) => {
      const body: Record<string, unknown> = {};
      if (config !== undefined) body.config = config;
      return jsonResponse(await client.post(`/api/secret-providers/${encodePath(id)}/test`, body));
    }
  );

  registerTool(server, 'test_secret_provider_config',
    {
      type: z.string().describe('Provider type to test, e.g. "vault", "infisical", "doppler", "onepassword-connect"'),
      config: configSchema,
    },
    async ({ type, config }) => {
      return jsonResponse(await client.post('/api/secret-providers/test', { type, config }));
    }
  );
}
