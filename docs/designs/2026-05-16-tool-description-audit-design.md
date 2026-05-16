# Tool Description Audit — Design

**Date:** 2026-05-16
**Status:** Approved
**Owner:** repo maintainer
**Implementation branch:** `feat/tool-description-audit`

## Problem

223 MCP tools are exposed through `src/tools/*.ts`. Each registration carries a `description` string that an AI client reads to decide *whether* and *which* tool to invoke. The current corpus has three recurring quality issues:

1. **Too terse to disambiguate.** Examples on `main`:
   - `get_stack_env` — `"Read environment variables of a stack"` (38 chars)
   - `get_stack_env_raw` — `"Read the raw .env file of a stack"` (35 chars)

   Both look like the same thing. An AI asked "lies die Env-Variablen vom Stack" picks the first; an AI asked "zeig mir die .env-Datei" picks the second. The user-facing distinction (DB-backed variables-list vs. on-disk file content) is invisible.

2. **No cross-references between siblings.** `update_stack_env` and `update_stack_env_raw` (PR #58) cross-link with `"For X use `<other_tool>`."`. That pattern is missing from the other 219 tools, including the symmetrical *get* pair right next to them.

3. **Destructive operations not labelled.** `down_stack`, `remove_image`, `prune_all`, `delete_*` use polite words like "Remove" or "Pull down" without flagging that they discard state.

The result is a quality floor set by individual tool authors, with PR #58 being the only point in the corpus that demonstrates the better pattern. This audit lifts every tool to that pattern.

## Goals

- Every tool description supports three AI decisions: **what** it does, **when** to use it vs. sibling tools, and **what side-effects** it has.
- The audit completes in a single PR (~1.5.0 minor bump via semantic-release).
- New regression tests prevent the next contributor from re-introducing the gap.

## Non-goals

- No new tools, no removed tools, no parameter renames. The validator-driven coverage gap (44 endpoints, Issue #60) is tracked separately.
- No translation, no internationalisation. Descriptions stay English (matches repo language post commit `9c7f396`).
- No UI labels, no README copy. This is `src/tools/*.ts` only.

## Quality criteria

Every description on `main` after this PR meets all four:

### C1 — Action-verb first sentence

The description opens with a verb that names the operation and the noun it acts on. Destructive operations use destructive verbs explicitly.

| Bad | Good |
|-----|------|
| `Stack-Down-Operation auf einem Stack` | `Tear down a stack (stops containers, removes them, and removes the project networks — volumes persist).` |
| `Remove an image` | `Delete an image from the environment. Fails if any container references the image; pass `force:true` to override.` |

### C2 — Cross-reference inside cluster

If a tool belongs to a cluster (see §Tool clusters below), its description names at least one sibling tool *by name in backticks* with a `"For X use `<sibling>`."` phrase. The two siblings reference each other, three+ siblings reference at least one other.

Example anchor (already on `main`, PR #58):

> `update_stack_env`: "...For non-secret variables that Docker Compose reads from the .env file at container start, use `update_stack_env_raw`."

### C3 — Scope marker for ambiguous tools

Where two tools could plausibly answer the same prompt, the description names the distinguishing axis. Common axes:

- **Storage backend:** DB-backed (encrypted, `isSecret`) vs. on-disk (`.env` file)
- **Batch vs. single:** `batch_update_containers` vs. `update_container`
- **Stream vs. sync:** `deploy_git_stack` vs. `deploy_git_stack_stream` (if present)
- **Scope:** per-stack vs. per-environment vs. global
- **Lifecycle phase:** pre-deploy (validate, scan) vs. deploy vs. post-deploy

### C4 — Length floor

Every description ≥ 60 characters. This is a coarse proxy for "carries enough information to be useful". Tools that genuinely have nothing more to say (e.g., `health_check`) still pass 60 chars after honestly describing their semantics ("Probe the MCP server's HTTP health endpoint; returns `{status,server,version}`. Use for liveness checks; does not test the Dockhand backend connection.").

## Tool clusters

A *cluster* is a set of tools where C2 (cross-references) applies. Tools not listed below are *standalone* — C1, C3, C4 still apply, but C2 does not.

| Cluster | Members | File(s) |
|---------|---------|---------|
| **Stack-Env** | get_stack_env, get_stack_env_raw, update_stack_env, update_stack_env_raw | stacks.ts |
| **Stack-Compose** | get_stack_compose, update_stack_compose | stacks.ts |
| **Stack-Lifecycle** | start_stack, stop_stack, restart_stack, down_stack | stacks.ts |
| **Stack-Path** | get_stack_base_path, get_stack_default_path, get_stack_path_hints, check_stack_path_change, validate_stack_path, relocate_stack | stacks.ts |
| **Stack-Source** | get_stack_sources, list_stacks, scan_stacks, adopt_stack | stacks.ts |
| **Container-Lifecycle** | start_container, stop_container, restart_container, pause_container, unpause_container, rename_container, update_container, batch_update_containers | containers.ts |
| **Container-Inspect** | get_container, inspect_container, get_container_logs, get_container_stats, get_container_top, get_container_sizes, get_container_activity, get_container_shells, get_container_auto_update | containers.ts |
| **Container-Files** | list_container_files, get_container_file_content, create_container_file, delete_container_file, rename_container_file, chmod_container_file, download_container_file, upload_container_file | containers.ts |
| **Prune-Family** | prune_all, prune_containers, prune_images, prune_volumes, prune_networks | system.ts |
| **Image-Lifecycle** | pull_image, push_image, tag_image, remove_image, list_images, get_image_history, scan_image, export_image | images.ts |
| **Volume-Lifecycle** | browse_volume, clone_volume, export_volume, get_volume, inspect_volume, list_volumes, remove_volume, get_volume_file_content, release_volume_browse | volumes.ts |
| **Network-Lifecycle** | create_network, get_network, inspect_network, list_networks, remove_network, connect_container_to_network, disconnect_container_from_network | networks.ts |
| **Git-Repository** | create_git_repository, get_git_repository, list_git_repositories, deploy_git_repository, test_git_repository, test_git_repository_connection, sync_git_repository | git-stacks.ts |
| **Git-Stack** | list_git_stacks, get_git_stack, deploy_git_stack, test_git_stack, sync_git_stack, get_git_stack_env_files, get_git_webhook, trigger_git_webhook, request_git_preview_env | git-stacks.ts |
| **Git-Credentials** | create_git_credential, get_git_credential, list_git_credentials, delete_git_credential, update_git_credential | git-stacks.ts |
| **Auth-LDAP** | create_ldap_provider, get_ldap_provider, test_ldap_provider | auth.ts |
| **Auth-OIDC** | create_oidc_provider, get_oidc_provider, test_oidc_provider, initiate_oidc_login, get_auth_providers, get_auth_session, get_auth_settings | auth.ts |
| **Hawser-Tokens** | create_hawser_token, list_hawser_tokens, revoke_hawser_token | auth.ts |
| **Users** | create_user, delete_user, get_user, list_users, update_user, enable_user_mfa, disable_user_mfa, get_user_roles, set_user_roles | users.ts |
| **Roles** | create_role, delete_role, get_role, list_roles, update_role | users.ts |
| **Notifications** | create_notification, get_notification, list_notifications, delete_notification, update_notification, test_notification, test_notification_config, trigger_test_notification | notifications.ts |
| **Env-Notifications** | create_environment_notification, get_environment_notification, list_environment_notifications, delete_environment_notification | environments.ts |
| **Schedules** | list_schedules, get_schedule_execution, get_schedule_executions, run_schedule_now, toggle_schedule, toggle_system_schedule, get_schedule_settings, update_schedule_settings | schedules.ts |
| **Registries** | create_registry, delete_registry, get_registry, list_registries, update_registry, search_registry, get_registry_catalog, get_registry_tags, set_default_registry | registries.ts |
| **Audit** | get_audit_events, get_audit_log, get_audit_users, export_audit_log | audit.ts |
| **Activity** | get_activity_feed, get_activity_events, get_activity_stats, get_container_activity | dashboard.ts + containers.ts |
| **Dashboard-Prefs** | get_dashboard_preferences, set_dashboard_preferences, get_grid_preferences, set_grid_preferences, get_favorites, set_favorites, get_favorite_groups, set_favorite_groups | dashboard.ts |
| **Profile** | get_profile, update_profile, get_profile_preferences, update_profile_preferences | users.ts |
| **Environments** | create_environment, delete_environment, get_environment, list_environments, update_environment, test_environment, test_environment_connection, detect_docker_socket | environments.ts |
| **System-Files** | list_system_files, get_system_file_content | system.ts |
| **System-Info** | get_system_info, get_system_disk, get_host_info, get_general_settings, update_general_settings | system.ts |
| **Health** | health_check, health_check_database | system.ts |
| **Auto-Update** | get_container_auto_update, set_container_auto_update, get_auto_update_settings | auto-update.ts |
| **Scanner-Settings** | get_scanner_settings, update_scanner_settings | system.ts |
| **License** | get_license, activate_license, get_legal_license | system.ts |
| **Config-Sets** | create_config_set, delete_config_set, get_config_set, list_config_sets, update_config_set | system.ts |

Tools not in any cluster (~30): mostly standalone informational (`get_changelog`, `get_privacy_policy`, `get_dependencies`, `get_pending_updates`, `get_prometheus_metrics`, `logout`, etc.).

## Test strategy

Add `tests/tool-descriptions.test.ts` to the existing static-analysis test suite. Pattern matches the existing files (`tool-registration.test.ts`, `stack-env-tools.test.ts`): read source, extract, assert text properties.

### Extractor

```typescript
interface ToolMeta {
  name: string;
  description: string;
  file: string;
}

function extractAllTools(): ToolMeta[] {
  // Reads every src/tools/*.ts (except index.ts)
  // Matches registerTool(server, 'name', 'description', ...) including multi-line
  // Returns flat array
}
```

### Assertions

1. **Length floor (C4):** every `description.length >= 60`.
2. **Destructive verb:** for every tool whose name matches `/^(delete_|remove_|prune_|down_|stop_|revoke_|disable_|disconnect_)/`, description contains `\b(delete|remove|prune|destroy|stop|tear down|drop|revoke|disable|disconnect)\b` case-insensitive.
3. **Ends with sentence:** description ends with `.`, `?`, `!`, or `)` (last grapheme).
4. **Per-cluster cross-refs:** for each cluster in `CLUSTERS` (table above, mirrored as a `const CLUSTERS: Record<string, string[]>` in the test file), every member's description contains at least one sibling member name verbatim in backticks (`` `sibling_name` ``).

Tests are intentionally strict on the cross-reference format. The backtick requirement guarantees AI clients see the sibling as a code-style identifier rather than free text.

### TDD cycle

Per file in `src/tools/`:

1. Author the cluster-cross-ref test cases first → run vitest → confirm RED.
2. Edit the descriptions in that file → run vitest → confirm GREEN.
3. Run `npm run typecheck` and `npm run lint` → confirm clean.
4. Commit (test + impl together).

Generic assertions (length, destructive verb, sentence end) are written once at the start. They will go RED across many files at once and stay RED until the last file lands — that is acceptable for an audit; the cluster tests provide per-file checkpoints.

## Execution plan

- Branch: `feat/tool-description-audit` off `main` (already created).
- Commit shape: one commit per file in `src/tools/` (16 commits), plus one for the test scaffolding, plus one for `validate-mcp-tools.mjs` (if any cross-ref check is added there — see below). Estimated 17–19 commits.
- Per-commit subject scope: `tools` for description-only changes, `tests` for the new test file.
- Final commit: optional CHANGELOG entry only if semantic-release doesn't generate one. semantic-release will see `feat(tools): ...` commits and bump minor.
- Single PR against `main`. AI reviewers (Copilot, Gemini) run automatically.

### Subagent strategy

One implementer subagent per file in `src/tools/`. Each subagent:

- Reads this spec and the eventual plan.
- Reads its assigned file plus the cluster definitions.
- Writes the cluster test (if not already present), confirms RED.
- Updates descriptions in the file.
- Runs targeted vitest, typecheck, lint.
- Commits with `feat(tools)` and `Refs <issue>`.

Spec-compliance reviewer and code-quality reviewer dispatch after each implementer. Final whole-PR code-review subagent at the end.

## Validator integration (optional follow-up)

`scripts/validate-mcp-tools.mjs` could be extended with a `DESCRIPTION_QUALITY` category that flags new tools failing C1–C4. **Out of scope for this PR** — left as a follow-up issue.

## Risk and rollback

- **Risk:** AI behaviour changes after merge. A tool whose description got more specific may now be selected in different prompts. Mitigation: we tightened *toward* the obvious intent of each tool, not away from it. The container-update worked-around `rawContent` case (PR #58) is the existence proof that vague descriptions misroute callers; the opposite — over-specific descriptions misrouting callers — is much rarer because AI clients fuzzy-match.
- **Rollback:** `git revert <merge-commit>` undoes the entire audit in one click. Tests stay green on the revert because they are written against the post-audit state — but the cluster cross-ref tests will fail on `main` again, which is the same state as today (no tests exist yet).
- **Coverage gap (Issue #60):** unaffected. Description audit and missing-tool audit are orthogonal.

## Acceptance criteria

1. All 223 tools meet C1–C4 (verified by `tests/tool-descriptions.test.ts`).
2. `npm test`, `npm run typecheck`, `npm run lint` pass on the branch.
3. `node scripts/validate-mcp-tools.mjs` continues to pass with the same MISSING_TOOL / ORPHANED_TOOL / PARAM_MISMATCH / MISSING_ENCODE counts as `main`.
4. PR description summarises changes by cluster.
5. Squash-merged or rebase-merged into `main` — semantic-release bumps to 1.5.0 (or higher if other feat commits land first).

## References

- PR #58 (the quality bar): https://github.com/strausmann/mcp-dockhand/pull/58
- Issue #60 (coverage tracker): https://github.com/strausmann/mcp-dockhand/issues/60
- PR #61 (sticky tracker workflow): https://github.com/strausmann/mcp-dockhand/pull/61
