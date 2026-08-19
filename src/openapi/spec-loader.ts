/**
 * Loads the committed `docs/dockhand-openapi.json` at runtime and looks up a single
 * operation by {method, path} — the bridge between `toolEndpoint()` (tool-endpoint.ts)
 * and `deriveToolDescription()` (derive-description.ts).
 *
 * Mirrors the loading pattern already used by scripts/lib/openapi-contract-source.mjs
 * (readFileSync + in-process cache, resolved relative to the module's own location via
 * import.meta.url) rather than a static TypeScript `import` of the JSON: the spec file
 * lives under `docs/`, outside `rootDir: "./src"` in tsconfig.json, so a static import
 * would fight tsc's rootDir constraint. Resolving relative to `import.meta.url` instead
 * works unchanged whether this module runs as `src/openapi/spec-loader.ts` (dev, via
 * tsx — two levels up from `src/openapi/` is the repo root) or as the compiled
 * `dist/openapi/spec-loader.js` (prod, via `node dist/index.js` — two levels up from
 * `dist/openapi/` is the container's `/app`). The Dockerfile now additionally copies
 * `docs/dockhand-openapi.json` into the runtime image at that same relative location
 * (`/app/docs/dockhand-openapi.json`) — without that, this loader would find nothing at
 * runtime even though `dist/` builds and starts fine (the missing file has no import-time
 * effect since it is only read lazily, on first tool registration).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenApiOperation } from './derive-description.js';
import type { ToolEndpointEntry } from './tool-endpoint-map.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const SPEC_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-openapi.json');

interface OpenApiSpec {
  info?: { version?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

let cachedSpec: OpenApiSpec | null | undefined;
let loggedMissing = false;

/**
 * Loads and caches the openapi spec. Returns `null` (not a throw) when the file is
 * missing — a missing spec must degrade every tool description to the defined fallback
 * text, not crash the server. Logs the miss exactly once per process.
 */
function loadSpec(): OpenApiSpec | null {
  if (cachedSpec !== undefined) return cachedSpec;

  if (!existsSync(SPEC_FILE)) {
    if (!loggedMissing) {
      logger.warn(
        { component: 'openapi', specFile: SPEC_FILE },
        'spec file not found — tool descriptions will use the fallback text. ' +
          'Run `node scripts/fetch-openapi.mjs` (dev) or check the Docker image build (prod).',
      );
      loggedMissing = true;
    }
    cachedSpec = null;
    return cachedSpec;
  }

  cachedSpec = JSON.parse(readFileSync(SPEC_FILE, 'utf8')) as OpenApiSpec;
  return cachedSpec;
}

/**
 * Resolves a tool's endpoint (as returned by `toolEndpoint()`) to its OpenAPI operation
 * object, or `undefined` when the endpoint is unresolved, the spec is unavailable, or
 * the endpoint isn't present in the spec (e.g. a stale registry entry).
 */
export function specOperation(endpoint: ToolEndpointEntry | undefined): OpenApiOperation | undefined {
  if (!endpoint) return undefined;
  const spec = loadSpec();
  if (!spec?.paths) return undefined;
  const methods = spec.paths[endpoint.path];
  if (!methods) return undefined;
  return methods[endpoint.method.toLowerCase()];
}

/**
 * Returns the pinned Dockhand OpenAPI spec's `info.version` (e.g. "1.0.41"), or
 * `undefined` when the spec file is unavailable (see `loadSpec()`) or carries no
 * `info.version`. Used by `get_tool_manifest` (src/tools/meta.ts) to report which
 * Dockhand API version the generated `TOOL_ENDPOINT_MAP` was derived from, alongside
 * the pinned source commit (`PINNED_DOCKHAND_OPENAPI_COMMIT`, src/openapi/pinned.ts).
 */
export function specInfoVersion(): string | undefined {
  const spec = loadSpec();
  return spec?.info?.version;
}

/** A path template plus the HTTP methods (lowercased) the spec defines an operation for. */
export interface SpecPathTemplate {
  readonly template: string;
  readonly methods: readonly string[];
}

// A Path Item Object may carry non-operation keys (parameters, summary, description,
// servers, $ref) alongside the verbs. Only these are real operations.
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);

/**
 * Returns every path template from the pinned OpenAPI spec (e.g. `/api/stacks/{name}/env/raw`)
 * together with the HTTP methods it defines, or `[]` when the spec is unavailable (see
 * `loadSpec()`). Used by `matchRoute()` (src/openapi/match-route.ts) to reverse-match a concrete
 * request back to its template — the set this function returns is the ONLY thing a debug log line
 * is ever allowed to contain instead of the caller's real path, so an empty result must make every
 * match fail closed, not throw. The methods are carried because a concrete pathname can match two
 * templates that differ only by which verb each defines (e.g. `POST /api/stacks/adopt` the literal
 * vs. `DELETE /api/stacks/{name}` where `name` is `adopt`) — the matcher needs the method to pick
 * the right one.
 */
export function specPathTemplates(): SpecPathTemplate[] {
  const spec = loadSpec();
  if (!spec?.paths) return [];
  return Object.entries(spec.paths).map(([template, operations]) => ({
    template,
    methods: Object.keys(operations).filter((key) => HTTP_METHODS.has(key.toLowerCase())),
  }));
}
