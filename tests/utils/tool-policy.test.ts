import { describe, it, expect } from 'vitest';
import {
  WRITE_GET_TOOLS,
  READ_ONLY_POST_TOOLS,
  ToolPolicyError,
  compilePattern,
  classifyTool,
  buildToolPolicy,
  defaultToolPolicy,
  configureToolPolicy,
  currentToolPolicy,
  findMisspelledPolicyVars,
  READ_ONLY_ADAPTIVE_TOOLS,
  WRITE_META_TOOLS,
  effectiveMode,
} from '../../src/utils/tool-policy.js';
import { TOOL_ENDPOINT_MAP } from '../../src/openapi/tool-endpoint-map.js';
import { META_TOOL_NAMES } from '../../src/tools/meta.js';

const map = {
  get_a: { method: 'GET', path: '/a' },
  list_b: { method: 'GET', path: '/b' },
  trigger_git_webhook: { method: 'GET', path: '/hook' },
  restart_container: { method: 'POST', path: '/restart' },
  validate_stack_env: { method: 'POST', path: '/validate' },
  scan_image: { method: 'POST', path: '/scan' },
  delete_x: { method: 'DELETE', path: '/x' },
};
const meta = ['self_check'];
const universe = { endpointMap: map, metaToolNames: meta };
const ALL = [...Object.keys(map), ...meta];

function registered(env: Record<string, string | undefined>): string[] {
  const p = buildToolPolicy(env, universe);
  return ALL.filter((n) => p.isRegistered(n)).sort();
}

describe('constants', () => {
  it('pin the documented lists', () => {
    expect(WRITE_GET_TOOLS).toEqual([
      'trigger_git_webhook',
      'get_git_stack_webhook',
      'get_git_webhook',
      'browse_volume',
      'export_volume',
      'get_volume_file_content',
      'get_container_shells',
      'get_container_top',
      'list_container_files',
      'probe_backup_stack_dir',
      'get_selfhst_icon',
      'get_selfhst_icon_manifest',
      'get_git_repository_sync_status',
      'get_container_file_content',
      'get_scanner_settings',
      'get_oidc_login_url',
      'get_container_version_notes',
      'get_registry_catalog',
      'get_registry_tags',
      'get_registry_tag_info',
      'search_registry',
      'list_templates',
      'list_backup_snapshots',
      'browse_backup_snapshot',
      'download_backup_snapshot_file',
      'dump_backup_snapshot_file',
      'get_backup_snapshot_metadata',
      'diff_backup_snapshots',
    ]);
    expect(READ_ONLY_POST_TOOLS).toEqual([
      'validate_stack_env',
      'validate_stack_path',
      'check_stack_path_change',
    ]);
    expect(WRITE_META_TOOLS).toEqual(['check_for_update', 'validate_config']);
  });
});

describe('write meta tools (exhaustive audit, PR #318)', () => {
  const real = { endpointMap: TOOL_ENDPOINT_MAP, metaToolNames: META_TOOL_NAMES };

  it.each(['check_for_update', 'validate_config'])('%s is write despite being a meta tool', (name) => {
    expect(META_TOOL_NAMES).toContain(name);
    expect(classifyTool(name, TOOL_ENDPOINT_MAP, META_TOOL_NAMES)).toBe('write');
    expect(effectiveMode(name, false, TOOL_ENDPOINT_MAP, META_TOOL_NAMES)).toBe('write');
  });

  it('MCP_READ_ONLY drops them; an exact ALLOW name re-admits one', () => {
    const p = buildToolPolicy({ MCP_READ_ONLY: 'true' }, real);
    expect(p.isRegistered('check_for_update')).toBe(false);
    expect(p.isRegistered('validate_config')).toBe(false);
    expect(p.isRegistered('get_server_info')).toBe(true);
    const q = buildToolPolicy({ MCP_READ_ONLY: 'true', MCP_TOOLS_ALLOW: 'validate_config' }, real);
    expect(q.summary.readmittedWriteTools).toEqual(['validate_config']);
  });
});

describe('classifyTool', () => {
  it.each([
    ['get_a', 'read'],
    ['trigger_git_webhook', 'write'],
    ['validate_stack_env', 'read'],
    ['scan_image', 'write'],
    ['self_check', 'read'],
    ['unknown_tool', 'write'],
  ])('%s -> %s', (name, expected) => {
    expect(classifyTool(name, map, meta)).toBe(expected);
  });
});

