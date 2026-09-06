/**
 * Git-based stack management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, errorResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

/**
 * Shared field definitions for `list_git_remote_branches` — used BOTH as the MCP
 * tool's flat registration shape (per-field JSON schema, no cross-field constraint
 * possible there) AND, wrapped in `z.object(...).superRefine(...)` below, as the
 * schema the handler re-parses to enforce the repositoryId/url contract before the
 * request ever reaches the server.
 *
 * Ground truth: Finsys/dockhand, src/routes/api/git/branches/+server.ts (pinned
 * commit 049221ceff6223ff10fae49c0cb9757368c565bf — see src/openapi/pinned.ts):
 *   if (repositoryId) { ...use stored repo... }
 *   else if (url) { ...use url + credentialId... }
 *   else { 400 'repositoryId or url is required' }
 * The real handler is actually LENIENT about "both": a truthy repositoryId always
 * wins the `if`, so a request sending both repositoryId AND url/credentialId does
 * NOT 400 server-side — url and credentialId are simply, silently ignored. That is
 * exactly the ambiguity worth rejecting client-side (Copilot review, PR #251): a
 * caller who thinks credentialId took effect alongside repositoryId is wrong, and
 * would never find out from the server. This schema is intentionally STRICTER than
 * the server: neither combination is useful, both are almost certainly a caller
 * mistake, and failing fast with a clear message beats a response that silently
 * used only half of what was sent.
 */
const listGitRemoteBranchesShape = {
  repositoryId: z.number().optional().describe('Existing repository ID (uses its stored URL and credential); use this OR url, never both'),
  url: z.string().optional().describe('A new repository URL to list branches for; use this OR repositoryId, never both'),
  credentialId: z.number().optional().describe('Credential ID to use when url is given; meaningless (and rejected) together with repositoryId, whose OWN stored credential is used instead'),
};

/**
 * Full request schema for `list_git_remote_branches`, INCLUDING the cross-field
 * repositoryId/url contract that a flat MCP tool shape cannot express. Exported so
 * it can be exercised directly (`.safeParse(...)`) without going through the
 * registered tool handler.
 */
export const listGitRemoteBranchesBodySchema = z.object(listGitRemoteBranchesShape).superRefine((val, ctx) => {
  if (val.repositoryId === undefined && val.url === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['repositoryId'],
      message: 'either repositoryId or url is required',
    });
  }
  if (val.repositoryId !== undefined && val.url !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['url'],
      message: 'repositoryId and url are mutually exclusive — use repositoryId (existing repository) OR url (+ optional credentialId) for a new one, never both',
    });
  }
  if (val.repositoryId !== undefined && val.credentialId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['credentialId'],
      message: 'credentialId is only used together with url — an existing repository (repositoryId) already has its own stored credential, so credentialId here would be silently ignored server-side',
    });
  }
});

