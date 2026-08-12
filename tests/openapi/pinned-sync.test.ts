import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_DOCKHAND_OPENAPI_COMMIT } from '../../src/openapi/pinned.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FETCH_OPENAPI_SCRIPT = join(__dirname, '..', '..', 'scripts', 'fetch-openapi.mjs');

/**
 * Enforces that src/openapi/pinned.ts (PINNED_DOCKHAND_OPENAPI_COMMIT -- a hand-maintained
 * mirror, see that file's header comment) never drifts from scripts/fetch-openapi.mjs's
 * SOURCE_COMMIT, the actual pinned Dockhand OpenAPI source commit. `get_tool_manifest`
 * exists precisely to surface this kind of drift to callers -- a stale mirror here would be
 * the same drift, self-inflicted and invisible.
 *
 * Reads the script as plain text and extracts SOURCE_COMMIT via regex, then asserts the
 * regex actually matched before comparing anything. Without that guard, a future rename or
 * reshaping of the constant (e.g. `SOURCE_COMMIT = SOME_OTHER_CONST`) would make the regex
 * match nothing, both sides of a naive comparison would end up `undefined`, and this test
 * would pass while silently testing nothing at all.
 */
describe('pinned Dockhand OpenAPI commit stays in sync', () => {
  it('src/openapi/pinned.ts mirrors scripts/fetch-openapi.mjs SOURCE_COMMIT exactly', () => {
    const scriptSource = readFileSync(FETCH_OPENAPI_SCRIPT, 'utf8');
    const match = scriptSource.match(/SOURCE_COMMIT\s*=\s*['"]([0-9a-f]{40})['"]/);

    expect(
      match,
      'Could not find SOURCE_COMMIT in scripts/fetch-openapi.mjs -- update the regex above if the script changed shape'
    ).not.toBeNull();

    const sourceCommit = match![1];
    expect(PINNED_DOCKHAND_OPENAPI_COMMIT).toBe(sourceCommit);
  });
});
