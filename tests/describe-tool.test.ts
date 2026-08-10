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

  it('resolves cross-references to tool names for create_git_stack', () => {
    const description = describeTool('create_git_stack');
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
      expect(describeTool('get_stack_env')).toMatch(/get all environment variables/i);
      expect(describeTool('remove_user_role')).toMatch(/remove a role assignment/i);
      expect(describeTool('trigger_git_webhook')).toMatch(
        /secret passed as the `secret` query parameter/i,
      );
    });
  });
});
