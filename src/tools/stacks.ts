/**
 * Stack (Docker Compose) management tools (15+ tools).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import type { StackEnv, EnvVariable } from '../types/dockhand.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';
import { diffEnvVars, extractDotEnvContent, parseDotEnvKeys, removeKeysFromDotEnv, upsertDotEnv } from '../utils/env-helpers.js';
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
      secretProviderId: z.number().nullable().optional().describe('Bind the stack to a configured secret provider (id from list_secret_providers); its secrets are injected at deploy. Pass null to leave it unbound. Dockhand 1.0.42+'),
    },
    async ({ environmentId, name, compose, composePath, envPath, start, envVars, rawEnvContent, secretProviderId }) => {
      const body: Record<string, unknown> = { name, compose };
      if (composePath !== undefined) body.composePath = composePath;
      if (envPath !== undefined) body.envPath = envPath;
      if (start !== undefined) body.start = start;
      if (envVars) body.envVars = envVars;
      if (rawEnvContent) body.rawEnvContent = rawEnvContent;
      if (secretProviderId !== undefined) body.secretProviderId = secretProviderId;

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
      files: z.boolean().optional().describe('Delete the stack\'s on-disk files/directory too (default: true, matching prior behavior). Pass files:false to keep the files on disk — use get_stack_delete_preview first to see what would be removed.'),
    },
    async ({ environmentId, name, force, files }) => {
      return jsonResponse(await client.delete(`/api/stacks/${encodePath(name)}`, {
        env: environmentId,
        force: force ? 'true' : undefined,
        files: files === false ? 'false' : undefined,
      }));
    }
  );

  registerTool(server, 'get_stack_delete_preview',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
    },
    async ({ environmentId, name }) => {
      return jsonResponse(await client.get(`/api/stacks/${encodePath(name)}/delete-preview`, { env: environmentId }));
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
      secretProviderId: z.number().nullable().optional().describe('Bind the stack to a configured secret provider (id from list_secret_providers); its secrets are injected at deploy. Pass null to CLEAR an existing binding; omit to leave it unchanged. Dockhand 1.0.42+'),
    },
    async ({ environmentId, name, content, restart, secretProviderId }) => {
      const body: Record<string, unknown> = { content };
      if (restart !== undefined) body.restart = restart;
      if (secretProviderId !== undefined) body.secretProviderId = secretProviderId;

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
      })).describe('Environment variables — flag secrets with isSecret:true. A call that includes any non-secret variable (isSecret:false or omitted) requires BOTH "stacks:view" and "stacks:edit": correctly routing a non-secret (DB vs. .env file) requires first resolving whether the stack is git-managed or internal, which needs "stacks:view" in addition to the "stacks:edit" the write itself needs. A pure-secret payload needs only "stacks:edit".'),
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

      // #231: resolves this stack's source type via GET /api/stacks/sources
      // (the same endpoint get_stack_sources wraps) and reports whether it
      // is a git stack. Shared by both merge and replace mode below — each
      // calls it only when a routing decision actually depends on the
      // answer (see call sites). Issue-#196 lesson: an unresolvable/
      // malformed response THROWS and aborts the whole call rather than
      // silently defaulting — a wrong default here would misroute a write.
      async function resolveIsGitStack(): Promise<boolean> {
        let sources: Record<string, { sourceType?: string }>;
        try {
          sources = await client.get<Record<string, { sourceType?: string }>>(
            '/api/stacks/sources', { env: environmentId });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // #231 (Fix-Runde 3, Codex P2 — permission-contract mismatch):
          // Ground Truth confirms GET /api/stacks/sources requires
          // 'stacks:view' (stacks/sources/+server.ts), while the write
          // endpoints this tool calls (PUT /env, PUT /env/raw) require only
          // 'stacks:edit' (env/+server.ts, env/raw/+server.ts). A caller
          // with edit-but-not-view previously never needed 'view' for a
          // pure replace-mode call (Critical 4 made zero GETs) — now every
          // call that has to resolve the stack's source type does, and gets
          // a bare 403. Issue-#196 lesson applies here too: don't let an
          // unexplained permission failure surface as an opaque error —
          // translate it into what the caller must actually do, and keep
          // the original detail attached rather than discarding it.
          if (/\breturned 403\b/.test(message)) {
            throw new Error(
              `update_stack_env: determining the stack source type for correct env routing requires the "stacks:view" permission (in addition to "stacks:edit"). Grant "stacks:view", or env updates that include non-secret variables cannot safely distinguish a git stack from an internal one. (${message})`);
          }
          throw e;
        }
        if (sources === undefined || sources === null || typeof sources !== 'object' || Array.isArray(sources)) {
          throw new Error(
            `update_stack_env: GET /api/stacks/sources returned an unexpected response shape — refusing to route variable(s) for stack "${name}" without a resolved source type.`);
        }
        return sources[name]?.sourceType === 'git';
      }

      let secrets: EnvVariable[];
      let payloadNonSecrets: EnvVariable[];
      let existingSecrets: EnvVariable[] = [];
      let existingSecretsCount = 0;
      let promotedKeys: string[] = [];
      let toMigrate: EnvVariable[] = [];
      // #231: whether this stack resolved to a git source type — resolved in
      // EITHER mode below, whenever a routing decision needs it (declared
      // here, not inside a branch, so the shared .env/raw block and the
      // summary baseline further down can both read it).
      let isGitStack = false;
      // #231 (Codex P2, Fix-Runde 2): the full pre-merge DB variable set for
      // a git stack (secrets AND non-secrets — GET /env returns both for
      // git). Used as the merge-summary baseline instead of the
      // secrets-only + parsed-.env baseline, which for a git stack has no
      // .env keys at all and would misreport every touched existing
      // non-secret as "added" instead of "updated", and every untouched one
      // as missing instead of "preserved".
      let existingVarsForBaseline: EnvVariable[] = [];

      if (mode === 'merge') {
        // GET is load-bearing here: a failure must NOT issue any write (no data loss).
        const existing = await client.get<StackEnv>(envPath, { env: environmentId });
        const existingVarsRaw = existing?.variables;
        // Guard against a malformed API response (variables null / not an array).
        const existingVars: EnvVariable[] = Array.isArray(existingVarsRaw)
          ? existingVarsRaw.filter((v): v is EnvVariable => !!v && typeof v.key === 'string')
          : [];

        existingVarsForBaseline = existingVars;
        existingSecrets = existingVars.filter((v) => v.isSecret === true);
        existingSecretsCount = existingSecrets.length;
        // Orphaned DB rows: non-secret entries sitting in the DB-backed
        // structured store. On an INTERNAL/adopted stack these should never
        // exist going forward (non-secrets belong in .env) but may be left
        // over from before this fix. Critical 3: they must not be silently
        // dropped. On a GIT stack these are NOT orphaned — see #231 below.
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

        // #231: on a GIT stack the DB is the canonical store for EVERY
        // variable, secret or not (Ground Truth: GET /api/stacks/[name]/env,
        // v1.0.46 handler — "For a GIT stack, ALL variables ... come from
        // the database"; PUT /env/raw is never consulted for a git stack on
        // read). PUT /env is a DELETE-all-for-this-stack + INSERT of exactly
        // the sent list (setStackEnvVars) — so on a git stack that list MUST
        // be the full finalVariables set (every existing row this call did
        // not touch, plus what it changed), not just the isSecret:true ones.
        // Sending only the payload's new non-secret alongside the isSecret
        // filter (an earlier version of this fix did exactly that) silently
        // deletes every OTHER existing git-DB row the call did not mention.
        //
        // Resolve the stack's source type whenever a DB PUT might actually
        // fire — either because the payload has a non-secret to route, or
        // because there is/will be at least one secret (the pre-existing
        // "willFireDbPut" condition from Critical 1/3 below, evaluated here
        // against the isSecret-only filter before any git-routing changes
        // it). A payload that touches nothing this call (no secrets now or
        // before, no non-secrets) never issues a DB PUT at all, so there is
        // nothing to lose and no need to resolve the source type.
        //
        // NOTE: if GET /api/stacks/sources cannot be resolved into a usable
        // map, resolveIsGitStack() THROWS and aborts the whole call — no
        // partial write, same fail-safe contract as the structured GET
        // above (Issue #196 lesson: unexpected shape on a write path must
        // never silently default). A resolvable-but-unlisted stack falls
        // back to the pre-existing internal/adopted routing below, which is
        // the long-standing production behavior, not a new regression.
        const isSecretOnly = (v: EnvVariable) => v.isSecret;
        const preGitSecrets = finalVariables.filter(isSecretOnly);
        const preGitPayloadNonSecrets = variables
          .map((v) => mergedByKey.get(v.key))
          .filter((v): v is EnvVariable => !!v && !v.isSecret);
        const willFireDbPutPreGit = preGitSecrets.length > 0 || existingSecretsCount > 0;

        if (preGitPayloadNonSecrets.length > 0 || willFireDbPutPreGit) {
          isGitStack = await resolveIsGitStack();
        }

        // Git: the DB PUT payload is the ENTIRE merged set (preserves every
        // untouched existing row, secret or not). Internal/adopted: unchanged
        // — only isSecret:true entries go to the DB, non-secrets go to .env.
        secrets = isGitStack ? finalVariables : preGitSecrets;
        // Only the payload's own non-secret entries are upserted into .env —
        // pre-existing .env keys the caller did not touch stay untouched.
        // On a git stack there is no .env store to upsert into (its
        // non-secrets already went into `secrets` above via finalVariables).
        payloadNonSecrets = isGitStack ? [] : preGitPayloadNonSecrets;

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
        // #231: skip this for a git stack — its DB non-secrets are the
        // canonical values, not leftovers, so there is nothing to migrate out.
        const willFireDbPut = secrets.length > 0 || existingSecretsCount > 0;
        if (willFireDbPut && !isGitStack) {
          const payloadKeys = new Set(variables.map((v) => v.key));
          toMigrate = existingDbNonSecrets.filter((v) => !payloadKeys.has(v.key));
        }
      } else {
        // replace: wipe-and-set exactly the provided list, split by isSecret.
        // No structured GET, no summary — Critical 4: matches the original
        // #105 contract for the case that never needs a routing decision.
        //
        // #231 (Fix-Runde 2 — Copilot finding, replace mode had the same
        // git-stack data-loss bug as merge mode): on a git stack every
        // variable belongs in the DB (same Ground Truth as merge mode
        // above), so `secrets` here must be the ENTIRE provided list, not
        // just the isSecret:true subset, and none of it goes to /env/raw.
        // Resolving the source type costs a GET this mode otherwise never
        // makes (Critical 4) — so it only happens when the payload actually
        // has a non-secret to route; a pure-secret (or empty) replace
        // payload never needs the answer and keeps the original "no GET at
        // all" contract intact.
        const replaceSecrets = variables.filter((v) => v.isSecret);
        const replaceNonSecrets = variables.filter((v) => !v.isSecret);
        if (replaceNonSecrets.length > 0) {
          isGitStack = await resolveIsGitStack();
        }
        if (isGitStack) {
          // #231 (Fix-Runde 2, security-audit MEDIUM — credential-loss
          // variant): a caller resending an EXISTING secret through replace
          // without isSecret:true (e.g. after a get_stack_env round-trip
          // that returned it masked as '***', then simply forwarding that
          // value back) would otherwise be silently demoted to a plaintext
          // non-secret — and because a git stack's DB PUT is DELETE-all +
          // INSERT of exactly this list, the old encrypted row is gone the
          // instant this call completes, with `success:true`. Preserve the
          // existing isSecret flag for any key the caller's payload omits
          // it on, mirroring merge mode's identical protection above
          // ("Preserve the existing isSecret flag when the caller omits
          // it"). A brand-new key (no existing row) defaults to false, same
          // as the pre-#231 replace contract. This is a DELIBERATE, narrow
          // exception to Critical 4's "no GET at all" for replace: it costs
          // one extra GET, and only for a git stack that already needed the
          // sources lookup (i.e. only when replaceNonSecrets is non-empty).
          const existingForReplace = await client.get<StackEnv>(envPath, { env: environmentId });
          const existingVarsRaw = existingForReplace?.variables;
          const existingIsSecretByKey = new Map(
            (Array.isArray(existingVarsRaw) ? existingVarsRaw : [])
              .filter((v): v is EnvVariable => !!v && typeof v.key === 'string')
              .map((v) => [v.key, v.isSecret === true]),
          );
          secrets = variables.map((v) => ({
            ...v,
            isSecret: v.isSecret !== undefined ? v.isSecret : (existingIsSecretByKey.get(v.key) ?? false),
          }));
        } else {
          secrets = replaceSecrets;
        }
        payloadNonSecrets = isGitStack ? [] : replaceNonSecrets;
      }

      // DB store: fires when there is at least one secret to persist, or when
      // secrets existed before this call and must be flushed (Critical 1).
      let dbSecretsWritten = 0;
      let dbPutResult: unknown;
      if (mode === 'replace' || secrets.length > 0 || existingSecretsCount > 0) {
        dbPutResult = await client.put(envPath, { variables: secrets }, { env: environmentId });
        // #231 (Fix-Runde 2 — Codex P2): on a git stack `secrets` is the
        // FULL merged/replace set (secrets AND non-secrets — the DB PUT
        // payload must carry both, see above), so `secrets.length` counts
        // non-secrets too. The reported count must reflect only the
        // ACTUAL secrets sent, or a non-secret gets misreported as a
        // written secret.
        dbSecretsWritten = secrets.filter((v) => v.isSecret).length;
      }

      // .env store: touched when the payload has non-secrets to upsert, when a
      // key is being promoted to a secret and must be scrubbed from .env
      // (Critical 2), or when an orphaned DB row needs migrating into .env
      // before the DB PUT above would otherwise drop it (Critical 3).
      // GET-raw + upsert + PUT (merge) or a full rebuild (replace) are treated
      // as one step — any failure inside it is reported as a partial success,
      // it never undoes the DB write above.
      // #231: a GIT stack never touches this store at all — its .env file is
      // not read by GET/deploy, and every one of its variables (secret or
      // not) already went into the DB PUT above. Without this guard a
      // resent-as-secret key (promotedKeys) would still trigger a pointless
      // (if harmless) raw GET+PUT for a file nothing reads.
      let envNonSecretsWritten = 0;
      let envError: string | undefined;
      let envPutResult: unknown;
      let rawStr: string | undefined;
      if (!isGitStack && (mode === 'replace' || payloadNonSecrets.length > 0 || promotedKeys.length > 0 || toMigrate.length > 0)) {
        try {
          let newContent: string;
          if (mode === 'merge') {
            const raw = await client.get<unknown>(envRawPath, { env: environmentId });
            rawStr = extractDotEnvContent(raw);
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
      // Important 5: for an INTERNAL/adopted stack the baseline combines
      // BOTH real stores — DB secrets and .env keys (parsed from the raw
      // GET above, when it happened) — so a key already tracked in .env and
      // changed this call is reported as `updated`, not `added`; a key left
      // out is `preserved`. Critical 3: orphaned DB non-secret rows are
      // deliberately excluded from the baseline — they are migrated into
      // .env above, not "preserved" in DB.
      // #231 (Fix-Runde 2 — Codex P2): for a GIT stack there is no .env
      // baseline at all (raw GET never happens, non-secrets never lived
      // there) — the baseline is instead the FULL pre-merge DB variable set
      // (existingVarsForBaseline, secrets AND non-secrets). Without this, a
      // changed existing non-secret was misreported as "added" (it isn't in
      // existingSecrets, which only holds secrets) and every untouched
      // existing non-secret was missing from "preserved" entirely.
      let diff: EnvDiff | undefined;
      if (mode === 'merge') {
        const baseline: EnvVariable[] = isGitStack
          ? existingVarsForBaseline
          : [
              ...existingSecrets,
              ...(rawStr !== undefined ? parseDotEnvKeys(rawStr) : [])
                .map((key) => ({ key, value: '', isSecret: false })),
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
      // Dockhand answers with JSON (`{ content, noEnvFile? }`), never with the file's bytes.
      // Passing that straight through handed callers `{"content":"KEY=value\n…"}` while the
      // tool advertises "read the raw .env" — the envelope instead of the thing (#198).
      // Bewusst OHNE Typargument. Der Aufruf liefert ohnehin `unknown`, und der
      // Endpunkt-Extraktor in scripts/validate-mcp-tools.mjs erkennt die Aufrufform nur
      // ohne spitze Klammern — mit Typargument faellt der Endpunkt aus
      // src/openapi/tool-endpoint-map.ts heraus. Das bleibt nicht unbemerkt:
      // tests/tool-endpoint.test.ts schlaegt dann an (in diesem PR genau so passiert).
      const raw = await client.get(`/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId });

      // "No env file at all" and "an env file that happens to be empty" both arrive as an
      // empty string. They are different states — one means the stack has no .env, the other
      // that it has one with nothing in it — and an empty tool response cannot express which.
      if (raw && typeof raw === 'object' && (raw as { noEnvFile?: unknown }).noEnvFile === true) {
        return textResponse('This stack has no .env file.');
      }

      return textResponse(extractDotEnvContent(raw));
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

      const raw = await client.get<unknown>(
        `/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId });
      const rawStr = extractDotEnvContent(raw);
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
      const raw = await client.get<unknown>(
        `/api/stacks/${encodePath(name)}/env/raw`, { env: environmentId });
      const envKeys = parseDotEnvKeys(extractDotEnvContent(raw));
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

  registerTool(server, 'validate_stack_compose',
    {
      environmentId: z.number().optional().describe('Environment ID for context-aware checks (cross-stack port/name collisions, missing external networks/volumes) — the handler\'s `env` query param is genuinely optional, ground-truthed against v1.0.46'),
      name: z.string().describe('Stack name (used to exclude the stack\'s own containers from cross-stack collision checks when `existing` is true)'),
      compose: z.string().describe('Compose file content to run the preflight linter against (required)'),
      config: z.object({
        disabled: z.array(z.string()).optional().describe('Rule IDs to disable'),
        severity: z.record(z.string(), z.string()).optional().describe('Per-rule severity overrides'),
      }).optional().describe('Validation rule configuration'),
      envVars: z.record(z.string(), z.string()).optional().describe('The editor\'s current env vars (including secrets) so `docker compose config` resolves `${VAR}` the same way a deploy would, instead of reporting a spurious "VAR not set"'),
      // Ground-truthed against Finsys/dockhand v1.0.46,
      // src/routes/api/stacks/[name]/validate/+server.ts, lines 62 + 82:
      // `body.existing` is read by the handler to self-exclude the stack's OWN
      // running containers/ports from cross-stack collision checks — but it is
      // NOT part of the `@openapi` annotation or docs/dockhand-openapi.json,
      // only visible in the handler source. Set true when validating an
      // ALREADY-EXISTING stack (e.g. before redeploying it); omit/false for a
      // brand-new stack, where a name/port clash with a same-named running
      // stack must still be reported.
      existing: z.boolean().optional().describe('Set true when validating an EXISTING stack\'s compose (self-excludes its own containers from collision checks) — undocumented handler-only field, ground-truthed against v1.0.46 source'),
    },
    async ({ environmentId, name, compose, config, envVars, existing }) => {
      const body: Record<string, unknown> = { compose };
      if (config !== undefined) body.config = config;
      if (envVars !== undefined) body.envVars = envVars;
      if (existing !== undefined) body.existing = existing;
      return jsonResponse(await client.post(`/api/stacks/${encodePath(name)}/validate`, body, { env: environmentId }));
    }
  );
}
