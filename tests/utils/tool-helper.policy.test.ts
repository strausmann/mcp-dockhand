/**
 * registerTool() consults the active tool policy (src/utils/tool-policy.ts, issue #254):
 * filtered tools are never registered, and registered ones carry MCP annotations
 * derived from the read/write classification.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { registerTool } from '../../src/utils/tool-helper.js';
import {
  buildToolPolicy,
  configureToolPolicy,
  defaultToolPolicy,
} from '../../src/utils/tool-policy.js';
import { TOOL_ENDPOINT_MAP } from '../../src/openapi/tool-endpoint-map.js';
import { META_TOOL_NAMES } from '../../src/utils/meta-tool-names.js';

interface Captured {
  name: string;
  description: string;
  schema: unknown;
  annotations: unknown;
  handler: unknown;
}

function fakeServer() {
  const tools = new Map<string, Captured>();
  return {
    tools,
    tool(name: string, description: string, schema: unknown, annotations: unknown, handler: unknown) {
      tools.set(name, { name, description, schema, annotations, handler });
    },
  };
}

describe('registerTool tool policy', () => {
  afterEach(() => {
    configureToolPolicy(defaultToolPolicy());
  });

  it('default policy: registers and annotates', () => {
    configureToolPolicy(defaultToolPolicy());
    const server = fakeServer();

    registerTool(server as never, 'get_job', {}, async () => ({ content: [] }) as never);
    registerTool(server as never, 'cancel_job', {}, async () => ({ content: [] }) as never);

    expect(server.tools.get('get_job')!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(server.tools.get('cancel_job')!.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(typeof server.tools.get('get_job')!.handler).toBe('function');
  });

  it('filtered tool is not registered', () => {
    configureToolPolicy(
      buildToolPolicy({ MCP_READ_ONLY: 'true' }, { endpointMap: TOOL_ENDPOINT_MAP, metaToolNames: META_TOOL_NAMES }),
    );
    const server = fakeServer();

    registerTool(server as never, 'cancel_job', {}, async () => ({ content: [] }) as never);
    expect(server.tools.size).toBe(0);

    registerTool(server as never, 'get_job', {}, async () => ({ content: [] }) as never);
    expect([...server.tools.keys()]).toEqual(['get_job']);
  });
});
