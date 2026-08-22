/**
 * spec-loader — loads the committed docs/dockhand-openapi.json at runtime and looks up
 * a single operation by {method, path}, so `deriveToolDescription` (derive-description.ts)
 * can be fed the real spec operation for a tool's endpoint (toolEndpoint.ts).
 *
 * Runtime-availability note: the compiled server (`dist/index.js`, see Dockerfile) needs
 * this file to exist relative to the compiled module, not just in the dev tree — see the
 * Dockerfile change in this same commit that copies docs/dockhand-openapi.json into the
 * runtime image.
 */
import { describe, it, expect } from 'vitest';
import { specOperation, specInfoVersion } from '../src/openapi/spec-loader.js';

describe('specOperation', () => {
  it('returns undefined when the endpoint argument itself is undefined (unresolved tool)', () => {
    expect(specOperation(undefined)).toBeUndefined();
  });

  it('returns undefined for a method/path combination not present in the spec', () => {
    expect(specOperation({ method: 'GET', path: '/api/does/not/exist' })).toBeUndefined();
  });

  it('resolves a real operation and exposes its summary', () => {
    const op = specOperation({ method: 'GET', path: '/api/environments' });
    expect(op).toBeDefined();
    expect(typeof op!.summary).toBe('string');
    expect(op!.summary!.length).toBeGreaterThan(0);
  });

  it('is method-case-insensitive (spec paths key operations by lowercase HTTP verb)', () => {
    const lower = specOperation({ method: 'get', path: '/api/environments' });
    const upper = specOperation({ method: 'GET', path: '/api/environments' });
    expect(lower).toEqual(upper);
  });

  it('resolves the known get_git_stack_env_files operation with the expected real summary', () => {
    const op = specOperation({ method: 'GET', path: '/api/git/stacks/{id}/env-files' });
    expect(op?.summary).toContain('.env files');
  });
});

describe('specInfoVersion', () => {
  it("returns the real spec's info.version (used by get_tool_manifest, src/tools/meta.ts)", () => {
    // Same committed spec every other test in this file resolves operations against
    // (docs/dockhand-openapi.json) — its info.version is currently "1.0.43". Re-pin this
    // literal whenever scripts/fetch-openapi.mjs (SOURCE_COMMIT) is bumped, same as
    // PINNED_DOCKHAND_OPENAPI_COMMIT in src/openapi/pinned.ts.
    expect(specInfoVersion()).toBe('1.0.43');
  });
});
