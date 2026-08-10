#!/usr/bin/env node

/**
 * Generates `src/openapi/tool-endpoint-map.ts`: a static, committed registry mapping
 * every registered MCP tool name to the `{method, path}` of the real Dockhand endpoint
 * it calls — using the openapi spec's OWN path form (e.g. `/api/git/stacks/{id}`), not
 * the tool's local variable names, so the entry can be used directly as a lookup key
 * into `docs/dockhand-openapi.json`'s `paths` object (see `src/openapi/spec-loader.ts`).
 *
 * WHY A GENERATED, EXPLICIT REGISTRY (not a pure runtime derivation from the
 * `client.<method>(...)` call sites in `src/tools/*.ts`):
 *
 * `scripts/validate-mcp-tools.mjs` already has a battle-tested static extractor
 * (`extractToolCalls()`) that recovers `{toolName, httpMethod, path}` from the tool
 * source text for the ORPHANED_TOOL/coverage checks. Re-running it here against
 * `docs/dockhand-openapi.json` (via `buildOpenApiPathIndex()`, same wildcard-normalized
 * matching the validator itself uses) resolves the great majority of tools reliably —
 * empirically 283 of 286 in a full run.
 *
 * BUT that extractor is a regex-based heuristic and gets four real, currently-registered
 * tools wrong for two distinct structural reasons (verified 2026-08-10 against the
 * actual source in src/tools/stacks.ts and src/tools/environments.ts):
 *
 * (1) INVISIBLE to the extractor — it never sees a `client.<method>(` call at all:
 *   - `check_stack_env_collisions` calls `client.get<StackEnv>(...)` / `client.get<string>
 *     (...)` — the explicit generic type argument (`<StackEnv>`) sits between the method
 *     name and the opening `(`, which the extractor's `client\.(\w+)\s*\(` pattern does
 *     not expect.
 *   - `update_stack_env` calls `client.put(envPath, ...)` / `client.put(envRawPath, ...)`
 *     with a plain identifier (a `const` computed a few lines above) instead of a
 *     string/template literal directly in the call — the extractor only recognizes a
 *     quote character right after the opening paren.
 *
 * (2) WRONG CALL PICKED — the extractor sees multiple calls for one tool, and this
 *     generator's own "first client call for a tool wins" rule (see `buildMap()` below)
 *     picks the wrong one when a tool makes an earlier, CONDITIONAL call before its real,
 *     unconditional mutating call. Found by code review of PR #177 (2026-08-10) after the
 *     first two entries above shipped without catching this second failure mode:
 *   - `update_environment` calls `client.get(...)` FIRST, but only as a conditional
 *     performance shortcut ("Only fetch environment when connectionType is not provided,
 *     avoids performance regression from PR #21") — the tool's actual, ALWAYS-executed
 *     write is the `client.put(...)` a few lines later. First-wins picked the GET, so the
 *     tool inherited `GET /api/environments/{id}`'s summary ("Get a single environment...")
 *     instead of the real `PUT .../{id}` summary ("Update an environment; renaming also
 *     renames its on-disk stacks/git-repos directories").
 *   - `remove_stack_env_vars` calls `client.put(.../env, ...)` and `client.put(.../env/raw,
 *     ...)`, both CONDITIONAL on which stores actually need a rewrite (there are also two
 *     earlier `client.get<...>(...)` reads, invisible per case (1) above). First-wins
 *     picked `PUT /api/stacks/{name}/env` — the SAME endpoint `update_stack_env` maps to —
 *     so a key-removal tool inherited the summary "Save environment variables...", which
 *     actively contradicts its purpose. No single spec endpoint describes "remove specific
 *     keys" (verified: no DELETE endpoint exists for stack env vars at all, only the two
 *     PUT endpoints above and their GET counterparts) — `PUT .../env/raw` was chosen as the
 *     least-wrong anchor: its summary explicitly says "...empty content deletes the .env
 *     file...", and unlike either GET it correctly signals that the tool is a MUTATION, not
 *     a read. Test comments in tests/stack-env-tools.test.ts and tests/stack-env-merge.test.ts
 *     document this as a KNOWN REGRESSION: the derived description does not (and cannot,
 *     from this endpoint alone) convey "safe way to delete variables — update_stack_env in
 *     merge mode cannot remove keys", which the original hand-written text stated
 *     explicitly and which is not recoverable from any surviving `.describe()` either.
 *
 * `update_stack_compose` also makes two statically-visible calls (`client.putSSE(...)` when
 * `restart` is set, `client.put(...)` otherwise) but both target the IDENTICAL endpoint
 * (`PUT /api/stacks/{name}/compose`) — first-wins is harmless there, verified, no override
 * needed. Every OTHER tool with more than one extracted call was checked the same way
 * (2026-08-10 review) — these four are the only ones affected.
 *
 * None of this is a parser bug worth chasing here (the validator's ORPHANED_TOOL=0 gate
 * already proves the extractor is accurate for individual call recognition); a pure runtime
 * derivation would silently get these wrong on every server start. An explicit,
 * generated-but-corrected registry lets all four be fixed by hand, with the reasoning
 * captured in EXPLICIT_OVERRIDES below, and a completeness test (the "tool-endpoint-map
 * completeness" describe block in tests/tool-endpoint.test.ts) that fails loudly if a
 * future tool is missing — though note that test only catches MISSING entries, not wrong
 * ones from this same "first call wins" class; see tests/tool-endpoint-map-multi-call.test.ts
 * for a regression guard specifically against reintroducing this class of bug.
 *
 * `get_prometheus_metrics` (GET /api/metrics) is deliberately left OUT of the registry:
 * `/api/metrics` is not a SvelteKit route (see the matching comment in
 * scripts/validate-mcp-tools.mjs's ORPHANED_TOOL check) and therefore structurally
 * cannot carry an `@openapi` annotation. `toolEndpoint('get_prometheus_metrics')`
 * returns `undefined` by design; `deriveDescriptionForTool()` (src/utils/tool-helper.ts)
 * falls back to `deriveToolDescription`'s defined fallback text and logs an advisory.
 *
 * Regenerate after adding/removing/renaming a tool or changing which endpoint it calls:
 *   node scripts/generate-tool-endpoint-map.mjs
 * Re-apply EXPLICIT_OVERRIDES manually if the underlying calls change shape again.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractToolCalls, endpointKey, buildOpenApiPathIndex } from './validate-mcp-tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUT_FILE = join(PROJECT_ROOT, 'src', 'openapi', 'tool-endpoint-map.ts');

/**
 * Manually verified entries for tools the static extractor cannot see (see file header
 * for why). Each entry is ground-truthed against the real `src/tools/stacks.ts` source
 * as of 2026-08-10 (Refs #57 / P3 Task 5) — re-verify against the real handler code if
 * these tools' client calls change shape.
 * @type {Record<string, {method: string, path: string}>}
 */
