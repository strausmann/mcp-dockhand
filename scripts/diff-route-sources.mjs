/**
 * Parallel-run equivalence proof (mcp-dockhand #222, Task 2).
 *
 * Compares the OLD route extractor's committed output (`docs/dockhand-api-schema.json`,
 * produced by `scripts/extract-dockhand-api.mjs`'s clone-and-regex-scan of the upstream
 * SvelteKit route tree) against the NEW openapi-derived routes
 * (`deriveRoutesFromOpenapi()`, Task 1 -- `scripts/lib/openapi-routes.mjs`), route by
 * route, method by method, param by param (name + `required`).
 *
 * This is evidence, not a gate on its own: `tests/route-source-parity.test.ts` is the
 * gate, asserting the diff is empty except for an explicit, reasoned allowlist. This
 * module only computes the diff.
 */

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOpenApiSpec } from './lib/openapi-contract-source.mjs';
import { deriveRoutesFromOpenapi } from './lib/openapi-routes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const SCHEMA_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-api-schema.json');

/**
 * @returns {{endpoints: Array<object>}}
 */
function loadOldSchema() {
  return JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'));
}

/**
 * Compares one method's query params between the two sources. A name-set mismatch is
 * reported as a single entry (per-param `required` comparison would be meaningless once
 * the sets differ); an identical name-set is then compared param by param for
 * `required`.
 *
 * @param {string} path
 * @param {string} method
 * @param {Array<{name: string, required: boolean}>} oldParams
 * @param {Array<{name: string, required: boolean}>} newParams
 * @returns {Array<object>}
 */
function compareQueryParams(path, method, oldParams, newParams) {
  const mismatches = [];
  const oldNames = oldParams.map((p) => p.name).sort();
  const newNames = newParams.map((p) => p.name).sort();

  if (JSON.stringify(oldNames) !== JSON.stringify(newNames)) {
    mismatches.push({
      key: `${path}:${method}:queryParamNames`,
      path,
      method,
      kind: 'queryParamNames',
      old: oldNames,
      new: newNames,
    });
    return mismatches;
  }

  const oldByName = new Map(oldParams.map((p) => [p.name, p.required]));
  const newByName = new Map(newParams.map((p) => [p.name, p.required]));
  for (const name of oldNames) {
    const oldRequired = oldByName.get(name);
    const newRequired = newByName.get(name);
    if (oldRequired !== newRequired) {
      mismatches.push({
        key: `${path}:${method}:${name}:required`,
        path,
        method,
        kind: 'queryParamRequired',
        name,
        old: oldRequired,
        new: newRequired,
      });
    }
  }
  return mismatches;
}

/**
 * @returns {{onlyInSchema: string[], onlyInOpenapi: string[], mismatched: Array<object>}}
 */
export function diffRouteSources() {
  const schema = loadOldSchema();
  const oldEndpoints = schema.endpoints;
  const spec = loadOpenApiSpec();
  const newEndpoints = deriveRoutesFromOpenapi(spec);

  const oldMap = new Map(oldEndpoints.map((e) => [e.path, e]));
  const newMap = new Map(newEndpoints.map((e) => [e.path, e]));

  const onlyInSchema = [...oldMap.keys()].filter((p) => !newMap.has(p)).sort();
  const onlyInOpenapi = [...newMap.keys()].filter((p) => !oldMap.has(p)).sort();

  const mismatched = [];
  const commonPaths = [...oldMap.keys()].filter((p) => newMap.has(p)).sort();

  for (const path of commonPaths) {
    const o = oldMap.get(path);
    const n = newMap.get(path);

    const oldMethods = [...o.methods].sort();
    const newMethods = [...n.methods].sort();
    if (JSON.stringify(oldMethods) !== JSON.stringify(newMethods)) {
      mismatched.push({
        key: `${path}:methods`,
        path,
        kind: 'methods',
        old: oldMethods,
        new: newMethods,
      });
    }

    const oldPathParams = [...(o.pathParams ?? [])].sort();
    const newPathParams = [...(n.pathParams ?? [])].sort();
    if (JSON.stringify(oldPathParams) !== JSON.stringify(newPathParams)) {
      mismatched.push({
        key: `${path}:pathParams`,
        path,
        kind: 'pathParams',
        old: oldPathParams,
        new: newPathParams,
      });
    }

    const oldQueryByMethod = o.queryParamsByMethod ?? {};
    const newQueryByMethod = n.queryParamsByMethod ?? {};
    const methods = [...new Set([...Object.keys(oldQueryByMethod), ...Object.keys(newQueryByMethod)])].sort();
    for (const method of methods) {
      mismatched.push(
        ...compareQueryParams(path, method, oldQueryByMethod[method] ?? [], newQueryByMethod[method] ?? [])
      );
    }
  }

  return { onlyInSchema, onlyInOpenapi, mismatched };
}
