/**
 * Resolves an MCP tool name to the {method, path} of the real Dockhand endpoint it
 * calls, and back (endpoint -> tool name) — the mapping `deriveToolDescription`
 * (derive-description.ts) needs both to look up its own operation in the spec
 * (`toolEndpoint`) and to resolve cross-references embedded in OTHER operations'
 * descriptions to a tool name (`endpointToTool`).
 *
 * Ground truth is the generated, committed `tool-endpoint-map.ts` registry — see
 * `scripts/generate-tool-endpoint-map.mjs` for how it is built and why it is an
 * explicit registry rather than a pure runtime derivation from `client.<method>(...)`
 * call sites (two real tools defeat a regex-based extractor: a generic type argument
 * between the method name and the call, and a path passed via a local variable
 * instead of a literal).
 */

import { TOOL_ENDPOINT_MAP, type ToolEndpointEntry } from './tool-endpoint-map.js';
import { TOOL_DESCRIPTION_OVERRIDES } from './description-overrides.js';

/**
 * Resolves a registered MCP tool name to the {method, path} of the Dockhand endpoint
 * it calls. Returns `undefined` for tools with no registry entry (currently only
 * `get_prometheus_metrics` — `/api/metrics` is not a SvelteKit route and therefore
 * cannot carry an `@openapi` annotation) and for any name that is not a known tool.
 */
export function toolEndpoint(name: string): ToolEndpointEntry | undefined {
  return TOOL_ENDPOINT_MAP[name];
}

/** `${METHOD} ${path}` — method upper-cased so lookups are method-case-insensitive. */
function endpointIndexKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Lazily-built, memoized inverse of TOOL_ENDPOINT_MAP: `"METHOD /api/path" -> toolName`.
 * Built once from the same static map `toolEndpoint()` reads — there is no separate
 * generated file to keep in sync, so forward and reverse lookups can never drift from
 * each other. Both tools of a shared endpoint still resolve correctly via `toolEndpoint()`
 * regardless of which one wins here.
 *
 * Tiebreak (Finding 2, P3 Final Fix Wave, Refs #57): when two tools share an endpoint, the
 * one WITHOUT a `TOOL_DESCRIPTION_OVERRIDES` entry wins — deterministically, not by
 * insertion/alphabetical order. An override exists precisely because that tool's own
 * derived description (spec summary + cross-refs) does NOT match its actual
 * fields/behavior (see description-overrides.ts for the four currently-known cases and
 * why each mismatch was confirmed against the real handler code, not assumed). The
 * non-overridden sibling is therefore the tool the spec operation actually describes —
 * exactly the tool a cross-reference to this endpoint should resolve to. When neither or
 * both share the same override status, the first-seen (insertion-order) entry still wins,
 * unchanged from the previous behavior — this rule only ever REDIRECTS an endpoint away
 * from a tool that is independently known to be mismatched, never introduces a new
 * ambiguity.
 */
let endpointToToolIndex: Map<string, string> | undefined;

function getEndpointToToolIndex(): Map<string, string> {
  if (!endpointToToolIndex) {
    const index = new Map<string, string>();
    for (const [name, entry] of Object.entries(TOOL_ENDPOINT_MAP)) {
      const key = endpointIndexKey(entry.method, entry.path);
      const existing = index.get(key);
      if (!existing) {
        index.set(key, name);
        continue;
      }
      const existingIsOverridden = existing in TOOL_DESCRIPTION_OVERRIDES;
      const currentIsOverridden = name in TOOL_DESCRIPTION_OVERRIDES;
      if (existingIsOverridden && !currentIsOverridden) {
        index.set(key, name);
      }
    }
    endpointToToolIndex = index;
  }
  return endpointToToolIndex;
}

/**
 * Resolves an HTTP method + `/api/...` path (in the spec's own path form, e.g.
 * `/api/git/stacks/{id}`) to the MCP tool name that exposes it, or `undefined` if no
 * registered tool serves that endpoint. This is the `EndpointToTool` function
 * `deriveToolDescription` (derive-description.ts) expects.
 */
export function endpointToTool(method: string, path: string): string | undefined {
  return getEndpointToToolIndex().get(endpointIndexKey(method, path));
}
