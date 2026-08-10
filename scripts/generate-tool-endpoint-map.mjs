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
 * BUT that extractor is a regex-based heuristic and misses two real, currently-
 * registered tools for structural reasons (verified 2026-08-10 against the actual
 * source in src/tools/stacks.ts):
 *   - `check_stack_env_collisions` calls `client.get<StackEnv>(...)` / `client.get<string>
 *     (...)` — the explicit generic type argument (`<StackEnv>`) sits between the method
 *     name and the opening `(`, which the extractor's `client\.(\w+)\s*\(` pattern does
 *     not expect.
 *   - `update_stack_env` calls `client.put(envPath, ...)` / `client.put(envRawPath, ...)`
 *     with a plain identifier (a `const` computed a few lines above) instead of a
 *     string/template literal directly in the call — the extractor only recognizes a
 *     quote character right after the opening paren.
 * Neither is a parser bug worth chasing here (the validator's ORPHANED_TOOL=0 gate
 * already proves the extractor is accurate for the calls it DOES see); a pure runtime
 * derivation would silently leave these two tools without a resolvable endpoint. An
 * explicit, generated-but-corrected registry lets both be added by hand, with the
 * reasoning captured in EXPLICIT_OVERRIDES below, and a completeness test
 * (the "tool-endpoint-map completeness" describe block in tests/tool-endpoint.test.ts)
 * that fails loudly if a future tool is missing.
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
const EXPLICIT_OVERRIDES = {
  // client.put(envPath, ...) where envPath = `/api/stacks/${encodePath(name)}/env` —
  // the tool's primary write target (DB-backed secrets); the .env-file write via
  // envRawPath is a secondary effect of the same call, not separately represented.
  update_stack_env: { method: 'PUT', path: '/api/stacks/{name}/env' },
  // Composes client.get<StackEnv>(envPath, ...) + client.get<string>(envRawPath, ...) —
  // no single dedicated REST endpoint; anchored on the structured-read side as the
  // closest available summary (secrets-masked variable listing).
  check_stack_env_collisions: { method: 'GET', path: '/api/stacks/{name}/env' },
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

main();
