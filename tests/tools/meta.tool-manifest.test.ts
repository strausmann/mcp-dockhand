import { describe, it, expect } from 'vitest';
import { buildToolManifest } from '../../src/tools/meta.js';

describe('buildToolManifest', () => {
  it('lists tools with endpoints and the pinned Dockhand OpenAPI identity', () => {
    const m = buildToolManifest({
      endpointMap: { get_container: { method: 'GET', path: '/containers/{id}' } },
      openApiCommit: 'abcdef0',
      openApiVersion: '1.0.41',
      generatedAt: '2026-08-11T00:00:00Z',
    });
    expect(m.toolCount).toBe(1);
    expect(m.tools[0]).toEqual({ name: 'get_container', method: 'GET', path: '/containers/{id}' });
    expect(m.dockhandOpenApiCommit).toBe('abcdef0');
    expect(m.dockhandOpenApiVersion).toBe('1.0.41');
  });

  it('reflects an empty endpoint map as zero tools', () => {
    const m = buildToolManifest({
      endpointMap: {},
      openApiCommit: 'abcdef0',
      openApiVersion: '1.0.41',
      generatedAt: '2026-08-11T00:00:00Z',
    });
    expect(m.toolCount).toBe(0);
    expect(m.tools).toEqual([]);
  });

  it('passes generatedAt through unchanged', () => {
    const m = buildToolManifest({
      endpointMap: {},
      openApiCommit: 'abcdef0',
      openApiVersion: '1.0.41',
      generatedAt: '2026-08-11T00:00:00Z',
    });
    expect(m.generatedAt).toBe('2026-08-11T00:00:00Z');
  });
});
