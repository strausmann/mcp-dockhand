# ADR-0002: Description-override map for shared-endpoint tools

**Status:** accepted
**Date:** 2026-08-10
**Refs:** #57 (P3 plan, "Final Fix Wave" review round), Findings 1 and 2

## Context

P3 (see commits `d37b986` "derive slim MCP tool descriptions from OpenAPI operations" and
`80a24e9` "derive descriptions from the spec, drop hand-written text") replaced every
hand-written MCP tool description with one derived at runtime from
`docs/dockhand-openapi.json`: `describeTool(name)` resolves `name` to a `{method, path}` via
`toolEndpoint()` (`src/openapi/tool-endpoint.ts`), looks up that endpoint's OpenAPI operation
via `specOperation()` (`src/openapi/spec-loader.ts`), and hands it to
`deriveToolDescription()` (`src/openapi/derive-description.ts`), which returns the
operation's `summary` plus any resolved cross-references.

This derivation is per-**endpoint**, not per-**tool**. When two MCP tools call the exact same
`{method, path}` — four such pairs currently exist, see `tool-endpoint-map.ts` — both resolve
to the identical spec operation and therefore receive the **identical** derived text. That
text is accurate for whichever tool the spec operation was actually written to describe, and
wrong for the other: it can name a request body field the other tool's Zod schema does not
accept at all, or omit the behavior that is the other tool's entire purpose.

Confirmed against the real handler code in `src/tools/*.ts` (not assumed) for all four pairs:

| Shared endpoint | Spec text actually describes | Gets it wrong |
|---|---|---|
| `PUT /api/stacks/{name}/env/raw` | `update_stack_env_raw` (raw-file write, `content` field) | `remove_stack_env_vars` (takes `keys: string[]`, no `content` field at all) |
| `GET /api/stacks/{name}/env` | `get_stack_env` (returns all variables) | `check_stack_env_collisions` (returns a collision report, not the variable list) |
| `DELETE /api/users/{id}/roles` | `remove_user_role` (takes `roleId`, optional `environmentId`) | `clear_user_roles` (takes only `userId`, clears every role — no `roleId`/`environmentId` params) |
| `GET /api/git/stacks/{id}/webhook` | `trigger_git_webhook` (takes and sends `secret`) | `get_git_stack_webhook` (takes only `stackId`, never sends a secret) |

The first of these (`remove_stack_env_vars`) was already flagged as a known, unresolved gap
at generation time — see the `EXPLICIT_OVERRIDES` comment in
`scripts/generate-tool-endpoint-map.mjs`: "KNOWN REGRESSION either way: the disambiguation …
has no surviving textual home at all". The P3 "Final Fix Wave" review round (this ADR) is
that follow-up.

A second, related problem: `endpointToTool()` (the reverse lookup other operations' cross-refs
use) resolved a shared endpoint to whichever tool happened to sort first alphabetically in
`TOOL_ENDPOINT_MAP`'s insertion order — an accident of naming, not a deliberate choice. For
three of the four pairs above, the alphabetically-first tool is the WRONG one (the one the
spec text does not describe).

## Decision

Two small, narrowly-scoped, fully-audited mechanisms — not a reintroduction of hand-written
prose across the tool surface:

1. **`TOOL_DESCRIPTION_OVERRIDES`** (`src/openapi/description-overrides.ts`): a
   `Record<toolName, string>` consulted by `describeTool()` BEFORE any spec lookup. An
   override wins outright when present. Currently four entries — exactly the four
   "gets it wrong" tools in the table above. Each entry restores that tool's own pre-P3
   hand-written description (from git history, the commit before `d37b986`) rather than
   inventing new prose: that text was already reviewed and shipped, and is tool-specific by
   construction.
2. **Deterministic tiebreak in `endpointToTool()`** (`src/openapi/tool-endpoint.ts`): when
   two tools share an endpoint, the one WITHOUT a `TOOL_DESCRIPTION_OVERRIDES` entry wins —
   not alphabetical order. The reasoning connecting the two mechanisms: an override exists
   *because* that tool's own derived description doesn't match its behavior, which means the
   spec operation wasn't written with that tool in mind — so it should not "own" the endpoint
   for cross-reference resolution either. The non-overridden sibling is, by construction, the
   tool the spec operation actually describes.

Both mechanisms are additive over the existing derivation path: a tool with no override and
no endpoint-sharing conflict behaves exactly as before this ADR.

### What was rejected

**Adding more `EXPLICIT_OVERRIDES` entries in `scripts/generate-tool-endpoint-map.mjs`** to
point the four affected tools at a *different*, less-shared endpoint. Rejected because no
such endpoint exists for any of the four — each genuinely calls the exact same REST endpoint
as its sibling; there is no dedicated `DELETE`/`PATCH` variant to redirect to. That map
answers "which endpoint does this tool call", a question with only one honest answer per
tool; it is not the right place to encode "how should this tool be described".

**A fully general "primary tool per endpoint" inference** (e.g., picking whichever tool's own
Zod parameter schema has the most overlap with the spec operation's declared parameters).
Rejected as disproportionate: only four pairs exist today, each already individually
confirmed by hand against the real handler code, and a heuristic inference risks being wrong
in a way that is *harder* to notice than the current, fully-enumerated, tested override list.
If a future shared endpoint appears, it is added to the table above and the override map
following the same audited process — not silently absorbed into a guess.

## Consequences

- `describeTool('remove_stack_env_vars')`, `describeTool('check_stack_env_collisions')`,
  `describeTool('clear_user_roles')`, and `describeTool('get_git_stack_webhook')` now return
  their own, tool-specific description instead of their endpoint-sibling's.
- `endpointToTool()` now resolves all four shared endpoints to the non-overridden sibling
  (`update_stack_env_raw`, `get_stack_env`, `remove_user_role`, `trigger_git_webhook`) — so a
  cross-reference embedded in some THIRD operation's spec text that happens to point at one of
  these endpoints resolves to the tool the spec text actually describes.
- A future new shared endpoint is safe by default (first-insertion tiebreak, unchanged
  behavior) until someone confirms a mismatch and adds an override — at which point the
  tiebreak redirects automatically, with no separate code change needed in
  `tool-endpoint.ts`.
- `tests/description-overrides.test.ts` guards the override map's structural invariants
  (every key a real tool, no empty values, and — as a deliberate regression fence, not a
  ceiling — exactly today's four entries); `tests/describe-tool.test.ts` and
  `tests/tool-endpoint.test.ts` assert the specific wrong-text/wrong-tiebreak regressions
  this ADR fixes stay fixed.

## Linked

- Overrides: `src/openapi/description-overrides.ts`
- Tiebreak: `src/openapi/tool-endpoint.ts` (`getEndpointToToolIndex()`)
- Tests: `tests/description-overrides.test.ts`, `tests/describe-tool.test.ts`
  ("description overrides" block), `tests/tool-endpoint.test.ts` ("shared-endpoint tiebreak"
  block)
- Origin of the known gap: `scripts/generate-tool-endpoint-map.mjs` (`EXPLICIT_OVERRIDES`,
  `remove_stack_env_vars`/`check_stack_env_collisions` comments)
- Prior art: `docs/adr/0001-omission-registry.md` (same "make a known gap machine-readable
  and tested, instead of leaving it as a comment" pattern)
