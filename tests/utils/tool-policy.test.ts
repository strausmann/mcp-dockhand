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
    ]);
    expect(READ_ONLY_POST_TOOLS).toEqual([
      'validate_stack_compose',
      'validate_stack_env',
      'validate_stack_path',
      'check_stack_path_change',
    ]);
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
    expect(p.mode('self_check')).toBe('read');
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
