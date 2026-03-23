/**
 * Git-based stack management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerGitStackTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_git_stacks',
    'List all Git-based stacks',
    {},
    async () => {
      const data = await client.get('/api/git/stacks');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_git_stack',
    'Get details of a specific Git stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      const data = await client.get(`/api/git/stacks/${stackId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'deploy_git_stack',
    'Deploy a Git-based stack (pulls latest and deploys via SSE)',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      const result = await client.postSSE(`/api/git/stacks/${stackId}/deploy`);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'sync_git_stack',
    'Synchronize a Git-based stack with its remote repository',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      const data = await client.post(`/api/git/stacks/${stackId}/sync`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_git_stack',
    'Test the Git connection for a stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      const data = await client.post(`/api/git/stacks/${stackId}/test`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_git_stack_env_files',
    'Get environment files for a Git-based stack',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      const data = await client.get(`/api/git/stacks/${stackId}/env-files`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'trigger_git_webhook',
    'Trigger a webhook for a Git-based stack (manual deploy trigger)',
    {
      stackId: z.number().describe('Git stack ID'),
      token: z.string().optional().describe('Webhook secret token'),
    },
    async ({ stackId, token }) => {
      const data = await client.post(`/api/git/stacks/${stackId}/webhook`, undefined, token ? { token } : undefined);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_git_webhook',
    'Get webhook details for a Git stack',
    { webhookId: z.number().describe('Webhook ID') },
    async ({ webhookId }) => {
      const data = await client.get(`/api/git/webhook/${webhookId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Git Credentials ---

  server.tool(
    'list_git_credentials',
    'List all stored Git credentials',
    {},
    async () => {
      const data = await client.get('/api/git/credentials');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_git_credential',
    'Create a new Git credential',
    {
      name: z.string().describe('Credential name'),
      type: z.string().describe('Credential type (e.g. ssh, token, password)'),
      config: z.record(z.unknown()).describe('Credential configuration'),
    },
    async ({ name, type, config }) => {
      const data = await client.post('/api/git/credentials', { name, type, ...config });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_git_credential',
    'Get details of a Git credential',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      const data = await client.get(`/api/git/credentials/${credentialId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_git_credential',
    'Update a Git credential',
    {
      credentialId: z.number().describe('Credential ID'),
      config: z.record(z.unknown()).describe('Updated credential configuration'),
    },
    async ({ credentialId, config }) => {
      const data = await client.put(`/api/git/credentials/${credentialId}`, config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'delete_git_credential',
    'Delete a Git credential',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      const data = await client.delete(`/api/git/credentials/${credentialId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Git Repositories ---

  server.tool(
    'list_git_repositories',
    'List all Git repositories',
    {},
    async () => {
      const data = await client.get('/api/git/repositories');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_git_repository',
    'Create a new Git repository configuration',
    {
      config: z.record(z.unknown()).describe('Repository configuration (url, branch, credentialId, etc.)'),
    },
    async ({ config }) => {
      const data = await client.post('/api/git/repositories', config);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_git_repository',
    'Get details of a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      const data = await client.get(`/api/git/repositories/${repositoryId}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'deploy_git_repository',
    'Deploy a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      const result = await client.postSSE(`/api/git/repositories/${repositoryId}/deploy`);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'sync_git_repository',
    'Synchronize a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      const data = await client.post(`/api/git/repositories/${repositoryId}/sync`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_git_repository',
    'Test connection to a Git repository',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      const data = await client.post(`/api/git/repositories/${repositoryId}/test`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'test_git_repository_connection',
    'Test a Git connection without saving a repository',
    {
      url: z.string().describe('Git repository URL'),
      credentialId: z.number().optional().describe('Credential ID to use'),
    },
    async ({ url, credentialId }) => {
      const body: Record<string, unknown> = { url };
      if (credentialId) body.credentialId = credentialId;
      const data = await client.post('/api/git/repositories/test', body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_git_preview_env',
    'Get preview environment for Git deployments',
    {},
    async () => {
      const data = await client.get('/api/git/preview-env');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
