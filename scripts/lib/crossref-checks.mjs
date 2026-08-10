/**
 * Cross-Ref-Unresolved-Check (advisory, Task P3.6, Refs #57).
 *
 * `derive-description.ts` (src/openapi/derive-description.ts) already parses the two-form
 * cross-reference contract embedded in `docs/dockhand-openapi.json`'s own text -- see that
 * file's header for the exact grammar:
 *   - path/query parameter description: `<desc> (from <METHOD> /api/<path>)`
 *   - operation-wide `description` prose: `<field> from <METHOD> /api/<path>`
 * -- and resolves each reference to the MCP tool name that serves the REFERENCED endpoint,
 * via `endpointToTool()` (src/openapi/tool-endpoint.ts). That resolution is best-effort by
 * design: `formatCrossRef()`/`formatParamCrossRef()` fall back to the raw `METHOD /api/path`
 * string when no tool covers it, so a typo'd or deliberately-omitted target endpoint never
 * breaks description generation.
 *
 * This module answers a DIFFERENT question with the SAME extraction grammar: not "what
 * should the description text say", but "does every cross-ref actually point at SOMETHING
 * WE EXPOSE" -- i.e. is `endpointToTool()`'s fallback ever silently hit in practice? Each
 * unresolved case is either a typo in the annotation (the referenced `/api/...` path does
 * not exist, or exists under a different method) or a deliberate reference to an endpoint we
 * have not wrapped yet -- both worth surfacing, neither worth failing CI over (see
 * `checkCrossRefs()` below and its caller in `scripts/validate-mcp-tools.mjs`, where the
 * resulting findings never influence `hasCriticalErrors()`/the exit code).
 *
 * Deliberately re-implements the SAME two regexes as derive-description.ts rather than
 * importing it: this module lives in `scripts/` (plain JS, run directly via `node`, no
 * build/tsx step -- see the "tsx-free" convention documented at the top of
 * `scripts/validate-mcp-tools.mjs`), `derive-description.ts` lives in `src/` (TypeScript,
 * compiled/run via tsc/tsx). Importing across that boundary would either require a build
 * step before every `node scripts/validate-mcp-tools.mjs` run, or a `tsx` subprocess like
 * the existing (optional, gracefully-skippable) body-shape collector -- disproportionate for
 * two small, stable regexes that are themselves the documented, versioned contract, not an
 * implementation detail likely to drift silently. Should the two definitions ever diverge,
 * `tests/derive-description-crossref-parity.test.ts` is the intended regression guard (not
 * part of this task).
 */

const HTTP_METHODS = 'GET|POST|PUT|DELETE|PATCH';

/** `<field> from <METHOD> /api/<path>` — used in operation-wide description prose. */
const PROSE_CROSS_REF_SOURCE = `([A-Za-z_][A-Za-z0-9_]*) from (${HTTP_METHODS}) (\\/api\\/[^\\s.,;)]+)`;

/** `(from <METHOD> /api/<path>)` — used in path/query parameter descriptions. */
const PAREN_CROSS_REF_SOURCE = `\\(from (${HTTP_METHODS}) (\\/api\\/[^\\s)]+)\\)`;

/**
 * @typedef {{ method: string, path: string }} CrossRefTarget
 * @typedef {{ tool: string, refs: CrossRefTarget[] }} CrossRefEntry
 *   One OpenAPI operation's cross-refs, labeled with the tool that OWNS the operation
 *   (i.e. the tool a caller would use to reach the endpoint carrying the annotation --
 *   NOT the referenced target). See `buildCrossRefEntries()` below for how the real spec
 *   is turned into a list of these.
 * @typedef {{ type: 'CROSSREF_UNRESOLVED', tool: string, method: string, path: string }} CrossRefFinding
 */

