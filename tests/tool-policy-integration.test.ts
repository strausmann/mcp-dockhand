/**
 * Integration: a real McpServer + SDK Client over an in-memory transport, asserting what a
 * client actually sees in tools/list under the tool policy (issue #254).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { logger } from '../src/utils/logger.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllTools } from '../src/tools/index.js';
import { TOOL_ENDPOINT_MAP } from '../src/openapi/tool-endpoint-map.js';
import { META_TOOL_NAMES } from '../src/utils/meta-tool-names.js';
import {
  buildToolPolicy,
  configureToolPolicy,
  defaultToolPolicy,
  type ToolPolicy,
} from '../src/utils/tool-policy.js';

async function listTools(policy: ToolPolicy) {
  configureToolPolicy(policy);
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  // Registration makes no network calls, so an empty stand-in client is enough.
  registerAllTools(server, {} as never);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe('tool policy through tools/list', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    configureToolPolicy(defaultToolPolicy());
  });

  it('MCP_READ_ONLY=true lists only read tools, all annotated read-only', async () => {
    const policy = buildToolPolicy(
      { MCP_READ_ONLY: 'true' },
      { endpointMap: TOOL_ENDPOINT_MAP, metaToolNames: META_TOOL_NAMES },
    );
    const tools = await listTools(policy);

    expect(tools.length).toBe(policy.summary.registered);
    for (const t of tools) {
      expect(policy.mode(t.name), t.name).toBe('read');
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
    }
    expect(tools.map((t) => t.name)).not.toContain('cancel_job');
  });

  it('default policy lists write tools annotated destructive', async () => {
    const tools = await listTools(defaultToolPolicy());
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('cancel_job')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get('get_job')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });
});
