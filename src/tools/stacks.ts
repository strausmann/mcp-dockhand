/**
 * Stack (Docker Compose) management tools (15+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerStackTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_stacks', 'List all Docker Compose stacks in an environment; use `create_stack` to add a new stack or `scan_stacks` to discover untracked ones.',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks', { env: environmentId }));
    }
  );

  registerTool(server, 'create_stack', 'Create a new Docker Compose stack and optionally deploy it; use `delete_stack` to remove it or `adopt_stack` for pre-existing stacks.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      compose: z.string().describe('Docker Compose file content as string'),
      start: z.boolean().optional().describe('Start/deploy the stack immediately (default: true)'),
      envVars: z.array(z.object({
        key: z.string(),
        value: z.string(),
        isSecret: z.boolean().optional(),
      })).optional().describe('Environment variables'),
      rawEnvContent: z.string().optional().describe('Raw .env file content'),
    },
    async ({ environmentId, name, compose, start, envVars, rawEnvContent }) => {
      const body: Record<string, unknown> = { name, compose };
      if (start !== undefined) body.start = start;
      if (envVars) body.envVars = envVars;
      if (rawEnvContent) body.rawEnvContent = rawEnvContent;

      return jsonResponse(await client.postSSE('/api/stacks', body, { env: environmentId }));
    }
  );

  registerTool(server, 'start_stack', 'Start a stopped stack (docker compose up -d); use `stop_stack` to stop or `restart_stack` for a quick cycle without going down.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/start`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'stop_stack', 'Stop running containers in a stack without removing them (docker compose stop); use `down_stack` to also remove containers, or `start_stack` to restart.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/stop`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'restart_stack', 'Restart all containers in a stack in one step (docker compose restart); convenience alternative to calling `stop_stack` then `start_stack` separately.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/restart`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'down_stack', 'Tear down and remove containers for a stack (docker compose down); more destructive than `stop_stack` — containers are removed, though volumes are preserved unless removeVolumes is true.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      removeVolumes: z.boolean().optional().describe('Also remove volumes (default: false)'),
    },
    async ({ environmentId, name, removeVolumes }) => {
      const body = removeVolumes !== undefined ? { removeVolumes } : undefined;
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/down`, body, { env: environmentId }));
    }
  );

  registerTool(server, 'delete_stack', 'Permanently delete a stack and its configuration from Dockhand (irreversible); use `down_stack` first to stop containers, or `list_stacks` to confirm the stack name before deletion.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      force: z.boolean().optional().describe('Force deletion'),
    },
    async ({ environmentId, name, force }) => {
      return jsonResponse(await client.delete(`/api/stacks/${encodePath(name)}`, {
        env: environmentId,
        force: force ? 'true' : undefined,
      }));
    }
  );

  registerTool(server, 'get_stack_compose', 'Read the current docker-compose.yml content of a stack; use `update_stack_compose` to modify the compose definition.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.get(`/api/stacks/${encodePath(name)}/compose`, { env: environmentId }));
    }
  );

  registerTool(server, 'update_stack_compose', 'Update the docker-compose.yml of a stack and optionally redeploy; use `get_stack_compose` to read the current content before making changes.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      content: z.string().describe('New compose file content'),
      restart: z.boolean().optional().describe('Redeploy after update (default: false)'),
    },
    async ({ environmentId, name, content, restart }) => {
      const body: Record<string, unknown> = { content };
      if (restart !== undefined) body.restart = restart;

      if (restart) {
        return jsonResponse(await client.putSSE(`/api/stacks/${encodePath(name)}/compose`, body, { env: environmentId }));
      }

      return jsonResponse(await client.put(`/api/stacks/${encodePath(name)}/compose`, body, { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_env', 'Read the database-backed environment variables of a stack (structured list with secret flags); use `get_stack_env_raw` to read the plain .env file instead, or `update_stack_env` to modify.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.get(`/api/stacks/${encodePath(name)}/env`, { env: environmentId }));
    }
  );

  registerTool(server, 'update_stack_env',
    'Update secret environment variables (database-backed, encrypted at rest). Variables flagged isSecret:true are stored in the Dockhand database and injected into containers via shell-env at deploy time — they are NEVER written to the .env file. For non-secret variables that Docker Compose reads from the .env file at container start, use `update_stack_env_raw`.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      variables: z.array(z.object({
        key: z.string().describe('Environment variable name (UPPER_SNAKE_CASE convention)'),
        value: z.string().describe('Variable value as string'),
        isSecret: z.boolean().optional().describe('When true, store value in the Dockhand database (encrypted at rest) and inject via shell-env at deploy. When false/omitted, value is written to the .env file as plain text — DO NOT use for credentials.'),
      })).describe('Environment variables — flag secrets with isSecret:true'),
    },
    async ({ environmentId, name, variables }) => {
      return jsonResponse(await client.put(`/api/stacks/${encodePath(name)}/env`, { variables }, { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_env_raw', 'Read the raw .env file of a stack directly from disk; use `get_stack_env` for the structured database-backed view, or `validate_stack_env` to check for issues.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return textResponse(await client.get(`/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId }));
    }
  );

  registerTool(server, 'update_stack_env_raw',
    'Write the raw .env file of a stack to disk. Use this for non-secret variables that Docker Compose reads at container start. For secrets that should be encrypted in the Dockhand database and injected via shell-env at deploy time, use `update_stack_env` with isSecret:true on each variable.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      content: z.string().describe('Full .env file content. Empty string deletes the .env file on disk.'),
    },
    async ({ environmentId, name, content }) => {
      return jsonResponse(await client.put(`/api/stacks/${encodePath(name)}/env/raw`, { content }, { env: environmentId }));
    }
  );

  registerTool(server, 'validate_stack_env', 'Validate the environment variables of a stack for completeness and correctness without mutating; use `update_stack_env` or `update_stack_env_raw` to fix any reported issues.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.post(`/api/stacks/${encodePath(name)}/env/validate`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'scan_stacks', 'Scan the filesystem for existing Docker Compose stacks not yet tracked by Dockhand; use `adopt_stack` to import a discovered stack, or `list_stacks` to see already-managed stacks.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/stacks/scan', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'adopt_stack', 'Adopt an existing untracked stack into Dockhand management; use `scan_stacks` to discover candidates or `create_stack` to create a brand-new managed stack.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name to adopt'),
      path: z.string().optional().describe('Path to the stack on the filesystem'),
    },
    async ({ environmentId, name, path }) => {
      const body: Record<string, unknown> = { name };
      if (path) body.path = path;
      return jsonResponse(await client.post('/api/stacks/adopt', body, { env: environmentId }));
    }
  );

  registerTool(server, 'relocate_stack', 'Move a stack to a different filesystem path on the host; use `check_stack_path_change` to verify the move is safe before calling this, or `validate_stack_path` to pre-validate the destination.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      newPath: z.string().describe('New filesystem path'),
    },
    async ({ environmentId, name, newPath }) => {
      return jsonResponse(await client.post(`/api/stacks/${encodePath(name)}/relocate`, { path: newPath }, { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_sources', 'Retrieve the available stack source types (e.g. compose, git) supported by this environment; use `create_stack` to create a plain-compose stack or `list_git_stacks` for git-backed stacks.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks/sources', { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_base_path', 'Retrieve the configured base directory under which all stacks are stored on this environment; see `get_stack_default_path` for the suggested path for a new stack, or `get_stack_path_hints` for a list of candidate paths.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks/base-path', { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_path_hints', 'Retrieve a list of suggested filesystem paths for placing a new stack; complements `get_stack_default_path` (single default) and `get_stack_base_path` (root base dir).',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks/path-hints', { env: environmentId }));
    }
  );

  registerTool(server, 'validate_stack_path', 'Validate that a filesystem path is acceptable for a new stack without creating anything; use `get_stack_path_hints` for suggested paths, or `check_stack_path_change` to validate moving an existing stack.',
    {
      environmentId: z.number().describe('Environment ID'),
      path: z.string().describe('Path to validate'),
    },
    async ({ environmentId, path }) => {
      return jsonResponse(await client.post('/api/stacks/validate-path', { path }, { env: environmentId }));
    }
  );

  // --- Missing endpoints ---

  registerTool(server, 'get_stack_default_path', 'Retrieve the default suggested path for a new stack on this environment; use `get_stack_path_hints` for multiple alternatives, or `validate_stack_path` to confirm a chosen path.',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks/default-path', { env: environmentId }));
    }
  );

  registerTool(server, 'check_stack_path_change', 'Check whether moving a stack to a new filesystem path is safe (e.g. no conflicts, writable); call before `relocate_stack` to avoid data issues, or use `validate_stack_path` for a new-stack path check.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      newPath: z.string().describe('New filesystem path to check'),
    },
    async ({ environmentId, name, newPath }) => {
      return jsonResponse(await client.post(`/api/stacks/${encodePath(name)}/check-path-change`, { path: newPath }, { env: environmentId }));
    }
  );

  registerTool(server, 'deploy_stack', 'Explicit deploy operation for an existing stack (pulls latest images and recreates services from the current compose file); use `start_stack` if you just want to start without re-pulling, or `update_stack_compose` to change the compose file before deploying.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/deploy`, undefined, { env: environmentId }));
    }
  );
}
