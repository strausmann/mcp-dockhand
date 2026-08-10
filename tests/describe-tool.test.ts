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
});