export const EXPLICIT_OVERRIDES = {
  // client.put(envPath, ...) where envPath = `/api/stacks/${encodePath(name)}/env` —
  // the tool's primary write target (DB-backed secrets); the .env-file write via
  // envRawPath is a secondary effect of the same call, not separately represented.
  update_stack_env: { method: 'PUT', path: '/api/stacks/{name}/env' },
  // Composes client.get<StackEnv>(envPath, ...) + client.get<string>(envRawPath, ...) —
  // no single dedicated REST endpoint; anchored on the structured-read side as the
  // closest available summary (secrets-masked variable listing). This endpoint is also
  // shared with `get_stack_env` — the spec summary this anchoring inherits ("Get all
  // environment variables...") describes get_stack_env, not this tool; see
  // src/openapi/description-overrides.ts for the follow-up fix (P3 Final Fix Wave,
  // Finding 1/2, Refs #57) that gives this tool its own correct description AND makes
  // endpointToTool() resolve this endpoint back to get_stack_env, not here.
  check_stack_env_collisions: { method: 'GET', path: '/api/stacks/{name}/env' },
  // client.get(...) is a CONDITIONAL performance shortcut ("Only fetch environment when
  // connectionType is not provided ... avoids performance regression from PR #21") —
  // client.put(...) a few lines later is the tool's real, unconditionally-executed write.
  // First-wins previously picked the GET; fixed 2026-08-10 after code review of PR #177.
  update_environment: { method: 'PUT', path: '/api/environments/{id}' },
  // Composes two conditional client.put(...) calls (DB store, .env-raw store) plus two
  // earlier client.get<...>(...) reads (invisible to the extractor, see file header case
  // (1)) — no dedicated REST endpoint for "remove specific keys" exists (verified: no
  // DELETE endpoint for stack env vars at all). Anchored on PUT .../env/raw: unlike either
  // GET it correctly signals the tool is a mutation, and its summary is the only one in
  // the whole endpoint family that mentions "deletes" at all ("...empty content deletes
  // the .env file..."). PUT .../env (what first-wins previously picked, matching
  // update_stack_env) was rejected: its summary "Save environment variables..." directly
  // contradicts a key-removal tool's purpose. KNOWN REGRESSION either way (at the time):
  // the disambiguation from update_stack_env's merge-mode limitation ("safe way to delete
  // variables — update_stack_env in merge mode cannot remove keys") had no surviving
  // textual home at all (not the spec, not any .describe()) — see
  // tests/stack-env-tools.test.ts and tests/stack-env-merge.test.ts, and the Task 5
  // fix-round report. RESOLVED (P3 Final Fix Wave, Finding 1/2, Refs #57): this endpoint
  // is ALSO shared with `update_stack_env_raw` — the derived description this anchoring
  // produced was update_stack_env_raw's raw-file-write text, not this tool's own. See
  // src/openapi/description-overrides.ts (restores the tool's own hand-written text,
  // including the exact "update_stack_env in merge mode cannot remove keys" disambiguation
  // above) and src/openapi/tool-endpoint.ts (makes endpointToTool() resolve this endpoint
  // back to update_stack_env_raw, not here).
  remove_stack_env_vars: { method: 'PUT', path: '/api/stacks/{name}/env/raw' },
};

