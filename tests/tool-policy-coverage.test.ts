/**
 * Guards the read/write classification (src/utils/tool-policy.ts) against the real tool set,
 * so a newly added tool cannot silently land in the wrong mode under MCP_READ_ONLY (issue #254).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registerAllTools } from '../src/tools/index.js';
import { TOOL_ENDPOINT_MAP } from '../src/openapi/tool-endpoint-map.js';
import { META_TOOL_NAMES } from '../src/utils/meta-tool-names.js';
import { classifyTool, WRITE_GET_TOOLS, READ_ONLY_POST_TOOLS } from '../src/utils/tool-policy.js';

function collectRegisteredNames(): string[] {
  const names: string[] = [];
  // The handler is the last argument; take the name from the first so the fake survives
  // extra arguments (description, schema, annotations) between them.
  const server = {
    tool(...args: unknown[]) {
      names.push(args[0] as string);
    },
  };
  registerAllTools(server as never, {} as never);
  return names;
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('tool policy coverage', () => {
  it('registered tools equal the classification universe (endpoint map + meta tools)', () => {
    const registered = sorted(new Set(collectRegisteredNames()));
    const universe = sorted(new Set([...Object.keys(TOOL_ENDPOINT_MAP), ...META_TOOL_NAMES]));
    expect(registered).toEqual(universe);
  });

  it('WRITE_GET_TOOLS names real GET tools', () => {
    for (const name of WRITE_GET_TOOLS) {
      expect(TOOL_ENDPOINT_MAP[name]?.method.toUpperCase(), name).toBe('GET');
    }
  });

  it('READ_ONLY_POST_TOOLS names real POST tools', () => {
    for (const name of READ_ONLY_POST_TOOLS) {
      expect(TOOL_ENDPOINT_MAP[name]?.method.toUpperCase(), name).toBe('POST');
    }
  });

  it('read-classified GET tools match the reviewed snapshot', () => {
    const actual = sorted(
      Object.keys(TOOL_ENDPOINT_MAP).filter(
        (n) =>
          TOOL_ENDPOINT_MAP[n].method.toUpperCase() === 'GET' &&
          classifyTool(n, TOOL_ENDPOINT_MAP, META_TOOL_NAMES) === 'read',
      ),
    );
    const expected = JSON.parse(
      readFileSync(new URL('./fixtures/read-get-tools.json', import.meta.url), 'utf8'),
    ) as string[];
    expect(
      actual,
      'GET tool set changed. Check the new tool\'s Dockhand handler: if it only reads, add it to ' +
        'tests/fixtures/read-get-tools.json; if it has a side effect, add it to WRITE_GET_TOOLS in src/utils/tool-policy.ts.',
    ).toEqual(expected);
  });
});
