/**
 * Git-based stack management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerGitStackTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_git_stacks', 'List all Git-based stacks',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/stacks'));
    }
  );

  registerTool(server, 'get_git_stack', 'Get details of a specific Git stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}`));
    }
  );

  registerTool(server, 'deploy_git_stack', 'Deploy a Git-based stack (pulls latest and deploys via SSE)',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.postSSE(`/api/git/stacks/${encodePath(stackId)}/deploy`));
    }
  );

  registerTool(server, 'sync_git_stack', 'Synchronize a Git-based stack with its remote repository',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/sync`));
    }
  );

  registerTool(server, 'test_git_stack', 'Test the Git connection for a stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/test`));
    }
  );

  registerTool(server, 'get_git_stack_env_files', 'Get environment files for a Git-based stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}/env-files`));
    }
  );

  registerTool(server, 'trigger_git_webhook', 'Trigger a webhook for a Git-based stack (manual deploy trigger)',
    {
      stackId: z.number().describe('Git stack ID'),
      token: z.string().optional().describe('Webhook secret token'),
    },
    async ({ stackId, token }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/webhook`, undefined, token ? { token } : undefined));
    }
  );

  registerTool(server, 'get_git_webhook', 'Get webhook details for a Git stack',
    { webhookId: z.number().describe('Webhook ID') },
    async ({ webhookId }) => {
      return jsonResponse(await client.get(`/api/git/webhook/${encodePath(webhookId)}`));
    }
  );

  // --- Git Credentials ---

  registerTool(server, 'list_git_credentials', 'List all stored Git credentials',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/credentials'));
    }
  );

  registerTool(server, 'create_git_credential', 'Create a new Git credential',
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

  registerTool(server, 'get_git_credential', 'Get details of a Git credential',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      return jsonResponse(await client.get(`/api/git/credentials/${encodePath(credentialId)}`));
    }
  );

  registerTool(server, 'update_git_credential', 'Update a Git credential',
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

  registerTool(server, 'delete_git_credential', 'Delete a Git credential',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      return jsonResponse(await client.delete(`/api/git/credentials/${encodePath(credentialId)}`));
    }
  );

  // --- Git Repositories ---

  registerTool(server, 'list_git_repositories', 'List all Git repositories',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/repositories'));
    }
  );

  registerTool(server, 'create_git_repository', 'Create a new Git repository configuration',
    {
      url: z.string().describe('Git repository URL (HTTPS or SSH)'),
      branch: z.string().optional().describe('Branch to track (default: main or master)'),
      credentialId: z.number().optional().describe('ID of the Git credential to use for authentication'),
      composePath: z.string().optional().describe('Path to docker-compose file within the repository'),
      envFilePath: z.string().optional().describe('Path to .env file within the repository'),
      stackName: z.string().optional().describe('Name for the stack created from this repository'),
      additionalConfig: z.record(z.string(), z.unknown()).optional().describe('Additional configuration not covered by explicit parameters'),
    },
    async ({ url, branch, credentialId, composePath, envFilePath, stackName, additionalConfig }) => {
      // Fix #30 (MEDIUM): Merge additionalConfig FIRST so explicit fields always win (PR #29)
      const body: Record<string, unknown> = { ...additionalConfig, url };
      if (branch !== undefined) body.branch = branch;
      if (credentialId !== undefined) body.credentialId = credentialId;
      if (composePath !== undefined) body.composePath = composePath;
      if (envFilePath !== undefined) body.envFilePath = envFilePath;
      if (stackName !== undefined) body.stackName = stackName;
      return jsonResponse(await client.post('/api/git/repositories', body));
    }
  );

  registerTool(server, 'get_git_repository', 'Get details of a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.get(`/api/git/repositories/${encodePath(repositoryId)}`));
    }
  );

  registerTool(server, 'deploy_git_repository', 'Deploy a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.postSSE(`/api/git/repositories/${encodePath(repositoryId)}/deploy`));
    }
  );

  registerTool(server, 'sync_git_repository', 'Synchronize a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.post(`/api/git/repositories/${encodePath(repositoryId)}/sync`));
    }
  );

  registerTool(server, 'test_git_repository', 'Test connection to a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.post(`/api/git/repositories/${encodePath(repositoryId)}/test`));
    }
  );

  registerTool(server, 'test_git_repository_connection', 'Test a Git connection without saving a repository',
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

  registerTool(server, 'request_git_preview_env', 'Get preview environment for Git deployments',
    {},
    async () => {
      return jsonResponse(await client.post('/api/git/preview-env'));
    }
  );
}
