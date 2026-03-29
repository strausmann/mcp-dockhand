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
      config: z.record(z.unknown()).describe('Credential configuration'),
    },
    async ({ name, type, config }) => {
      return jsonResponse(await client.post('/api/git/credentials', { name, type, ...config }));
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
      config: z.record(z.unknown()).describe('Updated credential configuration'),
    },
    async ({ credentialId, config }) => {
      return jsonResponse(await client.put(`/api/git/credentials/${encodePath(credentialId)}`, config));
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
      config: z.record(z.unknown()).describe('Repository configuration (url, branch, credentialId, etc.)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/git/repositories', config));
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

  registerTool(server, 'get_git_preview_env', 'Get preview environment for Git deployments',
    {},
    async () => {
      return jsonResponse(await client.post('/api/git/preview-env'));
    }
  );
}