/**
 * Extracts every cross-ref (both forms) from a single OpenAPI operation object
 * (`spec.paths[path][method]`, or any object shaped like one -- tests pass plain
 * literals). Order: parameter refs first (in declaration order), then prose refs (in
 * regex match order) -- matches `deriveToolDescription()`'s own ordering in
 * derive-description.ts, though nothing here depends on that order.
 * @param {{ description?: string, parameters?: Array<{in?: string, name?: string, description?: string}> }} op
 * @returns {CrossRefTarget[]}
 */
function extractCrossRefsFromOperation(op) {
  const refs = [];

  for (const param of op?.parameters ?? []) {
    if (param?.in !== 'path' && param?.in !== 'query') continue;
    if (!param?.description) continue;
    const match = new RegExp(PAREN_CROSS_REF_SOURCE).exec(param.description);
    if (match) refs.push({ method: match[1], path: match[2] });
  }

  const description = op?.description;
  if (description) {
    const re = new RegExp(PROSE_CROSS_REF_SOURCE, 'g');
    let match;
    while ((match = re.exec(description)) !== null) {
      refs.push({ method: match[2], path: match[3] });
    }
  }

  return refs;
}

/**
 * Builds the `entries` input `checkCrossRefs()` expects, from a real loaded OpenAPI spec
 * (`loadOpenApiSpec()`, scripts/lib/openapi-contract-source.mjs) and an `endpointToTool`
 * resolver for the OWNING side (same function signature `checkCrossRefs` itself takes for
 * the referenced side -- callers typically pass the identical resolver to both).
 *
 * Operations with zero extracted refs are skipped entirely (nothing to check). An
 * operation whose OWN endpoint has no covering tool still contributes its entry --
 * `entry.tool` falls back to `"METHOD /api/path"` (mirrors `formatCrossRef()`'s own
 * fallback in derive-description.ts) so the finding remains attributable even though no
 * MCP tool exposes the annotation's source.
 * @param {object} spec Parsed `docs/dockhand-openapi.json` (or an equivalent fixture)
 * @param {(method: string, path: string) => string | undefined} endpointToTool
 * @returns {CrossRefEntry[]}
 */
function buildCrossRefEntries(spec, endpointToTool) {
  const entries = [];
  const methodPattern = new RegExp(`^(${HTTP_METHODS.toLowerCase()})$`);

  for (const [path, operations] of Object.entries(spec?.paths ?? {})) {
    for (const [method, op] of Object.entries(operations ?? {})) {
      if (!methodPattern.test(method)) continue; // skip non-HTTP keys (e.g. "parameters")

      const refs = extractCrossRefsFromOperation(op);
      if (refs.length === 0) continue;

      const upperMethod = method.toUpperCase();
      const owningTool = endpointToTool(upperMethod, path) ?? `${upperMethod} ${path}`;
      entries.push({ tool: owningTool, refs });
    }
  }

  return entries;
}

/**
 * Checks every cross-ref target against `endpointToTool` and reports every one that does
 * NOT resolve to a covering tool. Pure function, no I/O -- `entries` and `endpointToTool`
 * are both caller-supplied (see `buildCrossRefEntries()` for the real-spec wiring used by
 * `scripts/validate-mcp-tools.mjs`).
 *
 * Advisory by design (Task P3.6 scope, Refs #57): the caller is responsible for NOT
 * folding `CROSSREF_UNRESOLVED` into `hasCriticalErrors()` -- this function itself has no
 * opinion on exit codes, it only reports.
 * @param {CrossRefEntry[]} entries
 * @param {(method: string, path: string) => string | undefined} endpointToTool
 * @returns {CrossRefFinding[]}
 */
function checkCrossRefs(entries, endpointToTool) {
  const findings = [];

  for (const entry of entries ?? []) {
    for (const ref of entry?.refs ?? []) {
      const resolved = endpointToTool(ref.method, ref.path);
      if (resolved) continue;
      findings.push({
        type: 'CROSSREF_UNRESOLVED',
        tool: entry.tool,
        method: ref.method,
        path: ref.path,
      });
    }
  }

  return findings;
}

export { checkCrossRefs, extractCrossRefsFromOperation, buildCrossRefEntries };
