import { describe, it, expect } from 'vitest';
import { areaOf, groupMissingByArea, buildCoverageDoc } from '../scripts/lib/coverage-report.mjs';

describe('areaOf', () => {
  it('extracts the first path segment after /api/', () => {
    expect(areaOf('/api/backup/schedule')).toBe('backup');
    expect(areaOf('/api/stacks/{id}/env')).toBe('stacks');
    expect(areaOf('/api/containers/{id}')).toBe('containers');
  });

  it('falls back to the full path when there is no /api/ prefix', () => {
    expect(areaOf('/weird/path')).toBe('/weird/path');
  });

  it('handles a bare /api/ with no further segment', () => {
    expect(areaOf('/api/')).toBe('/api/');
    expect(areaOf('/api')).toBe('/api');
  });
});

describe('groupMissingByArea', () => {
  it('groups entries by area and sorts areas alphabetically', () => {
    const missing = [
      { path: '/api/backup/schedule', method: 'GET', pathParams: [] },
      { path: '/api/stacks/{id}/env', method: 'PUT', pathParams: ['id'] },
      { path: '/api/backup/restore', method: 'POST', pathParams: [] },
    ];
    const grouped = groupMissingByArea(missing);
    expect(grouped.map((g) => g.area)).toEqual(['backup', 'stacks']);
    expect(grouped[0].entries).toHaveLength(2);
    expect(grouped[1].entries).toHaveLength(1);
  });

  it('sorts entries within an area by path then method', () => {
    const missing = [
      { path: '/api/backup/schedule', method: 'POST', pathParams: [] },
      { path: '/api/backup/schedule', method: 'GET', pathParams: [] },
      { path: '/api/backup/history', method: 'GET', pathParams: [] },
    ];
    const [group] = groupMissingByArea(missing);
    expect(group.entries.map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /api/backup/history',
      'GET /api/backup/schedule',
      'POST /api/backup/schedule',
    ]);
  });

  it('returns an empty array for no missing endpoints', () => {
    expect(groupMissingByArea([])).toEqual([]);
  });
});

describe('buildCoverageDoc', () => {
  const baseInput = {
    generatedAt: '2026-08-10T00:00:00.000Z',
    sourceCommit: '905c4a004dafe1cbad4ed2babc2c532d7f4018b8',
    schemaEndpointCount: 235,
    covered: [
      { path: '/api/containers', method: 'GET', tools: ['list_containers'] },
      { path: '/api/containers/{id}', method: 'GET', tools: ['get_container'] },
    ],
    missingTool: [
      { path: '/api/backup/schedule', method: 'GET', pathParams: [] },
      { path: '/api/backup/restore', method: 'POST', pathParams: [] },
      { path: '/api/stacks/{id}/env', method: 'PUT', pathParams: ['id'] },
    ],
    orphanedTool: [],
    excludedCount: 11,
  };

  it('is marked as auto-generated and states the source commit', () => {
    const doc = buildCoverageDoc(baseInput);
    expect(doc).toContain('Auto-generiert');
    expect(doc).toContain('905c4a00');
  });

  it('computes coverage percentage from covered vs. covered+missing (in-scope endpoints)', () => {
    // 2 covered + 3 missing = 5 in-scope, 2/5 = 40.0%
    const doc = buildCoverageDoc(baseInput);
    expect(doc).toContain('40.0%');
    expect(doc).toContain('2/5');
  });

  it('reports 100% when there is no missing tool at all', () => {
    const doc = buildCoverageDoc({ ...baseInput, missingTool: [] });
    expect(doc).toContain('100.0%');
  });

  it('groups MISSING_TOOL entries by area with counts', () => {
    const doc = buildCoverageDoc(baseInput);
    expect(doc).toContain('backup');
    expect(doc).toContain('stacks');
    // backup area has 2 missing endpoints
    expect(doc).toMatch(/backup.*\(2\)/);
    expect(doc).toMatch(/stacks.*\(1\)/);
  });

  it('lists individual missing endpoints with method and path', () => {
    const doc = buildCoverageDoc(baseInput);
    expect(doc).toContain('/api/backup/schedule');
    expect(doc).toContain('/api/backup/restore');
    expect(doc).toContain('/api/stacks/{id}/env');
  });

  it('includes the excluded-endpoints count', () => {
    const doc = buildCoverageDoc(baseInput);
    expect(doc).toContain('11');
  });

  it('includes an ORPHANED_TOOL section only when there are orphaned tools', () => {
    const clean = buildCoverageDoc(baseInput);
    expect(clean).not.toContain('## ORPHANED_TOOL');

    const withOrphans = buildCoverageDoc({
      ...baseInput,
      orphanedTool: [
        { toolName: 'ghost_tool', httpMethod: 'GET', path: '/api/removed', file: 'ghost.ts', line: 42 },
      ],
    });
    expect(withOrphans).toContain('ORPHANED_TOOL');
    expect(withOrphans).toContain('ghost_tool');
    expect(withOrphans).toContain('ghost.ts:42');
  });

  it('does not crash when there are no missing endpoints at all', () => {
    const doc = buildCoverageDoc({ ...baseInput, missingTool: [] });
    expect(doc).toContain('# ');
  });
});
