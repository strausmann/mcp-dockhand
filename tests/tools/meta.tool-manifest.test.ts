import { describe, it, expect } from 'vitest';
import { buildToolManifest, META_TOOL_NAMES } from '../../src/tools/meta.js';

describe('buildToolManifest', () => {
  it('lists tools with endpoints and the pinned Dockhand OpenAPI identity', () => {
    const m = buildToolManifest({
      endpointMap: { get_container: { method: 'GET', path: '/containers/{id}' } },
      metaToolNames: [],
      openApiCommit: 'abcdef0',
      openApiVersion: '1.0.41',
      generatedAt: '2026-08-11T00:00:00Z',
    });
    expect(m.toolCount).toBe(1);
    expect(m.tools[0]).toEqual({ name: 'get_container', method: 'GET', path: '/containers/{id}' });
    expect(m.dockhandOpenApiCommit).toBe('abcdef0');
    expect(m.dockhandOpenApiVersion).toBe('1.0.41');
  });

  it('reflects an empty endpoint map and empty meta tool list as zero tools', () => {
    const m = buildToolManifest({
      endpointMap: {},
      metaToolNames: [],
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
      metaToolNames: [],
      openApiCommit: 'abcdef0',
      openApiVersion: '1.0.41',
      generatedAt: '2026-08-11T00:00:00Z',
    });
    expect(m.generatedAt).toBe('2026-08-11T00:00:00Z');
  });

  describe('meta tools (Fix round 2, Finding 4: get_tool_manifest must list every registered tool, including itself)', () => {
    it('appends each meta tool name with method:null, path:null', () => {
      const m = buildToolManifest({
        endpointMap: { get_container: { method: 'GET', path: '/containers/{id}' } },
        metaToolNames: ['self_check', 'get_tool_manifest'],
        openApiCommit: 'abcdef0',
        openApiVersion: '1.0.41',
        generatedAt: '2026-08-11T00:00:00Z',
      });

      expect(m.toolCount).toBe(3);
      expect(m.tools).toContainEqual({ name: 'get_container', method: 'GET', path: '/containers/{id}' });
      expect(m.tools).toContainEqual({ name: 'self_check', method: null, path: null });
      expect(m.tools).toContainEqual({ name: 'get_tool_manifest', method: null, path: null });
    });

    it('toolCount equals endpointMap size plus metaToolNames length, and the manifest never omits get_tool_manifest itself', () => {
      const endpointMap = {
        get_container: { method: 'GET', path: '/containers/{id}' },
        list_containers: { method: 'GET', path: '/containers' },
      };
      const m = buildToolManifest({
        endpointMap,
        metaToolNames: META_TOOL_NAMES,
        openApiCommit: 'abcdef0',
        openApiVersion: '1.0.41',
        generatedAt: '2026-08-11T00:00:00Z',
      });

      expect(m.toolCount).toBe(Object.keys(endpointMap).length + META_TOOL_NAMES.length);
      expect(m.tools.map((t) => t.name)).toContain('get_tool_manifest');
      expect(m.tools.map((t) => t.name)).toEqual(expect.arrayContaining([...META_TOOL_NAMES]));
    });

    it('every META_TOOL_NAMES entry in the built manifest has method:null and path:null', () => {
      const m = buildToolManifest({
        endpointMap: {},
        metaToolNames: META_TOOL_NAMES,
        openApiCommit: 'abcdef0',
        openApiVersion: '1.0.41',
        generatedAt: '2026-08-11T00:00:00Z',
      });

      for (const name of META_TOOL_NAMES) {
        const entry = m.tools.find((t) => t.name === name);
        expect(entry, name).toBeDefined();
        expect(entry).toEqual({ name, method: null, path: null });
      }
    });
  });
});