describe('compilePattern', () => {
  it('anchors a trailing wildcard', () => {
    const m = compilePattern('get_*');
    expect(m('get_a')).toBe(true);
    expect(m('xget_a')).toBe(false);
  });
  it('supports a leading wildcard', () => {
    expect(compilePattern('*_b')('list_b')).toBe(true);
  });
  it('bare * matches everything', () => {
    const m = compilePattern('*');
    expect(m('anything')).toBe(true);
    expect(m('')).toBe(true);
  });
  it('supports multiple wildcards', () => {
    const m = compilePattern('a*b*c');
    expect(m('abc')).toBe(true);
    expect(m('a_x_b_y_c')).toBe(true);
    expect(m('a_x_b_y')).toBe(false);
  });
  it('treats regex metacharacters literally', () => {
    const m = compilePattern('get_.*');
    expect(m('get_.*')).toBe(true);
    expect(m('get_abc')).toBe(false);
    expect(() => compilePattern('list_(x)')).not.toThrow();
    expect(compilePattern('list_(x)')('list_(x)')).toBe(true);
  });
  it('is case-sensitive', () => {
    expect(compilePattern('get_*')('GET_a')).toBe(false);
  });
});

describe('buildToolPolicy', () => {
  it('registers everything by default', () => {
    const p = buildToolPolicy({}, universe);
    expect(registered({})).toEqual([...ALL].sort());
    expect(p.summary.readOnly).toBe(false);
    expect(p.summary.total).toBe(8);
    expect(p.summary.registered).toBe(8);
  });

  it('READ_ONLY registers only read tools', () => {
    expect(registered({ MCP_READ_ONLY: 'true' })).toEqual(
      ['get_a', 'list_b', 'self_check', 'validate_stack_env'],
    );
  });

  it('exact ALLOW re-admits a write tool under READ_ONLY', () => {
    const env = { MCP_READ_ONLY: 'true', MCP_TOOLS_ALLOW: 'scan_image,get_*' };
    expect(registered(env)).toEqual(['get_a', 'scan_image']);
    expect(buildToolPolicy(env, universe).summary.readmittedWriteTools).toEqual(['scan_image']);
  });

  it('a wildcard ALLOW does not re-admit write tools under READ_ONLY', () => {
    expect(() => buildToolPolicy({ MCP_READ_ONLY: 'true', MCP_TOOLS_ALLOW: 'scan_*' }, universe))
      .toThrow(/no tools registered/);
  });

  it('DENY beats ALLOW', () => {
    expect(() =>
      buildToolPolicy({ MCP_TOOLS_ALLOW: 'restart_container', MCP_TOOLS_DENY: 'restart_*' }, universe),
    ).toThrow(/no tools registered/);
  });

  it('DENY removes a tool', () => {
    expect(registered({ MCP_TOOLS_DENY: 'delete_x' })).toHaveLength(7);
  });

  it('trims entries and ignores empty ones', () => {
    const env = { MCP_TOOLS_DENY: ' get_* , ,list_*,' };
    const p = buildToolPolicy(env, universe);
    expect(registered(env)).toHaveLength(6);
    expect(p.summary.deny).toEqual(['get_*', 'list_*']);
    expect(p.summary.allow).toEqual([]);
  });

  it('empty final set is fatal', () => {
    expect(() => buildToolPolicy({ MCP_TOOLS_DENY: '*' }, universe)).toThrow(ToolPolicyError);
    expect(() => buildToolPolicy({ MCP_TOOLS_DENY: '*' }, universe)).toThrow(/no tools registered/);
  });

  it('DENY entry matching no tool names the variable and entry', () => {
    expect(() => buildToolPolicy({ MCP_TOOLS_DENY: 'contianer_*' }, universe)).toThrow(
      'MCP_TOOLS_DENY entry "contianer_*" matches no tool',
    );
  });

  it('ALLOW entry matching no tool names the variable and entry', () => {
    expect(() => buildToolPolicy({ MCP_TOOLS_ALLOW: 'nope' }, universe)).toThrow(
      'MCP_TOOLS_ALLOW entry "nope" matches no tool',
    );
  });

  it.each(['TRUE', 'Yes', '1'])('MCP_READ_ONLY=%s means read-only', (v) => {
    expect(buildToolPolicy({ MCP_READ_ONLY: v }, universe).summary.readOnly).toBe(true);
  });

  it.each(['false', '0', '', 'No'])('MCP_READ_ONLY=%j means not read-only', (v) => {
    expect(buildToolPolicy({ MCP_READ_ONLY: v }, universe).summary.readOnly).toBe(false);
  });

  it('invalid MCP_READ_ONLY is fatal', () => {
    expect(() => buildToolPolicy({ MCP_READ_ONLY: 'on' }, universe)).toThrow(
      'MCP_READ_ONLY must be true/false (got "on")',
    );
    expect(() => buildToolPolicy({ MCP_READ_ONLY: 'on' }, universe)).toThrow(ToolPolicyError);
  });

  it('mode() is independent of the filter', () => {
    const p = buildToolPolicy({ MCP_TOOLS_DENY: 'restart_container' }, universe);
    expect(p.mode('restart_container')).toBe('write');
    expect(p.isRegistered('restart_container')).toBe(false);
    expect(p.mode('get_a')).toBe('read');
  });

  it('summary carries only names and patterns', () => {
    const p = buildToolPolicy(
      { MCP_TOOLS_ALLOW: ' get_* ', DOCKHAND_PASSWORD: 'hunter2', MCP_TOOLS_DENY: 'delete_x' },
      universe,
    );
    expect(p.summary.allow).toEqual(['get_*']);
    expect(p.summary.deny).toEqual(['delete_x']);
    expect(JSON.stringify(p.summary)).not.toContain('hunter2');
  });
});

