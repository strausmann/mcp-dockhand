/**
 * Stack (Docker Compose) management tools (15+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import type { StackEnv, EnvVariable } from '../types/dockhand.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';
import { diffEnvVars, parseDotEnvKeys, removeKeysFromDotEnv, upsertDotEnv } from '../utils/env-helpers.js';
import type { EnvDiff } from '../utils/env-helpers.js';

export function registerStackTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_stacks',
    { environmentId: z.number().describe('Environment ID (required)') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks', { env: environmentId }));
    }
  );

  registerTool(server, 'create_stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      compose: z.string().describe('Docker Compose file content as string'),
      composePath: z.string().optional().describe('Explicit path for the compose file'),
      envPath: z.string().optional().describe('Explicit path for the .env file'),
      start: z.boolean().optional().describe('Start/deploy the stack immediately (default: true)'),
      envVars: z.array(z.object({
        key: z.string(),
        value: z.string(),
        isSecret: z.boolean().optional(),
      })).optional().describe('Environment variables'),
      rawEnvContent: z.string().optional().describe('Raw .env file content'),
    },
    async ({ environmentId, name, compose, composePath, envPath, start, envVars, rawEnvContent }) => {
      const body: Record<string, unknown> = { name, compose };
      if (composePath !== undefined) body.composePath = composePath;
      if (envPath !== undefined) body.envPath = envPath;
      if (start !== undefined) body.start = start;
      if (envVars) body.envVars = envVars;
      if (rawEnvContent) body.rawEnvContent = rawEnvContent;

      return jsonResponse(await client.postSSE('/api/stacks', body, { env: environmentId }));
    }
  );

  registerTool(server, 'start_stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/start`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'stop_stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/stop`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'restart_stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/restart`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'down_stack',
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

  registerTool(server, 'delete_stack',
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

  registerTool(server, 'get_stack_compose',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.get(`/api/stacks/${encodePath(name)}/compose`, { env: environmentId }));
    }
  );

  registerTool(server, 'update_stack_compose',
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

  registerTool(server, 'get_stack_env',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.get(`/api/stacks/${encodePath(name)}/env`, { env: environmentId }));
    }
  );

  registerTool(server, 'update_stack_env',
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
    async ({ environmentId, name, variables: rawVariables, mode = 'merge' }) => {
      const envPath = `/api/stacks/${encodePath(name)}/env`;
      const envRawPath = `/api/stacks/${encodePath(name)}/env/raw`;

      // Minor 7: de-duplicate incoming keys before anything is derived from
      // them (last occurrence wins) — a caller sending the same key twice
      // must not produce two lines in .env or an ambiguous DB write.
      const variables: EnvVariable[] = Array.from(
        rawVariables.reduce((map, v) => map.set(v.key, v), new Map<string, EnvVariable>()).values(),
      );

      let secrets: EnvVariable[];
      let payloadNonSecrets: EnvVariable[];
      let existingSecrets: EnvVariable[] = [];
      let existingSecretsCount = 0;
      let promotedKeys: string[] = [];
      let toMigrate: EnvVariable[] = [];

      if (mode === 'merge') {
        // GET is load-bearing here: a failure must NOT issue any write (no data loss).
        const existing = await client.get<StackEnv>(envPath, { env: environmentId });
        const existingVarsRaw = existing?.variables;
        // Guard against a malformed API response (variables null / not an array).
        const existingVars: EnvVariable[] = Array.isArray(existingVarsRaw)
          ? existingVarsRaw.filter((v): v is EnvVariable => !!v && typeof v.key === 'string')
          : [];

        existingSecrets = existingVars.filter((v) => v.isSecret === true);
        existingSecretsCount = existingSecrets.length;
        // Orphaned DB rows: non-secret entries sitting in the DB-backed
        // structured store. These should never exist going forward (non-secrets
        // belong in .env) but may be left over from before this fix, or from a
        // git-stack import. Critical 3: they must not be silently dropped.
        const existingDbNonSecrets = existingVars.filter((v) => v.isSecret !== true);

        const mergedByKey = new Map<string, EnvVariable>();
        for (const v of existingVars) {
          mergedByKey.set(v.key, v);
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
        const finalVariables: EnvVariable[] = Array.from(mergedByKey.values());

        secrets = finalVariables.filter((v) => v.isSecret);
        // Only the payload's own non-secret entries are upserted into .env —
        // pre-existing .env keys the caller did not touch stay untouched.
        payloadNonSecrets = variables
          .map((v) => mergedByKey.get(v.key))
          .filter((v): v is EnvVariable => !!v && !v.isSecret);

        // Critical 2: a key the caller explicitly promotes to isSecret:true
        // this call must be scrubbed from .env — otherwise the plaintext copy
        // lingers alongside the new encrypted DB row.
        promotedKeys = variables.filter((v) => v.isSecret === true).map((v) => v.key);

        // Critical 1 + 3: the DB PUT below is DELETE-all+INSERT with only
        // `secrets`. It must still fire when the last remaining secret is
        // being degraded to isSecret:false (secrets.length would otherwise be
        // 0 and the stale encrypted row would never be flushed). And when it
        // fires, any orphaned non-secret DB row the caller did not touch this
        // call would silently vanish — migrate its value into .env instead.
        const willFireDbPut = secrets.length > 0 || existingSecretsCount > 0;
        if (willFireDbPut) {
          const payloadKeys = new Set(variables.map((v) => v.key));
          toMigrate = existingDbNonSecrets.filter((v) => !payloadKeys.has(v.key));
        }
      } else {
        // replace: wipe-and-set exactly the provided list, split by isSecret.
        // No GET, no summary — Critical 4: matches the original #105 contract.
        // replace is a deliberate full wipe of both stores, not a preview.
        secrets = variables.filter((v) => v.isSecret);
        payloadNonSecrets = variables.filter((v) => !v.isSecret);
      }

      // DB store: fires when there is at least one secret to persist, or when
      // secrets existed before this call and must be flushed (Critical 1).
      let dbSecretsWritten = 0;
      let dbPutResult: unknown;
      if (mode === 'replace' || secrets.length > 0 || existingSecretsCount > 0) {
        dbPutResult = await client.put(envPath, { variables: secrets }, { env: environmentId });
        dbSecretsWritten = secrets.length;
      }

      // .env store: touched when the payload has non-secrets to upsert, when a
      // key is being promoted to a secret and must be scrubbed from .env
      // (Critical 2), or when an orphaned DB row needs migrating into .env
      // before the DB PUT above would otherwise drop it (Critical 3).
      // GET-raw + upsert + PUT (merge) or a full rebuild (replace) are treated
      // as one step — any failure inside it is reported as a partial success,
      // it never undoes the DB write above.
      let envNonSecretsWritten = 0;
      let envError: string | undefined;
      let envPutResult: unknown;
      let rawStr: string | undefined;
      if (mode === 'replace' || payloadNonSecrets.length > 0 || promotedKeys.length > 0 || toMigrate.length > 0) {
        try {
          let newContent: string;
          if (mode === 'merge') {
            const raw = await client.get<string>(envRawPath, { env: environmentId });
            rawStr = typeof raw === 'string' ? raw : '';
            newContent = upsertDotEnv(rawStr, payloadNonSecrets.map((v) => ({ key: v.key, value: v.value })));
            // N1: the live .env is authoritative for non-secrets — only migrate
            // orphaned DB rows whose key is NOT already in .env, so a stale DB
            // value can never overwrite a live .env value.
            const envKeys = new Set(parseDotEnvKeys(rawStr));
            const migrateNew = toMigrate.filter((v) => !envKeys.has(v.key));
            newContent = upsertDotEnv(newContent, migrateNew.map((v) => ({ key: v.key, value: v.value })));
            newContent = removeKeysFromDotEnv(newContent, promotedKeys);
          } else {
            // replace: rebuild the .env file from scratch — comments are lost
            // (deliberate: replace is a full wipe-and-set). Promoted secrets
            // never land here since payloadNonSecrets already excludes them.
            newContent = payloadNonSecrets.map((v) => `${v.key}=${v.value}`).join('\n');
          }
          envPutResult = await client.put(envRawPath, { content: newContent }, { env: environmentId });
          envNonSecretsWritten = payloadNonSecrets.length;
        } catch (e) {
          envError = `${dbSecretsWritten > 0 ? 'secrets written to database, but ' : ''}.env write failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      // Summary: merge-only (Critical 4 — replace has no GET, no preview).
      // Important 5: the baseline combines BOTH real stores — DB secrets and
      // .env keys (parsed from the raw GET above, when it happened) — so a
      // key already tracked in .env and changed this call is reported as
      // `updated`, not `added`; a key left out is `preserved`. Critical 3:
      // orphaned DB non-secret rows are deliberately excluded from the
      // baseline — they are migrated into .env above, not "preserved" in DB.
      let diff: EnvDiff | undefined;
      if (mode === 'merge') {
        const envBaselineKeys = rawStr !== undefined ? parseDotEnvKeys(rawStr) : [];
        const baseline: EnvVariable[] = [
          ...existingSecrets,
          ...envBaselineKeys.map((key) => ({ key, value: '', isSecret: false })),
        ];
        diff = diffEnvVars(baseline, variables, 'merge');
      }

      const hint =
        mode === 'merge' && diff && diff.added.length === 0 && diff.preserved.length > 0
          ? `merge mode preserved ${diff.preserved.length} variable(s) you did not include and removed nothing. To remove variables use remove_stack_env_vars, or update_stack_env with mode="replace".`
          : undefined;

      // Important 6: spread through any extra fields the underlying PUT
      // responses carried (e.g. API metadata), additively — our own fields
      // (success/db/env/summary/hint/error) always take precedence.
      return jsonResponse({
        ...(dbPutResult && typeof dbPutResult === 'object' ? dbPutResult : {}),
        ...(envPutResult && typeof envPutResult === 'object' ? envPutResult : {}),
        success: !envError,
        db: { secretsWritten: dbSecretsWritten },
        env: { nonSecretsWritten: envNonSecretsWritten },
        ...(diff ? { summary: {
          added: diff.added.length, updated: diff.updated.length,
          preserved: diff.preserved.length, removed: diff.removed.length,
        } } : {}),
        ...(envError ? { error: envError } : {}),
        ...(hint ? { hint } : {}),
      });
    }
  );

  registerTool(server, 'get_stack_env_raw',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return textResponse(await client.get(`/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId }));
    }
  );

  registerTool(server, 'update_stack_env_raw',
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
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      keys: z.array(z.string()).describe('Variable names to remove'),
    },
    async ({ environmentId, name, keys }) => {
      const uniqueKeys = [...new Set(keys)];
      const keySet = new Set(uniqueKeys);

      const structured = await client.get<StackEnv>(
        `/api/stacks/${encodePath(name)}/env`, { env: environmentId });
      const vars = (Array.isArray(structured?.variables) ? structured.variables : [])
        .filter((v) => v && typeof v.key === 'string');
      const structuredKeys = new Set(vars.map((v) => v.key));
      const secretKeys = new Set(vars.filter((v) => v.isSecret).map((v) => v.key));

      const raw = await client.get<string>(
        `/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId });
      const rawStr = typeof raw === 'string' ? raw : '';
      const envKeys = new Set(parseDotEnvKeys(rawStr));

      const removed = uniqueKeys.filter((k) => structuredKeys.has(k) || envKeys.has(k));
      const notFound = uniqueKeys.filter((k) => !structuredKeys.has(k) && !envKeys.has(k));

      // A target changes the DB store if it is a secret, or a non-secret that lives
      // in the DB (git stacks: present in the structured view but NOT in .env).
      const dbManagedTargets = uniqueKeys.filter(
        (k) => secretKeys.has(k) || (structuredKeys.has(k) && !envKeys.has(k)));

      if (dbManagedTargets.length > 0) {
        // Rebuild the FULL remaining DB-backed set minus targets — never drop
        // untouched vars. Keep secrets (masked '***'; the backend preserves the real
        // value) and DB-managed non-secrets (not in .env). .env-backed non-secrets are
        // handled by the raw rewrite below, so they are excluded here to avoid creating
        // a DB/.env duplicate.
        const remaining = vars
          .filter((v) => !keySet.has(v.key))
          .filter((v) => v.isSecret || !envKeys.has(v.key))
          .map((v) => ({ key: v.key, value: v.isSecret ? '***' : v.value, isSecret: v.isSecret ?? false }));
        await client.put(`/api/stacks/${encodePath(name)}/env`,
          { variables: remaining }, { env: environmentId });
      }

      const envTargets = uniqueKeys.filter((k) => envKeys.has(k));
      if (envTargets.length > 0) {
        try {
          const newContent = removeKeysFromDotEnv(rawStr, envTargets);
          await client.put(`/api/stacks/${encodePath(name)}/env/raw`,
            { content: newContent }, { env: environmentId });
        } catch (e) {
          return jsonResponse({
            removed: removed.filter((k) => !envTargets.includes(k)),
            not_found: notFound,
            error: `DB entries removed, but .env rewrite failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }

      return jsonResponse({ removed, not_found: notFound });
    }
  );

  registerTool(server, 'check_stack_env_collisions',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      const structured = await client.get<StackEnv>(
        `/api/stacks/${encodePath(name)}/env`, { env: environmentId });
      const secretKeys = new Set(
        (Array.isArray(structured?.variables) ? structured.variables : [])
          .filter((v) => v && v.isSecret && typeof v.key === 'string').map((v) => v.key));
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

  registerTool(server, 'validate_stack_env',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.post(`/api/stacks/${encodePath(name)}/env/validate`, undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'scan_stacks',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.post('/api/stacks/scan', undefined, { env: environmentId }));
    }
  );

  registerTool(server, 'adopt_stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name to adopt'),
      composePath: z.string().describe('Full path to the stack compose file'),
      envPath: z.string().optional().describe('Optional full path to the stack .env file'),
      sourceDir: z.string().optional().describe('Optional source directory for the stack'),
    },
    async ({ environmentId, name, composePath, envPath, sourceDir }) => {
      const stack: Record<string, unknown> = { name, composePath };
      if (envPath !== undefined) stack.envPath = envPath;
      if (sourceDir !== undefined) stack.sourceDir = sourceDir;
      return jsonResponse(await client.post('/api/stacks/adopt', {
        environmentId,
        stacks: [stack],
      }));
    }
  );

  registerTool(server, 'relocate_stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      oldDir: z.string().describe('Current stack directory'),
      newComposePath: z.string().describe('New full path to the compose file'),
      newEnvPath: z.string().optional().describe('Optional new full path to the .env file'),
    },
    async ({ environmentId, name, oldDir, newComposePath, newEnvPath }) => {
      const body: Record<string, unknown> = { oldDir, newComposePath };
      if (newEnvPath !== undefined) body.newEnvPath = newEnvPath;
      return jsonResponse(await client.post(`/api/stacks/${encodePath(name)}/relocate`, body, { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_sources',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks/sources', { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_base_path',
    { environmentId: z.number().describe('Environment ID') },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/stacks/base-path', { env: environmentId }));
    }
  );

  registerTool(server, 'get_stack_path_hints',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.get('/api/stacks/path-hints', { env: environmentId, name }));
    }
  );

  registerTool(server, 'validate_stack_path',
    {
      environmentId: z.number().describe('Environment ID'),
      path: z.string().describe('Path to validate'),
    },
    async ({ environmentId, path }) => {
      return jsonResponse(await client.post('/api/stacks/validate-path', { path }, { env: environmentId }));
    }
  );

  // --- Missing endpoints ---

  registerTool(server, 'get_stack_default_path',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.get('/api/stacks/default-path', { env: environmentId, name }));
    }
  );

  registerTool(server, 'check_stack_path_change',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      newComposePath: z.string().describe('New full path to the compose file to check'),
    },
    async ({ environmentId, name, newComposePath }) => {
      return jsonResponse(await client.post(`/api/stacks/${encodePath(name)}/check-path-change`, { newComposePath }, { env: environmentId }));
    }
  );

  registerTool(server, 'deploy_stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      pull: z.boolean().optional().describe('Pull newer images before recreating (default: true)'),
      build: z.boolean().optional().describe('Build services that declare a `build:` section (default: false)'),
      forceRecreate: z.boolean().optional().describe('Recreate containers even when their resolved configuration is unchanged (default: false)'),
    },
    async ({ environmentId, name, pull, build, forceRecreate }) => {
      // Dockhand's /deploy handler reads pull/build/forceRecreate out of the
      // request body. Sending no body is not equivalent to sending defaults:
      // before Dockhand 1.0.38 the handler called request.json() unguarded, so
      // an empty body threw before the SSE stream opened and the endpoint
      // answered with an HTML 500 while deploying nothing; and from 1.0.38 on
      // (request.json().catch(() => ({}))) an absent body silently means
      // pull:undefined, i.e. a deploy that never pulls — contradicting what
      // this tool advertises. So always send all three, defaulting to the
      // values the web UI's Deploy popover uses.
      const body = {
        pull: pull ?? true,
        build: build ?? false,
        forceRecreate: forceRecreate ?? false,
      };
      return jsonResponse(await client.postSSE(`/api/stacks/${encodePath(name)}/deploy`, body, { env: environmentId }));
    }
  );
}
