/**
 * spec-loader's degrade path when docs/dockhand-openapi.json itself is missing at
 * runtime (see loadSpec()'s `!existsSync(SPEC_FILE)` branch — the only "spec
 * unavailable" case the loader actually handles).
 *
 * Deliberately its own file, not appended to tests/spec-loader.test.ts: `node:fs` is
 * mocked here so `loadSpec()` believes the spec file does not exist, and the loader
 * memoizes that result (`cachedSpec`) for the lifetime of the module. Vitest gives each
 * test FILE its own isolated module registry by default, so this mock — and the
 * resulting cached `null` — cannot leak into tests/spec-loader.test.ts's real,
 * spec-present assertions (or vice versa).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: () => false };
});

describe('spec-loader — spec file missing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('specInfoVersion() returns undefined gracefully instead of throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { specInfoVersion } = await import('../src/openapi/spec-loader.js');

    expect(specInfoVersion()).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('specOperation() also degrades to undefined for the same missing-spec case (consistency check)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { specOperation } = await import('../src/openapi/spec-loader.js');

    expect(specOperation({ method: 'GET', path: '/api/environments' })).toBeUndefined();
  });
});
