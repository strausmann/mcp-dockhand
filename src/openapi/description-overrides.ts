/**
 * Manual description overrides for MCP tools whose DERIVED description
 * (`deriveToolDescription()`, derive-description.ts, fed from `docs/dockhand-openapi.json`
 * via spec-loader.ts) is demonstrably wrong or misleading — checked by `describeTool()`
 * (describe-tool.ts) BEFORE spec-derivation runs.
 *
 * Derivation is a per-ENDPOINT lookup (`toolEndpoint(name)` -> `specOperation(endpoint)`),
 * not a per-TOOL one. When two tools call the SAME `{method, path}`, both resolve to the
 * SAME spec operation and therefore get the IDENTICAL derived text — correct for whichever
 * tool the spec operation was actually written to describe, wrong (field/behavior
 * mismatch) for the other. `endpointToTool()` (tool-endpoint.ts) additionally picks exactly
 * ONE of the two as the "owning" tool for CROSS-REFERENCE resolution (first match in
 * `TOOL_ENDPOINT_MAP`'s alphabetically-sorted insertion order) — that same tool is also the
 * one whose OWN description this ambiguity affects, since a caller has no way to ask for
 * "the other tool's" operation.
 *
 * This is a narrow, audited exception to "derive everything from the spec" (P3, Refs #57)
 * — NOT a reintroduction of hand-written prose across the board. Every entry below:
 *   1. Is added ONLY after confirming the derived text actually references a field/behavior
 *      the tool does not have (checked against the tool's own Zod schema + handler body in
 *      `src/tools/*.ts` — never assumed).
 *   2. Carries a code comment explaining WHY derivation fails for this specific pair.
 *   3. Reuses the tool's own pre-P3 hand-written description where one existed (git history,
 *      commit before d37b986) rather than inventing new prose — that text was already
 *      reviewed, shipped, and tool-specific.
 *
 * `tests/description-overrides.test.ts` guards two invariants: every key here is a real,
 * registered tool name (typo-proofing against `TOOL_ENDPOINT_MAP`), and every value is
 * non-empty. `tests/describe-tool.test.ts` additionally asserts the overridden text does
 * NOT contain the specific wrong field/behavior references that motivated each entry.
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
};
