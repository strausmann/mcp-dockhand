/**
 * Manual description overrides for MCP tools whose DERIVED description
 * (`deriveToolDescription()`, derive-description.ts, fed from `docs/dockhand-openapi.json`
 * via spec-loader.ts) is either demonstrably wrong/misleading, or cannot be derived at all
 * — checked by `describeTool()` (describe-tool.ts) BEFORE spec-derivation runs.
 *
 * Two distinct categories live here, for two distinct reasons:
 *
 * 1. SHARED-ENDPOINT MISMATCHES (`remove_stack_env_vars`, `check_stack_env_collisions`,
 *    `clear_user_roles`, `get_git_stack_webhook`). Derivation is a per-ENDPOINT lookup
 *    (`toolEndpoint(name)` -> `specOperation(endpoint)`), not a per-TOOL one. When two tools
 *    call the SAME `{method, path}`, both resolve to the SAME spec operation and therefore
 *    get the IDENTICAL derived text — correct for whichever tool the spec operation was
 *    actually written to describe, wrong (field/behavior mismatch) for the other.
 *    `endpointToTool()` (tool-endpoint.ts) additionally picks exactly ONE of the two as the
 *    "owning" tool for CROSS-REFERENCE resolution (first match in `TOOL_ENDPOINT_MAP`'s
 *    alphabetically-sorted insertion order) — that same tool is also the one whose OWN
 *    description this ambiguity affects, since a caller has no way to ask for "the other
 *    tool's" operation.
 *
 * 2. NO DOCKHAND ENDPOINT AT ALL (the six self-help/meta tools registered by
 *    `registerMetaTools()`, src/tools/meta.ts: `get_server_info`, `check_for_update`,
 *    `get_tool_manifest`, `self_check`, `validate_config`, `get_runtime_stats`). These
 *    diagnose the MCP server itself, not a Dockhand REST resource, so `toolEndpoint(name)`
 *    returns `undefined` for every one of them — there is no `{method, path}` to look up in
 *    the first place, let alone a spec operation to summarize. Without an override,
 *    `deriveToolDescription({}, ...)` falls through to its own `FALLBACK_DESCRIPTION`
 *    literal, `"No description available."` — the exact text an MCP client sees for all six
 *    tools, since the README (where these tools ARE documented) is never visible to a
 *    client. Left unfixed, that defeats the entire point of shipping self-help tools: a
 *    client cannot tell what any of them do without already knowing.
 *
 * This is a narrow, audited exception to "derive everything from the spec" (P3, Refs #57)
 * — NOT a reintroduction of hand-written prose across the board. Every entry below:
 *   1. Is added ONLY after confirming the derived text is either wrong (category 1, checked
 *      against the tool's own Zod schema + handler body in `src/tools/*.ts` — never assumed)
 *      or entirely undeliverable (category 2, confirmed via `toolEndpoint(name) ===
 *      undefined`).
 *   2. Carries a code comment explaining WHY derivation fails for this specific tool.
 *   3. For category 1, reuses the tool's own pre-P3 hand-written description where one
 *      existed (git history, commit before d37b986) rather than inventing new prose — that
 *      text was already reviewed, shipped, and tool-specific. Category 2 tools never had a
 *      derivable description to restore (there was never a spec operation to derive one
 *      from), so their text is newly written to match the existing entries' concise,
 *      single-sentence style — and kept in sync with the tool's own README row (see the
 *      "Self-help / meta tools" section) rather than duplicating it independently.
 *
 * `tests/description-overrides.test.ts` guards two invariants: every key here is a real,
 * registered tool name (checked against the full set of tools `registerAllTools()` actually
 * registers, not just `TOOL_ENDPOINT_MAP` — category 2 keys are never in that map by
 * design), and every value is non-empty. `tests/describe-tool.test.ts` additionally asserts
 * the overridden text does NOT contain the specific wrong field/behavior references that
 * motivated each category-1 entry, and DOES return the real override (never the fallback)
 * for each category-2 (meta) tool.
 */