/**
 * @returns {{ map: Map<string, {method: string, path: string}>, unresolved: Array }}
 */
function buildMap() {
  const calls = extractToolCalls();
  const index = buildOpenApiPathIndex();
  if (!index) {
    throw new Error(
      'docs/dockhand-openapi.json not found — run `node scripts/fetch-openapi.mjs` first'
    );
  }

  const map = new Map();
  const unresolved = [];

  for (const call of calls) {
    if (map.has(call.toolName)) continue; // first client call for a tool wins
    const key = endpointKey(call.path, call.httpMethod);
    const realPath = index.get(key);
    if (!realPath) {
      unresolved.push(call);
      continue;
    }
    map.set(call.toolName, { method: call.httpMethod, path: realPath });
  }

  for (const [name, entry] of Object.entries(EXPLICIT_OVERRIDES)) {
    map.set(name, entry);
  }

  // get_prometheus_metrics is the one known, accepted gap (see file header) — anything
  // else left unresolved after applying EXPLICIT_OVERRIDES is unexpected and must stop
  // the generator rather than silently producing an incomplete registry.
  const stillUnresolved = unresolved.filter(
    (c) => c.toolName !== 'get_prometheus_metrics' && !(c.toolName in EXPLICIT_OVERRIDES)
  );

  return { map, stillUnresolved };
}

/**
 * @param {Map<string, {method: string, path: string}>} map
 * @returns {string}
 */
function render(map) {
  const entries = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  const lines = entries.map(
    ([name, ep]) =>
      `  ${JSON.stringify(name)}: { method: ${JSON.stringify(ep.method)}, path: ${JSON.stringify(ep.path)} },`
  );
  return `/**
 * GENERATED FILE — do not hand-edit.
 * Regenerate with: node scripts/generate-tool-endpoint-map.mjs
 * (see that script's header for the two manually-verified EXPLICIT_OVERRIDES entries
 * and why \`get_prometheus_metrics\` has no entry at all)
 *
 * Maps every registered MCP tool name to the {method, path} of the real Dockhand
 * endpoint it calls, using docs/dockhand-openapi.json's own path form (e.g.
 * "/api/git/stacks/{id}") so it can be used directly as a lookup key into that spec's
 * \`paths\` object — see src/openapi/spec-loader.ts and src/openapi/tool-endpoint.ts.
 */

export interface ToolEndpointEntry {
  readonly method: string;
  readonly path: string;
}

export const TOOL_ENDPOINT_MAP: Readonly<Record<string, ToolEndpointEntry>> = {
${lines.join('\n')}
};
`;
}

function main() {
  const { map, stillUnresolved } = buildMap();
  if (stillUnresolved.length > 0) {
    console.error(
      `[generate-tool-endpoint-map] ${stillUnresolved.length} tool call(s) could not be resolved against docs/dockhand-openapi.json:`
    );
    for (const c of stillUnresolved) {
      console.error(`  ${c.toolName}: ${c.httpMethod} ${c.path} (${c.file}:${c.line})`);
    }
    console.error(
      '[generate-tool-endpoint-map] Add a manually-verified entry to EXPLICIT_OVERRIDES in this script, or confirm the tool is a deliberate gap like get_prometheus_metrics.'
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(OUT_FILE, render(map), 'utf8');
  console.error(`[generate-tool-endpoint-map] Wrote ${map.size} entries to ${OUT_FILE}`);
}

// Only run (and write to disk) when executed directly as a CLI script — not when imported
// (e.g. by tests/tool-endpoint-map-multi-call.test.ts, which imports EXPLICIT_OVERRIDES to
// guard against the "first call wins" bug class without triggering a regeneration side
// effect on every test run). Mirrors the same guard in scripts/validate-mcp-tools.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