export function registerGitStackTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_git_stacks',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/stacks'));
    }
  );

  registerTool(server, 'get_git_stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}`));
    }
  );

  registerTool(server, 'deploy_git_stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.postSSE(`/api/git/stacks/${encodePath(stackId)}/deploy`));
    }
  );

  registerTool(server, 'sync_git_stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/sync`));
    }
  );

  registerTool(server, 'test_git_stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/test`));
    }
  );

  registerTool(server, 'get_git_stack_env_files',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}/env-files`));
    }
  );

  registerTool(server, 'trigger_git_webhook',
    {
      stackId: z.number().describe('Git stack ID'),
      secret: z.string().describe("Webhook secret, matched against the stack's configured secret (required by the real endpoint)"),
    },
    async ({ stackId, secret }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}/webhook`, { secret }));
    }
  );

  registerTool(server, 'get_git_webhook',
    { webhookId: z.number().describe('Webhook ID') },
    async ({ webhookId }) => {
      return jsonResponse(await client.get(`/api/git/webhook/${encodePath(webhookId)}`));
    }
  );

  // --- Git Credentials ---

  registerTool(server, 'list_git_credentials',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/credentials'));
    }
  );

  registerTool(server, 'create_git_credential',
    {
      name: z.string().describe('Credential name'),
      type: z.string().describe('Credential type (e.g. ssh, token, password)'),
      username: z.string().optional().describe('Username for password-based authentication'),
      password: z.string().optional().describe('Password for password-based authentication'),
      sshKey: z.string().optional().describe('Private SSH key content for SSH authentication'),
      token: z.string().optional().describe('Personal access token for token-based authentication'),
      additionalConfig: z.record(z.string(), z.unknown()).optional().describe('Additional configuration not covered by explicit parameters'),
    },
    async ({ name, type, username, password, sshKey, token, additionalConfig }) => {
      // Fix #30 (MEDIUM): Merge additionalConfig FIRST so explicit fields always win (PR #29)
      const body: Record<string, unknown> = { ...additionalConfig, name, type };
      if (username !== undefined) body.username = username;
      if (password !== undefined) body.password = password;
      if (sshKey !== undefined) body.sshKey = sshKey;
      if (token !== undefined) body.token = token;
      return jsonResponse(await client.post('/api/git/credentials', body));
    }
  );

  registerTool(server, 'get_git_credential',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      return jsonResponse(await client.get(`/api/git/credentials/${encodePath(credentialId)}`));
    }
  );

  registerTool(server, 'update_git_credential',
    {
      credentialId: z.number().describe('Credential ID'),
      name: z.string().optional().describe('Updated credential name'),
      type: z.string().optional().describe('Updated credential type (e.g. ssh, token, password)'),
      username: z.string().optional().describe('Username for password-based authentication'),
      password: z.string().optional().describe('Password for password-based authentication'),
      sshKey: z.string().optional().describe('Private SSH key content for SSH authentication'),
      token: z.string().optional().describe('Personal access token for token-based authentication'),
      additionalConfig: z.record(z.string(), z.unknown()).optional().describe('Additional configuration not covered by explicit parameters'),
    },
    async ({ credentialId, name, type, username, password, sshKey, token, additionalConfig }) => {
      // Fix #30 (MEDIUM): Merge additionalConfig FIRST so explicit fields always win (PR #29)
      const body: Record<string, unknown> = { ...additionalConfig };
      if (name !== undefined) body.name = name;
      if (type !== undefined) body.type = type;
      if (username !== undefined) body.username = username;
      if (password !== undefined) body.password = password;
      if (sshKey !== undefined) body.sshKey = sshKey;
      if (token !== undefined) body.token = token;
      return jsonResponse(await client.put(`/api/git/credentials/${encodePath(credentialId)}`, body));
    }
  );

  registerTool(server, 'delete_git_credential',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      return jsonResponse(await client.delete(`/api/git/credentials/${encodePath(credentialId)}`));
    }
  );

  // --- Git Repositories ---

  registerTool(server, 'list_git_repositories',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/repositories'));
    }
  );

  // NOTE: despite the endpoint's HTTP method (POST) and its position among the
  // "/api/git/branches" path, this is a READ operation — `git ls-remote`, not branch
  // creation. Verified against src/routes/api/git/branches/+server.ts: it accepts
  // EITHER an existing repositoryId OR a fresh url (+ optional credentialId), runs the
  // repo target through the shared SSRF policy, then lists remote branches with their
  // short commit SHAs. POST is used here only because the body can carry a
  // credentialId, not because it mutates anything server-side.
  registerTool(server, 'list_git_remote_branches',
    listGitRemoteBranchesShape,
    async (args) => {
      // Re-parse with the full schema (INCLUDING the superRefine) — the flat shape
      // above only gives the MCP client per-field types, it cannot express the
      // cross-field repositoryId/url contract. See the file header for the ground
      // truth this mirrors.
      const parsed = listGitRemoteBranchesBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResponse(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      const { repositoryId, url, credentialId } = parsed.data;
      const body: Record<string, unknown> = {};
      if (repositoryId !== undefined) body.repositoryId = repositoryId;
      if (url !== undefined) body.url = url;
      if (credentialId !== undefined) body.credentialId = credentialId;
      return jsonResponse(await client.post('/api/git/branches', body));
    }
  );

  registerTool(server, 'create_git_repository',
    {
      name: z.string().describe('Repository name (required by the real endpoint)'),
      url: z.string().describe('Git repository URL (HTTPS or SSH)'),
      branch: z.string().optional().describe('Branch to track (default: main)'),
      credentialId: z.number().optional().describe('ID of the Git credential to use for authentication'),
    },
    async ({ name, url, branch, credentialId }) => {
      const body: Record<string, unknown> = { name, url };
      if (branch !== undefined) body.branch = branch;
      if (credentialId !== undefined) body.credentialId = credentialId;
      return jsonResponse(await client.post('/api/git/repositories', body));
    }
  );

  registerTool(server, 'get_git_repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.get(`/api/git/repositories/${encodePath(repositoryId)}`));
    }
  );

  registerTool(server, 'deploy_git_repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.postSSE(`/api/git/repositories/${encodePath(repositoryId)}/deploy`));
    }
  );

  registerTool(server, 'sync_git_repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.post(`/api/git/repositories/${encodePath(repositoryId)}/sync`));
    }
  );

  registerTool(server, 'test_git_repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.post(`/api/git/repositories/${encodePath(repositoryId)}/test`));
    }
  );

  registerTool(server, 'test_git_repository_connection',
    {
      url: z.string().describe('Git repository URL'),
      credentialId: z.number().optional().describe('Credential ID to use'),
    },
    async ({ url, credentialId }) => {
      const body: Record<string, unknown> = { url };
      if (credentialId) body.credentialId = credentialId;
      return jsonResponse(await client.post('/api/git/repositories/test', body));
    }
  );

  registerTool(server, 'request_git_preview_env',
    {
      composePath: z.string().describe('Path to the compose file within the repository (required by the real endpoint)'),
      repositoryId: z.number().optional().describe('Existing repository ID; use this OR url'),
      url: z.string().optional().describe('New repository URL; use this OR repositoryId'),
      branch: z.string().optional().describe('Branch to use when url is given (default: main)'),
      credentialId: z.number().optional().describe('Credential ID to use when url is given'),
      envFilePath: z.string().optional().describe('Path to an additional .env file within the repository'),
    },
    async ({ composePath, repositoryId, url, branch, credentialId, envFilePath }) => {
      const body: Record<string, unknown> = { composePath };
      if (repositoryId !== undefined) body.repositoryId = repositoryId;
      if (url !== undefined) body.url = url;
      if (branch !== undefined) body.branch = branch;
      if (credentialId !== undefined) body.credentialId = credentialId;
      if (envFilePath !== undefined) body.envFilePath = envFilePath;
      return jsonResponse(await client.post('/api/git/preview-env', body));
    }
  );

  // --- Git-Stack CRUD completion ---

  registerTool(server, 'create_git_stack',
    {
      config: z.record(z.string(), z.unknown()).describe('Git stack configuration (url, branch, credentialId, composePath, environmentId, etc.)'),
      envFilePath: z.string().optional().describe('Path to the .env file within the repository this Git stack should use on deploy; also settable via `config.envFilePath` — this explicit field wins on collision. See `get_git_stack_env_files` to discover available .env files in the repository.'),
    },
    async ({ config, envFilePath }) => {
      const body: Record<string, unknown> = { ...config };
      if (envFilePath !== undefined) body.envFilePath = envFilePath;
      return jsonResponse(await client.post('/api/git/stacks', body));
    }
  );

  registerTool(server, 'update_git_stack',
    {
      stackId: z.number().describe('Git stack ID'),
      config: z.record(z.string(), z.unknown()).describe('Git stack configuration to merge'),
      envFilePath: z.string().optional().describe('Path to the .env file within the repository this Git stack should use on deploy; also settable via `config.envFilePath` — this explicit field wins on collision. See `get_git_stack_env_files` to discover available .env files in the repository.'),
    },
    async ({ stackId, config, envFilePath }) => {
      const body: Record<string, unknown> = { ...config };
      if (envFilePath !== undefined) body.envFilePath = envFilePath;
      return jsonResponse(await client.put(`/api/git/stacks/${encodePath(stackId)}`, body));
    }
  );

  registerTool(server, 'delete_git_stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.delete(`/api/git/stacks/${encodePath(stackId)}`));
    }
  );

  registerTool(server, 'deploy_git_stack_stream',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.postSSE(`/api/git/stacks/${encodePath(stackId)}/deploy-stream`));
    }
  );

  registerTool(server, 'get_git_stack_webhook',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}/webhook`));
    }
  );

  // --- Git-Repository CRUD completion ---

  registerTool(server, 'update_git_repository',
    {
      repositoryId: z.number().describe('Git repository ID'),
      config: z.record(z.string(), z.unknown()).describe('Git repository configuration to merge'),
    },
    async ({ repositoryId, config }) => {
      return jsonResponse(await client.put(`/api/git/repositories/${encodePath(repositoryId)}`, config));
    }
  );

  registerTool(server, 'delete_git_repository',
    { repositoryId: z.number().describe('Git repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.delete(`/api/git/repositories/${encodePath(repositoryId)}`));
    }
  );

  registerTool(server, 'get_git_repository_sync_status',
    { repositoryId: z.number().describe('Git repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.get(`/api/git/repositories/${encodePath(repositoryId)}/sync`));
    }
  );

  registerTool(server, 'receive_git_webhook',
    {
      webhookId: z.string().describe('Webhook identifier in the URL'),
      payload: z.record(z.string(), z.unknown()).optional().describe('Webhook payload body (provider-specific)'),
    },
    async ({ webhookId, payload }) => {
      return jsonResponse(await client.post(`/api/git/webhook/${encodePath(webhookId)}`, payload ?? {}));
    }
  );
}
