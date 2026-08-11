/**
 * registerMetaTools() (src/tools/meta.ts) — registers all six self-help tools (M1:
 * `get_server_info`, `check_for_update`, `get_tool_manifest`; M2: `self_check`,
 * `validate_config`, `get_runtime_stats`) against a capturing fake server, mirroring
 * the fixture shape tests/tool-error-logging.test.ts already uses for registerTool().
 * Registration-only: none of the six handlers are invoked here (get_server_info/
 * get_tool_manifest hit the real Dockhand client / filesystem, check_for_update hits
 * the real network, self_check/validate_config would hit both the real client and
 * `fetch()` directly) — that behavior is covered by the pure builders' own tests
 * (meta.get-server-info.test.ts, meta.check-for-update.test.ts,
 * meta.tool-manifest.test.ts, meta.self-check.test.ts, meta.validate-config.test.ts;
 * get_runtime_stats has no separate builder test since `getStatsSnapshot()` itself is
 * covered by runtime-stats.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { registerMetaTools } from '../../src/tools/meta.js';

interface CapturedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

function fakeServer() {
  const tools = new Map<string, CapturedTool>();
  return {
    tools,
    // Mirrors the subset of McpServer.tool() that registerTool() calls.
    tool(name: string, description: string, schema: Record<string, unknown>) {
      tools.set(name, { name, description, schema });
    },
  };
}

const EXPECTED_TOOL_NAMES = [
  'check_for_update',
  'get_server_info',
  'get_runtime_stats',
  'get_tool_manifest',
  'self_check',
  'validate_config',
];

describe('registerMetaTools', () => {
  const server = fakeServer();
  // The six handlers never touch the client during registration itself (only when
  // actually invoked), so an empty stand-in is safe here — same pattern
  // tests/tool-descriptions-derived.test.ts uses for registerAllTools().
  registerMetaTools(server as never, {} as never);

  it('registers exactly the six self-help tools (M1 + M2)', () => {
    expect([...server.tools.keys()].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('all six tools take no input arguments', () => {
    for (const name of EXPECTED_TOOL_NAMES) {
      const tool = server.tools.get(name);
      expect(tool, name).toBeDefined();
      expect(Object.keys(tool!.schema)).toHaveLength(0);
    }
  });

  it('each tool has a non-empty description', () => {
    for (const name of EXPECTED_TOOL_NAMES) {
      const tool = server.tools.get(name);
      expect(tool!.description.length, name).toBeGreaterThan(0);
    }
  });
});