describe('default / configured policy', () => {
  it('default registers everything and classifies with the real map', () => {
    const p = defaultToolPolicy();
    expect(p.isRegistered('anything_at_all')).toBe(true);
    expect(p.summary.readOnly).toBe(false);
    expect(p.summary.total).toBe(new Set([...Object.keys(TOOL_ENDPOINT_MAP), ...META_TOOL_NAMES]).size);
    expect(p.mode('trigger_git_webhook')).toBe('write');
    // self_check runs its connection-test POST outside read-only, so it must not be advertised as read.
    expect(p.mode('self_check')).toBe('write');
    expect(p.mode('get_server_info')).toBe('read');
  });

  it('currentToolPolicy starts as default and can be reconfigured', () => {
    expect(currentToolPolicy().isRegistered('get_a')).toBe(true);
    const custom = buildToolPolicy({ MCP_TOOLS_DENY: 'get_a' }, universe);
    configureToolPolicy(custom);
    try {
      expect(currentToolPolicy()).toBe(custom);
    } finally {
      configureToolPolicy(defaultToolPolicy());
    }
  });
});

describe('read-only-adaptive tools (Codex review #318)', () => {
  const real = { endpointMap: TOOL_ENDPOINT_MAP, metaToolNames: META_TOOL_NAMES };

  it('lists self_check', () => {
    expect(READ_ONLY_ADAPTIVE_TOOLS).toEqual(['self_check']);
  });

  it('effectiveMode is write outside read-only and the static classification under it', () => {
    expect(effectiveMode('self_check', false, TOOL_ENDPOINT_MAP, META_TOOL_NAMES)).toBe('write');
    expect(effectiveMode('self_check', true, TOOL_ENDPOINT_MAP, META_TOOL_NAMES)).toBe('read');
    expect(effectiveMode('get_server_info', false, TOOL_ENDPOINT_MAP, META_TOOL_NAMES)).toBe('read');
    expect(classifyTool('self_check', TOOL_ENDPOINT_MAP, META_TOOL_NAMES)).toBe('read');
  });

  it('MCP_READ_ONLY keeps self_check registered and reports it as read', () => {
    const p = buildToolPolicy({ MCP_READ_ONLY: 'true' }, real);
    expect(p.isRegistered('self_check')).toBe(true);
    expect(p.mode('self_check')).toBe('read');
  });

  it('an allow-only filter reports self_check as write', () => {
    const p = buildToolPolicy({ MCP_TOOLS_ALLOW: 'self_check' }, real);
    expect(p.isRegistered('self_check')).toBe(true);
    expect(p.mode('self_check')).toBe('write');
  });
});

describe('findMisspelledPolicyVars', () => {
  it('flags near-miss names (case, underscores) with the variable they resemble', () => {
    expect(
      findMisspelledPolicyVars({
        MCP_READONLY: 'true',
        mcp_read_only: 'true',
        MCPTOOLS_ALLOW: 'get_*',
        MCP_TOOLSDENY: 'x',
      }),
    ).toEqual([
      { name: 'MCP_READONLY', expected: 'MCP_READ_ONLY' },
      { name: 'mcp_read_only', expected: 'MCP_READ_ONLY' },
      { name: 'MCPTOOLS_ALLOW', expected: 'MCP_TOOLS_ALLOW' },
      { name: 'MCP_TOOLSDENY', expected: 'MCP_TOOLS_DENY' },
    ]);
  });

  it('ignores the exact names and unrelated variables', () => {
    expect(
      findMisspelledPolicyVars({
        MCP_READ_ONLY: 'true',
        MCP_TOOLS_ALLOW: 'a',
        MCP_TOOLS_DENY: 'b',
        MCP_PORT: '8080',
        READ_ONLY: 'true',
      }),
    ).toEqual([]);
  });
});
