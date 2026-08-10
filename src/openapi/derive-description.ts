/**
 * Derives the slim MCP tool description (summary + curated, tool-name-resolved
 * cross-references) from a generated OpenAPI operation.
 *
 * Deliberately does NOT surface the full `description` prose block — only the
 * cross-reference fragments extracted from it. This keeps MCP tool
 * descriptions short while still pointing an agent at the right upstream
 * tool for an ID it needs.
 *
 * Parses the two-form string contract documented in the Dockhand repo
 * (`docs/openapi-annotations.md`, Section 3 "Cross-reference convention"):
 *   - path/query parameter description: `<desc> (from <METHOD> /api/<path>)`
 *   - operation-wide `description` prose: `<field> from <METHOD> /api/<path>`
 * Different phrasing (`see GET /api/...`, `cf. .../...`) is not recognized —
 * that is a binding constraint of the upstream contract, not a gap here.
 */

const HTTP_METHODS = 'GET|POST|PUT|DELETE|PATCH';

/** `<field> from <METHOD> /api/<path>` — used in operation-wide description prose. */
const PROSE_CROSS_REF_SOURCE = `([A-Za-z_][A-Za-z0-9_]*) from (${HTTP_METHODS}) (\\/api\\/[^\\s.,;)]+)`;

/** `(from <METHOD> /api/<path>)` — used in path/query parameter descriptions. */
const PAREN_CROSS_REF_SOURCE = `\\(from (${HTTP_METHODS}) (\\/api\\/[^\\s)]+)\\)`;

const FALLBACK_DESCRIPTION = 'No description available.';

export interface OpenApiParameter {
  in?: string;
  name?: string;
  description?: string;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
}

/**
 * Resolves an HTTP method + `/api/...` path to the MCP tool name that
 * exposes it, or `undefined` when no tool covers that endpoint (yet).
 */
export type EndpointToTool = (method: string, path: string) => string | undefined;

interface BodyCrossRef {
  field: string;
  method: string;
  path: string;
}

interface ParamCrossRef {
  name: string;
  method: string;
  path: string;
}

/** Extracts every `<field> from <METHOD> /api/<path>` reference from the operation's description prose. */
function extractBodyCrossRefs(description: string | undefined): BodyCrossRef[] {
  if (!description) return [];
  const refs: BodyCrossRef[] = [];
  const re = new RegExp(PROSE_CROSS_REF_SOURCE, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(description)) !== null) {
    refs.push({ field: match[1], method: match[2], path: match[3] });
  }
  return refs;
}

/** Extracts the `(from <METHOD> /api/<path>)` reference from each path/query parameter's description. */
function extractParamCrossRefs(parameters: OpenApiParameter[] | undefined): ParamCrossRef[] {
  if (!parameters) return [];
  const refs: ParamCrossRef[] = [];
  for (const param of parameters) {
    if (param.in !== 'path' && param.in !== 'query') continue;
    if (!param.name || !param.description) continue;
    const re = new RegExp(PAREN_CROSS_REF_SOURCE);
    const match = re.exec(param.description);
    if (match) refs.push({ name: param.name, method: match[1], path: match[2] });
  }
  return refs;
}

/**
 * Formats a single cross-reference, resolving it to the owning tool name
 * when possible. An unresolvable reference falls back to the raw endpoint
 * (method + path) rather than being dropped or crashing — the information
 * is still useful even without a tool name to point at.
 */
function formatCrossRef(
  ref: { method: string; path: string },
  label: string,
  endpointToTool: EndpointToTool,
): string {
  const toolName = endpointToTool(ref.method, ref.path);
  const target = toolName ?? `${ref.method} ${ref.path}`;
  return `${label} from ${target}`;
}

function formatParamCrossRef(ref: ParamCrossRef, endpointToTool: EndpointToTool): string {
  const toolName = endpointToTool(ref.method, ref.path);
  const target = toolName ?? `${ref.method} ${ref.path}`;
  return `${ref.name} (from ${target})`;
}

/**
 * Derives the slim MCP tool description for an OpenAPI operation: `summary`
 * plus any curated cross-references (from path/query parameter descriptions
 * and from the operation-wide `description` prose), each resolved to a tool
 * name via `endpointToTool`. The full `description` prose block itself is
 * never included.
 */
export function deriveToolDescription(
  op: OpenApiOperation,
  endpointToTool: EndpointToTool,
): string {
  const base = op.summary && op.summary.trim().length > 0 ? op.summary.trim() : FALLBACK_DESCRIPTION;

  const paramRefs = extractParamCrossRefs(op.parameters).map((ref) =>
    formatParamCrossRef(ref, endpointToTool),
  );
  const bodyRefs = extractBodyCrossRefs(op.description).map((ref) =>
    formatCrossRef(ref, ref.field, endpointToTool),
  );

  const allRefs = [...paramRefs, ...bodyRefs];
  return allRefs.length > 0 ? `${base}\nRefs: ${allRefs.join('; ')}` : base;
}
