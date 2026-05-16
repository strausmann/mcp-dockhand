# Tool Description Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise every MCP tool description in `src/tools/*.ts` to the quality bar of PR #58 so AI clients can disambiguate sibling tools.

**Architecture:** Test-first audit. A new `tests/tool-descriptions.test.ts` codifies the four quality criteria (C1–C4) from the design spec. Description rewrites land per-file; tests for each file's clusters are added in the same commit as the description rewrites. Generic assertions (length ≥60, destructive verb, sentence end) stay RED until the last file ships — that is acceptable for a single-PR audit.

**Tech Stack:** TypeScript strict, Vitest, Node 22. No runtime mocks — every assertion is static analysis over the source files.

**Spec:** `docs/designs/2026-05-16-tool-description-audit-design.md` (commit `ab03bb2`).
**Tracking issue:** strausmann/mcp-dockhand#62. Every commit body MUST end with `Refs #62`.
**Branch:** `feat/tool-description-audit` (already pushed to origin).

---

## Conventions for every commit

- Conventional Commits scope is one of: `tools` (description updates per file), `tests` (test scaffolding), `docs` (spec/plan).
- header-max-length 100; scope-empty=never; subject-empty=never.
- `git commit` is run with `-c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com"`.
- **No** `Co-Authored-By: Claude` anywhere.
- Husky pre-commit and commit-msg hooks are active — commits will fail fast if any rule breaks.
- Subagents do NOT push. The orchestrator pushes after final code review.

---

## File structure

**Created:**
- `tests/tool-descriptions.test.ts` — the audit's enforcement mechanism.

**Modified:**
- `src/tools/audit.ts` (4 tools)
- `src/tools/auth.ts` (14 tools)
- `src/tools/auto-update.ts` (3 tools)
- `src/tools/containers.ts` (28 tools)
- `src/tools/dashboard.ts` (8 tools)
- `src/tools/environments.ts` (18 tools)
- `src/tools/git-stacks.ts` (21 tools)
- `src/tools/images.ts` (8 tools)
- `src/tools/networks.ts` (7 tools)
- `src/tools/notifications.ts` (8 tools)
- `src/tools/registries.ts` (9 tools)
- `src/tools/schedules.ts` (8 tools)
- `src/tools/stacks.ts` (23 tools)
- `src/tools/system.ts` (25 tools)
- `src/tools/users.ts` (29 tools)
- `src/tools/volumes.ts` (9 tools)

Total: 222 tool registrations across 16 files. (The spec said 223; the extractor counts 222 due to a single tool whose description spans an unusual brace pattern — does not affect the plan.)

---

## Quality criteria (verbatim from spec)

Every description after this PR meets all four:

- **C1** — Opens with an action verb naming the operation and the noun it acts on. Destructive operations use destructive verbs explicitly (`delete`, `remove`, `prune`, `tear down`, `stop`, `revoke`, `disable`, `disconnect`).
- **C2** — If the tool belongs to a cluster (see §Tool clusters in spec), description references at least one sibling tool by name in backticks with a `"For X use \`<sibling>\`."` phrase.
- **C3** — Tools that share a prompt-surface with siblings name the distinguishing axis (DB-backed vs. disk, batch vs. single, stream vs. sync, per-stack vs. global).
- **C4** — `description.length >= 60` characters.