export const TOOL_DESCRIPTION_OVERRIDES: Readonly<Record<string, string>> = {
  // Shares PUT /api/stacks/{name}/env/raw with `update_stack_env_raw`. The spec operation
  // describes the raw-file-write semantics of THAT tool (`content` body field, "Write raw
  // .env file content to disk", "empty content deletes the .env file"). `remove_stack_env_vars`
  // takes `keys: string[]` and has no `content` field at all — the derived text names a
  // field the tool does not accept. Restored the tool's own pre-P3 description (introduced
  // in c5e2e2f, "add remove_stack_env_vars for safe two-store key removal").
  remove_stack_env_vars:
    'Remove environment variables from a stack across BOTH stores. Secret keys are dropped ' +
    'from the encrypted database set (remaining secrets are preserved via masked "***" ' +
    'values); non-secret keys are removed from the .env file. Keys present in neither are ' +
    'returned in not_found. This is the safe way to delete variables — update_stack_env in ' +
    'the default merge mode cannot remove keys.',

  // Shares GET /api/stacks/{name}/env with `get_stack_env`. The spec operation describes
  // "Get all environment variables for a stack (secrets masked)" — accurate for
  // `get_stack_env`, but `check_stack_env_collisions` does not return the variable list at
  // all; it returns a collision report (keys present as BOTH a DB secret and a .env entry).
  // Restored the tool's own pre-P3 description.
  check_stack_env_collisions:
    'Read-only check reporting variable keys defined BOTH as a database-backed secret and ' +
    'in the plain .env file. Such duplicates are ambiguous: at deploy the secret (shell ' +
    'environment) wins over the .env value. Remove the duplicate copy with ' +
    '`remove_stack_env_vars`.',

  // Shares DELETE /api/users/{id}/roles with `remove_user_role`. The spec operation
  // describes "Remove a role assignment from a user, optionally scoped to an environment"
  // with cross-refs for `roleId` and `environmentId` — accurate for `remove_user_role`
  // (which takes both), but `clear_user_roles` takes ONLY `userId` (no roleId, no
  // environmentId) and clears EVERY role assignment, not one. The derived text's
  // cross-refs point at fields this tool's schema does not have. Restored the tool's own
  // pre-P3 description.
  clear_user_roles:
    'Permanently remove every role assignment from a user (the user remains, but loses all ' +
    'permissions until reassigned); pair with `get_user_roles` to inspect first, or ' +
    '`add_user_role` to re-assign roles afterwards.',

  // Shares GET /api/git/stacks/{id}/webhook with `trigger_git_webhook`. The spec operation
  // describes "GET webhook trigger ... with the secret passed as the `secret` query
  // parameter" — accurate for `trigger_git_webhook` (which takes and sends `secret`), but
  // `get_git_stack_webhook` takes only `stackId` and never sends a secret. Restored the
  // tool's own pre-P3 description.
  get_git_stack_webhook:
    'Retrieve the inbound webhook URL and secret configured on a Git-based stack (used by ' +
    'GitHub/GitLab/etc. to POST deploy notifications); use `trigger_git_webhook` to fire the ' +
    'webhook manually, or `get_git_webhook` for the equivalent on the generic webhook ' +
    'endpoint.',

  // --- Category 2: no Dockhand endpoint at all (registerMetaTools(), src/tools/meta.ts) ---
  // `toolEndpoint(name)` returns `undefined` for all six — there is no `{method, path}` to
  // resolve a spec operation from, so without an override each would fall through to the
  // literal fallback string "No description available.". See the file-level comment above
  // for the full rationale; each entry mirrors its own row in README.md's "Self-help / meta
  // tools" table.

  get_server_info:
    "This server's own version, git SHA, build date, and uptime, plus the MCP protocol " +
    'version and the Dockhand URL and server version it is currently connected to.',

  check_for_update:
    'Checks whether a newer mcp-dockhand release is available by comparing this server\'s ' +
    "running version against the latest GitHub release; the result is cached for about an " +
    'hour.',

  get_tool_manifest:
    'Lists every tool this build exposes together with the pinned Dockhand OpenAPI ' +
    'commit/version they were generated against, so a client can detect drift between the ' +
    'two.',

  self_check:
    'Live end-to-end diagnostic: Dockhand reachability, credential validity, latency, and a ' +
    'per-environment reachability check plus Hawser-agent-connected status, all in one call.',

  validate_config:
    "Checks whether this server's required Dockhand configuration is present and the " +
    'credentials authenticate; returns only booleans and the raw HTTP status code, never ' +
    'secret values.',

  get_runtime_stats:
    'In-process request and error counters for this server, broken down per tool, plus the ' +
    'most recent error, for debugging this server itself (never call arguments or response ' +
    'payloads).',
};
