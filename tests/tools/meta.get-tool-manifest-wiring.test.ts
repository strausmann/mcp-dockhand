/**
 * get_tool_manifest's real registration wiring (registerMetaTools() in src/tools/meta.ts)
 * — Fix round 2, Finding 4. buildToolManifest() itself (tests/tools/meta.tool-manifest.test.ts)
 * is a pure, injectable builder tested in isolation; this file is the end-to-end regression
 * guard for the actual bug the review found: get_tool_manifest's own toolCount silently
 * drifting from registerAllTools()'s real registered-tool count (292 vs 298 before this fix).
 *
 * get_tool_manifest's handler does no I/O at all (no client.* calls — it is pure local
 * computation over TOOL_ENDPOINT_MAP + META_TOOL_NAMES + the pinned OpenAPI identity), so
 * unlike self_check/validate_config it CAN be invoked directly against a capturing fake
 * server (same fixture shape tests/tool-descriptions-derived.test.ts and
 * tests/tools/meta.register.test.ts already use), with no real Dockhand client needed.
 */
import { describe, it, expect } from 'vitest';
import { registerAllTools } from '../../src/tools/index.js';
import { registerMetaTools, META_TOOL_NAMES } from '../../src/tools/meta.js';
import { TOOL_ENDPOINT_MAP } from '../../src/openapi/tool-endpoint-map.js';

interface CapturedTool {
  name: string;
  handler: (args: Record<string, never>) => Promise<{ content: { type: 'text'; text: string }[] }>;
}

function collectRegisteredToolNames(): string[] {
  const names: string[] = [];
  const server = { tool: (name: string) => names.push(name) };
  registerAllTools(server as never, {} as never);
  return names;
}

async function invokeGetToolManifest(): Promise<{ toolCount: number; tools: { name: string; method: string | null; path: string | null }[] }> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    tool(name: string, _description: string, _schema: unknown, handler: CapturedTool['handler']) {
      tools.set(name, { name, handler });
    },
  };
  // registerMetaTools() never invokes a handler during registration, and this specific
  // handler needs no Dockhand client at all — an empty stand-in is safe.
  registerMetaTools(server as never, {} as never);

  const captured = tools.get('get_tool_manifest');
  if (!captured) throw new Error('get_tool_manifest was not registered');
  const result = await captured.handler({});
  return JSON.parse(result.content[0]!.text) as {
    toolCount: number;
    tools: { name: string; method: string | null; path: string | null }[];
  };
}

describe('get_tool_manifest registration wiring', () => {
  it('toolCount equals the true registered tool count from registerAllTools() (Fix round 2, Finding 4)', async () => {
    const allNames = collectRegisteredToolNames();
    const manifest = await invokeGetToolManifest();

    expect(manifest.toolCount).toBe(allNames.length);
  });

  it('lists every tool registerAllTools() actually exposes, by name — including all six meta tools and get_tool_manifest itself', async () => {
    const allNames = collectRegisteredToolNames();
    const manifest = await invokeGetToolManifest();
    const manifestNames = manifest.tools.map((t) => t.name).sort();

    expect(manifestNames).toEqual([...allNames].sort());
    expect(manifestNames).toContain('get_tool_manifest');
    for (const metaName of META_TOOL_NAMES) {
      expect(manifestNames).toContain(metaName);
    }
  });

  it('reports method:null, path:null for every meta tool', async () => {
    const manifest = await invokeGetToolManifest();

    for (const metaName of META_TOOL_NAMES) {
      const entry = manifest.tools.find((t) => t.name === metaName);
      expect(entry, metaName).toEqual({ name: metaName, method: null, path: null });
    }
  });

  it('reports get_prometheus_metrics with its real, documented endpoint (GET /api/metrics), not null', async () => {
    const manifest = await invokeGetToolManifest();

    const entry = manifest.tools.find((t) => t.name === 'get_prometheus_metrics');
    expect(entry).toEqual({ name: 'get_prometheus_metrics', method: 'GET', path: '/api/metrics' });
  });

  it('every non-meta, non-get_prometheus_metrics tool matches its TOOL_ENDPOINT_MAP entry exactly', async () => {
    const manifest = await invokeGetToolManifest();

    for (const [name, entry] of Object.entries(TOOL_ENDPOINT_MAP)) {
      const found = manifest.tools.find((t) => t.name === name);
      expect(found, name).toEqual({ name, method: entry.method, path: entry.path });
    }
  });
});
