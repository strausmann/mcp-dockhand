/**
 * Stack (Docker Compose) management tools (15+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';

export function registerStackTools(server: McpServer, client: DockhandClient): void {

  server.tool(
    'list_stacks',
    'List all Docker Compose stacks in an environment',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      const data = await client.get('/api/stacks', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_stack',
    'Get details of a specific stack by name',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const data = await client.get(`/api/stacks/${encodeURIComponent(name)}`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'create_stack',
    'Create a new Docker Compose stack and optionally deploy it',
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

      const result = await client.postSSE('/api/stacks', body, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'start_stack',
    'Start a stack (docker compose up -d)',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const result = await client.postSSE(`/api/stacks/${encodeURIComponent(name)}/start`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'stop_stack',
    'Stop a stack (docker compose stop)',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const result = await client.postSSE(`/api/stacks/${encodeURIComponent(name)}/stop`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'restart_stack',
    'Restart a stack (docker compose restart)',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const result = await client.postSSE(`/api/stacks/${encodeURIComponent(name)}/restart`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'down_stack',
    'Take down a stack (docker compose down)',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      removeVolumes: z.boolean().optional().describe('Also remove volumes (default: false)'),
    },
    async ({ environmentId, name, removeVolumes }) => {
      const body = removeVolumes !== undefined ? { removeVolumes } : undefined;
      const result = await client.postSSE(`/api/stacks/${encodeURIComponent(name)}/down`, body, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'delete_stack',
    'Delete a stack completely',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      force: z.boolean().optional().describe('Force deletion'),
    },
    async ({ environmentId, name, force }) => {
      const data = await client.delete(`/api/stacks/${encodeURIComponent(name)}`, {
        env: environmentId,
        force: force ? 'true' : undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_stack_compose',
    'Read the docker-compose.yml content of a stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const data = await client.get(`/api/stacks/${encodeURIComponent(name)}/compose`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_stack_compose',
    'Update the docker-compose.yml of a stack and optionally redeploy',
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
        const result = await client.putSSE(`/api/stacks/${encodeURIComponent(name)}/compose`, body, { env: environmentId });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      const data = await client.put(`/api/stacks/${encodeURIComponent(name)}/compose`, body, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_stack_env',
    'Read environment variables of a stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const data = await client.get(`/api/stacks/${encodeURIComponent(name)}/env`, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'update_stack_env',
    'Update environment variables of a stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      variables: z.array(z.object({
        key: z.string(),
        value: z.string(),
        isSecret: z.boolean().optional(),
      })).optional().describe('Environment variables'),
      rawContent: z.string().optional().describe('Raw .env file content'),
    },
    async ({ environmentId, name, variables, rawContent }) => {
      const body: Record<string, unknown> = {};
      if (variables) body.variables = variables;
      if (rawContent) body.rawContent = rawContent;
      const data = await client.put(`/api/stacks/${encodeURIComponent(name)}/env`, body, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_stack_env_raw',
    'Read the raw .env file of a stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const data = await client.get(`/api/stacks/${encodeURIComponent(name)}/env/raw`, { env: environmentId });
      return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'validate_stack_env',
    'Validate environment variables of a stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const data = await client.post(`/api/stacks/${encodeURIComponent(name)}/env/validate`, undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'scan_stacks',
    'Scan filesystem for existing Docker Compose stacks',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.post('/api/stacks/scan', undefined, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'adopt_stack',
    'Adopt an existing untracked stack into Dockhand management',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name to adopt'),
      path: z.string().optional().describe('Path to the stack on the filesystem'),
    },
    async ({ environmentId, name, path }) => {
      const body: Record<string, unknown> = { name };
      if (path) body.path = path;
      const data = await client.post('/api/stacks/adopt', body, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'relocate_stack',
    'Move a stack to a different filesystem path',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      newPath: z.string().describe('New filesystem path'),
    },
    async ({ environmentId, name, newPath }) => {
      const data = await client.post(`/api/stacks/${encodeURIComponent(name)}/relocate`, { path: newPath }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_stack_sources',
    'Get available stack sources',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get('/api/stacks/sources', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_stack_base_path',
    'Get the base path for stacks on an environment',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get('/api/stacks/base-path', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'get_stack_path_hints',
    'Get path suggestions for new stacks',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      const data = await client.get('/api/stacks/path-hints', { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'validate_stack_path',
    'Validate a filesystem path for a new stack',
    {
      environmentId: z.number().describe('Environment ID'),
      path: z.string().describe('Path to validate'),
    },
    async ({ environmentId, path }) => {
      const data = await client.post('/api/stacks/validate-path', { path }, { env: environmentId });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );
}
