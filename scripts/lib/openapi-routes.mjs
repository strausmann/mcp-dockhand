/**
 * Derives the routes/query-params/path-params shape (previously only available via
 * `scripts/extract-dockhand-api.mjs`'s clone-and-regex-scan of the upstream SvelteKit
 * route tree) directly from the single already-committed `docs/dockhand-openapi.json`
 * spec instead.
 *
 * Locked output shape (matches `docs/dockhand-api-schema.json`'s `endpoints` array —
 * see `tests/openapi-routes.test.ts` header for how this was verified against the
 * actual extractor output):
 *
 *   Array<{
 *     path: string,                                    // e.g. "/api/activity/{id}"
 *     methods: string[],                                // uppercase, sorted, e.g. ["GET", "POST"]
 *     pathParams?: string[],                             // only present if non-empty
 *     queryParamsByMethod?: {
 *       [method: string]: Array<{ name: string, required: boolean }>  // sorted by name
 *     }                                                  // only present if non-empty
 *   }>
 *
 * Names are passed through exactly as the spec has them (the spec mixes
 * `environmentId`/`environment_id` across different endpoints) -- this deriver does NOT
 * normalize them, matching the old extractor's behavior of reading whatever the source
 * actually used.
 */

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

/**
 * @param {object} spec A parsed OpenAPI 3 document (as loaded by
 *   `loadOpenApiSpec()`/`getBodyContract()`'s `options.spec` in openapi-contract-source.mjs).
 * @returns {Array<{path: string, methods: string[], pathParams?: string[], queryParamsByMethod?: object}>}
 */
export function deriveRoutesFromOpenapi(spec) {
  const endpoints = [];

  for (const path of Object.keys(spec.paths ?? {})) {
    const pathItem = spec.paths[path];
    const methods = [];
    const queryParamsByMethod = {};
    let pathParams = [];

    for (const key of Object.keys(pathItem)) {
      const method = key.toUpperCase();
      if (!HTTP_METHODS.includes(method)) continue;
      methods.push(method);

      const operation = pathItem[key];
      const parameters = operation?.parameters ?? [];

      const queryParams = parameters
        .filter((p) => p?.in === 'query')
        .map((p) => ({ name: p.name, required: p.required === true }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (queryParams.length > 0) {
        queryParamsByMethod[method] = queryParams;
      }

      // Path params are a property of the URL template, not of an individual method --
      // every method sharing this path exposes the same ones (verified against the
      // committed spec). Take them from the first operation that has any.
      if (pathParams.length === 0) {
        const opPathParams = parameters.filter((p) => p?.in === 'path').map((p) => p.name);
        if (opPathParams.length > 0) pathParams = opPathParams;
      }
    }

    methods.sort();

    const endpoint = { path, methods };
    if (pathParams.length > 0) endpoint.pathParams = pathParams;
    if (Object.keys(queryParamsByMethod).length > 0) endpoint.queryParamsByMethod = queryParamsByMethod;

    endpoints.push(endpoint);
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path));
  return endpoints;
}
