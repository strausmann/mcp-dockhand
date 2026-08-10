/**
 * End-to-end check that every MCP tool registered via `registerAllTools()` ends up with
 * a non-empty, spec-derived `description` at registration time — the outcome Task 5 of
 * the P3 plan (docs/superpowers/plans/2026-08-10-mcp-dockhand-description-quality-governance.md)
 * requires: no `src/tools/*.ts` carries a hand-written description string literal
 * anymore, `registerTool()` (src/utils/tool-helper.ts) derives it via
 * `deriveToolDescription(specOperation(toolEndpoint(name)), endpointToTool)` instead.
 *
 * Registers every real tool against a capturing mock server (same fixture shape as
 * tests/tool-error-logging.test.ts's fakeServer() and
 * scripts/lib/tool-body-shape.mjs's createCapturingServer() — this one additionally
 * keeps the description, which those two intentionally discard) and inspects what
 * `server.tool(name, description, schema, handler)` actually received.
 */
import { describe, it, expect } from 'vitest';
import { registerAllTools } from '../src/tools/index.js';
import { toolEndpoint } from '../src/openapi/tool-endpoint.js';

interface CapturedTool {
  name: string;
  description: string;
}

function collectRegisteredTools(): CapturedTool[] {
  const tools: CapturedTool[] = [];
  const server = {
    tool(name: string, description: string) {
      tools.push({ name, description });
    },
  };
  // registerAllTools() never invokes a tool callback during registration (only when an
  // MCP client actually calls the tool) — an empty client stand-in is safe, the same
  // fixture pattern scripts/collect-tool-shapes.mjs already uses.
  registerAllTools(server as never, {} as never);
  return tools;
}

describe('derived tool descriptions', () => {
  const tools = collectRegisteredTools();

  it('registers a non-trivial number of tools (sanity check on the fixture itself)', () => {
    expect(tools.length).toBeGreaterThan(130);
  });

  it('every registered tool has a non-empty, derived description', () => {
    for (const t of tools) {
      expect(t.description, t.name).toBeTruthy();
      expect(t.description.length, t.name).toBeGreaterThan(0);
    }
  });

  it('a tool with a resolvable spec operation gets that operation\'s summary as its description core', () => {
    const listGitStacks = tools.find((t) => t.name === 'list_git_stacks');
    expect(listGitStacks).toBeDefined();
    expect(listGitStacks!.description).toContain('List git-backed stacks');
  });

  it('a cross-referencing tool (create_git_stack) resolves its foreign-id references to tool names', () => {
    const createGitStack = tools.find((t) => t.name === 'create_git_stack');
    expect(createGitStack).toBeDefined();
    expect(createGitStack!.description).toMatch(/environmentId from list_environments/);
    expect(createGitStack!.description).toMatch(/repositoryId from list_git_repositories/);
    expect(createGitStack!.description).toMatch(/credentialId from list_git_credentials/);
  });

  it('the one known registry gap (get_prometheus_metrics) still gets a non-empty fallback description', () => {
    expect(toolEndpoint('get_prometheus_metrics')).toBeUndefined();
    const metrics = tools.find((t) => t.name === 'get_prometheus_metrics');
    expect(metrics).toBeDefined();
    expect(metrics!.description.length).toBeGreaterThan(0);
  });
});
