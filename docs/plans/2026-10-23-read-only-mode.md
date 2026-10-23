# Read-only Mode and Tool Filter Implementation Plan

> **Current classification:** [ADR-0003](../adr/0003-tool-read-write-classification.md). The tool sets in this plan are historical.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MCP_READ_ONLY`, `MCP_TOOLS_ALLOW` and `MCP_TOOLS_DENY` decide at startup which tools mcp-dockhand registers. Every tool carries MCP read/write annotations, and a generated `docs/tools.md` lists every tool with its mode.

**Architecture:** A pure policy module (`src/utils/tool-policy.ts`) classifies tools from the generated `TOOL_ENDPOINT_MAP`, plus `META_TOOL_NAMES` and two exception sets, and evaluates the env filter once. `registerTool()` (`src/utils/tool-helper.ts`) is the single choke point: it skips unregistered tools and passes annotations. `src/index.ts` builds the policy at startup and exits on a misconfiguration.

**Tech Stack:** TypeScript (strict), `@modelcontextprotocol/sdk` 1.32 (`McpServer.tool(name, description, paramsSchema, annotations, cb)`), Zod 3, Vitest 5, pino logger.

**Spec:** `docs/designs/2026-10-23-read-only-mode-design.md` (issue #254)

## Global Constraints

- Env names: `MCP_READ_ONLY`, `MCP_TOOLS_ALLOW`, `MCP_TOOLS_DENY`.
- `MCP_READ_ONLY` accepts `true`/`1`/`yes` and `false`/`0`/`no`/empty, case-insensitive. Any other value is a startup error.
- Patterns: `*` = any characters, including none. Any count, any position, a bare `*` is allowed. Match is anchored to the whole name and case-sensitive, and all other characters are literal.
- Under READ_ONLY only an **exact** ALLOW name (no `*`) re-admits a write tool. DENY always wins.
- Unknown tool name ⇒ write (fail-safe).
- Fatal at startup: invalid `MCP_READ_ONLY`, any ALLOW/DENY entry matching no tool, empty final set.
- `WRITE_GET_TOOLS = ['trigger_git_webhook']`
- `READ_ONLY_POST_TOOLS = ['validate_stack_compose','validate_stack_env','validate_stack_path','check_stack_path_change','preview_backup_restore','batch_get_selfhst_icons','list_git_remote_branches']`
- Meta tools come from the existing `META_TOOL_NAMES` in `src/tools/meta.ts` (do not duplicate the list).
- Commit scopes must be from `.commitlintrc` (`tools`, `auth`, `docs`, `ci`, `tests`, `security`, …). `design`/`policy` are **not** allowed. Commits end with the session's attribution trailers.
- No secrets in any log line or tool output. The policy summary contains names and patterns only.

## Review Focus

1. **Stray separators/whitespace** (`MCP_TOOLS_DENY=" get_* , ,list_*,"`): trimmed, and empty entries are ignored rather than treated as "matches nothing" errors. Test in Task 1.
2. **Regex metacharacters in an entry** (`get_.*`, `list_(x)`): matched literally, so they never throw and never widen the match. Test in Task 1.
3. **An entry in both ALLOW and DENY** (`ALLOW=restart_container`, `DENY=restart_*`): DENY wins and the tool is absent. Test in Task 1.
4. **`MCP_READ_ONLY=TRUE` / `Yes`** is accepted, and **`MCP_READ_ONLY=on`** is fatal rather than silently off. Test in Task 1.
5. **Annotations reach the client even with no filter set.** The default policy still passes `readOnlyHint`/`destructiveHint`. Test in Task 3.

---

### Task 1: Policy core (`tool-policy.ts`)

**Files:**
- Create: `src/utils/tool-policy.ts`
- Test: `tests/utils/tool-policy.test.ts`

**Interfaces:**
- Produces:
  - `export const WRITE_GET_TOOLS: readonly string[]`
  - `export const READ_ONLY_POST_TOOLS: readonly string[]`
  - `export class ToolPolicyError extends Error {}`
  - `export function compilePattern(entry: string): (name: string) => boolean`
  - `export function classifyTool(name: string, endpointMap: Readonly<Record<string, ToolEndpointEntry>>, metaToolNames: readonly string[]): 'read' | 'write'`
  - `export interface ToolPolicySummary { readOnly: boolean; allow: string[]; deny: string[]; registered: number; total: number; readmittedWriteTools: string[] }`
  - `export interface ToolPolicy { isRegistered(name: string): boolean; mode(name: string): 'read' | 'write'; summary: ToolPolicySummary }`
  - `export function buildToolPolicy(env: Record<string, string | undefined>, universe: { endpointMap: Readonly<Record<string, ToolEndpointEntry>>; metaToolNames: readonly string[] }): ToolPolicy` (throws `ToolPolicyError`)
  - `export function defaultToolPolicy(): ToolPolicy`: registers everything, classified with the real map.
  - `export function configureToolPolicy(p: ToolPolicy): void`, `export function currentToolPolicy(): ToolPolicy` (initially the default policy).

- [ ] **Step 1: Write the failing tests.** Use a small injected universe so the tests do not depend on the real map. `map = { get_a:{GET}, list_b:{GET}, trigger_git_webhook:{GET}, restart_container:{POST}, validate_stack_env:{POST}, scan_image:{POST}, delete_x:{DELETE} }` and `meta = ['self_check']`.
  - `classifyTool`:
    - `get_a` → read
    - `trigger_git_webhook` → write
    - `validate_stack_env` → read
    - `scan_image` → write
    - `self_check` → read
    - `unknown_tool` → write
  - `compilePattern`:
    - `get_*` matches `get_a` but not `xget_a`;
    - `*_b` matches `list_b`;
    - `*` matches everything;
    - `a*b*c` matches `abc` and `a_x_b_y_c`;
    - `get_.*` matches only the literal `get_.*` and does not throw;
    - `list_(x)` does not throw.
  - `buildToolPolicy`:
    - `{}` registers all 8 tools and `summary.readOnly === false`;
    - `MCP_READ_ONLY=true` registers exactly `get_a, list_b, validate_stack_env, self_check`;
    - `MCP_READ_ONLY=true` + `MCP_TOOLS_ALLOW=scan_image,get_*` registers `get_a, scan_image`, and `summary.readmittedWriteTools` is `['scan_image']`;
    - `MCP_READ_ONLY=true` + `MCP_TOOLS_ALLOW=scan_*` throws "no tools registered". `scan_*` matches `scan_image` in the universe, so it is not a "matches no tool" error, because that check always runs against the universe, not the base. Being a pattern, it re-admits nothing, so the whitelist leaves nothing.
    - `MCP_TOOLS_ALLOW=restart_container` + `MCP_TOOLS_DENY=restart_*` throws "no tools registered" (DENY beats ALLOW, Review Focus 3);
    - `MCP_TOOLS_DENY=delete_x` registers 7 tools;
    - `MCP_TOOLS_DENY=" get_* , ,list_*,"` registers 5 tools (Review Focus 1);
    - `MCP_TOOLS_DENY=*` throws "no tools registered";
    - `MCP_TOOLS_DENY=contianer_*` throws an error whose message names `MCP_TOOLS_DENY` and `contianer_*`;
    - `MCP_TOOLS_ALLOW=nope` throws an error naming `MCP_TOOLS_ALLOW` and `nope`;
    - `MCP_READ_ONLY` with `TRUE`, `Yes` and `1` means read-only; with `false`, `0` and `""` it does not; with `on` it throws an error naming `MCP_READ_ONLY` (Review Focus 4);
    - `policy.mode('restart_container') === 'write'` regardless of filter;
    - `summary` contains `allow`/`deny` as the trimmed entries and never any other env value.
- [ ] **Step 2: Run** `npx vitest run tests/utils/tool-policy.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/utils/tool-policy.ts`.**
  - `compilePattern`: split on `*`, escape each part for RegExp, join with `.*`, anchor with `^…$`.
  - `buildToolPolicy` follows the spec's evaluation block exactly. The universe is `keys(endpointMap) ∪ metaToolNames`.
  - `defaultToolPolicy()` imports `TOOL_ENDPOINT_MAP` and `META_TOOL_NAMES`. If importing `META_TOOL_NAMES` from `src/tools/meta.ts` creates an import cycle through `tool-helper.ts`, move `META_TOOL_NAMES` into a new `src/tools/meta-tool-names.ts`, re-export it from `meta.ts` and import it from there.
- [ ] **Step 4: Run** `npx vitest run tests/utils/tool-policy.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(tools): add read-only tool policy and filter evaluation`.

### Task 2: Classification guards against the real tool set

**Files:**
- Test: `tests/tool-policy-coverage.test.ts`
- Create: `tests/fixtures/read-get-tools.json` (the snapshot)

**Interfaces:**
- Consumes: `classifyTool`, `WRITE_GET_TOOLS`, `READ_ONLY_POST_TOOLS` (Task 1); `TOOL_ENDPOINT_MAP`; `META_TOOL_NAMES`; `registerAllTools(server, client)`.

- [ ] **Step 1: Write the tests.**
  - **Registered set equals the universe.** Call `registerAllTools` against a capturing fake server, using the same fake shape as `tests/tool-descriptions-derived.test.ts`, with the handler taken as the **last** argument. The set of captured names must equal `keys(TOOL_ENDPOINT_MAP) ∪ META_TOOL_NAMES`.
  - **Exception sets name real tools.** Every name in `WRITE_GET_TOOLS` is in the map with method GET. Every name in `READ_ONLY_POST_TOOLS` is in the map with method POST.
  - **GET snapshot.** The sorted list of map tools with method GET that `classifyTool` reports as read equals `tests/fixtures/read-get-tools.json`. The failure message tells the developer to add a new GET tool either to the fixture (read) or to `WRITE_GET_TOOLS` (side effect) after checking its Dockhand handler.
- [ ] **Step 2: Generate the fixture once.** Write the current read-GET list (171 entries: 172 GET minus `trigger_git_webhook`). Review the list by eye for side-effecting names before committing it.
- [ ] **Step 3: Run** `npx vitest run tests/tool-policy-coverage.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit:** `test(tools): guard read/write classification against the real tool set`.

