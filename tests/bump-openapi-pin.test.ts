import { describe, it, expect, vi } from 'vitest';
import {
  bumpOpenapiPin,
  fetchLatestMainSha,
  rewriteSourceCommitConstant,
  rewritePinnedConstant,
} from '../scripts/bump-openapi-pin.mjs';

/**
 * bump-openapi-pin.mjs decides whether the pinned upstream Finsys/dockhand OpenAPI
 * source commit needs to move, and if so rewrites BOTH mirrored constants
 * (SOURCE_COMMIT in fetch-openapi.mjs, PINNED_DOCKHAND_OPENAPI_COMMIT in pinned.ts).
 * These tests cover the pure decision/rewrite logic with an injected fetch and injected
 * fake filesystem -- no network, no real disk I/O. The scheduled workflow
 * (.github/workflows/drift-bump.yml) verifies the real end-to-end run.
 */

const OLD_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);

const FETCH_OPENAPI_FIXTURE = `const SOURCE_REPO = 'https://github.com/Finsys/dockhand.git';\nconst SOURCE_COMMIT = '${OLD_SHA}';\nconst SOURCE_BRANCH = 'main';\n`;

const PINNED_TS_FIXTURE = `export const PINNED_DOCKHAND_OPENAPI_COMMIT = '${OLD_SHA}';\n`;

function fakeFetch(sha: string, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => ({ sha }),
  });
}

describe('rewriteSourceCommitConstant', () => {
  it('replaces the SOURCE_COMMIT constant with the new SHA', () => {
    const result = rewriteSourceCommitConstant(FETCH_OPENAPI_FIXTURE, NEW_SHA);
    expect(result).toContain(`const SOURCE_COMMIT = '${NEW_SHA}';`);
    expect(result).not.toContain(OLD_SHA);
  });

  it('throws when the file does not contain a matching assignment', () => {
    expect(() => rewriteSourceCommitConstant('// nothing here', NEW_SHA)).toThrow();
  });
});

describe('rewritePinnedConstant', () => {
  it('replaces the PINNED_DOCKHAND_OPENAPI_COMMIT constant with the new SHA', () => {
    const result = rewritePinnedConstant(PINNED_TS_FIXTURE, NEW_SHA);
    expect(result).toContain(`export const PINNED_DOCKHAND_OPENAPI_COMMIT = '${NEW_SHA}';`);
    expect(result).not.toContain(OLD_SHA);
  });

  it('throws when the file does not contain a matching assignment', () => {
    expect(() => rewritePinnedConstant('// nothing here', NEW_SHA)).toThrow();
  });
});

describe('fetchLatestMainSha', () => {
  it('returns the sha from a successful GitHub API response', async () => {
    const sha = await fetchLatestMainSha(fakeFetch(NEW_SHA));
    expect(sha).toBe(NEW_SHA);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchLatestMainSha(fakeFetch(NEW_SHA, false))).rejects.toThrow(/500/);
  });

  it('throws when the response has no valid 40-char sha', async () => {
    const badFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sha: 'not-a-sha' }),
    });
    await expect(fetchLatestMainSha(badFetch)).rejects.toThrow(/valid 40-char/);
  });
});

describe('bumpOpenapiPin', () => {
  it('rewrites BOTH constants when the latest SHA differs from the pin', async () => {
    const files = new Map<string, string>([
      ['/repo/scripts/fetch-openapi.mjs', FETCH_OPENAPI_FIXTURE],
      ['/repo/src/openapi/pinned.ts', PINNED_TS_FIXTURE],
    ]);
    const readFile = vi.fn((path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`unexpected read: ${path}`);
      return content;
    });
    const writeFile = vi.fn((path: string, content: string) => {
      files.set(path, content);
    });

    const result = await bumpOpenapiPin({
      currentSha: OLD_SHA,
      fetchOpenapiPath: '/repo/scripts/fetch-openapi.mjs',
      pinnedTsPath: '/repo/src/openapi/pinned.ts',
      fetchLatestSha: async () => NEW_SHA,
      readFile,
      writeFile,
    });

    expect(result).toEqual({ changed: true, previousSha: OLD_SHA, newSha: NEW_SHA });
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(files.get('/repo/scripts/fetch-openapi.mjs')).toContain(
      `const SOURCE_COMMIT = '${NEW_SHA}';`
    );
    expect(files.get('/repo/src/openapi/pinned.ts')).toContain(
      `export const PINNED_DOCKHAND_OPENAPI_COMMIT = '${NEW_SHA}';`
    );
  });

  it('makes NO change when the latest SHA equals the pin', async () => {
    const readFile = vi.fn();
    const writeFile = vi.fn();

    const result = await bumpOpenapiPin({
      currentSha: OLD_SHA,
      fetchOpenapiPath: '/repo/scripts/fetch-openapi.mjs',
      pinnedTsPath: '/repo/src/openapi/pinned.ts',
      fetchLatestSha: async () => OLD_SHA,
      readFile,
      writeFile,
    });

    expect(result).toEqual({ changed: false, previousSha: OLD_SHA, newSha: OLD_SHA });
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
