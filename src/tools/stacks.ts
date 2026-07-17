/**
 * Stack (Docker Compose) management tools (15+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import type { StackEnv, EnvVariable } from '../types/dockhand.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';
import { diffEnvVars, parseDotEnvKeys, removeKeysFromDotEnv } from '../utils/env-helpers.js';
import type { EnvDiff } from '../utils/env-helpers.js';

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
    'Update secret environment variables (database-backed, encrypted at rest). Variables flagged isSecret:true are stored in the Dockhand database and injected into containers via shell-env at deploy time — they are NEVER written to the .env file. For non-secret variables that Docker Compose reads from the .env file at container start, use `update_stack_env_raw`.\n\n**IMPORTANT — merge vs replace semantics:** The underlying Dockhand REST endpoint (`PUT /api/stacks/{name}/env`) has replace-semantics: sending a partial list silently deletes all other variables. This tool therefore defaults to `mode="merge"`: it fetches the current variables first, merges your payload by key (new values win on collision), and then writes the full combined list. Use `mode="replace"` only when you intentionally want to wipe all existing variables and set exactly the provided list.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      variables: z.array(z.object({
        key: z.string().describe('Environment variable name (UPPER_SNAKE_CASE convention)'),
        value: z.string().describe('Variable value as string'),
        isSecret: z.boolean().optional().describe('When true, store value in the Dockhand database (encrypted at rest) and inject via shell-env at deploy. When false/omitted, value is written to the .env file as plain text — DO NOT use for credentials.'),
      })).describe('Environment variables — flag secrets with isSecret:true'),
      mode: z.enum(['merge', 'replace']).optional().describe('How to handle existing variables. "merge" (default): fetch existing vars, update/add the provided ones, preserve all others. "replace": overwrite the entire variable list with exactly the provided variables — all others are deleted.'),
    },
    async ({ environmentId, name, variables, mode = 'merge' }) => {
      let finalVariables: EnvVariable[];
      let diff: EnvDiff | undefined;

      if (mode === 'merge') {
        // GET is load-bearing here: a failure must NOT issue a PUT (no data loss).
        const existing = await client.get<StackEnv>(
          `/api/stacks/${encodePath(name)}/env`,
          { env: environmentId },
        );
        const existingVars = existing?.variables;
        const mergedByKey = new Map<string, EnvVariable>();

        // Guard against a malformed API response (variables null / not an array).
        if (Array.isArray(existingVars)) {
          for (const v of existingVars) {
            if (v && typeof v.key === 'string') {
              mergedByKey.set(v.key, v);
            }
          }
        }

        for (const v of variables) {
          const existingVar = mergedByKey.get(v.key);
          // Preserve the existing isSecret flag when the caller omits it, so a
          // value-only update never silently demotes a secret to plaintext.
          mergedByKey.set(v.key, {
            ...v,
            isSecret: v.isSecret !== undefined ? v.isSecret : existingVar?.isSecret,
          });
        }
        finalVariables = Array.from(mergedByKey.values());
        diff = diffEnvVars(Array.isArray(existingVars) ? existingVars : [], variables, 'merge');
      } else {
        // replace: PUT the payload directly. No GET, no summary — the existing
        // contract (replace does not GET) stays intact.
        finalVariables = variables;
      }

      const result = (await client.put(
        `/api/stacks/${encodePath(name)}/env`, { variables: finalVariables },
        { env: environmentId })) as Record<string, unknown>;

      const hint =
        diff && diff.added.length === 0 && diff.preserved.length > 0
          ? `merge mode preserved ${diff.preserved.length} variable(s) you did not include and removed nothing. To remove variables use remove_stack_env_vars, or update_stack_env with mode="replace".`
          : undefined;

      return jsonResponse({
        ...result,
        ...(diff ? { summary: {
          added: diff.added.length, updated: diff.updated.length,
          preserved: diff.preserved.length, removed: diff.removed.length,
        } } : {}),
        ...(hint ? { hint } : {}),
      });
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

  registerTool(server, 'remove_stack_env_vars',
    'Remove environment variables from a stack across BOTH stores. Secret keys are dropped from the encrypted database set (remaining secrets are preserved via masked "***" values); non-secret keys are removed from the .env file. Keys present in neither are returned in not_found. This is the safe way to delete variables — `update_stack_env` in the default merge mode cannot remove keys.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      keys: z.array(z.string()).describe('Variable names to remove'),
    },
    async ({ environmentId, name, keys }) => {
      const keySet = new Set(keys);
      const structured = await client.get<StackEnv>(
        `/api/stacks/${encodePath(name)}/env`, { env: environmentId });
      const vars = Array.isArray(structured?.variables) ? structured.variables : [];
      const secretKeys = new Set(vars.filter((v) => v.isSecret).map((v) => v.key));

      const raw = await client.get<string>(
        `/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId });
      const rawStr = typeof raw === 'string' ? raw : '';
      const envKeys = new Set(parseDotEnvKeys(rawStr));

      const secretTargets = keys.filter((k) => secretKeys.has(k));
      const envTargets = keys.filter((k) => envKeys.has(k));
      const notFound = keys.filter((k) => !secretKeys.has(k) && !envKeys.has(k));

      if (secretTargets.length > 0) {
        const remainingSecrets = vars
          .filter((v) => v.isSecret && !keySet.has(v.key))
          .map((v) => ({ key: v.key, value: '***', isSecret: true }));
        await client.put(`/api/stacks/${encodePath(name)}/env`,
          { variables: remainingSecrets }, { env: environmentId });
      }

      let removedEnv: string[] = [];
      if (envTargets.length > 0) {
        try {
          const newContent = removeKeysFromDotEnv(rawStr, envTargets);
          await client.put(`/api/stacks/${encodePath(name)}/env/raw`,
            { content: newContent }, { env: environmentId });
          removedEnv = envTargets;
        } catch (e) {
          return jsonResponse({
            removed_secrets: secretTargets,
            removed_env: [],
            not_found: notFound,
            error: `Secrets removed, but .env rewrite failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }

      return jsonResponse({ removed_secrets: secretTargets, removed_env: removedEnv, not_found: notFound });
    }
  );

  registerTool(server, 'check_stack_env_collisions',
    'Read-only check reporting variable keys defined BOTH as a database-backed secret and in the plain .env file. Such duplicates are ambiguous: at deploy the secret (shell environment) wins over the .env value. Remove the duplicate copy with `remove_stack_env_vars`.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const structured = await client.get<StackEnv>(
        `/api/stacks/${encodePath(name)}/env`, { env: environmentId });
      const secretKeys = new Set(
        (Array.isArray(structured?.variables) ? structured.variables : [])
          .filter((v) => v.isSecret).map((v) => v.key));
      const raw = await client.get<string>(
        `/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId });
      const envKeys = parseDotEnvKeys(typeof raw === 'string' ? raw : '');
      const collisions = envKeys.filter((k) => secretKeys.has(k));
      return jsonResponse(
        collisions.length > 0
          ? { collisions, note: 'These keys exist BOTH as a DB secret and in .env. The DB secret (shell-env) wins at deploy; remove the .env copy with remove_stack_env_vars.' }
          : { collisions: [] },
      );
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