The reference quality bar (already on `main` from PR #58) is the `update_stack_env` / `update_stack_env_raw` pair in `src/tools/stacks.ts`.

---

## Task 0: Test scaffolding

**Files:**
- Create: `tests/tool-descriptions.test.ts`
- Test: `tests/tool-descriptions.test.ts` (the file under test is itself the harness)

This task adds the enforcement mechanism. After this commit lands, `npx vitest run tests/tool-descriptions.test.ts` is RED across most assertions (intended — that's what the audit fixes file-by-file).

- [ ] **Step 1: Create `tests/tool-descriptions.test.ts` with extractor and assertions**

```typescript
/**
 * Tool description audit — static-analysis assertions over src/tools/*.ts.
 *
 * Enforces the four quality criteria from
 * docs/designs/2026-05-16-tool-description-audit-design.md:
 *   C1 — action-verb first sentence (destructive verbs named explicitly)
 *   C2 — backticked cross-references within tool clusters
 *   C3 — scope marker for ambiguous tools
 *   C4 — description.length >= 60
 *
 * Generic assertions cover C1 (destructive verb), C4 (length), and basic
 * sentence-form hygiene. Per-cluster assertions cover C2 (cross-references).
 * C3 is judgement-based and verified by code review, not by automated tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, '..', 'src', 'tools');

interface ToolMeta {
  name: string;
  description: string;
  file: string;
}

/**
 * Extracts every `registerTool(server, 'name', 'description', ...)` site
 * across every src/tools/*.ts (excluding the index). The description regex
 * accepts single quotes, double quotes, or backticks, and tolerates the
 * description spanning multiple physical lines.
 */
function extractAllTools(): ToolMeta[] {
  const files = readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .sort();
  const tools: ToolMeta[] = [];
  const pattern =
    /registerTool\s*\(\s*server\s*,\s*['"`]([^'"`]+)['"`]\s*,\s*(['"`])([\s\S]*?)\2\s*,/g;
  for (const file of files) {
    const content = readFileSync(join(TOOLS_DIR, file), 'utf-8');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      tools.push({ name: m[1], description: m[3], file });
    }
  }
  return tools;
}

const ALL_TOOLS = extractAllTools();

/**
 * Clusters that require C2 cross-references. Every member's description
 * MUST mention at least one sibling member by name in backticks.
 *
 * Keep this in sync with the §Tool clusters table in
 * docs/designs/2026-05-16-tool-description-audit-design.md.
 */
const CLUSTERS: Record<string, string[]> = {
  // stacks.ts
  'Stack-Env': [
    'get_stack_env',
    'get_stack_env_raw',
    'update_stack_env',
    'update_stack_env_raw',
  ],
  'Stack-Compose': ['get_stack_compose', 'update_stack_compose'],
  'Stack-Lifecycle': ['start_stack', 'stop_stack', 'restart_stack', 'down_stack'],
  'Stack-Path': [
    'get_stack_base_path',
    'get_stack_default_path',
    'get_stack_path_hints',
    'check_stack_path_change',
    'validate_stack_path',
    'relocate_stack',
  ],
  'Stack-Source': ['get_stack_sources', 'list_stacks', 'scan_stacks', 'adopt_stack'],
  // containers.ts
  'Container-Lifecycle': [
    'start_container',
    'stop_container',
    'restart_container',
    'pause_container',
    'unpause_container',
    'rename_container',
    'update_container',
    'batch_update_containers',
  ],
  'Container-Inspect': [
    'get_container',
    'inspect_container',
    'get_container_logs',
    'get_container_stats',
    'get_container_top',
    'get_container_sizes',
    'get_container_shells',
  ],
  'Container-Files': [
    'list_container_files',
    'get_container_file_content',
    'create_container_file',
    'delete_container_file',
    'rename_container_file',
    'chmod_container_file',
    'download_container_file',
    'upload_container_file',
  ],
  // system.ts
  'Prune-Family': [
    'prune_all',
    'prune_containers',
    'prune_images',
    'prune_volumes',
    'prune_networks',
  ],
  'System-Files': ['list_system_files', 'get_system_file_content'],
  'System-Info': [
    'get_system_info',
    'get_system_disk',
    'get_host_info',
    'get_general_settings',
    'update_general_settings',
  ],
  Health: ['health_check', 'health_check_database'],
  License: ['get_license', 'activate_license', 'get_legal_license'],
  'Scanner-Settings': ['get_scanner_settings', 'update_scanner_settings'],
  // images.ts
  'Image-Lifecycle': [
    'pull_image',
    'push_image',
    'tag_image',
    'remove_image',
    'list_images',
    'get_image_history',
    'scan_image',
    'export_image',
  ],
  // volumes.ts
  'Volume-Lifecycle': [
    'browse_volume',
    'clone_volume',
    'export_volume',
    'get_volume',
    'inspect_volume',
    'list_volumes',
    'remove_volume',
    'get_volume_file_content',
    'release_volume_browse',
  ],
  // networks.ts
  'Network-Lifecycle': [
    'create_network',
    'get_network',
    'inspect_network',
    'list_networks',
    'remove_network',
    'connect_container_to_network',
    'disconnect_container_from_network',
  ],
  // git-stacks.ts
  'Git-Repository': [
    'create_git_repository',
    'get_git_repository',
    'list_git_repositories',
    'deploy_git_repository',
    'test_git_repository',
    'test_git_repository_connection',
    'sync_git_repository',
  ],
  'Git-Stack': [
    'list_git_stacks',
    'get_git_stack',
    'deploy_git_stack',
    'test_git_stack',
    'sync_git_stack',
    'get_git_stack_env_files',
    'get_git_webhook',
    'trigger_git_webhook',
    'request_git_preview_env',
  ],
  'Git-Credentials': [
    'create_git_credential',
    'get_git_credential',
    'list_git_credentials',
    'delete_git_credential',
    'update_git_credential',
  ],
  // auth.ts
  'Auth-LDAP': ['create_ldap_provider', 'get_ldap_provider', 'test_ldap_provider'],
  'Auth-OIDC': [
    'create_oidc_provider',
    'get_oidc_provider',
    'test_oidc_provider',
    'initiate_oidc_login',
    'get_auth_providers',
    'get_auth_session',
    'get_auth_settings',
  ],
  'Hawser-Tokens': ['list_hawser_tokens', 'create_hawser_token', 'revoke_hawser_token'],
  // users.ts
  Users: [
    'create_user',
    'delete_user',
    'get_user',
    'list_users',
    'update_user',
    'enable_user_mfa',
    'disable_user_mfa',
    'get_user_roles',
    'set_user_roles',
  ],
  Roles: ['create_role', 'delete_role', 'get_role', 'list_roles', 'update_role'],
  Profile: ['get_profile', 'update_profile', 'get_profile_preferences', 'update_profile_preferences'],
  'Favorites-Prefs': [
    'get_favorites',
    'set_favorites',
    'get_favorite_groups',
    'set_favorite_groups',
    'get_grid_preferences',
    'set_grid_preferences',
  ],
  'Config-Sets': [
    'create_config_set',
    'delete_config_set',
    'get_config_set',
    'list_config_sets',
    'update_config_set',
  ],
  // notifications.ts
  Notifications: [
    'create_notification',
    'get_notification',
    'list_notifications',
    'delete_notification',
    'update_notification',
    'test_notification',
    'test_notification_config',
    'trigger_test_notification',
  ],
  // environments.ts
  Environments: [
    'create_environment',
    'delete_environment',
    'get_environment',
    'list_environments',
    'update_environment',
    'test_environment',
    'test_environment_connection',
    'detect_docker_socket',
  ],
  'Env-Notifications': [
    'create_environment_notification',
    'get_environment_notification',
    'list_environment_notifications',
    'delete_environment_notification',
  ],
  'Env-Settings': [
    'get_environment_timezone',
    'set_environment_timezone',
    'get_environment_update_check',
    'set_environment_update_check',
    'get_environment_image_prune',
    'set_environment_image_prune',
  ],
  // schedules.ts
  Schedules: [
    'list_schedules',
    'get_schedule_execution',
    'get_schedule_executions',
    'run_schedule_now',
    'toggle_schedule',
    'toggle_system_schedule',
    'get_schedule_settings',
    'update_schedule_settings',
  ],
  // registries.ts
  Registries: [
    'create_registry',
    'delete_registry',
    'get_registry',
    'list_registries',
    'update_registry',
    'search_registry',
    'get_registry_catalog',
    'get_registry_tags',
    'set_default_registry',
  ],
  // audit.ts
  Audit: ['get_audit_events', 'get_audit_log', 'get_audit_users', 'export_audit_log'],
  // dashboard.ts
  Activity: [
    'get_activity_feed',
    'get_activity_events',
    'get_activity_stats',
    'get_container_activity',
  ],
  'Dashboard-Prefs': [
    'get_dashboard_preferences',
    'set_dashboard_preferences',
    'get_dashboard_stats',
  ],
  // auto-update.ts
  'Auto-Update': [
    'get_container_auto_update',
    'set_container_auto_update',
    'get_auto_update_settings',
  ],
};

/**
 * Tools whose name matches one of these prefixes are treated as destructive
 * and MUST contain a destructive verb in their description.
 */
const DESTRUCTIVE_NAME_PATTERN =
  /^(delete_|remove_|prune_|down_|stop_|revoke_|disable_|disconnect_)/;
const DESTRUCTIVE_VERBS =
  /\b(delete|remove|prune|destroy|stop|tear down|drop|revoke|disable|disconnect)\b/i;

describe('Tool description audit', () => {
  describe('C4 — minimum length', () => {
    it('every description is at least 60 characters', () => {
      const tooShort = ALL_TOOLS.filter((t) => t.description.length < 60).map(
        (t) => `${t.file}::${t.name} (${t.description.length} chars): "${t.description}"`,
      );
      expect(tooShort, `\n${tooShort.join('\n')}`).toEqual([]);
    });
  });

  describe('C1 — destructive verb hygiene', () => {
    it('every destructive-named tool names a destructive action', () => {
      const violators = ALL_TOOLS.filter(
        (t) =>
          DESTRUCTIVE_NAME_PATTERN.test(t.name) &&
          !DESTRUCTIVE_VERBS.test(t.description),
      ).map((t) => `${t.file}::${t.name}: "${t.description}"`);
      expect(violators, `\n${violators.join('\n')}`).toEqual([]);
    });
  });

  describe('sentence hygiene', () => {
    it('every description ends with sentence-terminating punctuation', () => {
      const violators = ALL_TOOLS.filter((t) => {
        const last = t.description.trim().slice(-1);
        return !['.', '!', '?', ')'].includes(last);
      }).map((t) => `${t.file}::${t.name}: ends with "${t.description.slice(-10)}"`);
      expect(violators, `\n${violators.join('\n')}`).toEqual([]);
    });
  });

  describe('C2 — cluster cross-references', () => {
    for (const [clusterName, members] of Object.entries(CLUSTERS)) {
      describe(clusterName, () => {
        it('every member references at least one sibling by name in backticks', () => {
          const byName = new Map(ALL_TOOLS.map((t) => [t.name, t.description]));
          const missing: string[] = [];
          for (const member of members) {
            const desc = byName.get(member);
            if (!desc) {
              missing.push(`${member}: tool not found in any src/tools/*.ts`);
              continue;
            }
            const siblings = members.filter((s) => s !== member);
            const hasBacktickedSibling = siblings.some((s) =>
              desc.includes('`' + s + '`'),
            );
            if (!hasBacktickedSibling) {
              missing.push(`${member} (cluster ${clusterName}): "${desc}"`);
            }
          }
          expect(missing, `\n${missing.join('\n')}`).toEqual([]);
        });
      });
    }
  });
});
```

- [ ] **Step 2: Run the new test file to confirm it loads and runs**

Run: `cd /tmp/mcp-dockhand && npx vitest run tests/tool-descriptions.test.ts`
Expected: vitest runs, reports many failures across C4, C2, and possibly the sentence-hygiene check. No test-file syntax errors. No `extractAllTools` errors.

- [ ] **Step 3: Run typecheck on the new test**

Run: `cd /tmp/mcp-dockhand && npm run typecheck`
Expected: PASS (the test file is pure TypeScript with no untyped APIs).

- [ ] **Step 4: Run lint on the new test**

Run: `cd /tmp/mcp-dockhand && npm run lint`
Expected: PASS (the test follows the same style as `tests/stack-env-tools.test.ts`).

- [ ] **Step 5: Commit**

```bash
cd /tmp/mcp-dockhand
git add tests/tool-descriptions.test.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "test(tests): add tool description audit scaffolding

Static-analysis assertions over src/tools/*.ts enforcing the four
quality criteria from the design spec:

  C1 — action-verb first sentence (destructive verbs named)
  C2 — backticked cross-references within tool clusters
  C3 — scope marker for ambiguous tools (judgement-based, not auto)
  C4 — description.length >= 60 characters

Plus sentence-form hygiene (descriptions end with punctuation). The
CLUSTERS table mirrors the §Tool clusters section of the design doc.

Tests are RED on the current corpus — that is the expected RED state
for the audit's TDD cycle. Per-file commits in this PR turn cluster
groups GREEN one at a time; the generic length / destructive-verb
checks stay RED until the last file lands.

Refs #62"
```

---

## Per-file task structure (Tasks 1–16)

Each task below modifies exactly one `src/tools/*.ts` file. Within one task:

1. Confirm the cluster tests for this file's clusters are currently failing.
2. Rewrite the descriptions of every tool registered in the file. Apply C1–C4. Use the cluster's sibling list to insert backticked cross-references for C2.
3. Run the targeted vitest on this file's clusters and confirm GREEN.
4. Run `npm run typecheck` and `npm run lint`.
5. Commit.

The implementer subagent must rewrite each description; this plan does not pre-write the prose. The criteria (C1–C4) plus the tests (Task 0) define the acceptance bar. The PR #58 pair (`update_stack_env`, `update_stack_env_raw`) is the gold-standard example for cross-references and length — refer to it.

**Concrete examples for shape:**

Bad: `'Read environment variables of a stack'` (38 chars, no cross-ref, no scope marker)

Good (C1+C2+C3+C4): `` 'Read the DB-backed environment variables of a stack (list of {name, value, isSecret} entries; secrets are masked). For the raw .env file content on disk, use `get_stack_env_raw`.' ``

Bad: `'Remove an image'` (15 chars, no cross-ref to siblings, destructive verb present but no scope)

Good: `` 'Delete an image from the environment. Fails if any container references the image — pass `force:true` to override. For pulling images use `pull_image`, for tagging use `tag_image`.' ``

Bad: `'Tear down a stack'` (17 chars, no scope info)

Good: `` 'Tear down a stack: stops every container in it, removes the containers, and removes the project-private networks. Volumes persist. For temporary halts that preserve containers, use `stop_stack`; to start it back up, use `start_stack`.' ``

---

### Task 1: audit.ts (4 tools, cluster: Audit)

**Files:**
- Modify: `src/tools/audit.ts`
- Test: `tests/tool-descriptions.test.ts` (cluster `Audit`)

**Tools to update:** `get_audit_log`, `get_audit_events`, `get_audit_users`, `export_audit_log`

**Cluster cross-ref rule:** every member's description must mention at least one of the other three in backticks.

- [ ] **Step 1: Confirm RED for this cluster**

Run: `cd /tmp/mcp-dockhand && npx vitest run tests/tool-descriptions.test.ts -t "Audit"`
Expected: FAIL — at least one violator listed in cluster `Audit`.

- [ ] **Step 2: Rewrite descriptions in `src/tools/audit.ts`**

Apply C1–C4 to each of the four tools. Cross-reference siblings using backticked names. Distinguish them on the data axis (full log vs. event types vs. per-user grouping vs. export-to-file).

- [ ] **Step 3: Run cluster test, confirm GREEN**

Run: `cd /tmp/mcp-dockhand && npx vitest run tests/tool-descriptions.test.ts -t "Audit"`
Expected: PASS for cluster `Audit`. C4 generic test still RED across the rest of the corpus — that is expected.

- [ ] **Step 4: Run typecheck and lint**

Run: `cd /tmp/mcp-dockhand && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /tmp/mcp-dockhand
git add src/tools/audit.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand audit tool descriptions for AI disambiguation

Rewrite get_audit_log, get_audit_events, get_audit_users, and
export_audit_log descriptions to meet C1-C4. Each tool now names its
distinguishing data axis (full log vs. event types vs. per-user
grouping vs. export-to-file) and cross-references its siblings in
backticks.

Refs #62"
```

---

### Task 2: auto-update.ts (3 tools, cluster: Auto-Update)

**Files:**
- Modify: `src/tools/auto-update.ts`
- Test: `tests/tool-descriptions.test.ts` (cluster `Auto-Update`)

**Tools:** `get_auto_update_settings`, `get_container_auto_update`, `set_container_auto_update`

**Cross-ref rule:** each must mention at least one of the other two.

**Scope axis:** environment-wide settings vs. per-container get vs. per-container set.

- [ ] **Step 1:** Run `npx vitest run tests/tool-descriptions.test.ts -t "Auto-Update"` → confirm RED.
- [ ] **Step 2:** Rewrite the three descriptions per C1–C4 with cross-refs and the scope axis above.
- [ ] **Step 3:** Run the same vitest → confirm GREEN for the cluster.
- [ ] **Step 4:** Run `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5:** Commit.

```bash
cd /tmp/mcp-dockhand
git add src/tools/auto-update.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand auto-update tool descriptions

Cross-reference get_auto_update_settings (env-wide) against the
per-container get_container_auto_update and set_container_auto_update,
clarifying the scope axis (environment defaults vs. per-container
override).

Refs #62"
```

---

### Task 3: networks.ts (7 tools, cluster: Network-Lifecycle)

**Files:**
- Modify: `src/tools/networks.ts`
- Test: `tests/tool-descriptions.test.ts` (cluster `Network-Lifecycle`)

**Tools:** `list_networks`, `get_network`, `inspect_network`, `create_network`, `remove_network`, `connect_container_to_network`, `disconnect_container_from_network`

**Scope axes:**
- `get_network` vs. `inspect_network` — confirm by reading both blocks; if both return docker-inspect JSON, name the distinction (e.g., "summary" vs. "full inspect") or merge the description honesty.
- `create_network` vs. `remove_network` — destructive on remove.
- `connect_*` / `disconnect_*` — pair; cross-reference each other.

- [ ] **Step 1:** `npx vitest run tests/tool-descriptions.test.ts -t "Network-Lifecycle"` → RED.
- [ ] **Step 2:** Rewrite all 7 descriptions. `remove_network` and `disconnect_container_from_network` must contain destructive verbs ("delete", "remove", "disconnect").
- [ ] **Step 3:** Same vitest → GREEN.
- [ ] **Step 4:** `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/networks.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand network lifecycle descriptions

Cross-reference the create/remove pair and the connect/disconnect
pair, name the get vs. inspect scope axis, and add destructive verbs
to remove_network and disconnect_container_from_network.

Refs #62"
```

---

### Task 4: images.ts (8 tools, cluster: Image-Lifecycle)

**Tools:** `list_images`, `get_image_history`, `tag_image`, `remove_image`, `pull_image`, `push_image`, `scan_image`, `export_image`

**Scope axes:** read (`list`, `get_image_history`) vs. registry-in (`pull_image`) vs. registry-out (`push_image`) vs. tag (`tag_image`) vs. delete (`remove_image`) vs. scan (`scan_image`) vs. file-export (`export_image`).

- [ ] **Step 1:** vitest -t "Image-Lifecycle" → RED.
- [ ] **Step 2:** Rewrite all 8. `remove_image` must contain destructive verb.
- [ ] **Step 3:** vitest → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/images.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand image lifecycle descriptions

Differentiate the pull/push registry direction, tag vs. remove
mutation kind, and scan vs. export informational paths. Each tool
references at least one sibling in backticks.

Refs #62"
```

---

### Task 5: volumes.ts (9 tools, cluster: Volume-Lifecycle)

**Tools:** `list_volumes`, `get_volume`, `inspect_volume`, `browse_volume`, `get_volume_file_content`, `release_volume_browse`, `clone_volume`, `export_volume`, `remove_volume`

**Notes:**
- `browse_volume` and `release_volume_browse` are paired (lock acquire / release) — call this out.
- `get_volume` vs. `inspect_volume` — same disambiguation question as networks; pick honestly.
- `remove_volume` destructive.

- [ ] **Step 1:** vitest -t "Volume-Lifecycle" → RED.
- [ ] **Step 2:** Rewrite all 9.
- [ ] **Step 3:** vitest → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/volumes.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand volume lifecycle descriptions

Pair browse_volume with release_volume_browse, differentiate
clone vs. export vs. remove, and name the get vs. inspect scope.

Refs #62"
```

---

### Task 6: registries.ts (9 tools, cluster: Registries)

**Tools:** `list_registries`, `create_registry`, `get_registry`, `update_registry`, `delete_registry`, `set_default_registry`, `search_registry`, `get_registry_catalog`, `get_registry_tags`

**Notes:**
- `delete_registry` destructive.
- `set_default_registry` is meta (changes which registry is used by default).
- `search_registry`, `get_registry_catalog`, `get_registry_tags` are content queries on a chosen registry.

- [ ] **Step 1:** vitest -t "Registries" → RED.
- [ ] **Step 2:** Rewrite all 9.
- [ ] **Step 3:** vitest → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/registries.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand registry tool descriptions

CRUD subgroup cross-references itself; the content-query subgroup
(search, catalog, tags) names what it returns; set_default_registry
explains its meta-effect on subsequent pulls.

Refs #62"
```

---

### Task 7: schedules.ts (8 tools, cluster: Schedules)

**Tools:** `list_schedules`, `get_schedule_settings`, `update_schedule_settings`, `get_schedule_executions`, `get_schedule_execution`, `run_schedule_now`, `toggle_schedule`, `toggle_system_schedule`

**Scope axes:**
- Settings get/update — env-scoped configuration.
- Executions get plural vs. singular — history vs. one row.
- `run_schedule_now` is one-shot manual trigger.
- `toggle_schedule` vs. `toggle_system_schedule` — user-defined vs. built-in.

- [ ] **Step 1:** vitest -t "Schedules" → RED.
- [ ] **Step 2:** Rewrite all 8.
- [ ] **Step 3:** vitest → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/schedules.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand schedule tool descriptions

Differentiate settings get/update, executions plural vs. singular,
manual run_schedule_now trigger, and user vs. system toggle scopes.

Refs #62"
```

---

### Task 8: notifications.ts (8 tools, cluster: Notifications)

**Tools:** `list_notifications`, `create_notification`, `get_notification`, `update_notification`, `delete_notification`, `test_notification`, `test_notification_config`, `trigger_test_notification`

**Notes:**
- `delete_notification` destructive.
- Three test variants need clear disambiguation: `test_notification` (tests a saved notification by id), `test_notification_config` (tests a config blob without saving), `trigger_test_notification` (fires the standard test payload). Read the code blocks to confirm what each does before writing.

- [ ] **Step 1:** vitest -t "Notifications" → RED.
- [ ] **Step 2:** Read the three `test_*` blocks first to ground the wording in actual behaviour. Then rewrite all 8.
- [ ] **Step 3:** vitest → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/notifications.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand notification tool descriptions

Disambiguate the three test variants (saved-id vs. config-blob vs.
fire-default), pair create/delete/update with each other, and
keep delete_notification explicitly destructive.

Refs #62"
```

---

### Task 9: dashboard.ts (8 tools, clusters: Activity + Dashboard-Prefs)

**Files:**
- Modify: `src/tools/dashboard.ts`
- Test: `tests/tool-descriptions.test.ts` (clusters `Activity`, `Dashboard-Prefs`)

**Tools:** `get_dashboard_stats`, `get_dashboard_preferences`, `set_dashboard_preferences`, `get_activity_feed`, `get_container_activity`, `get_activity_events`, `get_activity_stats`, `get_merged_logs`

**Notes:**
- `get_container_activity` is named in two clusters? No — `Activity` only. The spec table has it once under Activity. (It also appears in `containers.ts` per the source — confirm during implementation; if `get_container_activity` is registered in `dashboard.ts` not `containers.ts`, the cluster membership in the test file is still correct because the cluster check is name-based across the whole corpus.)
- `get_merged_logs` is standalone — its description still needs C1, C3, C4 but no cross-reference is required.
- Two clusters touch this file: `Activity` (4 tools) and `Dashboard-Prefs` (3 tools).

- [ ] **Step 1:** vitest -t "Activity" then vitest -t "Dashboard-Prefs" → both RED.
- [ ] **Step 2:** Rewrite all 8. `get_merged_logs` gets a long-enough description and standalone explanation.
- [ ] **Step 3:** Both vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/dashboard.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand dashboard and activity descriptions

Cross-reference activity_feed / activity_events / activity_stats /
container_activity as the Activity cluster; pair get/set dashboard
preferences with dashboard_stats; give merged_logs a standalone
explanation of multi-container log merging.

Refs #62"
```

---

### Task 10: environments.ts (18 tools, clusters: Environments + Env-Notifications + Env-Settings)

**Tools (18):**
`list_environments`, `get_environment`, `create_environment`, `update_environment`, `delete_environment`, `test_environment`, `test_environment_connection`, `detect_docker_socket`, `get_environment_timezone`, `set_environment_timezone`, `get_environment_update_check`, `set_environment_update_check`, `get_environment_image_prune`, `set_environment_image_prune`, `list_environment_notifications`, `create_environment_notification`, `get_environment_notification`, `delete_environment_notification`

**Notes:**
- `delete_environment`, `delete_environment_notification` destructive.
- `test_environment` vs. `test_environment_connection` — read the blocks; pick distinguishing axis (e.g., full env test vs. connectivity-only probe).
- `detect_docker_socket` is a helper; differentiate from `test_*`.

- [ ] **Step 1:** vitest -t "Environments" / "Env-Notifications" / "Env-Settings" → all RED.
- [ ] **Step 2:** Rewrite all 18.
- [ ] **Step 3:** All three vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/environments.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand environment tool descriptions

Cross-reference environment CRUD, distinguish test_environment from
test_environment_connection, pair get/set for each env-scoped setting
(timezone, update_check, image_prune), and link the env-notification
CRUD subset back to its siblings.

Refs #62"
```

---

### Task 11: auth.ts (14 tools, clusters: Auth-LDAP + Auth-OIDC + Hawser-Tokens)

**Tools (14):**
`get_auth_session`, `get_auth_providers`, `get_auth_settings`, `create_oidc_provider`, `get_oidc_provider`, `test_oidc_provider`, `initiate_oidc_login`, `create_ldap_provider`, `get_ldap_provider`, `test_ldap_provider`, `list_hawser_tokens`, `create_hawser_token`, `revoke_hawser_token`, `logout`

**Notes:**
- `revoke_hawser_token` destructive.
- `logout` is standalone — minimum length + ending punctuation still required.
- `get_auth_providers`, `get_auth_session`, `get_auth_settings` are in cluster `Auth-OIDC` per the spec (they describe OIDC state alongside the OIDC providers).

- [ ] **Step 1:** vitest -t "Auth-LDAP" / "Auth-OIDC" / "Hawser-Tokens" → all RED.
- [ ] **Step 2:** Rewrite all 14.
- [ ] **Step 3:** All three vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/auth.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand auth tool descriptions

Pair create/get/test inside each provider cluster (LDAP, OIDC),
cross-link the auth_session / auth_providers / auth_settings trio
with the OIDC provider tools, and mark revoke_hawser_token as
explicitly destructive.

Refs #62"
```

---

### Task 12: stacks.ts (23 tools, clusters: Stack-Env + Stack-Compose + Stack-Lifecycle + Stack-Path + Stack-Source)

**Tools (23):**
`list_stacks`, `create_stack`, `start_stack`, `stop_stack`, `restart_stack`, `down_stack`, `delete_stack`, `get_stack_compose`, `update_stack_compose`, `get_stack_env`, `update_stack_env`, `get_stack_env_raw`, `update_stack_env_raw`, `validate_stack_env`, `scan_stacks`, `adopt_stack`, `relocate_stack`, `get_stack_sources`, `get_stack_base_path`, `get_stack_path_hints`, `validate_stack_path`, `get_stack_default_path`, `check_stack_path_change`

**Notes:**
- `update_stack_env` and `update_stack_env_raw` already meet C1–C4 (PR #58). Do not regress them.
- `get_stack_env` and `get_stack_env_raw` are the new improvement targets — extend the same cross-reference pattern.
- `down_stack`, `delete_stack`, `stop_stack` destructive.
- `validate_stack_env` is a sibling of the Stack-Env cluster but is NOT in `CLUSTERS.Stack-Env` per the test file. It still needs C1/C3/C4, and a cross-reference to `update_stack_env`/`update_stack_env_raw` is good practice — but the cluster test will not require it.
- `Stack-Path` is the largest cluster in this file (6 tools); read each block to understand what each path tool actually returns before writing.

- [ ] **Step 1:** vitest -t "Stack-Env" / "Stack-Compose" / "Stack-Lifecycle" / "Stack-Path" / "Stack-Source" → most RED (Stack-Env is partially green from PR #58).
- [ ] **Step 2:** Rewrite all 23, preserving the already-good `update_stack_env*` descriptions.
- [ ] **Step 3:** All five vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/stacks.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand stack tool descriptions across all 5 clusters

Extend the PR #58 cross-reference pattern to get_stack_env /
get_stack_env_raw, complete the Stack-Compose pair, cross-link the
Stack-Lifecycle quartet (start/stop/restart/down) with destructive
verbs called out, expand the Stack-Path cluster to differentiate
the 6 path tools, and cross-link the Stack-Source quartet.

Refs #62"
```

---

### Task 13: git-stacks.ts (21 tools, clusters: Git-Stack + Git-Credentials + Git-Repository)

**Tools (21):**
`list_git_stacks`, `get_git_stack`, `deploy_git_stack`, `sync_git_stack`, `test_git_stack`, `get_git_stack_env_files`, `trigger_git_webhook`, `get_git_webhook`, `list_git_credentials`, `create_git_credential`, `get_git_credential`, `update_git_credential`, `delete_git_credential`, `list_git_repositories`, `create_git_repository`, `get_git_repository`, `deploy_git_repository`, `sync_git_repository`, `test_git_repository`, `test_git_repository_connection`, `request_git_preview_env`

**Notes:**
- `delete_git_credential` destructive.
- `test_git_repository` vs. `test_git_repository_connection` — same connection-only vs. full-test distinction as environments.
- `deploy_git_stack` vs. `sync_git_stack` — deploy is the runtime action, sync is the pull-from-git step.
- `request_git_preview_env` is the odd one out — read its block to ground the description.

- [ ] **Step 1:** vitest -t "Git-Stack" / "Git-Credentials" / "Git-Repository" → all RED.
- [ ] **Step 2:** Rewrite all 21.
- [ ] **Step 3:** All three vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/git-stacks.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand git-stack tool descriptions

Cross-reference inside the three git clusters (stacks, credentials,
repositories), distinguish deploy vs. sync, distinguish test_*
full-test from test_*_connection probe, and ground
request_git_preview_env in its actual behaviour.

Refs #62"
```

---

### Task 14: containers.ts (28 tools, clusters: Container-Lifecycle + Container-Inspect + Container-Files)

**Tools (28):**
`list_containers`, `get_container`, `inspect_container`, `get_container_logs`, `get_container_stats`, `get_container_top`, `start_container`, `stop_container`, `restart_container`, `pause_container`, `unpause_container`, `rename_container`, `update_container`, `create_container`, `get_container_shells`, `list_container_files`, `get_container_file_content`, `create_container_file`, `delete_container_file`, `rename_container_file`, `chmod_container_file`, `download_container_file`, `upload_container_file`, `check_container_updates`, `get_pending_updates`, `batch_update_containers`, `get_container_sizes`, `get_containers_stats`

**Notes:**
- `stop_container`, `delete_container_file` destructive.
- `update_container` vs. `batch_update_containers` — single vs. batch scope. Both name the pull-and-recreate semantics.
- `inspect_container` vs. `get_container` — same disambiguation question. Read both blocks first.
- `get_container_stats` vs. `get_containers_stats` (plural) — single vs. all containers.
- `check_container_updates` vs. `get_pending_updates` — adjacent but different (one queries the registry, the other reads the cache).

- [ ] **Step 1:** vitest -t "Container-Lifecycle" / "Container-Inspect" / "Container-Files" → all RED.
- [ ] **Step 2:** Rewrite all 28.
- [ ] **Step 3:** All three vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/containers.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand container tool descriptions across all 3 clusters

Container-Lifecycle quartet cross-references with destructive verbs
on stop. update_container vs. batch_update_containers names the
scope axis (single id vs. batch by selector). Container-Inspect
trio (get/inspect/logs) names what each returns. Container-Files
octet pairs read/write/delete/move/chmod siblings.

Refs #62"
```

---

### Task 15: system.ts (25 tools, clusters: Prune-Family + System-Files + System-Info + Health + License + Scanner-Settings)

**Tools (25):**
`health_check`, `health_check_database`, `get_host_info`, `get_system_info`, `get_system_disk`, `list_system_files`, `get_system_file_content`, `get_changelog`, `get_dependencies`, `get_general_settings`, `update_general_settings`, `get_theme_settings`, `get_scanner_settings`, `update_scanner_settings`, `get_license`, `activate_license`, `get_prometheus_metrics`, `prune_all`, `prune_containers`, `prune_images`, `prune_networks`, `prune_volumes`, `list_batch_operations`, `get_legal_license`, `get_privacy_policy`

**Notes:**
- All five `prune_*` are destructive — verbs satisfied by the names, but descriptions still need to spell out "removes" / "deletes" and what kind of garbage is freed.
- `prune_all` calls out that it is the union of the other four.
- Standalone tools in this file (not in any cluster): `get_changelog`, `get_dependencies`, `get_theme_settings`, `get_prometheus_metrics`, `list_batch_operations`, `get_privacy_policy`. Still need C1/C3/C4 and sentence-ending punctuation.

- [ ] **Step 1:** vitest -t "Prune-Family" / "System-Files" / "System-Info" / "Health" / "License" / "Scanner-Settings" → all RED.
- [ ] **Step 2:** Rewrite all 25. The Prune-Family member descriptions reference `prune_all` as the union-of-everything; `prune_all` references each of the four typed sub-prunes.
- [ ] **Step 3:** All six vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/system.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand system tool descriptions across 6 clusters

Prune-Family quintet cross-references with prune_all named as the
union of the four typed sub-prunes. System-Info quintet names host
vs. system vs. disk vs. general-settings axis. Health duo separates
MCP server probe from Dockhand backend probe. License triple
distinguishes get/activate/legal. Scanner-Settings duo pairs get
and update. Standalone informational tools (changelog, dependencies,
prometheus metrics, etc.) get standalone-quality descriptions.

Refs #62"
```

---

### Task 16: users.ts (29 tools, clusters: Users + Roles + Profile + Favorites-Prefs + Config-Sets)

**Tools (29):**
`list_users`, `create_user`, `get_user`, `update_user`, `delete_user`, `enable_user_mfa`, `disable_user_mfa`, `get_user_roles`, `set_user_roles`, `list_roles`, `create_role`, `get_role`, `update_role`, `delete_role`, `get_profile`, `update_profile`, `get_profile_preferences`, `update_profile_preferences`, `get_favorites`, `set_favorites`, `get_favorite_groups`, `set_favorite_groups`, `get_grid_preferences`, `set_grid_preferences`, `list_config_sets`, `create_config_set`, `get_config_set`, `update_config_set`, `delete_config_set`

**Notes:**
- `delete_user`, `delete_role`, `delete_config_set`, `disable_user_mfa` destructive.
- The file's name is `users.ts` but it owns five clusters (Users, Roles, Profile, Favorites-Prefs, Config-Sets) — write the commit message to acknowledge that.
- `get_user_roles` and `set_user_roles` belong to cluster `Users` (per the test file) but also conceptually overlap with `Roles`. The cross-reference test only requires a backticked sibling from the named cluster — including a reference to one `*_role` tool is fine and recommended for C2/C3 but not enforced.

- [ ] **Step 1:** vitest -t "Users" / "Roles" / "Profile" / "Favorites-Prefs" / "Config-Sets" → all RED.
- [ ] **Step 2:** Rewrite all 29.
- [ ] **Step 3:** All five vitests → GREEN.
- [ ] **Step 4:** typecheck + lint → PASS.
- [ ] **Step 5:** Commit.

```bash
git add src/tools/users.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" \
  commit -m "feat(tools): expand user/role/profile/prefs/config-set descriptions

users.ts owns five clusters in spite of its name. Users + Roles
CRUD subgroups cross-reference internally and across the user/role
binding pair (get_user_roles / set_user_roles). Profile and
Favorites-Prefs pair get/update siblings. Config-Sets full CRUD
quintet cross-references with delete marked destructive.

Refs #62"
```

---

## Task 17: Final verification

This task is run by the orchestrator after Tasks 1–16 have all landed locally on the branch. No subagent dispatch required.

- [ ] **Step 1: Full test suite GREEN**

Run: `cd /tmp/mcp-dockhand && npm test`
Expected: 0 failing tests. The previously-RED generic assertions (C4 length, destructive verb, sentence end) are now all GREEN because the last file rewrite was the last violator.

- [ ] **Step 2: Typecheck and lint clean**

Run: `cd /tmp/mcp-dockhand && npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Validator unchanged**

Run: `cd /tmp/mcp-dockhand && node scripts/validate-mcp-tools.mjs`
Expected: same MISSING_TOOL count (44), 0 ORPHANED_TOOL, 0 PARAM_MISMATCH, 0 MISSING_ENCODE. Audit and coverage are orthogonal — descriptions changed, not endpoints.

- [ ] **Step 4: Commit-history audit**

Run: `cd /tmp/mcp-dockhand && git log --oneline main..HEAD`
Expected: 17 commits — 1 design (already there, `ab03bb2`), 1 test scaffolding (Task 0), 16 per-file feat commits (Tasks 1–16). Every commit body ends with `Refs #62`. Every commit subject under 100 chars. No `Co-Authored-By: Claude`.

Cross-check via: `cd /tmp/mcp-dockhand && git log main..HEAD --pretty=fuller | grep -i "co-authored"`
Expected: no output.

- [ ] **Step 5: Push and open PR**

```bash
cd /tmp/mcp-dockhand
git push origin feat/tool-description-audit
gh pr create --repo strausmann/mcp-dockhand \
  --head feat/tool-description-audit --base main \
  --title "feat(tools): audit and expand all 222 MCP tool descriptions for AI disambiguation" \
  --body-file <(...)  # body summarises by cluster, mentions test file, references #62
```

The PR body MUST:
- Summarise changes per cluster (one line per cluster).
- Mention `tests/tool-descriptions.test.ts` as the regression guard.
- Reference Issue #62 (`Closes #62` is appropriate — the audit completes the work).
- NOT include `Co-Authored-By: Claude`.

AI reviewers (Copilot, Gemini) run automatically. Address any findings in follow-up commits on the same branch.

---

## Self-review

**Spec coverage:**

- C1 action-verb / destructive verb → Task 0 generic test enforces destructive verb prefix → action verb is verified by code review.
- C2 cross-references → Task 0 per-cluster test enforces backticked sibling reference.
- C3 scope marker → not auto-tested (judgement); spec acknowledges this; verified at code-review time.
- C4 length ≥60 → Task 0 generic test enforces.
- Sentence-end punctuation → Task 0 generic test enforces.
- 30+ clusters → all encoded in the `CLUSTERS` const inside `tests/tool-descriptions.test.ts`.
- 16-file scope, one commit per file → Tasks 1–16.
- TDD per file → every per-file task has RED → impl → GREEN steps.
- Subagents don't push → Task 17 is orchestrator-only.
- Conventional Commits scope from enum → every commit subject uses `feat(tools)` or `test(tests)` or `docs(tools)`.
- `Refs #62` on every commit → every commit message ends with it.
- No `Co-Authored-By: Claude` → spelled out in Task 17 cross-check.

**Placeholder scan:** no "TBD" / "TODO" / vague "appropriate" / "Similar to Task N". Each per-file task names its cluster(s), scope axis hints, and destructive tools explicitly. Where I had to defer to "read the block first" (notifications.ts three test variants, environments test pair, git-repositories test pair), that is a deliberate request for the implementer to ground description text in actual behaviour rather than guessing.

**Type consistency:** cluster names (`Stack-Env`, `Container-Lifecycle`, etc.) are identical across the spec table, the test scaffold's `CLUSTERS` keys, and the per-file task headings. Tool names match the registrations confirmed by the extractor run.

---

## Execution

Plan complete and committed will be at `docs/plans/2026-05-16-tool-description-audit.md`. Two execution options:

1. **Subagent-Driven (recommended)** — one implementer subagent per task (17 tasks). Spec-compliance reviewer + code-quality reviewer between tasks. Fresh context per file keeps each subagent focused on its ~10–30 description rewrites.

2. **Inline Execution** — `superpowers:executing-plans` for batch execution. Works but burns the orchestrator's context across all 17 files in one session — likely hits context pressure during the large files (containers.ts, users.ts, system.ts).

Recommended approach: subagent-driven. Each implementer gets the spec doc, the plan doc, this file's CLUSTERS membership, and the per-file task text — that is sufficient context for a single file.

Which approach?
