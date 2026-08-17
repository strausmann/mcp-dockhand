/**
 * describeTool() — the single glue function `registerTool()` (src/utils/tool-helper.ts)
 * calls to get a tool's derived description: looks up the tool's endpoint
 * (tool-endpoint.ts), resolves the matching spec operation (spec-loader.ts), and hands
 * both to `deriveToolDescription()` (derive-description.ts). Falls back to
 * `deriveToolDescription`'s own fallback text (never an empty string) and logs an
 * advisory when the tool has no resolvable endpoint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeTool } from '../src/openapi/describe-tool.js';

describe('describeTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives a real description for a tool with a resolvable spec operation', () => {
    const description = describeTool('list_environments');
    expect(description.length).toBeGreaterThan(0);
    expect(description).not.toBe('No description available.');
  });

  // Was pinned to create_git_stack until Dockhand 1.0.42, whose spec dropped that
  // operation's `description` (and with it its cross-references) — the mechanism itself is
  // unaffected: 26 operations still carry operation-level cross-refs, 21 of them backed by
  // a tool. create_hawser_token is one of them and carries exactly one, which keeps this
  // test a focused check of resolution rather than of a particular endpoint's prose.
  it('resolves cross-references to tool names for create_hawser_token', () => {
    const description = describeTool('create_hawser_token');
    expect(description).toMatch(/environmentId from list_environments/);
  });

  it('falls back to a non-empty default and logs an advisory for a tool with no registry entry', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const description = describeTool('get_prometheus_metrics');
    expect(description.length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('get_prometheus_metrics');
  });

  it('falls back to a non-empty default and logs an advisory for a name that is not a known tool', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const description = describeTool('totally_made_up_tool_name');
    expect(description.length).toBeGreaterThan(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  describe('description overrides (P3 Final Fix Wave, Finding 1, Refs #57)', () => {
    // Four tool pairs share a single Dockhand endpoint (see tool-endpoint-map.ts). The
    // spec operation for a shared endpoint describes only ONE of the two tools correctly;
    // `endpointToTool()`'s alphabetical tiebreak picks the other as the endpoint's "owner"
    // for the wrong reason, so its OWN derived description also inherits the mismatch.
    // `TOOL_DESCRIPTION_OVERRIDES` (description-overrides.ts) replaces exactly those four.

    it('remove_stack_env_vars: no longer suggests a "content" field or raw-file-write semantics', () => {
      const description = describeTool('remove_stack_env_vars');
      expect(description).not.toMatch(/\bcontent\b/i);
      expect(description).not.toMatch(/write raw \.env file/i);
      expect(description).toMatch(/remove environment variables/i);
      expect(description).toMatch(/keys/i);
    });

    it('check_stack_env_collisions: no longer claims to return the full variable list', () => {
      const description = describeTool('check_stack_env_collisions');
      expect(description).not.toMatch(/get all environment variables/i);
      expect(description).toMatch(/collision|duplicate/i);
    });

    it('clear_user_roles: no longer references roleId/environmentId cross-refs it does not accept', () => {
      const description = describeTool('clear_user_roles');
      expect(description).not.toMatch(/roleId/);
      expect(description).not.toMatch(/environmentId/);
      expect(description).toMatch(/every role assignment/i);
    });

    it('get_git_stack_webhook: no longer claims it sends the secret query parameter', () => {
      const description = describeTool('get_git_stack_webhook');
      expect(description).not.toMatch(/secret passed as the `secret` query parameter/i);
      expect(description).toMatch(/retrieve the inbound webhook/i);
    });

    it('leaves the OTHER tool in each shared-endpoint pair on the normal spec-derived path', () => {
      // update_stack_env_raw, get_stack_env, remove_user_role, trigger_git_webhook are the
      // tools the spec operation's summary actually describes — they must keep getting the
      // plain derived text (no override entry for them).
      expect(describeTool('update_stack_env_raw')).toMatch(/write raw \.env file/i);
      // 1.0.42 reworded this summary and now also mentions the provider-injected keys.
      expect(describeTool('get_stack_env')).toMatch(/env vars .*secrets masked/i);
      expect(describeTool('remove_user_role')).toMatch(/remove a role assignment/i);
      expect(describeTool('trigger_git_webhook')).toMatch(
        /secret passed as the `secret` query parameter/i,
      );
    });
  });

  describe('description overrides (Self-Help Final Fix Wave, Finding 1): the six meta tools', () => {
    // None of the six self-help/meta tools (registerMetaTools(), src/tools/meta.ts) wrap a
    // Dockhand endpoint, so without an override each would silently get the literal fallback
    // string "No description available." — the exact text an MCP client sees, since the
    // README (where these ARE documented) is never visible to a client. This is the outcome
    // check for that fix: each must resolve to its own real override text, never the
    // fallback, and never another meta tool's text.
    const metaTools = [
      'get_server_info',
      'check_for_update',
      'get_tool_manifest',
      'self_check',
      'validate_config',
      'get_runtime_stats',
    ];

    it.each(metaTools)('%s: resolves to a real, non-fallback description', (name) => {
      const description = describeTool(name);
      expect(description.length).toBeGreaterThan(0);
      expect(description).not.toBe('No description available.');
    });

    it('each meta tool gets its OWN description, not another meta tool\'s', () => {
      const descriptions = metaTools.map((name) => describeTool(name));
      expect(new Set(descriptions).size).toBe(metaTools.length);
    });

    it('get_server_info: mentions version/uptime, not a Dockhand REST field', () => {
      expect(describeTool('get_server_info')).toMatch(/version/i);
      expect(describeTool('get_server_info')).toMatch(/uptime/i);
    });

    it('check_for_update: mentions the GitHub release comparison', () => {
      expect(describeTool('check_for_update')).toMatch(/github release/i);
    });

    it('get_tool_manifest: mentions the pinned Dockhand OpenAPI commit/version', () => {
      expect(describeTool('get_tool_manifest')).toMatch(/openapi/i);
    });

    it('self_check: mentions reachability and credential validity', () => {
      expect(describeTool('self_check')).toMatch(/reachab/i);
      expect(describeTool('self_check')).toMatch(/credential/i);
    });

    it('validate_config: mentions it never returns secret values', () => {
      expect(describeTool('validate_config')).toMatch(/never/i);
      expect(describeTool('validate_config')).toMatch(/secret/i);
    });

    it('get_runtime_stats: mentions per-tool counters and that call args/response payloads are never captured', () => {
      const description = describeTool('get_runtime_stats');
      expect(description).toMatch(/counters?/i);
      expect(description).toMatch(/never.*(arguments|payloads)/i);
    });
  });
});
