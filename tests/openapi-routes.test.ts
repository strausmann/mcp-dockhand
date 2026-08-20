import { describe, it, expect } from 'vitest';
import { deriveRoutesFromOpenapi } from '../scripts/lib/openapi-routes.mjs';
import { loadOpenApiSpec } from '../scripts/lib/openapi-contract-source.mjs';

/**
 * Task 1 of the mcp-dockhand spec-source consolidation (#222).
 *
 * LOCKED SHAPE (Step 1) -- read from `scripts/extract-dockhand-api.mjs` (the OUTPUT it
 * writes to `docs/dockhand-api-schema.json`), cross-checked against the actual committed
 * `docs/dockhand-api-schema.json` and against `scripts/validate-mcp-tools.mjs` (the
 * consumer that reads `schema.endpoints`):
 *
 *   schema.endpoints: Array<{
 *     path: string,              // e.g. "/api/activity", "/api/containers/{id}"
 *     methods: string[],         // uppercase HTTP methods, sorted alphabetically
 *     pathParams?: string[],     // param names extracted from "{...}" segments in `path`;
 *                                // key OMITTED entirely when there are none (never `[]`)
 *     queryParamsByMethod?: {    // key OMITTED entirely when no method has any query param
 *       [method: string]: Array<{ name: string, required: boolean }>  // sorted by name
 *     }
 *   }>
 *
 * `queryParamsByMethod` is per-METHOD (not per-file/per-path) -- a route file with both
 * GET and POST can read different query params in each (see route-handlers.mjs header
 * comment). A method only gets a key in `queryParamsByMethod` if it has at least one
 * query param.
 *
 * `deriveRoutesFromOpenapi(spec)` reproduces this same per-route shape, but sourced from
 * the single committed `docs/dockhand-openapi.json` (via the same loader
 * `openapi-contract-source.mjs` already uses) instead of a fresh clone-and-regex-scan of
 * the upstream SvelteKit route tree. It returns the `endpoints` array directly (not the
 * `{generatedAt, sourceRepo, sourceCommit, endpointCount, endpoints}` wrapper -- that
 * metadata describes the OLD extractor's git-clone process and has no openapi-derived
 * equivalent; the array is the actual contract `validate-mcp-tools.mjs` consumes).
 *
 * Concrete assertions below are verified directly against the real, committed
 * `docs/dockhand-openapi.json` (not guessed/copied from `dockhand-api-schema.json`):
 *   - GET /api/activity -> 9 optional query params (all `required: false`)
 *   - GET /api/audit -> 12 query params
 *   - DELETE /api/backup/snapshots/{id} -> query param `destinationId` with `required: true`
 *     (confirmed to be a real `required: true` query param in the spec, not path)
 */

describe('deriveRoutesFromOpenapi', () => {
  const spec = loadOpenApiSpec();
  const endpoints = deriveRoutesFromOpenapi(spec);

  function findEndpoint(path: string) {
    const ep = endpoints.find((e: { path: string }) => e.path === path);
    if (!ep) throw new Error(`No derived endpoint for path ${path}`);
    return ep;
  }

  it('returns an array of endpoints, sorted by path', () => {
    expect(Array.isArray(endpoints)).toBe(true);
    expect(endpoints.length).toBeGreaterThan(0);
    const paths = endpoints.map((e: { path: string }) => e.path);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    expect(paths).toEqual(sorted);
  });

  it('GET /api/activity yields exactly 9 optional query params, verbatim names', () => {
    const ep = findEndpoint('/api/activity');
    const getParams = ep.queryParamsByMethod?.GET;
    expect(getParams).toBeDefined();
    expect(getParams).toHaveLength(9);

    const names = getParams.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(
      [
        'actions',
        'containerId',
        'containerName',
        'environmentId',
        'fromDate',
        'labels',
        'limit',
        'offset',
        'toDate',
      ].sort()
    );

    // All optional (none of these have an `if (!x) 4xx` guard upstream).
    expect(getParams.every((p: { required: boolean }) => p.required === false)).toBe(true);
  });

  it('GET /api/audit yields exactly 12 query params', () => {
    const ep = findEndpoint('/api/audit');
    const getParams = ep.queryParamsByMethod?.GET;
    expect(getParams).toBeDefined();
    expect(getParams).toHaveLength(12);

    const names = getParams.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(
      [
        'action',
        'actions',
        'entityType',
        'entityTypes',
        'environmentId',
        'fromDate',
        'labels',
        'limit',
        'offset',
        'toDate',
        'username',
        'usernames',
      ].sort()
    );
  });

  it('maps a real required:true query param through as required:true', () => {
    // DELETE /api/backup/snapshots/{id} has a `destinationId` query param that the spec
    // marks `required: true` -- verified directly against docs/dockhand-openapi.json.
    const ep = findEndpoint('/api/backup/snapshots/{id}');
    const deleteParams = ep.queryParamsByMethod?.DELETE;
    expect(deleteParams).toBeDefined();

    const destinationId = deleteParams.find((p: { name: string }) => p.name === 'destinationId');
    expect(destinationId).toBeDefined();
    expect(destinationId.required).toBe(true);

    // ...and the path param from "{id}" is captured separately, not mixed into query params.
    expect(ep.pathParams).toEqual(['id']);
    expect(deleteParams.some((p: { name: string }) => p.name === 'id')).toBe(false);
  });

  it('does not normalize the mixed environmentId/environment_id naming in the spec', () => {
    // /api/activity uses "environmentId"; /api/activity/containers uses "environment_id"
    // in the real spec -- both must be passed through verbatim, not unified.
    const camel = findEndpoint('/api/activity');
    expect(camel.queryParamsByMethod.GET.some((p: { name: string }) => p.name === 'environmentId')).toBe(
      true
    );

    const snake = findEndpoint('/api/activity/containers');
    expect(
      snake.queryParamsByMethod.GET.some((p: { name: string }) => p.name === 'environment_id')
    ).toBe(true);
  });

  it('omits queryParamsByMethod and pathParams entirely when there are none', () => {
    const ep = findEndpoint('/api/activity/events');
    expect(ep.queryParamsByMethod).toBeUndefined();
    expect(ep.pathParams).toBeUndefined();
    expect(ep.methods).toEqual(['GET']);
  });

  it('strips the env query param, mirroring the old extractor (p.name !== "env")', () => {
    // GET /api/auto-update has exactly ONE query param in the real spec: `env`
    // (`in: query`, `name: env`) -- verified directly against
    // docs/dockhand-openapi.json. `scripts/extract-dockhand-api.mjs` /
    // `scripts/lib/route-handlers.mjs` deliberately filter `env` out
    // (`.filter((p) => p.name !== 'env')`) so it NEVER appears in the committed
    // `docs/dockhand-api-schema.json`'s `queryParamsByMethod`. The deriver must match
    // that invariant: with `env` stripped, GET /api/auto-update has NO query params
    // left at all, so `queryParamsByMethod` must be omitted entirely for this route
    // (same "omit when empty" rule as the test above).
    const ep = findEndpoint('/api/auto-update');
    expect(ep.queryParamsByMethod?.GET?.some((p: { name: string }) => p.name === 'env')).not.toBe(
      true
    );
    expect(ep.queryParamsByMethod).toBeUndefined();
  });
});