### Task 3: Wire the policy into registration and startup

**Files:**
- Modify: `src/utils/tool-helper.ts` (`registerTool`)
- Modify: `src/index.ts` (after the `DOCKHAND_API_TOKEN` validation, ~line 57-60)
- Modify fakes that capture the handler positionally: `tests/tool-error-logging.test.ts:47`, `tests/tools/meta.get-tool-manifest-wiring.test.ts:34`, `tests/utils/tool-helper.runtime-stats.test.ts`. Also check `tests/tools/meta.register.test.ts`, `tests/description-overrides.test.ts` and `tests/tool-descriptions-derived.test.ts`, which only read leading arguments.
- Test: `tests/utils/tool-helper.policy.test.ts`, `tests/index-tool-policy.test.ts`

**Interfaces:**
- Consumes: `currentToolPolicy()`, `configureToolPolicy()`, `buildToolPolicy()`, `ToolPolicyError` (Task 1).
- Produces: `registerTool()` calls `server.tool(name, description, schema, annotations, handler)` with `annotations = { readOnlyHint: boolean, destructiveHint: boolean }`, where `destructiveHint = !readOnlyHint`.

- [ ] **Step 1: Write the failing tests.**
  - In `tool-helper.policy.test.ts`, with a fake server capturing all five arguments:
    - `default policy: registers and annotates`: after `configureToolPolicy(defaultToolPolicy())`, registering `get_job` captures `{readOnlyHint:true, destructiveHint:false}` and `cancel_job` captures `{readOnlyHint:false, destructiveHint:true}` (Review Focus 5).
    - `filtered tool is not registered`: after configuring `buildToolPolicy({MCP_READ_ONLY:'true'}, real universe)`, `registerTool(server,'cancel_job',…)` leaves the fake empty while `get_job` is registered.
    - Reset to the default policy in `afterEach`.
  - In `index-tool-policy.test.ts`, follow the pattern of `tests/index-fatal-exit-logging.test.ts`: spawn or import `src/index.ts` with `MCP_TOOLS_DENY=contianer_*`, then assert exit code 1 and a fatal log line containing `MCP_TOOLS_DENY`.
