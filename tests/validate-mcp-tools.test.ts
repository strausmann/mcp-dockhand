import { describe, it, expect } from 'vitest';
import {
  splitTopLevel,
  extractObjectKey,
  pathParamsMatch,
  diffQueryParams,
  extractToolCallsFromSource,
  WHITELISTED_QUERY_PARAMS,
} from '../scripts/validate-mcp-tools.mjs';

describe('splitTopLevel', () => {
  it('splits simple comma-separated top-level args', () => {
    expect(splitTopLevel('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('does not split inside nested braces/brackets/parens', () => {
    expect(splitTopLevel('{ a: 1, b: 2 }, [1, 2, 3], fn(1, 2)')).toEqual([
      '{ a: 1, b: 2 }',
      '[1, 2, 3]',
      'fn(1, 2)',
    ]);
  });

  it('does not split on commas inside strings or template literals', () => {
    expect(splitTopLevel(`'a, b', "c, d", \`e, \${f(1, 2)}\``)).toEqual([
      "'a, b'",
      '"c, d"',
      '`e, ${f(1, 2)}`',
    ]);
  });

  it('ignores commas inside comments', () => {
    expect(splitTopLevel('a /* x, y */, b // z, w')).toEqual(['a /* x, y */', 'b // z, w']);
  });

  it('returns a single element for input without top-level commas', () => {
    expect(splitTopLevel('{ env: environmentId }')).toEqual(['{ env: environmentId }']);
  });

  it('returns an empty array for empty input', () => {
    expect(splitTopLevel('')).toEqual([]);
    expect(splitTopLevel('   ')).toEqual([]);
  });
});

describe('extractObjectKey', () => {
  it('extracts a regular key:value key', () => {
    expect(extractObjectKey('env: environmentId')).toBe('env');
    expect(extractObjectKey('force: force ? \'true\' : undefined')).toBe('force');
  });

  it('extracts a shorthand property key', () => {
    expect(extractObjectKey('tail')).toBe('tail');
    expect(extractObjectKey('  path  ')).toBe('path');
  });

  it('extracts a quoted key', () => {
    expect(extractObjectKey("'foo-bar': 1")).toBe('foo-bar');
    expect(extractObjectKey('"foo": 1')).toBe('foo');
  });

  it('ignores the colon inside a ternary value (key colon comes first)', () => {
    expect(extractObjectKey('mode: force ? "hard" : "soft"')).toBe('mode');
  });

  it('returns null for a spread element', () => {
    expect(extractObjectKey('...rest')).toBeNull();
  });

  it('returns null for a computed key', () => {
    expect(extractObjectKey('[dynamicKey]: 1')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractObjectKey('')).toBeNull();
    expect(extractObjectKey('   ')).toBeNull();
  });

  it('does not get confused by nested objects in the value', () => {
    expect(extractObjectKey('filter: { a: 1, b: 2 }')).toBe('filter');
  });
});

describe('pathParamsMatch', () => {
  it('matches when call and schema names are identical', () => {
    expect(pathParamsMatch(['type', 'id'], ['type', 'id'])).toBe(true);
  });

  it('matches when the schema (generic) name is a case-insensitive suffix of the descriptive call name', () => {
    // Real repo pattern: schema uses the generic SvelteKit route name ("id"), tools use
    // descriptive variable names ("containerId", "providerId", ...).
    expect(pathParamsMatch(['containerId'], ['id'])).toBe(true);
    expect(pathParamsMatch(['providerId'], ['id'])).toBe(true);
    expect(pathParamsMatch(['environmentId', 'notificationId'], ['id', 'notificationId'])).toBe(true);
  });

  it('fails when the counts differ', () => {
    expect(pathParamsMatch(['id'], ['id', 'notificationId'])).toBe(false);
  });

  it('fails when a name at a position is genuinely unrelated (real deviation)', () => {
    // e.g. a copy-paste bug: wrong variable used at this position
    expect(pathParamsMatch(['scheduleId', 'notificationId'], ['type', 'id'])).toBe(false);
  });
});

describe('diffQueryParams', () => {
  // Schema-Query-Params sind seit der queryParamsByMethod-Umstellung required-aware:
  // `{ name, required }` statt eines nackten `string[]`. `req`/`opt` sind Kurzformen für
  // lesbarere Test-Fixtures.
  const req = (name: string) => ({ name, required: true });
  const opt = (name: string) => ({ name, required: false });

  it('flags a sent key the schema does not know as unknown', () => {
    const { unknown, missingRequired } = diffQueryParams(
      ['q', 'env'],
      [req('term'), opt('limit'), opt('registry')],
      { checkMissing: true }
    );
    expect(unknown).toEqual(['q']);
    expect(missingRequired).toEqual(['term']);
  });

  it('never flags the whitelisted env scoping param as unknown', () => {
    expect(WHITELISTED_QUERY_PARAMS.has('env')).toBe(true);
    const { unknown } = diffQueryParams(['env'], undefined, { checkMissing: true });
    expect(unknown).toEqual([]);
  });

  it('flags envId normally (not whitelisted) when the schema does not expect it', () => {
    const { unknown } = diffQueryParams(['envId'], [opt('other')], { checkMissing: true });
    expect(unknown).toEqual(['envId']);
  });

  it('does not flag envId when the schema explicitly expects it (e.g. /api/containers/{id}/exec)', () => {
    const { unknown, missingRequired } = diffQueryParams(['envId'], [req('envId')], { checkMissing: true });
    expect(unknown).toEqual([]);
    expect(missingRequired).toEqual([]);
  });

  it('does NOT flag a missing OPTIONAL param — only required params are checked', () => {
    const { missingRequired } = diffQueryParams(['env'], [opt('tail'), opt('since')], { checkMissing: true });
    expect(missingRequired).toEqual([]);
  });

  it('flags a missing REQUIRED param even when other optional params are also unsent', () => {
    const { missingRequired } = diffQueryParams(['env'], [req('registry'), opt('last')], { checkMissing: true });
    expect(missingRequired).toEqual(['registry']);
  });

  it('reports no missing params when checkMissing is false, even if the schema lists required ones', () => {
    const { missingRequired } = diffQueryParams(['env'], [req('tail'), req('since')], { checkMissing: false });
    expect(missingRequired).toEqual([]);
  });

  it('reports no missing params when the schema has none', () => {
    const { missingRequired } = diffQueryParams(['env'], undefined, { checkMissing: true });
    expect(missingRequired).toEqual([]);
  });

  it('is a clean diff when everything required is sent and everything sent is known', () => {
    const { missingRequired, unknown } = diffQueryParams(
      ['env', 'term', 'limit', 'registry'],
      [req('term'), opt('limit'), opt('registry')],
      { checkMissing: true }
    );
    expect(missingRequired).toEqual([]);
    expect(unknown).toEqual([]);
  });
});

describe('extractToolCallsFromSource', () => {
  it('extracts query param keys from a single-line client.get call', () => {
    const source = `
registerTool(server, 'get_container_stats', 'desc',
  { environmentId: z.number() },
  async ({ environmentId, containerId }) => {
    return jsonResponse(await client.get(\`/api/containers/\${encodePath(containerId)}/stats\`, { env: environmentId }));
  }
);
`;
    const calls = extractToolCallsFromSource('fake.ts', source);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('get_container_stats');
    expect(calls[0].httpMethod).toBe('GET');
    expect(calls[0].queryParamKeys).toEqual(['env']);
  });

  it('extracts query param keys from a call whose params object spans multiple lines', () => {
    const source = `
registerTool(server, 'get_container_logs', 'desc',
  { environmentId: z.number(), containerId: z.string(), tail: z.number().optional() },
  async ({ environmentId, containerId, tail }) => {
    const data = await client.get(\`/api/containers/\${encodePath(containerId)}/logs\`, {
      env: environmentId,
      tail: tail ?? 100,
    });
    return textResponse(data);
  }
);
`;
    const calls = extractToolCallsFromSource('fake.ts', source);
    expect(calls).toHaveLength(1);
    expect(calls[0].queryParamKeys).toEqual(['env', 'tail']);
  });

  it('extracts query param keys for POST-like calls from the 3rd argument (body is 2nd)', () => {
    const source = `
registerTool(server, 'set_container_auto_update', 'desc',
  { environmentId: z.number(), containerName: z.string(), policy: z.string() },
  async ({ environmentId, containerName, policy }) => {
    return jsonResponse(await client.post(\`/api/auto-update/\${encodePath(containerName)}\`, { policy }, { env: environmentId }));
  }
);
`;
    const calls = extractToolCallsFromSource('fake.ts', source);
    expect(calls).toHaveLength(1);
    expect(calls[0].httpMethod).toBe('POST');
    // The body ({ policy }) must NOT leak into the query param keys — only the 3rd arg counts.
    expect(calls[0].queryParamKeys).toEqual(['env']);
  });

  it('returns null query param keys when the params argument is not an inline object literal', () => {
    const source = `
registerTool(server, 'weird_tool', 'desc',
  {},
  async ({ opts }) => {
    return jsonResponse(await client.get('/api/system/files', opts));
  }
);
`;
    const calls = extractToolCallsFromSource('fake.ts', source);
    expect(calls).toHaveLength(1);
    expect(calls[0].queryParamKeys).toBeNull();
  });

  it('RED → GREEN: reproduces the real search_registry bug class (q instead of term) and the fixed version', () => {
    // RED: this is (structurally) the real bug found by this check in registries.ts —
    // the route reads `term`/`limit`/`registry`, the tool sent `q` instead of `term`
    // and never sent `registry` at all.
    const buggySource = `
registerTool(server, 'search_registry', 'desc',
  { query: z.string(), environmentId: z.number().optional() },
  async ({ query, environmentId }) => {
    return jsonResponse(await client.get('/api/registry/search', { q: query, env: environmentId }));
  }
);
`;
    // Real /api/registry/search shape: `term` is REQUIRED (handler 400s without it),
    // `limit`/`registry` are optional.
    const searchSchemaParams = [
      { name: 'term', required: true },
      { name: 'limit', required: false },
      { name: 'registry', required: false },
    ];

    const buggyCall = extractToolCallsFromSource('registries.ts', buggySource)[0];
    const buggyDiff = diffQueryParams(buggyCall.queryParamKeys!, searchSchemaParams, {
      checkMissing: true,
    });
    expect(buggyDiff.unknown).toEqual(['q']);
    // `term` is required and never sent (the tool sent `q` instead) → hard failure.
    // `limit`/`registry` are optional and legitimately unsent — NOT flagged.
    expect(buggyDiff.missingRequired).toEqual(['term']);

    // GREEN: sending the real key names produces a clean diff.
    const fixedSource = `
registerTool(server, 'search_registry', 'desc',
  { query: z.string(), environmentId: z.number().optional() },
  async ({ query, environmentId }) => {
    return jsonResponse(await client.get('/api/registry/search', { term: query, env: environmentId }));
  }
);
`;
    const fixedCall = extractToolCallsFromSource('registries.ts', fixedSource)[0];
    const fixedDiff = diffQueryParams(fixedCall.queryParamKeys!, searchSchemaParams, {
      checkMissing: true,
    });
    expect(fixedDiff.unknown).toEqual([]);
    expect(fixedDiff.missingRequired).toEqual([]);
  });

  it('does not confuse a tool-level query param diff with sibling tools in the same file', () => {
    const source = `
registerTool(server, 'tool_a', 'desc', {}, async () => {
  return jsonResponse(await client.get('/api/a', { env: 1, foo: 'x' }));
});

registerTool(server, 'tool_b', 'desc', {}, async () => {
  return jsonResponse(await client.get('/api/b', { env: 1 }));
});
`;
    const calls = extractToolCallsFromSource('fake.ts', source);
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.toolName === 'tool_a')?.queryParamKeys).toEqual(['env', 'foo']);
    expect(calls.find((c) => c.toolName === 'tool_b')?.queryParamKeys).toEqual(['env']);
  });

  it('RED → GREEN: get_registry_catalog bug class — a ternary params argument no longer hides a missing required param', () => {
    // RED: this is the exact real shape from src/tools/registries.ts get_registry_catalog
    // before the fix — `environmentId ? { env: environmentId } : undefined` sends `env`
    // (whitelisted) but NEVER the actual `registry` query-param the real
    // /api/registry/catalog handler requires (400s without it). Before the ternary fix,
    // extractCallQueryParamKeys() returned `null` for this call (only handled a bare
    // `{...}` argument) — the query-param check silently skipped the whole call.
    const source = `
registerTool(server, 'get_registry_catalog', 'desc',
  { environmentId: z.number().optional() },
  async ({ environmentId }) => {
    return jsonResponse(await client.get('/api/registry/catalog', environmentId ? { env: environmentId } : undefined));
  }
);
`;
    const call = extractToolCallsFromSource('registries.ts', source)[0];
    // The ternary is now statically resolvable: `env` from the true-branch, nothing
    // (extra) from the false-branch (`undefined`).
    expect(call.queryParamKeys).toEqual(['env']);

    const diff = diffQueryParams(
      call.queryParamKeys!,
      [
        { name: 'registry', required: true },
        { name: 'last', required: false },
      ],
      { checkMissing: true }
    );
    expect(diff.missingRequired).toEqual(['registry']);
    expect(diff.unknown).toEqual([]);
  });

  it('RED → GREEN: reset_scanner_settings bug class — a call with NO params argument at all is checked, not skipped', () => {
    // RED: real shape from src/tools/system.ts reset_scanner_settings — the tool takes
    // no MCP-level arguments and calls `client.delete('/api/settings/scanner')` with no
    // second argument whatsoever. The real DELETE /api/settings/scanner handler 400s
    // without `removeImages=true`. Before this fix, a missing params argument returned
    // `null` (treated the same as "not statically analyzable") — indistinguishable from
    // a genuinely unresolvable call, so this always-broken tool call was never checked.
    const source = `
registerTool(server, 'reset_scanner_settings', 'desc', {}, async () => {
  return jsonResponse(await client.delete('/api/settings/scanner'));
});
`;
    const call = extractToolCallsFromSource('system.ts', source)[0];
    // No params argument at all is a definite fact: sends nothing — not "unknown".
    expect(call.queryParamKeys).toEqual([]);

    const diff = diffQueryParams(call.queryParamKeys!, [{ name: 'removeImages', required: true }], {
      checkMissing: true,
    });
    expect(diff.missingRequired).toEqual(['removeImages']);
  });
});
