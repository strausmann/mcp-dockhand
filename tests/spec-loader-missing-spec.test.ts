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
// The logger writes via pino.destination({ fd: 2, sync: true }) (SonicBoom), which
// calls fs.writeSync(fd, ...) directly rather than console.error/process.stderr.write.
// Default import, not `import * as fs`: the namespace form is a frozen ES module
// object and vi.spyOn cannot redefine a property on it.
import fs from 'node:fs';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: () => false };
});

function captureLoggerOutput(): { written: string[]; restore: () => void } {
  const written: string[] = [];
  const spy = vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
    if (fd === 2) {
      const text = String(buffer);
      written.push(text);
      return Buffer.byteLength(text);
    }
    return 0;
  });
  return { written, restore: () => spy.mockRestore() };
}

describe('spec-loader — spec file missing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('specInfoVersion() returns undefined gracefully instead of throwing', async () => {
    const { written, restore } = captureLoggerOutput();
    const { specInfoVersion } = await import('../src/openapi/spec-loader.js');

    expect(specInfoVersion()).toBeUndefined();
    expect(written.length).toBeGreaterThan(0);
    restore();
  });

  it('specOperation() also degrades to undefined for the same missing-spec case (consistency check)', async () => {
    const { restore } = captureLoggerOutput();
    const { specOperation } = await import('../src/openapi/spec-loader.js');

    expect(specOperation({ method: 'GET', path: '/api/environments' })).toBeUndefined();
    restore();
  });
});
