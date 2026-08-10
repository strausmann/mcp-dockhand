import { describe, it, expect } from 'vitest';
import { groupFindingsByType, buildBodyContractDoc } from '../scripts/lib/body-contract-report.mjs';

const findings = [
  { type: 'BODY_PARAM_UNKNOWN', field: 'bogus', toolName: 'create_stack', httpMethod: 'POST', path: '/api/stacks', file: 'stacks.ts', line: 10 },
  { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name', toolName: 'rename_container', httpMethod: 'POST', path: '/api/containers/{containerId}/rename', file: 'containers.ts', line: 205 },
  { type: 'UNTYPED_PASSTHROUGH', toolName: 'update_container', httpMethod: 'POST', path: '/api/containers/{containerId}/update', file: 'containers.ts', line: 209 },
  { type: 'UNTYPED_PASSTHROUGH', toolName: 'create_container', httpMethod: 'POST', path: '/api/containers', file: 'containers.ts', line: 150 },
];

describe('groupFindingsByType', () => {
  it('groups findings by type in the fixed, most-critical-first order', () => {
    const grouped = groupFindingsByType(findings);

    expect(grouped.map((g) => g.type)).toEqual(['BODY_PARAM_MISSING_REQUIRED', 'BODY_PARAM_UNKNOWN', 'UNTYPED_PASSTHROUGH']);
  });

  it('sorts entries within a group by tool name', () => {
    const grouped = groupFindingsByType(findings);
    const passthrough = grouped.find((g) => g.type === 'UNTYPED_PASSTHROUGH');

    expect(passthrough?.entries.map((e) => e.toolName)).toEqual(['create_container', 'update_container']);
  });

  it('appends an unknown/future finding type at the end instead of dropping it', () => {
    const withUnknown = [...findings, { type: 'SOME_FUTURE_TYPE', toolName: 'z_tool', httpMethod: 'POST', path: '/api/x', file: 'x.ts', line: 1 }];
    const grouped = groupFindingsByType(withUnknown);

    expect(grouped.at(-1)?.type).toBe('SOME_FUTURE_TYPE');
  });

  it('returns an empty array for no findings', () => {
    expect(groupFindingsByType([])).toEqual([]);
  });
});

describe('buildBodyContractDoc', () => {
  it('includes the advisory banner and a summary row per finding type', () => {
    const doc = buildBodyContractDoc({ generatedAt: '2026-08-10T12:00:00.000Z', bodyFindings: findings });

    expect(doc).toContain('ADVISORY');
    expect(doc).toContain('kein CI-Gate');
    expect(doc).toContain('| BODY_PARAM_MISSING_REQUIRED | 1 |');
    expect(doc).toContain('| BODY_PARAM_UNKNOWN | 1 |');
    expect(doc).toContain('| UNTYPED_PASSTHROUGH | 2 |');
  });

  it('lists every finding with tool, method, path, field, and file:line', () => {
    const doc = buildBodyContractDoc({ generatedAt: '2026-08-10T12:00:00.000Z', bodyFindings: findings });

    expect(doc).toContain('`rename_container`');
    expect(doc).toContain('`name`');
    expect(doc).toContain('containers.ts:205');
  });

  it('renders a field-less finding (UNTYPED_PASSTHROUGH) with a dash instead of a stray field cell', () => {
    const doc = buildBodyContractDoc({ generatedAt: '2026-08-10T12:00:00.000Z', bodyFindings: findings });

    expect(doc).toMatch(/\| `update_container` \| POST \| `\/api\/containers\/\{containerId\}\/update` \| - \| containers\.ts:209 \|/);
  });

  it('reports "no findings" clearly instead of an empty/confusing table for a clean run', () => {
    const doc = buildBodyContractDoc({ generatedAt: '2026-08-10T12:00:00.000Z', bodyFindings: [] });

    expect(doc).toContain('Keine Findings');
    expect(doc).not.toContain('## BODY_PARAM_MISSING_REQUIRED');
  });
});
