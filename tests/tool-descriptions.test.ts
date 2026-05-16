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
 * This file is the authoritative cluster definition. The §Tool clusters
 * table in docs/designs/2026-05-16-tool-description-audit-design.md is
 * the historical proposal; the test file may diverge as cluster
 * boundaries get refined during implementation. When in doubt, trust
 * this file.
 */
/**
 * Tools intentionally outside every cluster — C1, C3, C4 still apply,
 * but C2 does not (no semantic siblings to cross-reference).
 *
 * The coverage-completeness test below asserts that every extracted
 * tool is either listed in a CLUSTERS array or in this STANDALONES
 * set. Adding a new tool to src/tools/*.ts without putting it in one
 * of the two will fail that test — the right fix is to add it to a
 * cluster (preferred) or to extend this list with rationale.
 */
const STANDALONES: ReadonlySet<string> = new Set([
  'logout',
  'get_changelog',
  'get_dependencies',
  'get_privacy_policy',
  'get_prometheus_metrics',
  'get_theme_settings',
]);

const CLUSTERS: Record<string, string[]> = {
  // stacks.ts
  'Stack-Env': [
    'get_stack_env',
    'get_stack_env_raw',
    'update_stack_env',
    'update_stack_env_raw',
    'validate_stack_env',
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
  'Stack-Source': ['create_stack', 'delete_stack', 'get_stack_sources', 'list_stacks', 'scan_stacks', 'adopt_stack'],
  // containers.ts
  'Container-Lifecycle': [
    'create_container',
    'start_container',
    'stop_container',
    'restart_container',
    'pause_container',
    'unpause_container',
    'rename_container',
    'update_container',
    'batch_update_containers',
    'list_batch_operations',
  ],
  'Container-Inspect': [
    'get_container',
    'inspect_container',
    'list_containers',
    'get_container_logs',
    'get_container_stats',
    'get_containers_stats',
    'get_container_top',
    'get_container_sizes',
    'get_container_shells',
    'get_merged_logs',
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
    'check_container_updates',
    'get_pending_updates',
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

  // Partial C1 enforcement: this block only checks the *destructive-verb*
  // half of the criterion. The "action-verb first sentence" half of C1
  // is judgement-based (an LLM that opens with "Retrieve" satisfies the
  // intent; one that opens with "This is a tool that retrieves..." does
  // not — but a regex cannot reliably tell them apart). Code review
  // catches the action-verb part during PR review, similar to how C3
  // (scope-marker) is review-only.
  describe('destructive verb hygiene (partial C1)', () => {
    it('every destructive-named tool names a destructive action', () => {
      const violators = ALL_TOOLS.filter(
        (t) =>
          DESTRUCTIVE_NAME_PATTERN.test(t.name) &&
          !DESTRUCTIVE_VERBS.test(t.description),
      ).map((t) => `${t.file}::${t.name}: "${t.description}"`);
      expect(violators, `\n${violators.join('\n')}`).toEqual([]);
    });
  });

  // Closes the audit-coverage loophole: a new tool that lands in
  // src/tools/*.ts without a cluster home AND without explicit
  // standalone declaration will fail this test, surfacing the gap
  // before the PR merges instead of silently bypassing C2.
  describe('coverage completeness', () => {
    it('every extracted tool is in a CLUSTERS array or in STANDALONES', () => {
      const clusterMembers = new Set(
        Object.values(CLUSTERS).flatMap((arr) => arr),
      );
      const uncovered = ALL_TOOLS.filter(
        (t) => !clusterMembers.has(t.name) && !STANDALONES.has(t.name),
      ).map(
        (t) =>
          `${t.file}::${t.name} — neither in any CLUSTERS array nor in STANDALONES`,
      );
      expect(uncovered, `\n${uncovered.join('\n')}`).toEqual([]);
    });

    it('every CLUSTERS member maps to an actually-registered tool', () => {
      const allNames = new Set(ALL_TOOLS.map((t) => t.name));
      const dangling: string[] = [];
      for (const [clusterName, members] of Object.entries(CLUSTERS)) {
        for (const member of members) {
          if (!allNames.has(member)) {
            dangling.push(
              `${clusterName}::${member} — listed in CLUSTERS but not found in any src/tools/*.ts`,
            );
          }
        }
      }
      expect(dangling, `\n${dangling.join('\n')}`).toEqual([]);
    });

    it('every STANDALONES entry maps to an actually-registered tool', () => {
      const allNames = new Set(ALL_TOOLS.map((t) => t.name));
      const dangling = [...STANDALONES]
        .filter((name) => !allNames.has(name))
        .map(
          (name) =>
            `${name} — listed in STANDALONES but not found in any src/tools/*.ts`,
        );
      expect(dangling, `\n${dangling.join('\n')}`).toEqual([]);
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
