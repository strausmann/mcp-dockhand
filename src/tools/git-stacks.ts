/**
 * Git-based stack management tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerGitStackTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_git_stacks', 'List all Git-based stacks registered in Dockhand; use `get_git_stack` to retrieve details for a specific entry.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/stacks'));
    }
  );

  registerTool(server, 'get_git_stack', 'Retrieve configuration and status for a single Git-based stack; use `list_git_stacks` to discover available stack IDs.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}`));
    }
  );

  registerTool(server, 'deploy_git_stack', 'Perform a full deploy of a Git-based stack — pulls the latest commit and redeploys all services via a streaming SSE pipeline; use `sync_git_stack` instead to pull remote changes without triggering a full redeploy.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.postSSE(`/api/git/stacks/${encodePath(stackId)}/deploy`));
    }
  );

  registerTool(server, 'sync_git_stack', 'Pull the latest remote changes for a Git-based stack without performing a full redeploy; use `deploy_git_stack` when a full redeploy is required.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/sync`));
    }
  );

  registerTool(server, 'test_git_stack', 'Verify that a saved Git-based stack can reach its remote repository; use `get_git_stack` to inspect stack configuration before running this check.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/test`));
    }
  );

  registerTool(server, 'get_git_stack_env_files', 'Retrieve the environment file content associated with a Git-based stack; use `get_git_stack` to confirm the stack exists before fetching its env files.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}/env-files`));
    }
  );

  registerTool(server, 'trigger_git_webhook', 'Fire the incoming webhook for a Git-based stack to trigger a manual deploy; use `get_git_webhook` to inspect webhook details before firing.',
    {
      stackId: z.number().describe('Git stack ID'),
      token: z.string().optional().describe('Webhook secret token'),
    },
    async ({ stackId, token }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/webhook`, undefined, token ? { token } : undefined));
    }
  );

  registerTool(server, 'get_git_webhook', 'Retrieve the webhook URL and secret for a Git stack; use `trigger_git_webhook` to fire a manual deploy via this webhook.',
    { webhookId: z.number().describe('Webhook ID') },
    async ({ webhookId }) => {
      return jsonResponse(await client.get(`/api/git/webhook/${encodePath(webhookId)}`));
    }
  );

  // --- Git Credentials ---

  registerTool(server, 'list_git_credentials', 'List all stored Git credentials available for authentication; use `get_git_credential` to fetch details for a specific entry.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/credentials'));
    }
  );

  registerTool(server, 'create_git_credential', 'Create a new Git credential (SSH key, personal access token, or username/password); use `list_git_credentials` to verify the entry was saved.',
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

  registerTool(server, 'get_git_credential', 'Retrieve configuration details for a single Git credential; use `list_git_credentials` to discover available credential IDs.',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      return jsonResponse(await client.get(`/api/git/credentials/${encodePath(credentialId)}`));
    }
  );

  registerTool(server, 'update_git_credential', 'Update an existing Git credential; use `get_git_credential` to read current values before modifying, and `delete_git_credential` to remove it entirely.',
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

  registerTool(server, 'delete_git_credential', 'Permanently delete a Git credential; use `list_git_credentials` to confirm the ID before deleting, and `update_git_credential` for non-destructive edits.',
    { credentialId: z.number().describe('Credential ID') },
    async ({ credentialId }) => {
      return jsonResponse(await client.delete(`/api/git/credentials/${encodePath(credentialId)}`));
    }
  );

  // --- Git Repositories ---

  registerTool(server, 'list_git_repositories', 'List all Git repository configurations registered in Dockhand; use `get_git_repository` to retrieve details for a specific entry.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/git/repositories'));
    }
  );

  registerTool(server, 'create_git_repository', 'Register a new Git repository configuration with a URL, branch, and optional credential; use `list_git_repositories` to verify the entry and `deploy_git_repository` to trigger the first deploy.',
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

  registerTool(server, 'get_git_repository', 'Retrieve configuration details for a saved Git repository; use `list_git_repositories` to discover available repository IDs.',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.get(`/api/git/repositories/${encodePath(repositoryId)}`));
    }
  );

  registerTool(server, 'deploy_git_repository', 'Perform a full deploy of a saved Git repository — pulls the latest commit and redeploys all services via a streaming SSE pipeline; use `sync_git_repository` to pull remote changes without triggering a full redeploy.',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.postSSE(`/api/git/repositories/${encodePath(repositoryId)}/deploy`));
    }
  );

  registerTool(server, 'sync_git_repository', 'Pull the latest remote changes for a saved Git repository without performing a full redeploy; use `deploy_git_repository` when a full redeploy is required.',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.post(`/api/git/repositories/${encodePath(repositoryId)}/sync`));
    }
  );

  registerTool(server, 'test_git_repository', 'Test connectivity for a saved Git repository using its stored configuration; use `test_git_repository_connection` to probe an arbitrary URL before saving a repository.',
    { repositoryId: z.number().describe('Repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.post(`/api/git/repositories/${encodePath(repositoryId)}/test`));
    }
  );

  registerTool(server, 'test_git_repository_connection', 'Probe an arbitrary Git URL and credential without requiring a saved repository; use `test_git_repository` to verify connectivity for an already-registered repository.',
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

  registerTool(server, 'request_git_preview_env', 'Request a transient preview environment configuration for Git-based deployments; complements `deploy_git_stack` and `deploy_git_repository` for ephemeral testing workflows.',
    {},
    async () => {
      return jsonResponse(await client.post('/api/git/preview-env'));
    }
  );

  // --- Git-Stack CRUD completion ---

  registerTool(server, 'create_git_stack', 'Register a new Git-based stack from a repository URL + branch + optional credential, ready to deploy with `deploy_git_stack`; use `list_git_stacks` to verify or `update_git_stack` to amend afterwards.',
    {
      config: z.record(z.string(), z.unknown()).describe('Git stack configuration (url, branch, credentialId, composePath, environmentId, etc.)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/git/stacks', config));
    }
  );

  registerTool(server, 'update_git_stack', 'Update an existing Git-based stack (URL, branch, credential, compose path, etc.); read current values with `get_git_stack` first and re-run `test_git_stack` after to confirm connectivity.',
    {
      stackId: z.number().describe('Git stack ID'),
      config: z.record(z.string(), z.unknown()).describe('Git stack configuration to merge'),
    },
    async ({ stackId, config }) => {
      return jsonResponse(await client.put(`/api/git/stacks/${encodePath(stackId)}`, config));
    }
  );

  registerTool(server, 'delete_git_stack', 'Permanently delete a Git-based stack registration; the deployed containers continue to run, but the Git linkage is removed. Use `list_git_stacks` to confirm the ID first, or `update_git_stack` to amend the config instead.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.delete(`/api/git/stacks/${encodePath(stackId)}`));
    }
  );

  registerTool(server, 'deploy_git_stack_stream', 'Streaming variant of `deploy_git_stack` — performs a full Git pull + redeploy and emits progress via Server-Sent Events; use this when you want to surface live deploy logs, otherwise the plain `deploy_git_stack` returns the same end state without the stream.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.postSSE(`/api/git/stacks/${encodePath(stackId)}/deploy-stream`));
    }
  );

  registerTool(server, 'set_git_stack_env_files', 'Upload or replace the environment files (`.env` content + overrides) used by a Git-based stack on its next deploy; read current files with `get_git_stack_env_files` and trigger the deploy via `deploy_git_stack` or `sync_git_stack`.',
    {
      stackId: z.number().describe('Git stack ID'),
      envFiles: z.record(z.string(), z.string()).describe('Map of filename to file contents (e.g. {".env": "FOO=bar\\n"})'),
    },
    async ({ stackId, envFiles }) => {
      return jsonResponse(await client.post(`/api/git/stacks/${encodePath(stackId)}/env-files`, { envFiles }));
    }
  );

  registerTool(server, 'get_git_stack_webhook', 'Retrieve the inbound webhook URL and secret configured on a Git-based stack (used by GitHub/GitLab/etc. to POST deploy notifications); use `trigger_git_webhook` to fire the webhook manually, or `get_git_webhook` for the equivalent on the generic webhook endpoint.',
    { stackId: z.number().describe('Git stack ID') },
    async ({ stackId }) => {
      return jsonResponse(await client.get(`/api/git/stacks/${encodePath(stackId)}/webhook`));
    }
  );

  // --- Git-Repository CRUD completion ---

  registerTool(server, 'update_git_repository', 'Update a saved Git repository configuration (URL, branch, credential, etc.); read current values with `get_git_repository` first and re-verify connectivity afterwards with `test_git_repository`.',
    {
      repositoryId: z.number().describe('Git repository ID'),
      config: z.record(z.string(), z.unknown()).describe('Git repository configuration to merge'),
    },
    async ({ repositoryId, config }) => {
      return jsonResponse(await client.put(`/api/git/repositories/${encodePath(repositoryId)}`, config));
    }
  );

  registerTool(server, 'delete_git_repository', 'Permanently delete a saved Git repository configuration; deployed stacks linked from it continue to run, but future syncs will fail. Use `list_git_repositories` to confirm the ID first, or `update_git_repository` to amend the config instead.',
    { repositoryId: z.number().describe('Git repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.delete(`/api/git/repositories/${encodePath(repositoryId)}`));
    }
  );

  registerTool(server, 'get_git_repository_sync_status', 'Read the current sync status for a saved Git repository (last fetched commit, last sync timestamp, error state) without triggering a new pull; use `sync_git_repository` to actually pull changes, or `deploy_git_repository` for a full pull + redeploy.',
    { repositoryId: z.number().describe('Git repository ID') },
    async ({ repositoryId }) => {
      return jsonResponse(await client.get(`/api/git/repositories/${encodePath(repositoryId)}/sync`));
    }
  );

  registerTool(server, 'receive_git_webhook', 'POST a webhook payload to the generic Git receive endpoint (the URL external Git hosters call when pushing — exposing this as a tool lets you simulate the trigger). Use `trigger_git_webhook` for the per-stack equivalent, or `get_git_webhook` to inspect the receive URL configuration.',
    {
      webhookId: z.string().describe('Webhook identifier in the URL'),
      payload: z.record(z.string(), z.unknown()).optional().describe('Webhook payload body (provider-specific)'),
    },
    async ({ webhookId, payload }) => {
      return jsonResponse(await client.post(`/api/git/webhook/${encodePath(webhookId)}`, payload ?? {}));
    }
  );
}
