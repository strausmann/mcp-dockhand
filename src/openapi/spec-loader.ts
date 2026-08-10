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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const SPEC_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-openapi.json');

interface OpenApiSpec {
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
      console.error(
        `[openapi] Spec file not found at ${SPEC_FILE} — tool descriptions will use the fallback text. Run \`node scripts/fetch-openapi.mjs\` (dev) or check the Docker image build (prod).`
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
