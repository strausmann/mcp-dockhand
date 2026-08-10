/**
 * Git-based stack management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

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