- [ ] **Step 2: Run both tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `registerTool`: return early if `!currentToolPolicy().isRegistered(name)`. Otherwise call the 5-argument `tool()` overload with the annotations.
  - `index.ts`: build the policy with `buildToolPolicy(process.env, {endpointMap: TOOL_ENDPOINT_MAP, metaToolNames: META_TOOL_NAMES})`. On a `ToolPolicyError`, log fatal with `component: 'config'` and `process.exit(1)`, the same way as the token error. Otherwise call `configureToolPolicy`, then log `info` `{component:'tools', readOnly, registered, total}` with the message `tool policy`. When `readmittedWriteTools` is non-empty, log `warn` `{component:'tools', tools}` with the message `write tools re-admitted under MCP_READ_ONLY via exact MCP_TOOLS_ALLOW names`. All of this happens **before** `createServer(config)`.
  - Update the three positional fakes to take the handler as the last argument, e.g. `tool(...args) { const handler = args.at(-1) … }`.
- [ ] **Step 4: Run** `npx vitest run` (full suite), `npm run typecheck`, `npm run typecheck:tests`. Expected: all PASS.
- [ ] **Step 5: Commit:** `feat(tools): register tools through the read-only policy with MCP annotations`.

### Task 4: Self-report the policy

**Files:**
- Modify: `src/tools/meta.ts`:
  - `ServerInfo` gets `toolPolicy: ToolPolicySummary`, filled by the `buildServerInfo` deps.
  - `SelfCheck` gets `toolPolicy: ToolPolicySummary`.
  - `ToolManifestEntry` gets `mode: 'read' | 'write'` and a `registered: boolean`; `buildToolManifest` deps get `classify: (name) => 'read'|'write'` and `isRegistered: (name) => boolean`.
- Modify the existing tests: `tests/tools/meta.get-server-info.test.ts`, `meta.self-check.test.ts`, `meta.tool-manifest.test.ts`, `meta.get-tool-manifest-wiring.test.ts`.

**Interfaces:**
- Consumes: `currentToolPolicy()` (Task 1). The wiring in `registerMetaTools` passes `currentToolPolicy().summary`, `.mode` and `.isRegistered`.

- [ ] **Step 1: Extend the tests.**
  - `buildServerInfo` echoes an injected `toolPolicy` summary unchanged.
  - `buildToolManifest` sets `mode` and `registered` per entry from the injected functions. `toolCount` stays the total (all tools), and a new `registeredCount` counts `registered: true`.
  - Wiring test: under `buildToolPolicy({MCP_READ_ONLY:'true'}, …)` the manifest marks `cancel_job` as `mode:'write', registered:false`.
- [ ] **Step 2: Run** the four test files. Expected: FAIL.
- [ ] **Step 3: Implement** the fields and the wiring.
- [ ] **Step 4: Run** the full suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(tools): report the active tool policy in server info, self check and manifest`.

### Task 5: Generated `docs/tools.md`

**Files:**
- Create: `src/utils/tool-list-doc.ts`, `scripts/generate-tool-list.mjs`, `docs/tools.md` (generated)
- Modify: `package.json` (script `"docs:tools": "node scripts/generate-tool-list.mjs"`); `.github/workflows/ci.yml` ("Derived docs are in sync" step: run the generator and add `docs/tools.md` to `git diff --exit-code`); `.github/workflows/api-schema-sync.yml` (regenerate and commit alongside `docs/coverage.md`)
- Test: `tests/tool-list-doc.test.ts`

**Interfaces:**
- Produces: `export function buildToolListDoc(deps: { endpointMap; metaToolNames: readonly string[]; classify: (name: string) => 'read'|'write'; summaryOf: (name: string) => string | undefined; openApiCommit: string }): string`

- [ ] **Step 1: Write the failing test.** With an injected map of 3 tools plus 1 meta tool, assert that the output:
  - starts with an auto-generated notice naming `scripts/generate-tool-list.mjs`;
  - contains the line `**Tools:** 4 · **read:** 2 · **write:** 2`;
  - has a table header `| Tool | Mode | Method | Path | Summary |`;
  - lists rows sorted by name;
  - shows `—` for the meta tool's method and path;
  - escapes `|` in summaries;
  - cuts each summary to its first sentence;
  - contains no timestamp, so regeneration is a no-op when nothing changed and the CI diff stays stable.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The builder in `src/utils/tool-list-doc.ts`.
  - The script imports from `../dist/` (CI runs `npm run build` before the derived-docs step, the same as the other generators): `buildToolListDoc`, `TOOL_ENDPOINT_MAP`, `META_TOOL_NAMES`, `classifyTool`, `specOperation`, `PINNED_DOCKHAND_OPENAPI_COMMIT`. It writes `docs/tools.md` only when the content changed, logging `[tool-list] Unverändert` or `[tool-list] Wrote N tools`, the same as `generate-coverage-doc.mjs`.
  - Wire the script into CI and the nightly workflow.
- [ ] **Step 4: Run** `npm run build && npm run docs:tools`, then run the test. Expected: PASS. Running `git diff --exit-code docs/tools.md` after a second `docs:tools` must be clean.
- [ ] **Step 5: Commit:** `docs(tools): generate docs/tools.md with read/write mode per tool`.

### Task 6: README, compose example, ADR-0003

**Files:**
- Modify: `README.md`:
  - three rows in the env table next to `MCP_AUTH_TOKEN`;
  - a new section "Read-only mode and tool filter" with the evaluation rules, three examples and a link to `docs/tools.md`. The examples are read-only only, read-only plus `scan_image`, and hiding the backup tools via `MCP_TOOLS_DENY=backup_*,*_backup_*`; verify the matches against `docs/tools.md` before writing them.
  - one paragraph stating that the filter adds to Dockhand RBAC, `MCP_AUTH_TOKEN` and `DOCKHAND_API_TOKEN` and does not replace them.
- Modify: `docker-compose.yml` (commented `MCP_READ_ONLY`, `MCP_TOOLS_ALLOW`, `MCP_TOOLS_DENY` lines).
- Create: `docs/adr/0003-tool-read-write-classification.md`, in the format of 0001/0002. It records the decision, the three sets, unknown ⇒ write, the GET snapshot guard and "exact name re-admits". Status `accepted`, date 2026-10-23, refs #254.
- Modify: `docs/adr/README.md` (registry row).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Check that every example env value is accepted by `buildToolPolicy` against the real universe, using a throwaway `node -e` against `dist/`. Do not commit that check.
- [ ] **Step 3: Commit:** `docs(tools): document read-only mode, tool filter and ADR-0003`.

### Task 7: Security review, then PR

- [ ] **Step 1:** Run the full local gate: `npm run typecheck`, `npm run typecheck:tests`, `npx vitest run`, `npm run build`, `npm run api:validate`, then all four derived-doc generators followed by a clean `git diff --exit-code`.
- [ ] **Step 2: Security review**, per the spec's "Security review" section, by a fresh reviewer (`/security-review` or a security-focused subagent) given the spec and the branch diff. It must answer each item explicitly:
  - **Bypass:**
    - Re-check every `READ_ONLY_POST_TOOLS` and `META_TOOL_NAMES` handler against Finsys/dockhand `9efea8b` `src/routes/api/**/+server.ts` for state changes or outbound effects.
    - Spot-check at least the GET tools whose names do not start with `get_`/`list_`: `detect_docker_socket`, `diff_backup_snapshots`, `health_check`, `health_check_database`, `preview_backup_stack_path`, `probe_backup_stack_dir`.
  - **Fail-open:** Is there any code path where a parse error, an unexpected env value or an import failure leaves `currentToolPolicy()` at the permissive default while the operator set a filter?
  - **Exposure:** Do the `toolPolicy` summary and the log lines carry only names and patterns?
  - **Docs:** Does the README state that this is not a substitute for RBAC or transport auth?
- [ ] **Step 3:** Fix in-scope findings with tests in this branch. Open issues for out-of-scope ones.
- [ ] **Step 4:** Push, then open the PR `feat(tools): read-only mode and tool allow/deny filter`. The PR body lists the security review findings and their outcome, and says `Closes #254`. Subscribe to PR activity and drive it to green.
